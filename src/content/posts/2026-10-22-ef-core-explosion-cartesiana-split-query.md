---
title: "Dos Include, 5.000 filas: cuando EF multiplica en vez de sumar"
subtitle: Cargar dos colecciones a la vez cruza todas sus filas, y AsSplitQuery lo evita con un coste que conviene conocer
description: "Qué es la explosión cartesiana en Entity Framework Core con varios Include de colecciones, cuándo ocurre y no, cómo AsSplitQuery la evita y los inconvenientes de las consultas divididas."
date: 2026-10-22
topic: dotnet
series: ef-core
published: false
---

Un pedido tiene líneas y pagos. Cargar las dos cosas parece lo más natural:

```csharp
var orders = await db.Orders
    .OrderBy(o => o.Id)
    .Take(50)
    .Include(o => o.Lines)
    .Include(o => o.Payments)
    .ToListAsync();
```

Una consulta, dos `Include`. Sin embargo, esa consulta no devuelve 50 + 500 + 500 filas. Devuelve 5.000.

## Qué pasa en el `JOIN`

Para traer las líneas y los pagos de golpe, EF genera una sola sentencia con dos `LEFT JOIN`. Las líneas y los pagos cuelgan del mismo pedido, así que la base de datos los combina todos con todos: cada una de las 10 líneas de un pedido se junta con cada uno de sus 10 pagos. Son 100 filas por pedido, y con 50 pedidos, 5.000.

A este efecto se le llama explosión cartesiana. La documentación de Microsoft lo explica con 10 posts y 10 colaboradores por blog: 100 filas para un solo blog. Cada colección hermana que añadas multiplica el total.

Lo medí en la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCorePills/Pills/CartesianExplosion)), con 50 pedidos de 10 líneas y 10 pagos cada uno:

| Modo | Comandos | Filas | Tiempo (mediana de 5) |
|---|---|---|---|
| Una sola consulta | 1 | 5.000 | 91 ms |
| Consulta dividida | 3 | unas 1.050 (50 + 500 + 500) | 2 ms |

En los dos casos, el código recibe exactamente lo mismo: 500 líneas y 500 pagos. La diferencia es cuántos datos repetidos han cruzado el cable para llegar a ellos. Las 1.050 de la consulta dividida son una suma de lo cargado, no una medición directa del lector.

## Cuándo ocurre y cuándo no

Solo pasa con colecciones al mismo nivel: dos `Include` sobre el mismo padre. Una cadena anidada no lo provoca:

```csharp
// No cartesian product: Comments hang from Posts, not from Blogs.
db.Blogs.Include(b => b.Posts).ThenInclude(p => p.Comments)
```

Aquí hay una fila por comentario, sin multiplicación entre hermanos. La documentación lo muestra con este mismo contraste.

## La corrección: `AsSplitQuery`

```csharp
var orders = await db.Orders
    .OrderBy(o => o.Id)
    .Take(50)
    .Include(o => o.Lines)
    .Include(o => o.Payments)
    .AsSplitQuery()
    .ToListAsync();
```

EF lanza una consulta para los pedidos y una por cada colección incluida. Tres comandos en la demo. Cada consulta devuelve solo lo suyo, sin duplicar.

EF te avisa si no has decidido. Cuando una consulta carga varias colecciones y no has indicado `AsSingleQuery` ni `AsSplitQuery` ni un valor global, genera una advertencia. Puedes configurarlo para todo el contexto:

```csharp
optionsBuilder.UseSqlServer(connectionString,
    o => o.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery));
```

Y volver a una consulta única donde convenga con `AsSingleQuery()`.

## Lo que cuesta dividir

La documentación enumera los inconvenientes, y conviene tenerlos presentes antes de ponerlo en todas partes:

- Más viajes a la base de datos. Cada consulta es una ida y vuelta. Con la base de datos lejos, tres viajes pueden costar más que una consulta gorda.
- Consistencia. Las consultas se ejecutan por separado: si alguien modifica datos entre una y otra, el resultado puede ser incoherente. Se puede mitigar con una transacción serializable o snapshot, con su propio coste.
- Memoria. Con algunos motores solo puede haber una consulta activa por conexión, así que los resultados de las primeras consultas se guardan en memoria hasta lanzar las siguientes.
- Orden único con `Skip` y `Take`. Antes de EF 10, si combinas consulta dividida con paginación, el orden tiene que ser completamente único; si no, las consultas pueden devolver datos inconsistentes.
- Si además incluyes navegaciones de referencia, cada consulta dividida repite los `JOIN` a ellas.

## Alternativas

Antes de elegir entre una gran consulta y varias, pregúntate si necesitas las dos colecciones completas. Una proyección con solo lo que muestras (la píldora anterior) suele evitar el problema entero: si de las líneas solo quieres el total, ni las traes.

Otra opción es dividir a mano: una consulta para los pedidos y otra para los pagos de esos ids, que es lo que hace `AsSplitQuery` pero con control total sobre cada una.

## Cuándo no tocarlo

Si la consulta con dos colecciones es rápida con datos reales, déjala. La advertencia de EF es una invitación a decidir, no a dividir por sistema. Otros desarrolladores han documentado casos de timeouts que solo se resolvieron con `AsSplitQuery`, y el criterio es el mismo en todos: medir con datos de producción y mirar el número de filas, no solo el tiempo.
