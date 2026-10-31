---
title: "ExecuteUpdate: un UPDATE en vez de 2.000 viajes"
subtitle: Cargar, modificar y guardar fila a fila frente a un UPDATE que la base de datos resuelve de una vez
description: "Por qué llamar a SaveChanges dentro de un bucle es lento en Entity Framework Core, qué ganas con un solo SaveChanges o con ExecuteUpdate, y los límites de ExecuteUpdate y ExecuteDelete."
date: 2026-10-17
topic: dotnet
series: ef-core
published: false
---

Un proceso nocturno marca como caducados los pedidos pendientes que nadie pagó. Así lo escribió alguien con prisa:

```csharp
foreach (var order in orders)
{
    order.Status = "Expired";
    await db.SaveChangesAsync();
}
```

Funciona. Con dos mil pedidos tarda cinco segundos. Con doscientos mil, ya es un problema.

## Tres formas de hacer lo mismo

En la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills)) marco como caducados 2.000 pedidos pendientes de las tres maneras (SQLite, una ejecución de cada una):

| Forma | Comandos | Tiempo |
|---|---|---|
| `SaveChanges` dentro del bucle | 2.001 | 5.058 ms |
| Un solo `SaveChanges` al final | 2.001 | 110 ms |
| `ExecuteUpdate` | 1 | 71 ms |

Dos observaciones antes de seguir. Una: esto es una sola ejecución, no una mediana, así que fíjate en el orden de magnitud y no en los decimales. Otra: el número de comandos del bucle y del `SaveChanges` único es el mismo, 2.001. Lo que cambia es el tiempo. Los 2.001 son la lectura de los pedidos más 2.000 `UPDATE`. En esta demo, SQLite lanzó un comando por cada `UPDATE`. Otros proveedores sí agrupan: EF Core envía los cambios de un `SaveChanges` en lotes, y con SQL Server, por ejemplo, varias sentencias viajan en el mismo viaje.

La diferencia de 46 veces entre las dos primeras filas viene de las transacciones. Cada `SaveChanges` abre su propia transacción y la confirma. El bucle hace 2.000 confirmaciones; el `SaveChanges` único, una.

## Primer arreglo: un solo `SaveChanges`

```csharp
foreach (var order in orders)
    order.Status = "Expired";

await db.SaveChangesAsync();
```

Este cambio es mínimo y casi siempre vale la pena: EF acumula todos los cambios, los envía (en lotes si el proveedor lo permite) y los confirma en una única transacción. Además es atómico: o se guardan todos o ninguno.

## Segundo arreglo: no cargar nada con `ExecuteUpdate`

Si lo que quieres es «a todos los que cumplan esto, ponles este valor», no hace falta traer los pedidos:

```csharp
await db.Orders
    .Where(o => o.Status == "Pending" && o.CreatedAt < cutoff)
    .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, "Expired"));
```

EF genera un único `UPDATE ... WHERE`. La base de datos lo resuelve sin que los datos pasen por la aplicación. Existe también `ExecuteDelete` para borrados. Ambos llegaron en EF Core 7.

EF Core 10 permite además escribir las asignaciones con una lambda normal, por ejemplo para añadir un `SetProperty` solo si se cumple una condición:

```csharp
await db.Orders.Where(o => o.Id == id).ExecuteUpdateAsync(s =>
{
    s.SetProperty(o => o.Status, "Expired");
    if (note is not null)
        s.SetProperty(o => o.Notes, note);
});
```

## Lo que `ExecuteUpdate` no hace

Es una herramienta distinta, no un `SaveChanges` más rápido. Según la documentación de Microsoft:

- No pasa por el change tracker. Si ya tienes cargadas esas entidades en el contexto, siguen mostrando el valor viejo. Peor: si después llamas a `SaveChanges` con otros cambios sobre ellas, puedes pisar lo que hizo `ExecuteUpdate`.
- No abre una transacción. Cada llamada es su propia sentencia. Dos `ExecuteUpdate` seguidos no son atómicos, a no ser que abras una transacción tú.
- No controla la concurrencia. No hay token de concurrencia. Devuelve el número de filas afectadas, y con eso puedes montar tu propio control: filtra por el valor esperado y comprueba que se tocó una fila.
- Solo actualiza y borra. Las inserciones siguen siendo `Add` y `SaveChanges`.
- Una tabla por llamada. Y varias llamadas no se agrupan; cada una es un viaje.
- No funciona con proveedores que no son relacionales (Cosmos DB, por ejemplo).

## Qué usar

| Situación | Qué usar |
|---|---|
| Cambias entidades que ya tienes cargadas y quieres control de cambios | Un `SaveChanges` al final |
| Mismo valor o expresión para un conjunto que se define con un filtro | `ExecuteUpdate` o `ExecuteDelete` |
| Necesitas concurrencia optimista automática | `SaveChanges` |
| Muchas inserciones | `AddRange` y un `SaveChanges` |

La regla corta: `SaveChanges` dentro de un bucle casi nunca es lo que quieres. Si lo ves en una revisión de código, pregunta por qué no está fuera.
