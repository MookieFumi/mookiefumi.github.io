---
title: "Funciona en tu máquina con 200 filas"
subtitle: Listados sin límite, Skip/Take que se ralentiza página a página y la alternativa que no se entera de cuánto has avanzado
description: "Cómo paginar bien con Entity Framework Core: por qué un listado sin Take se rompe con datos reales, el coste de Skip y Take (offset) y cómo funciona la paginación por keyset, con medidas sobre un millón de filas."
date: 2026-10-18
topic: dotnet
series: ef-core
published: false
---

El listado de expediciones de un almacén se probó con 200 filas y funcionaba. Un año después hay dos millones y la página tarda en abrir, el servidor consume memoria y alguien descubre que el código era esto:

```csharp
var shipments = await db.Shipments.ToListAsync();
```

La documentación de Microsoft lo dice así: como el número de filas depende de los datos reales, es imposible saber cuántos se van a cargar, y las bases de datos de prueba suelen tener pocos datos, así que los problemas aparecen cuando la consulta llega a datos reales.

## Primer nivel: poner un límite

Lo mínimo es que ninguna consulta de listado pueda devolver un número ilimitado de filas:

```csharp
var shipments = await db.Shipments
    .OrderBy(s => s.ShippedAt).ThenBy(s => s.Id)
    .Take(25)
    .ToListAsync();
```

Con eso el servidor está a salvo. Para que el usuario vea más hace falta paginar.

## Paginación por offset: Skip y Take

Lo más intuitivo es saltarse las filas de las páginas anteriores:

```csharp
var page = 1000;
var size = 25;

var shipments = await db.Shipments
    .OrderBy(s => s.ShippedAt).ThenBy(s => s.Id)
    .Skip((page - 1) * size)
    .Take(size)
    .ToListAsync();
```

En SQL es `OFFSET` y `LIMIT`. Tiene dos problemas, y la documentación de EF Core los nombra:

1. La base de datos tiene que recorrer las filas que se salta. Cuanto más avanzas, más trabajo.
2. Si hay cambios mientras el usuario navega, se pierden o se repiten filas. Si se borra una fila de la página 2 cuando el usuario va a la 3, todo se desplaza y una fila se queda sin mostrar.

Lo medí sobre un millón de envíos en SQLite, con un índice por `(ShippedAt, Id)` y páginas de 25 filas. Mediana de 15 ejecuciones ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills)):

| Página | Offset |
|---|---|
| 1 | menos de 1 ms |
| 1.000 | menos de 1 ms |
| 20.000 | 13 ms |
| 40.000 | 26 ms |

El tiempo crece de forma lineal con la posición. Aquí hablamos de milisegundos porque SQLite, el índice y el equipo local son muy favorables. Con una consulta con filtros, joins y una base de datos compartida, el coste es mucho mayor. Lo importante es la forma de la curva.

## Paginación por keyset

La alternativa que recomienda la documentación es no usar un desplazamiento, sino recordar la última fila vista y pedir las siguientes:

```csharp
var next = await db.Shipments
    .Where(s => s.ShippedAt > last.ShippedAt
             || (s.ShippedAt == last.ShippedAt && s.Id > last.Id))
    .OrderBy(s => s.ShippedAt).ThenBy(s => s.Id)
    .Take(25)
    .ToListAsync();
```

El cliente devuelve la última fila (o un token que la codifique) y el servidor sigue desde ahí. Con el índice adecuado, la base de datos va directamente al punto de partida. En la misma prueba, la paginación por keyset tardó menos de 1 ms en las cuatro páginas, incluida la 40.000.

Además no sufre los cambios concurrentes: aunque se borren filas anteriores, la siguiente página empieza justo después de la última fila que viste.

## La trampa: el orden tiene que ser único

Fíjate en que el ejemplo ordena por `ShippedAt` y después por `Id`. No es un adorno. En la demo hay tres envíos por cada minuto: ordenar solo por fecha deja empates, y la base de datos puede devolver los empatados en cualquier orden, distinto entre dos consultas. La documentación avisa de que, con orden no único, la paginación puede saltarse o repetir filas, y de que las bases de datos relacionales no garantizan ningún orden por defecto, ni siquiera por clave primaria.

Regla: el `OrderBy` de una paginación termina siempre en una columna única, normalmente el `Id`. Y el índice debe coincidir con ese orden: `(ShippedAt, Id)` en nuestro caso.

## Lo que no te da el keyset

Con keyset solo puedes ir a la siguiente o a la anterior. No puedes saltar a la página 37 ni mostrar «página 37 de 4.000». Si el producto necesita acceso aleatorio, hay que usar offset. La documentación propone una mezcla: keyset para avanzar y retroceder, offset solo cuando el usuario salta a una página lejana.

Antes de aceptar el requisito de «ir a la página N», conviene preguntar si alguien lo usa. En muchos listados, el usuario filtra y avanza, o busca y abre un resultado.

Un detalle más: EF Core no puede expresar todavía la comparación de tuplas `WHERE (ShippedAt, Id) > (@a, @b)` que admiten muchas bases de datos, por eso hay que escribir la condición con `||` como arriba. Está registrado en el repositorio de EF Core.

## Resumen

| Situación | Qué usar |
|---|---|
| Ninguna consulta de lista sin límite | `Take` como mínimo |
| Páginas numeradas, datos pequeños | `Skip` y `Take` con orden único |
| Listado largo, avance y retroceso | Keyset con orden único e índice |
| Tablas grandes con salto a página arbitraria | Mezcla de ambos |
