---
title: "Select antes de ToList: pide solo lo que vas a enseñar"
subtitle: Cuando el listado trae hasta el PDF de cada pedido, y la base de datos lo manda por la red
description: "Por qué traer la entidad entera con ToList penaliza las consultas de lectura en Entity Framework Core, y cómo Select con un DTO reduce columnas, datos transferidos y tiempo, con SQL generado real."
date: 2026-10-25
topic: dotnet
series: ef-core
published: false
---

El panel de administración lista pedidos: número, estado e importe. La tabla `Orders` tiene más columnas de las que aparecen en pantalla, entre ellas unas notas largas y la factura en PDF guardada como `varbinary`. El código que alimenta el listado es este:

```csharp
var orders = await db.Orders
    .AsNoTracking()
    .OrderBy(o => o.Id)
    .Take(2000)
    .ToListAsync();
```

Parece correcto: ya lleva `AsNoTracking()`. El problema está en lo que no se ve. EF Core genera esto:

```sql
SELECT "o"."Id", "o"."CreatedAt", "o"."CustomerId", "o"."InvoicePdf", "o"."Notes", "o"."Status", "o"."Total"
FROM "Orders" AS "o"
ORDER BY "o"."Id"
LIMIT @p
```

Siete columnas, entre ellas `InvoicePdf`, solo para pintar tres. Si la tabla tiene treinta, son treinta. Cada una viaja de la base de datos a la aplicación y se convierte en un objeto.

## La corrección: pedir solo lo que se muestra

```csharp
public record OrderRow(int Id, string Status, decimal Total);

var orders = await db.Orders
    .AsNoTracking()
    .OrderBy(o => o.Id)
    .Take(2000)
    .Select(o => new OrderRow(o.Id, o.Status, o.Total))
    .ToListAsync();
```

El SQL cambia:

```sql
SELECT "o"."Id", "o"."Status", "o"."Total"
FROM "Orders" AS "o"
ORDER BY "o"."Id"
LIMIT @p
```

Tres columnas en vez de siete. En la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCorePills/Pills/Projection)), con 2.000 pedidos de ~20 KB de PDF cada uno, la versión con la entidad entera tardó unos 20 ms y la proyección unos 6 ms. Es una sola ejecución, no una medida fina, y SQLite lee de un fichero local. Con una base de datos remota la diferencia en red es mayor, porque lo que viaja es la columna de 20 KB multiplicada por 2.000, unos 40 MB frente a unos pocos KB.

La documentación de Microsoft lo recoge en su guía de consultas eficientes: usa `Select` para proyectar solo las propiedades que necesitas, sobre todo en consultas de solo lectura.

## Con `Include`, el problema crece

Este es un efecto menos conocido. Cuando cargas una colección con `Include`, EF hace un `JOIN`, y cada fila del resultado repite las columnas de la entidad principal. Si el pedido tiene una columna de 20 KB y diez líneas, ese PDF viaja diez veces. La documentación lo explica con un ejemplo de `HugeColumn`. Proyectar elimina el problema de raíz:

```csharp
var orders = await db.Orders
    .Select(o => new { o.Id, o.Status, o.Lines })
    .ToListAsync();
```

## Lo que pierdes

Una proyección a un DTO o a un tipo anónimo no es una entidad. EF no la rastrea, así que no puedes modificarla y guardar. Si necesitas actualizar, hay dos caminos:

- cargar la entidad entera por su id en el comando de escritura (es una sola fila, no importa);
- usar `ExecuteUpdate`, que no necesita cargar nada (lo vemos en la píldora de `SaveChanges` en bucle).

Esto lleva de forma natural a separar la lectura de la escritura: los listados y las pantallas de consulta proyectan a DTOs, y los comandos que cambian datos trabajan con entidades. No hace falta ninguna arquitectura especial para eso.

## Mantener la proyección sin repetirla

Si repites el mismo `Select` en cinco sitios, saca el mapeo a un método de extensión sobre `IQueryable<Order>`:

```csharp
public static IQueryable<OrderRow> ToRows(this IQueryable<Order> orders) =>
    orders.Select(o => new OrderRow(o.Id, o.Status, o.Total));
```

Tiene que ser una expresión que EF pueda traducir: sin llamadas a métodos propios dentro del `Select`, o la parte que no se pueda traducir se ejecutará en memoria o dará error.

## Cuándo no merece la pena

Si la tabla es pequeña, si de verdad necesitas todas las columnas o si vas a modificar el objeto que cargas, trae la entidad. El `Select` es una optimización que pesa cuando hay columnas anchas, muchas filas o latencia de red. En una tabla de cinco columnas estrechas y cien filas no cambia nada.
