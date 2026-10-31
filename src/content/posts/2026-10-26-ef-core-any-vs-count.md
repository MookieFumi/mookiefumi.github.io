---
title: "Any o Count: en tres de cuatro casos da igual, en el cuarto no"
subtitle: Una pregunta de sí o no no necesita contar, pero la diferencia real depende de los datos y del plan
description: "Diferencia entre Count() > 0 y Any() en Entity Framework Core, el SQL que genera cada uno, cuándo importa de verdad con medidas sobre un millón de filas y por qué hay que mirar el plan de ejecución."
date: 2026-10-26
topic: dotnet
series: ef-core
published: false
---

«¿Hay algún pedido pendiente?» Hay una forma de escribirlo que se lee bien y funciona:

```csharp
var hasPending = await db.Orders
    .CountAsync(o => o.Status == "Pending") > 0;
```

Y otra que dice lo que quieres saber:

```csharp
var hasPending = await db.Orders
    .AnyAsync(o => o.Status == "Pending");
```

La primera cuenta todas las filas y después las compara con cero. La segunda pregunta si existe alguna.

## El SQL de cada una

`CountAsync` se traduce a un conteo:

```sql
SELECT COUNT(*)
FROM "Orders" AS "o"
WHERE "o"."Status" = 'Pending'
```

`AnyAsync` genera un `EXISTS`:

```sql
SELECT EXISTS (
    SELECT 1
    FROM "Orders" AS "o"
    WHERE "o"."Status" = 'Pending')
```

Con `COUNT(*)`, la base de datos tiene que recorrer todas las filas que cumplen el filtro, aunque a ti te daría igual el resultado a partir de la primera. Con `EXISTS` puede parar en cuanto encuentra una.

## Lo que midió la demo

Probé cuatro casos en la demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCorePills/Pills/AnyVsCount)), con SQLite y la mediana de varias ejecuciones:

| Caso | `Count() > 0` | `AnyAsync()` |
|---|---|---|
| 20.000 pedidos, `Status = 'Pending'` | menos de 1 ms | menos de 1 ms |
| Mismos pedidos, cliente 7 y estado (con índice) | menos de 1 ms | menos de 1 ms |
| Mismos pedidos, `Total > 5000` (nadie cumple) | 3 ms | 3 ms |
| 1.000.000 de envíos, `Carrier = 'Carrier 3'`, sin índice | 40 ms | menos de 1 ms |

En tres de los cuatro casos no hay diferencia. Con 20.000 filas el conteo es instantáneo, con índice las dos consultas lo aprovechan, y cuando nadie cumple el filtro las dos tienen que mirar todas las filas, porque `EXISTS` también tiene que comprobar que no hay ninguna.

La diferencia aparece en el último caso: tabla grande, filtro sin índice y miles de filas que cumplen. Ahí `COUNT(*)` recorre el millón de filas y `EXISTS` se detiene en la primera coincidencia.

## Entonces, ¿por qué usar `Any`?

Por tres motivos, y solo el tercero es de rendimiento:

1. Dice lo que quieres. `Any` expresa «¿existe?»; `Count() > 0` obliga a quien lee a deducir que solo te importa si el resultado es mayor que cero.
2. Es el caso en el que no te hace falta pensar. Con `Any` no dependes de que hoy la tabla sea pequeña o de que tu índice cubra el filtro.
3. Puede parar en la primera fila. Cuando hay muchas coincidencias y el filtro no usa un índice, es mucho más barato.

Otros motores pueden tener optimizaciones distintas para `COUNT(*) > 0`. No lo asumas: mira el plan de ejecución de tu base de datos (`EXPLAIN` en PostgreSQL y SQLite, el plan de ejecución real en SQL Server) para la consulta que te importa. Es lo que recomienda la documentación de EF Core para cualquier duda de rendimiento: encuentra la consulta lenta y examina su plan.

## Cuándo sí quieres `Count`

Cuando necesitas el número. «Tiene 14 pedidos pendientes» es una pregunta distinta, y entonces `CountAsync` es lo correcto. Y si lo que quieres es mostrar el total en una página con paginación, ten presente que contar también cuesta, y que quizá no necesites mostrar el total exacto.

También existe `All`, que contesta «¿cumplen todos?» y se traduce a `NOT EXISTS`. Los tres operadores (`Any`, `All`, `Count`) responden preguntas diferentes, y elegir el que corresponde a la pregunta suele dar mejor SQL.

## Cierre de la serie: la lista de comprobación

Las ocho píldoras comparten un hábito, que es mirar el SQL y contar comandos y filas. Antes de dar por buena una consulta de EF Core:

1. ¿Cuántos comandos ejecuta por petición? (N+1)
2. ¿Necesita seguimiento de cambios? (`AsNoTracking`)
3. ¿Pide solo las columnas que usa? (`Select`)
4. ¿Tiene límite o paginación con orden único? (`Take`, keyset)
5. ¿El filtro está antes del materializador? (`Where` antes de `ToList`)
6. ¿Carga más de una colección? (`AsSplitQuery`, proyección)
7. ¿Guarda dentro de un bucle? (`SaveChanges` único, `ExecuteUpdate`)
8. ¿Cuenta cuando solo necesita saber si existe? (`Any`)

Ninguna se arregla de memoria: se ven en el log. El código con el que he sacado cada número está en [ef-core-pills](https://github.com/MookieFumi/ef-core-pills).
