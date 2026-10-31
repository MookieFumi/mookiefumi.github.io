---
title: "ToList().Where(): traes la tabla entera para quedarte con tres filas"
subtitle: El filtro que llega tarde, porque ya se ejecutó la consulta
description: "Por qué filtrar con Where después de ToList en Entity Framework Core carga toda la tabla en memoria, qué cambió en EF Core 3.0 con la evaluación en cliente y cómo detectar y corregir este error."
date: 2026-10-15
topic: dotnet
series: ef-core
published: false
---

Hay un error de EF Core que no da error. Compila, devuelve el resultado correcto y funciona perfectamente en desarrollo:

```csharp
var pending = (await db.Orders.ToListAsync())
    .Where(o => o.Status == "Pending" && o.CustomerId == 7)
    .ToList();
```

La consulta que se envía a la base de datos es `SELECT ... FROM Orders`, sin `WHERE`. Todo el contenido de la tabla viaja a la aplicación, se convierte en objetos y entonces C# filtra los que te interesan. El resto se tira.

## Qué cuesta

En la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills)) hay 20.000 pedidos, cada uno con un PDF de 20 KB, y el cliente 7 tiene 15 pedidos pendientes:

| Versión | Filas leídas | Tiempo |
|---|---|---|
| `ToList().Where(...)` | 20.000 | 1.224 ms |
| `Where(...).ToList()` | 15 | menos de 1 ms |

(Medianas de 3 ejecuciones, en SQLite local.) Las 15 filas eran las mismas. El resultado no cambia; lo que cambia es cuánto trabajo se hace para llegar a él. Con la tabla creciendo, la primera versión crece con ella y la segunda no.

La corrección es mover el filtro antes de materializar:

```csharp
var pending = await db.Orders
    .Where(o => o.Status == "Pending" && o.CustomerId == 7)
    .ToListAsync();
```

Ahora EF genera `WHERE "o"."Status" = 'Pending' AND "o"."CustomerId" = 7` y la base de datos usa el índice que tenga para ello.

## El principio: dónde está la frontera

Una consulta de EF Core es una expresión que se construye con operadores (`Where`, `OrderBy`, `Select`...) mientras sigue siendo `IQueryable`. En el momento en que la materializas (`ToList`, `ToArray`, `AsEnumerable`, un `foreach`...) EF la traduce a SQL y la ejecuta. Todo lo que escribas después es LINQ en memoria, sobre los datos que ya llegaron.

Por eso importa el orden de los operadores. Todo lo que quieras que haga la base de datos va antes del materializador.

## Variantes más sutiles

El `ToList()` explícito se ve en una revisión. Estas variantes no tanto:

- `AsEnumerable()` en mitad de una cadena, quizá porque había un método que EF no traducía y alguien lo «arregló» así.
- Un método de repositorio que devuelve `IEnumerable<Order>` en vez de `IQueryable<Order>`: quien lo llama añade un `Where` y cree que filtra en la base de datos, pero ya se ejecutó.
- Un `.Where(o => MiMetodo(o))` donde `MiMetodo` es código propio.

Esto último lleva a un cambio importante de EF Core 3.0. Hasta entonces, el filtro con un método propio se evaluaba en cliente sin avisar. Desde la 3.0, si EF encuentra una expresión que no puede traducir en cualquier sitio que no sea la proyección final, lanza una excepción en tiempo de ejecución. La documentación lo justifica así: cargar todos los datos para filtrar en cliente puede producir problemas de rendimiento que pasan desapercibidos.

```csharp
// Throws InvalidOperationException: EF cannot translate StandardizeUrl to SQL.
var blogs = await db.Blogs
    .Where(b => StandardizeUrl(b.Url).Contains("dotnet"))
    .ToListAsync();
```

Así que EF te protege cuando no sabe traducir. No te protege cuando tú mismo materializas antes del filtro.

## Cuándo filtrar en memoria es lo correcto

Hay casos legítimos, y EF los permite de forma explícita:

- Pocos datos y un criterio que no se puede expresar en SQL.
- Un operador sin traducción para tu proveedor.

En esos casos, hazlo a propósito, con el filtro en la base de datos todo lo que puedas y el resto después:

```csharp
var result = db.Blogs
    .Where(b => b.Rating > 3)       // translated to SQL
    .AsEnumerable()
    .Where(b => StandardizeUrl(b.Url).Contains("dotnet")); // runs in memory
```

`AsEnumerable()` hace streaming, es decir, procesa fila a fila sin cargar todo el resultado a la vez, y el segundo `Where` se evalúa en memoria sobre cada fila que llega. `ToList()` cargaría todo en memoria primero. La documentación aconseja no usar `ToList` si después vas a encadenar otro operador de LINQ.

## Cómo detectarlo

- Mira el SQL: si no tiene el `WHERE` que esperabas, el filtro está en otro sitio.
- Cuenta filas: el log de EF o un interceptor te dicen cuántas filas leyó la consulta. Si leyó 20.000 y tu pantalla muestra 15, hay un filtro de más en memoria.
- En las revisiones de código, busca `ToList()`, `ToArray()` y `AsEnumerable()` seguidos de `Where`, `OrderBy` o `Select`.
