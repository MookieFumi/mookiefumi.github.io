---
title: "Tres formas de registrar tu DbContext y solo conoces una"
subtitle: AddDbContext, AddDbContextPool y AddDbContextFactory no son intercambiables, y elegir mal rompe cosas distintas
description: "Cuándo usar AddDbContext, AddDbContextPool o AddDbContextFactory en EF Core: ciclo de vida de cada uno, qué cuesta de verdad el pool con medidas, por qué un BackgroundService no puede inyectar el contexto y cómo hacer trabajo en paralelo sin InvalidOperationException."
date: 2026-12-28
topic: dotnet
published: false
---

Si has escrito una API con EF Core, en `Program.cs` tienes esta línea:

```csharp
builder.Services.AddDbContext<ShopContext>(options =>
    options.UseSqlite("Data Source=pills.db"));
```

Funciona, así que nunca miras las otras dos opciones. Existen `AddDbContextPool` y `AddDbContextFactory`, y cada una cubre un caso que `AddDbContext` no cubre bien. Si eliges la equivocada, el fallo suele aparecer lejos del registro: una excepción de concurrencia en un endpoint, o un contexto que lleva semanas vivo dentro de un servicio en segundo plano.

## AddDbContext: una instancia por petición

Es la opción por defecto y la que necesitas casi siempre. Registra el contexto con ciclo de vida *scoped*: cada petición HTTP tiene su propio scope y, dentro de él, todos los servicios que piden el contexto reciben la misma instancia.

Lo comprobé con un contenedor de DI mínimo (el código está en [ef-core-pills](https://github.com/MookieFumi/ef-core-pills/tree/main/src/EfCorePills/Pills/DbContextRegistration)):

```text
same scope, resolved twice -> same instance: True
different scopes            -> same instance: False
```

El repositorio y el servicio de pedidos comparten el seguimiento de cambios dentro de una petición, y la petición siguiente empieza limpia. La limitación es que `DbContext` no es seguro para hilos: una instancia admite una operación a la vez.

## AddDbContextPool: la misma idea, sin crear el contexto cada vez

Con `AddDbContextPool` el servicio sigue viéndose igual desde fuera, un contexto por petición, pero EF Core no crea uno nuevo cada vez. Al terminar la petición resetea el estado de la instancia y la devuelve a un pool; la siguiente petición la reutiliza.

```csharp
builder.Services.AddDbContextPool<ShopContext>(
    options => options.UseSqlite("Data Source=pills.db"),
    poolSize: 128);
```

En la demo hice 5.000 peticiones seguidas, cada una con un scope nuevo y una consulta mínima:

```text
sequential scopes: 5000  distinct DbContext instances: 1
entities tracked when a request started (should be 0): 0
```

Una sola instancia atendió las 5.000, y ninguna empezó con entidades de la anterior. El reseteo funciona.

¿Y cuánto se gana? Con SQLite en local, la mediana de siete ejecuciones de las 5.000 peticiones fue:

| Registro | Mediana |
|---|---|
| `AddDbContext` | 496 ms |
| `AddDbContextPool` | 196 ms |
| `AddDbContextFactory` | 458 ms |

Son unos 60 microsegundos por petición. La documentación de EF Core publica un benchmark con SQL Server en local donde el pool pasa de unos 700 µs a unos 350 µs por consulta, y advierte de que depende de tu plataforma. En cuanto la base de datos está en otra máquina, la latencia de red tapa ese ahorro. El pool tiene sentido en una API con mucho tráfico y consultas muy cortas; en el resto no lo vas a notar.

Y trae una trampa. Como la instancia se reutiliza, tratarla como estado propio de la petición es peligroso. `OnConfiguring` se ejecuta solo cuando se crea el contexto, no en cada petición, así que no sirve para nada que cambie entre peticiones. El caso típico es un identificador de tenant guardado en un campo del contexto. EF Core resetea su propio estado, no el tuyo ni el del driver: si abres una conexión a mano, ciérrala antes de devolver el contexto. La documentación describe cómo hacerlo con un `AddPooledDbContextFactory` y una factoría con scope que asigna el tenant en cada petición.

## AddDbContextFactory: tú decides cuándo empieza y acaba

Hay sitios donde no existe una petición a la que atar el contexto. Un servicio en segundo plano es el ejemplo claro:

```csharp
public class PendingOrdersWorker(IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // Not a ShopContext in the constructor: the worker is a singleton
            // and the context is scoped.
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ShopContext>();
            await ProcessPendingAsync(db, stoppingToken);

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    private static Task ProcessPendingAsync(ShopContext db, CancellationToken token) =>
        Task.CompletedTask;
}
```

El `BackgroundService` es un singleton, y un singleton no puede recibir un servicio scoped por constructor. Un contexto guardado en un campo viviría semanas y acumularía todas las entidades que haya tocado. La salida con scope manual funciona, y con la factoría queda más corta:

```csharp
public class PendingOrdersWorker(IDbContextFactory<ShopContext> factory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await using var db = await factory.CreateDbContextAsync(stoppingToken);
            await ProcessPendingAsync(db, stoppingToken);

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    private static Task ProcessPendingAsync(ShopContext db, CancellationToken token) =>
        Task.CompletedTask;
}
```

El registro es una línea:

```csharp
builder.Services.AddDbContextFactory<ShopContext>(
    options => options.UseSqlite("Data Source=pills.db"));
```

Lo que cambia es la responsabilidad: los contextos que crea la factoría no los gestiona el contenedor, así que el `await using` de arriba no es opcional.

## El otro uso: trabajo en paralelo

Imagina un endpoint de panel que necesita tres consultas independientes y quieres lanzarlas a la vez. Con el contexto de la petición, todas comparten la misma instancia. Lo reproduje con ocho consultas en paralelo sobre un contexto scoped:

```text
shared scoped context, 8 parallel queries: InvalidOperationException
factory, 8 parallel queries (one context each): 8 results, all 200
```

EF Core detecta el uso concurrente y lanza `InvalidOperationException`. La documentación avisa de que la detección no cubre todos los casos: cuando se le escapa, el resultado es comportamiento indefinido. Con la factoría, cada tarea pide su propio contexto, lo usa y lo libera:

```csharp
var counts = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
{
    await using var db = await factory.CreateDbContextAsync();
    return await db.Customers.CountAsync();
}));
```

## Qué más hay que saber

- Con `AddDbContextFactory`, en la versión que probé (EF Core 10) el contexto también se puede resolver directamente desde el contenedor: lo comprobé en la demo. No lo des por supuesto en otras versiones.
- Hay una combinación de las dos últimas, `AddPooledDbContextFactory`: factoría con pool. La documentación la recomienda para el último punto de rendimiento y para el caso del tenant.
- Si en un único scope necesitas varias unidades de trabajo independientes (por ejemplo, guardar cada elemento de un lote por separado), también es un caso para la factoría.

## Cuál elegir

| Situación | Registro |
|---|---|
| API web o MVC, una petición = una unidad de trabajo | `AddDbContext` |
| La misma API con mucho tráfico y consultas muy cortas, y has medido | `AddDbContextPool` |
| `BackgroundService`, `IHostedService`, Blazor Server | `AddDbContextFactory` |
| Consultas en paralelo dentro de una petición | `AddDbContextFactory` |
| Pool, pero con estado por petición (tenant) | `AddPooledDbContextFactory` |

Empieza por `AddDbContext`. Pasa a la factoría cuando aparezca un singleton o un paralelismo que lo necesite, y al pool solo si has medido que el coste de crear el contexto se nota.
