---
title: "Aspire sin humo: qué es y qué no"
subtitle: Ni un Docker Compose con otro nombre ni algo que solo sirve en local
description: "Qué es Aspire 13 y qué no: el AppHost como modelo de la aplicación en C#, ServiceDefaults con OpenTelemetry y health checks, el dashboard y Scalar.Aspire, sobre una API real en .NET 10."
date: 2026-10-03
topic: dotnet
series: aspire
published: false
---

Hasta hace poco, arrancar [entry-hub](https://github.com/MookieFumi/entry-hub) en local eran tres pasos:

```bash
docker compose up -d        # PostgreSQL on localhost:5432
cd src
dotnet run --project EntryHub.Api
```

El `docker-compose.yml` levantaba un PostgreSQL con usuario, contraseña y base de datos `entryhub`. La API tenía su cadena de conexión en `appsettings.Development.json`, con los mismos tres valores escritos otra vez. Si alguien cambiaba uno de los dos ficheros y no el otro, la API no arrancaba, y el error no decía nada de Docker Compose.

Luego llegó un segundo servicio, el de recordatorios, que lee de la misma base de datos y necesita que la API haya creado el esquema antes de arrancar. Con Docker Compose eso suponía otra cadena de conexión, otra terminal y acordarse del orden.

Hoy es esto:

```bash
cd src
dotnet run --project EntryHub.AppHost
```

El `docker-compose.yml` ya no existe, y en el repositorio no queda ninguna cadena de conexión. Este es el primer post de la serie sobre Aspire, y va de qué pasó en medio: qué es Aspire, qué no es y cuándo no lo pondría.

## Qué es Aspire hoy

Lo justo para situarse, sin catálogo de novedades:

- Hasta la versión 9 se llamaba .NET Aspire. Desde la 13 se llama solo Aspire, porque ya no es exclusivo de .NET.
- Desde la 9 ya no se instala como un workload de .NET (lo que en la 8 se instalaba con `dotnet workload install aspire`). Es un SDK de MSBuild, `Aspire.AppHost.Sdk`, que se referencia en el proyecto, más una CLI, `aspire`, opcional.
- entry-hub usa la 13.6.1. Todo lo que cuento en la serie es de esa versión.

Con Aspire describes tu aplicación en C#: qué piezas tiene y de qué depende cada una. Con esa descripción arranca todo en local, te da un panel para verlo y, más adelante, genera los ficheros de despliegue.

## Las tres piezas

Una solución con Aspire tiene tres partes, y conviene no mezclarlas:

- **El AppHost** es un proyecto de consola donde está el modelo: los recursos (PostgreSQL, la API, el servicio de recordatorios) y cómo se relacionan.
- **ServiceDefaults** es una librería que referencia cada servicio. Le añade telemetría, health checks, service discovery y resiliencia en las llamadas HTTP, siempre igual en todos los servicios.
- **El dashboard** es la web que abre el AppHost en local, con los recursos, sus logs, sus trazas y sus métricas.

En entry-hub el modelo queda así:

```text
postgres ──► EntryHub (base de datos) ──► api ──► reminders
                    │                                ▲
                    └────────────────────────────────┘
```

Las flechas son dos métodos que vamos a ver enseguida: `WithReference`, que le pasa a un recurso lo que necesita para conectarse a otro, y `WaitFor`, que no lo arranca hasta que el otro está sano.

## El AppHost de entry-hub, línea a línea

El fichero completo está en `src/EntryHub.AppHost/AppHost.cs`. Tiene también la parte de Kubernetes, que dejo para el último post de la serie. Esto es lo que importa en local:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("postgres");
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithDataVolume();
}

