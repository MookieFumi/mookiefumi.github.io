---
title: "N+1: la multiplicación que solo se ve con datos reales"
subtitle: El bucle que le pregunta a la base de datos lo mismo una vez por cada fila
description: "Qué es el problema N+1 en Entity Framework Core, cómo lo provocan el lazy loading y las consultas dentro de un bucle, cómo detectarlo con el log de EF y cómo arreglarlo con Include o una proyección."
date: 2026-10-12
topic: dotnet
series: ef-core
published: false
---

Una pantalla de pedidos tarda tres segundos en cargar. En local, con diez pedidos de prueba, iba bien. En producción hay 500 por página y cada uno trae sus líneas. El código no tiene nada raro:

```csharp
var orders = await db.Orders.OrderBy(o => o.Id).Take(500).ToListAsync();

foreach (var order in orders)
{
    // With lazy loading enabled, this line triggers a query.
    Console.WriteLine($"{order.Id}: {order.Lines.Count} lines");
}
```

Cuando activas el log de EF Core ves una consulta para los pedidos y otra por cada pedido para sus líneas: 501 comandos para pintar una tabla. A eso se le llama N+1: una consulta inicial más N consultas, una por cada fila del resultado.

## Cómo se cuela

El N+1 aparece de dos maneras. La más conocida es el lazy loading: EF carga una propiedad de navegación (`order.Lines`) la primera vez que la lees, y si lo haces dentro de un bucle, cada vuelta es un viaje a la base de datos. La documentación de Microsoft lo avisa de forma explícita: recomienda evitar el lazy loading porque es muy fácil provocar viajes de más sin querer, y prefiere la carga eager o explícita, donde el código deja claro cuándo hay un viaje.

La segunda es más tonta y también habitual: una consulta dentro de un `foreach`.

```csharp
foreach (var order in orders)
{
    var lineCount = await db.OrderLines.CountAsync(l => l.OrderId == order.Id);
}
```

En la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCorePills/Pills/NPlusOne)) uso esta segunda forma para no depender de proxies de lazy loading, y el efecto es el mismo. Con 300 pedidos:

| Estrategia | Comandos | Filas leídas |
|---|---|---|
| Una consulta por pedido | 301 | 600 |
| `Include` | 1 | 3.000 |
| Proyección con `Select` | 1 | 300 |

## Las dos correcciones

Si necesitas las líneas, pídelas junto con los pedidos:

```csharp
var orders = await db.Orders
    .OrderBy(o => o.Id)
    .Take(300)
    .Include(o => o.Lines)
    .ToListAsync();
```

EF genera un único `SELECT` con un `LEFT JOIN` y reconstruye cada pedido con sus líneas. Un viaje, y los datos de las 300 filas.

Si solo necesitas un dato derivado, por ejemplo cuántas líneas tiene cada pedido, ni siquiera traigas las líneas:

```csharp
var rows = await db.Orders
    .OrderBy(o => o.Id)
    .Take(300)
    .Select(o => new { o.Id, LineCount = o.Lines.Count })
    .ToListAsync();
```

El conteo se hace dentro de la base de datos. Es la opción más barata cuando el resultado es un número o un puñado de columnas.

## El tiempo que no ves en local

Mira la columna de tiempo de mi demo: 30 ms para las 301 consultas y 34 ms para el `Include`. Casi igual, porque SQLite corre dentro del mismo proceso y un comando no paga nada de red.

Con una base de datos remota cada comando paga la latencia de ida y vuelta. Con 1 ms por viaje (un número cualquiera para hacer la cuenta, no una medida mía), 501 comandos suponen más de medio segundo solo en latencia, antes de contar lo que tarde cada consulta. Y cuanto más lejos está la base de datos (otra zona, otro proveedor), peor.

Por eso el N+1 se descubre tarde: en desarrollo, con pocos datos y la base de datos al lado, todo parece rápido. El número de comandos sí se ve desde el primer día, si lo miras.

## Cómo detectarlo

Con el log de EF Core, subiendo a `Information` la categoría `Microsoft.EntityFrameworkCore.Database.Command` en el `appsettings.Development.json` (lo vimos en el primer post de la serie). Busca ráfagas de consultas casi idénticas que solo cambian en un parámetro (`WHERE "o"."OrderId" = @p`). Otra opción es contar comandos con un interceptor, como hace la demo de la serie, y comprobarlo en un test: si el endpoint de listado ejecuta más de N comandos, el test falla.

Cuando el listado crece, puedes volver a tener un problema con el propio `Include`. Si cargas dos colecciones a la vez, el `JOIN` se multiplica, y eso lo vemos en la píldora sobre la explosión cartesiana.

## Cuándo no hace falta

No todo bucle con consulta es un problema. Si son tres iteraciones, o si el bucle depende de una decisión que se toma fila a fila (consultar un servicio externo para decidir si se cargan las líneas), la carga explícita o diferida puede ser razonable. La documentación lo reconoce: en esos casos los viajes extra son el precio de no traer datos que quizá no necesites.

La regla práctica: cuando sepas de antemano qué datos relacionados vas a usar, pídelos con la consulta principal.
