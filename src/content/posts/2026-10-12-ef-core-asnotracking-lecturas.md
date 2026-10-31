---
title: "Tu GET no va a guardar nada. ¿Por qué EF se lo apunta todo?"
subtitle: Lo que cuesta el seguimiento de cambios en una consulta de solo lectura y lo que pierdes al quitarlo
description: "Qué hace el change tracking de Entity Framework Core, cuánto cuesta en consultas de solo lectura y cuándo usar AsNoTracking o AsNoTrackingWithIdentityResolution, con números de una demo sobre 50.000 filas."
date: 2026-10-12
topic: dotnet
series: ef-core
published: false
---

Un endpoint `GET /shipments` lee envíos y los devuelve como JSON. No modifica nada, no llama a `SaveChanges`. Aun así, por defecto EF Core trata cada fila que carga como una entidad que podría modificarse:

```csharp
var shipments = await db.Shipments
    .OrderBy(s => s.Id)
    .Take(50_000)
    .ToListAsync();
```

Ese trabajo extra se llama change tracking y tiene dos partes. EF guarda un diccionario con las entidades que ha cargado (así, si dos filas apuntan a la misma, devuelve la misma instancia). Y guarda una copia (un snapshot) de los valores originales de cada una para compararlos en `SaveChanges` y generar solo los `UPDATE` necesarios. Ambas cosas cuestan tiempo y memoria.

## Qué cuesta, con números

La demo de la serie ([ef-core-pills](https://github.com/MookieFumi/ef-core-pills)) lee 50.000 envíos, una tabla estrecha, sin columnas grandes, para que el tracking no quede tapado por otra cosa:

| Modo | Entidades rastreadas | Memoria asignada | Tiempo (mediana) |
|---|---|---|---|
| Con tracking | 50.000 | 43.406 KB | 113 a 273 ms según la ejecución |
| `AsNoTracking()` | 0 | 17.483 KB | 44 a 49 ms |

El tiempo varía bastante entre ejecuciones en mi máquina, por eso doy el rango. Lo que no varía es la memoria y el número de entidades rastreadas: con tracking, 2,5 veces más memoria asignada y 50.000 objetos más que el recolector de basura tiene que vigilar. La propia documentación de Microsoft publica un benchmark parecido (10 blogs con 20 posts cada uno): sin tracking tarda en torno a un 30 % menos y asigna un 39 % menos de memoria.

La corrección es una línea:

```csharp
var shipments = await db.Shipments
    .AsNoTracking()
    .OrderBy(s => s.Id)
    .Take(50_000)
    .ToListAsync();
```

## Lo que pierdes: la resolución de identidad

Sin tracking, EF ya no sabe qué instancias ha creado. Si cien pedidos pertenecen al mismo cliente y los traes con `Include(o => o.Customer)`, una consulta con tracking te da una sola instancia de ese cliente, compartida. Una consulta sin tracking te da cien copias.

La demo lo comprueba con 500 pedidos y 200 clientes:

| Modo | Instancias distintas de `Customer` |
|---|---|
| Con tracking | 181 |
| `AsNoTracking()` | 500 |
| `AsNoTrackingWithIdentityResolution()` | 181 |

Hay un tercer camino. `AsNoTrackingWithIdentityResolution()` no rastrea cambios, pero sí reutiliza instancias dentro de la misma consulta. Es algo más lento que `AsNoTracking()` y más ligero que el tracking completo. Si tu código compara referencias entre entidades o necesitas el grafo de objetos compartido, es la opción.

En una API que serializa a JSON esto casi nunca importa: cada copia se escribe igual. Importa cuando construyes grafos y esperas identidad.

## Cuándo no usarlo

- Si vas a modificar y guardar lo que cargas. Sin tracking, `SaveChanges` no se entera de nada. Tendrías que adjuntar la entidad y marcar qué propiedades cambiaron a mano. La documentación lo dice con claridad: eso solo vale la pena si has medido que el tracking es un problema.
- Si proyectas con `Select` a un DTO. Las consultas que devuelven tipos que no son entidades no se rastrean de todas formas, así que `AsNoTracking()` no añade nada. De hecho, es el siguiente paso natural: la siguiente píldora trata de traer solo las columnas que necesitas.

## ¿Y cambiarlo para todo el contexto?

Existe esta opción global:

```csharp
optionsBuilder.UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
```

Para un contexto que solo lee (una API de consultas, un informe) es razonable. Para uno que lee y escribe, es una trampa: el día que alguien cargue una entidad para modificarla y no se guarde nada, el fallo no da error. Si lo configuras global, haz la excepción visible con `AsTracking()` en las consultas que modifican.

Una práctica sencilla: cada `GET` de lectura lleva `AsNoTracking()` o una proyección. Cada comando de escritura carga con tracking.