var database = postgres.AddDatabase("EntryHub", "entryhub");
```

`AddPostgres` declara un PostgreSQL en un contenedor. Aspire elige la imagen y genera la contraseña; no la escribes tú en ningún sitio. `WithDataVolume` le añade un volumen de Docker para que los datos sobrevivan a los reinicios. `IsRunMode` es `true` cuando ejecutas el AppHost en tu máquina y `false` cuando lo usas para generar el despliegue. Ese `if` lo explico en el post de Kubernetes.

`AddDatabase("EntryHub", "entryhub")` declara una base de datos dentro de ese servidor. El primer argumento es el nombre del recurso y el segundo, el de la base de datos en PostgreSQL. El nombre del recurso no es casual: cuando otro recurso lo referencia, Aspire le inyecta la cadena de conexión como `ConnectionStrings__EntryHub`, que en .NET se lee como `ConnectionStrings:EntryHub`. Justo lo que ya leía la API:

```csharp
builder.Services.AddDbContext<EntryHubDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("EntryHub")));
```

Por eso la API no tiene cadena de conexión propia. Si la ejecutas sin el AppHost, necesitas definir `ConnectionStrings__EntryHub` contra el PostgreSQL que quieras.

Después viene la API:

```csharp
var api = builder.AddProject<Projects.EntryHub_Api>("api")
    .WithReference(database)
    .WaitFor(database)
    .WithHttpProbe(ProbeType.Readiness, "/health", endpointName: "http")
    .WithHttpProbe(ProbeType.Liveness, "/alive", endpointName: "http");
```

`AddProject<Projects.EntryHub_Api>` apunta al proyecto de la API. `Projects.EntryHub_Api` es una clase que el SDK genera por cada proyecto que referencia el AppHost, así que un proyecto que no existe es un error de compilación, no un fallo al arrancar. En local la API corre como un proceso normal de .NET, no dentro de un contenedor: el depurador se engancha igual que siempre.

`WithReference(database)` inyecta la cadena de conexión. `WaitFor(database)` hace que la API no arranque hasta que PostgreSQL acepte conexiones. Ya no hay carrera en la que la API arranca antes que la base de datos y se cae.

Las dos probes son comprobaciones periódicas: `/health` dice si la API puede atender peticiones (incluye PostgreSQL) y `/alive`, si el proceso responde. Aquí Aspire usa la de readiness para saber cuándo la API está lista. Van por el endpoint `http` a propósito. El de HTTPS usa el certificado de desarrollo de ASP.NET Core, y en una máquina que no confía en él, como la CI o un contenedor recién creado, Aspire nunca vería la API sana. Las probes cobran su sentido en Kubernetes, y allí volveremos.

Por último, el servicio de recordatorios:

```csharp
builder.AddProject<Projects.EntryHub_Reminders>("reminders")
    .WithReference(database)
    .WaitFor(api);
```

Usa la misma base de datos, pero espera a la API y no a PostgreSQL. En Development la API aplica las migraciones de EF Core al arrancar, y la columna en la que el servicio de recordatorios marca lo que ya ha avisado solo existe después de eso. `WaitFor(api)` espera a que `/health` conteste, y para entonces las migraciones ya están aplicadas.

Ese orden es lo que antes tenías que recordar con dos terminales. Ahora está escrito en el código, y quien llega nuevo al repositorio lo ve en `AppHost.cs`.

## ServiceDefaults: lo que cada servicio trae de serie

La API y el servicio de recordatorios llaman a la misma línea al principio de su `Program.cs`:

```csharp
builder.AddServiceDefaults();
```

El método está en `src/EntryHub.ServiceDefaults/Extensions.cs`, que es casi el de la plantilla de Aspire:

```csharp
public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder
{
    builder.ConfigureOpenTelemetry();

    builder.AddDefaultHealthChecks();

    builder.Services.AddServiceDiscovery();

    builder.Services.ConfigureHttpClientDefaults(http =>
    {
        http.AddStandardResilienceHandler();
        http.AddServiceDiscovery();
    });

    return builder;
}
```

Hace cuatro cosas:

- Configura OpenTelemetry, el estándar abierto de telemetría, para logs, trazas y métricas. Instrumenta ASP.NET Core, `HttpClient` y el runtime de .NET, y deja fuera de las trazas las peticiones a `/health` y `/alive`, que si no lo llenarían todo.
- Registra los health checks, con un check `self` etiquetado `live` que solo dice que el proceso responde.
- Añade service discovery, para que un servicio llame a otro por su nombre en el AppHost y no por host y puerto. entry-hub no lo usa todavía, porque ningún servicio llama por HTTP a otro, pero en el [post del MCP Server](/2026-08-15-mcp-server-sdk-dotnet) era justo lo que permitía llamar a la API como `https+http://brent-api`.
- Pone resiliencia en todos los `HttpClient`: reintentos, timeouts y circuit breaker (el patrón que deja de llamar un rato a un servicio que está fallando) con los valores por defecto de `Microsoft.Extensions.Http.Resilience`.

La telemetría solo sale del proceso si hay a dónde mandarla:

```csharp
var useOtlpExporter = !string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]);

if (useOtlpExporter)
{
    builder.Services.AddOpenTelemetry().UseOtlpExporter();
}
```

OTLP es el protocolo con el que OpenTelemetry envía los datos. En local, el AppHost define `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando al dashboard, y por eso ves ahí los logs y las trazas sin configurar nada. Sin el AppHost no hay variable, y los servicios no intentan enviar nada a ningún sitio.

Hay un cambio respecto a la plantilla. La plantilla solo publica `/health` y `/alive` en Development, y entry-hub los publica en todos los entornos:

```csharp
public static WebApplication MapDefaultEndpoints(this WebApplication app)
{
    // Kubernetes probes the pods over HTTP, so these are mapped in every environment. They answer only
    // "Healthy" or "Unhealthy" and no details, and the chart publishes no ingress for them: keep it that way
    // (see https://aka.ms/aspire/healthchecks).
    app.MapHealthChecks(HealthEndpointPath);

    app.MapHealthChecks(AlivenessEndpointPath, new HealthCheckOptions
    {
        Predicate = r => r.Tags.Contains("live")
    });

    return app;
}
```

La razón es Kubernetes, que pregunta a esos dos endpoints para decidir si manda tráfico al pod o lo reinicia. Solo responden `Healthy` o `Unhealthy`, sin detalles, y no se exponen hacia fuera. Lo cuento con calma en el [post de Kubernetes](/2026-10-05-aspire-kubernetes-helm-kind).

El health check de PostgreSQL no sale de ServiceDefaults. Lo añade `EnrichNpgsqlDbContext` en el `Program.cs` de la API, junto con las trazas y métricas de Npgsql. En entry-hub va con los reintentos desactivados, porque el handler que crea reservas ya decide qué hacer con un deadlock entre dos reservas simultáneas, y un reintento silencioso lo escondería.

## El dashboard

`dotnet run --project EntryHub.AppHost` imprime en la consola la URL del dashboard. Al abrirlo ves los recursos del modelo: `postgres`, la base de datos `EntryHub`, `api`, `reminders` y `scalar-api-reference`. Cada uno lleva su estado, sus endpoints y un enlace a sus logs.

El dashboard está en inglés. Las vistas que más vas a mirar:

- Resources: quién está arrancando, quién espera a quién y quién ha fallado. Mientras PostgreSQL arranca, `api` aparece esperando, y `reminders` espera a `api`.
- Console: la salida de cada recurso, tal cual.
- Structured logs: los logs con sus campos. El servicio de recordatorios avisa con una línea de log; en entry-hub no hay correo ni notificaciones push. Cuando hay una reserva confirmada que empieza en los próximos 15 minutos, en el recurso `reminders` aparece una línea como esta, que es la que salió en la prueba del chart en Kubernetes:

  ```text
  Reminder for ana: "Kind check" in Kind room starts at 2026-10-18 17:29:09Z
  ```

  El formato sale del `LoggerMessage` del servicio, `Reminder for {OrganizerId}: "{Title}" in {RoomName} starts at {StartAt:u}`, y en el dashboard puedes filtrar por `OrganizerId` como por cualquier otro campo.
- Traces: una petición de punta a punta. Un `POST /api/v1/rooms` aparece como la petición HTTP de la API con, dentro, la consulta a PostgreSQL que hizo Npgsql, cada una con su duración.

El último recurso de la lista es la referencia de la API. Viene de `Scalar.Aspire`:

```csharp
if (builder.ExecutionContext.IsRunMode)
{
    builder.AddScalarApiReference().WithApiReference(api);
}
```

Es la misma documentación con Scalar que montamos en el [post de OpenAPI](/2026-09-25-openapi-scalar-minimal-apis), pero como un recurso más del dashboard: un único sitio para la referencia de todos los servicios que publican un documento OpenAPI. Hoy solo lo publica la API, porque el servicio de recordatorios no tiene endpoints HTTP. Solo existe en local, por eso el `IsRunMode`.

El dashboard es una herramienta de desarrollo. No guarda nada: al parar el AppHost, la telemetría se pierde. Para producción hay que mandar OpenTelemetry a lo que use el equipo, y por eso entry-hub no lo incluye en el despliegue.

## Lo que Aspire no es

Tres ideas habituales sobre Aspire que no se sostienen:

- "Es para Azure". Aspire puede desplegar en Azure, pero entry-hub no toca Azure. Del mismo modelo sale un chart de Helm para cualquier Kubernetes.
- "Es un runtime de producción". El AppHost no se despliega. En tu máquina arranca los procesos, y en la CI genera los ficheros de despliegue; ahí termina su trabajo. En el clúster no hay ningún pod del AppHost.
- "Es un Docker Compose con otra sintaxis". Docker Compose es un YAML que arranca contenedores. No sabe qué es un proyecto .NET, ni que la API necesita una cadena de conexión con la contraseña del PostgreSQL de tres líneas más arriba: eso lo escribías tú, dos veces. El modelo de Aspire es código C# con tipos. Sabe que `api` es un proyecto, la ejecuta como proceso con su depurador, le inyecta la cadena de conexión, espera a que su base de datos esté sana y le manda la telemetría al dashboard. Y si borras o renombras un proyecto, el compilador te avisa.

## Cuándo no lo pondría

Aspire tiene su coste: son dos proyectos más en la solución, un SDK que hay que actualizar a su ritmo y otro sitio donde mirar cuando algo no arranca. Hay casos donde no lo pondría:

- Con un único servicio sin dependencias. Si la API no habla con nada, el AppHost solo añadiría un paso para arrancar lo que ya arranca con `dotnet run`.
- Sin runtime de contenedores. PostgreSQL y el resto de dependencias corren en contenedores. Si tu equipo no puede tener Docker Desktop, Podman o similar en su máquina, o la CI no lo tiene, el AppHost no arranca. En entry-hub los tests que levantan el AppHost entero solo se ejecutan en la CI, en un runner de GitHub con Docker.

En cuanto hay dos servicios y una base de datos, como en entry-hub, sí compensa. Lo que antes estaba repartido entre un YAML, un `appsettings` y el README queda en un solo fichero.

## Resumiendo

- Aspire es el modelo de tu aplicación escrito en C#: recursos, referencias entre ellos (`WithReference`) y orden de arranque (`WaitFor`). Con ese modelo arranca todo en local con un solo comando.
- ServiceDefaults da a cada servicio OpenTelemetry, health checks, service discovery y resiliencia. El dashboard muestra esa telemetría, y `Scalar.Aspire` añade la referencia de la API.
- No es un runtime de producción ni un Docker Compose. Si tienes un único servicio, o no tienes contenedores en la máquina o en la CI, mejor no ponerlo.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el [siguiente post](/2026-10-04-tests-sistema-aspire) usamos este mismo AppHost desde un test, para comprobar que una reserva acaba en un recordatorio con todo el sistema arrancado.
