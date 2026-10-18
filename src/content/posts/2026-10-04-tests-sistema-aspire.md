---
title: "¿Testcontainers? Tu AppHost ya sabe arrancar el sistema"
subtitle: La API escribe la reserva y otro servicio la lee de la misma base de datos. Cada uno pasa sus tests y nadie comprueba si se entienden
description: "Tests de sistema con Aspire.Hosting.Testing en .NET 10: arrancar el AppHost con PostgreSQL, la API y un worker desde xUnit, en qué se diferencia de Testcontainers, tokens JWT para otro proceso, timeouts y CI."
date: 2026-10-04
topic: dotnet
series: aspire
published: false
---

En [entry-hub](https://github.com/MookieFumi/entry-hub) hay un servicio que no tiene ni un endpoint. Se llama `EntryHub.Reminders`, es un worker (un proceso de .NET que corre en segundo plano sin servir peticiones) y cada 30 segundos busca en PostgreSQL las reservas que empiezan en los próximos 15 minutos. Por cada una, marca la reserva como recordada y escribe en el log un aviso para quien la organizó.

Esas reservas las escribe la API, en la base de datos que crea la API, con el esquema que aplican las migraciones de la API. El worker no tiene migraciones propias: lee `bookings` y `rooms` y escribe una sola columna, `ReminderSentAt`. Si mañana alguien renombra esa columna en la API, los tests de la API pasan, los del worker también, y los recordatorios dejan de llegar.

En el [post anterior](/2026-10-03-aspire-sin-humo) vimos que el AppHost describe el sistema entero en código. En este lo usamos para probarlo: un test que arranca lo mismo que arrancas tú en local y comprueba que las piezas se hablan.

## ¿Esto no es Testcontainers?

Es lo primero que pregunta quien ve un test que arranca PostgreSQL en Docker, y a mí también me costó separarlo. Lo que lo aclara es esto: Testcontainers no es un tipo de test. Es una forma de conseguir la base de datos que necesita un test.

En entry-hub hay dos tipos de test, y la diferencia está en qué arranca cada uno.

El primero es el test de la API. La API corre dentro del proceso del test, en memoria, gracias a `WebApplicationFactory`. Necesita un PostgreSQL de verdad al lado, y ese PostgreSQL tiene que salir de algún sitio. Hoy lo pone la CI o lo tienes instalado en tu máquina. Con [Testcontainers](https://dotnet.testcontainers.org/) lo arrancaría el propio test en Docker. El test es el mismo en los dos casos: solo cambia quién pone la base de datos.

El segundo es el test del sistema, el de este post. El test ya no arranca la API: arranca el AppHost, y el AppHost levanta todo lo que describe, igual que con `aspire run`. Eso es el contenedor de PostgreSQL, la API y el servicio de recordatorios, cada uno en su proceso. El test solo los ve desde fuera, por HTTP y por los logs. La [documentación de Aspire](https://learn.microsoft.com/dotnet/aspire/testing/overview) los llama tests de caja cerrada (*closed-box*).

```text
1. Test de la API
   [ proceso del test: el test + la API en memoria ] ---> [ PostgreSQL ]
                                                           (CI, tu máquina o Testcontainers)

2. Test del sistema
   [ el test ] ---> [ AppHost: API + PostgreSQL + recordatorios ]
```

| | Test de la API (`WebApplicationFactory`, con o sin Testcontainers) | Test del sistema (`Aspire.Hosting.Testing`) |
|---|---|---|
| Qué arranca | Un servicio, dentro del proceso del test, contra dependencias reales en contenedores | El AppHost entero: contenedores y servicios, cada uno en su proceso |
| Quién monta el sistema | El test | El AppHost, el mismo que usas en local |
| Qué ve el test | Todo: puede cambiar servicios en la inyección de dependencias y mirar el estado interno | Lo que exponen los recursos: HTTP, logs y datos de conexión, como la cadena de PostgreSQL |
| Velocidad | Rápido | Lento: arrancar el sistema lleva decenas de segundos |
| Para qué sirve | Endpoints, validación, reglas de negocio, autorización | Lo que pasa entre servicios, como el recordatorio |

La propia documentación de Aspire lo dice: para mocks, para cambiar servicios o para probar un proyecto aislado, usa `WebApplicationFactory`. Con Aspire solo puedes influir desde fuera, con variables de entorno o configuración.

Así que Testcontainers mejora el primer tipo, y Aspire te da el segundo. Los 101 tests de `EntryHub.Api.Tests` son del primero. ¿Por qué hace falta el segundo? Porque el recordatorio pasa entre dos servicios: la API guarda la reserva y otro proceso la encuentra. En un test de la API el servicio de recordatorios no existe, así que eso no se puede probar.

## Qué tests había y cuál faltaba

Los tests que ya había, todos en `EntryHub.Api.Tests`, son de dos clases.

Los de la API levantan la aplicación en memoria con `WebApplicationFactory` contra un PostgreSQL real, el mismo enfoque que usamos en el [post de contract testing](/2026-09-30-contract-testing-openapi-dotnet). Prueban endpoints, validación, autorización y reglas de negocio, y son rápidos.

Los del worker no esperan al temporizador. Crean un `ReminderWorker` con un reloj fijo y llaman a `RemindAsync` directamente:

```csharp
var worker = new ReminderWorker(
    new ReminderStore(NpgsqlDataSource.Create(TestDatabase.ConnectionString)),
    Options.Create(new ReminderOptions()),
    new FixedClock(now),
    logger);

await worker.RemindAsync(TimeSpan.FromMinutes(15), CancellationToken.None);
await worker.RemindAsync(TimeSpan.FromMinutes(15), CancellationToken.None);

var message = Assert.Single(logger.Messages);
```

Dos rondas y un solo aviso: la reserva se recuerda una vez. Es un buen test, pero todo pasa dentro de un mismo proceso, con el esquema que el propio test se encarga de aplicar.

Lo que faltaba era el sistema arrancado como lo arranca el AppHost: PostgreSQL en un contenedor, la API como proceso aparte aplicando sus migraciones, y el worker esperando a la API antes de arrancar. Ese orden lo decide el AppHost y en ningún otro sitio se prueba.

## Arrancar el AppHost desde un test

El paquete es `Aspire.Hosting.Testing`, y el proyecto de tests, `EntryHub.AppHost.Tests`, solo referencia el AppHost, la API y xUnit. La pieza central es `DistributedApplicationTestingBuilder`, que construye el AppHost real desde el test:

```csharp
var builder = await DistributedApplicationTestingBuilder.CreateAsync<Projects.EntryHub_AppHost>();

_app = await builder.BuildAsync();

await _app.StartAsync(timeout.Token);
await _app.ResourceNotifications.WaitForResourceHealthyAsync("api", timeout.Token);
await _app.ResourceNotifications.WaitForResourceAsync("reminders", KnownResourceStates.Running, timeout.Token);
```

`Projects.EntryHub_AppHost` es la clase que Aspire genera para referenciar el proyecto del AppHost, igual que `Projects.EntryHub_Api` dentro del propio AppHost. Así el test no copia la definición del sistema: si mañana el AppHost añade una caché, el test la arranca sin tocar nada.

Que `StartAsync` termine no significa que todo esté listo, así que el test espera a dos cosas. Primero, a que la API esté sana: `WaitForResourceHealthyAsync("api")` espera a que pase la probe de readiness que declara el AppHost, la que llama a `/health`. Ese endpoint comprueba también PostgreSQL, así que cuando contesta bien ya hay base de datos y migraciones aplicadas.

Después, a que el worker esté en marcha. No tiene endpoints ni health check, así que basta con que esté en estado `Running`. Como el AppHost lo declara con `WaitFor(api)`, no arranca hasta que la API está sana.

Arrancar todo esto es lo más lento de la prueba. Por eso va en una clase aparte, `EntryHubSystem`, que xUnit usa como fixture de colección: se crea una vez y la comparten todos los tests de la colección.

```csharp
[CollectionDefinition(Name)]
public sealed class SystemCollectionDefinition : ICollectionFixture<EntryHubSystem>
{
    public const string Name = "EntryHub system";
}
```

Los tests piden el sistema por constructor y xUnit les pasa siempre la misma instancia:

```csharp
[Collection(SystemCollectionDefinition.Name)]
[Trait("Category", "Aspire")]
public class SystemTests(EntryHubSystem system)
```

## Tokens para una API que corre en otro proceso

En los tests de la API, el token JWT se valida con una configuración que el test mete en memoria. Aquí eso no funciona: la API es otro proceso, lanzado por Aspire, y no comparte nada con el test.

Lo que sí controla el test es cómo se lanza ese proceso. Antes de construir la aplicación, toma el recurso `api` y le añade variables de entorno:

```csharp
// Same wiring as production, plus the settings that make the API accept the tokens of these tests.
var api = builder.CreateResourceBuilder<ProjectResource>("api");
foreach (var (name, value) in Tokens.ApiSettings)
{
    api.WithEnvironment(name, value);
}
```

`Tokens.ApiSettings` lleva el emisor, la audiencia y una clave de firma que solo existe en este proyecto de tests. Los nombres son los de la configuración de autenticación de ASP.NET Core, con `__` en lugar de `:` porque viajan como variables de entorno:

```csharp
public static IReadOnlyDictionary<string, string> ApiSettings { get; } = new Dictionary<string, string>
{
    ["Authentication__Schemes__Bearer__ValidIssuer"] = Issuer,
    ["Authentication__Schemes__Bearer__ValidAudiences__0"] = Audience,
    ["Authentication__Schemes__Bearer__SigningKeys__0__Issuer"] = Issuer,
    ["Authentication__Schemes__Bearer__SigningKeys__0__Value"] = Convert.ToBase64String(Key),
    ["Authentication__Schemes__Bearer__SigningKeys__0__Length"] = Key.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
};
```

Con esa misma clave, `Tokens.Create` firma los tokens que mandan los tests. Para las llamadas, Aspire da un `HttpClient` que ya apunta a la dirección del recurso, sea cual sea el puerto que le tocó en esta ejecución:

```csharp
public HttpClient CreateApiClient(string subject, params string[] roles)
{
    var client = App.CreateHttpClient("api", "http");
    client.DefaultRequestHeaders.Authorization = new("Bearer", Tokens.Create(subject, roles));
    return client;
}
```

## Los tres tests

Cada uno prueba algo que solo existe con el sistema entero en marcha.

El primero comprueba que la API está sana y que guarda en el PostgreSQL del AppHost. Crea una sala a través de la API y la vuelve a leer:

```csharp
[Fact]
public async Task The_api_is_healthy_and_serves_rooms_created_through_it()
{
    using var facilities = system.CreateApiClient("facilities", Roles.Facilities);

    var health = await facilities.GetAsync("/health");
    var created = await facilities.PostAsJsonAsync("/api/v1/rooms", new CreateRoomRequest($"Room {Guid.NewGuid():N}", 2, 6, null));

    Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    Assert.Equal(HttpStatusCode.Created, created.StatusCode);
    var room = await created.Content.ReadFromJsonAsync<RoomResponse>();
    var read = await facilities.GetAsync($"/api/v1/rooms/{room!.Id}");
    Assert.Equal(HttpStatusCode.OK, read.StatusCode);
}
```

El segundo, que sin token la API responde `401`. Parece obvio, pero aquí la autenticación se configura con variables de entorno y no en memoria, así que conviene comprobar que la configuración llega y que no hay ningún hueco:

```csharp
[Fact]
public async Task The_api_rejects_requests_without_a_token()
{
    using var anonymous = system.App.CreateHttpClient("api", "http");

    var response = await anonymous.GetAsync("/api/v1/rooms");

    Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
}
```

El tercero mete una reserva que empieza dentro de cinco minutos y espera a que el worker la marque como recordada.

La reserva no se crea con la API: las reglas de negocio solo aceptan reservas en horario de oficina, y la CI corre a cualquier hora. Por eso el test pide a Aspire la cadena de conexión de la base de datos y la inserta directamente con el `DbContext` de la API:

```csharp
var connectionString = await system.GetConnectionStringAsync(CancellationToken.None);
var options = new DbContextOptionsBuilder<EntryHubDbContext>().UseNpgsql(connectionString).Options;
```

Lo que se prueba es que el worker encuentre la reserva, no cómo la crea la API. Y para saber si la encontró, el test no lee el log: mira la columna. El worker marca `ReminderSentAt` en la misma sentencia que selecciona las reservas, justo antes de escribir el aviso, así que esa marca prueba que una ronda la encontró:

```csharp
// The service marks the booking in the same statement that selects it, right before it logs the reminder,
// so the mark is what proves a round found it. It polls every 30 seconds.
using var timeout = new CancellationTokenSource(ReminderTimeout);
DateTimeOffset? reminderSentAt = null;
while (reminderSentAt is null && !timeout.IsCancellationRequested)
{
    await using var db = new EntryHubDbContext(options);
    reminderSentAt = await db.Bookings
        .Where(booking => booking.Id == bookingId)
        .Select(booking => booking.ReminderSentAt)
        .SingleAsync(timeout.Token);

    if (reminderSentAt is null)
    {
        await Task.Delay(TimeSpan.FromSeconds(2), timeout.Token);
    }
}

Assert.NotNull(reminderSentAt);
```

`ReminderTimeout` son dos minutos. El worker mira cada 30 segundos, así que en el peor caso le bastan cuatro rondas.

Si alguien renombra la columna en la API, este es el test que falla, porque el worker real no la encuentra en la base de datos real.

## Que un sistema que no arranca falle, no se cuelgue

La primera versión de estos tests no tenía timeouts y en la CI salió mal. El job `aspire` se quedó colgado diez minutos sin escribir nada.

La causa salió en cuanto los logs fueron visibles. El AppHost comprobaba la salud de la API por HTTPS, con el certificado de desarrollo de ASP.NET Core. Ese certificado no es de confianza en un runner de CI, así que la comprobación fallaba con `UntrustedRoot`, la API nunca se daba por sana y el test esperaba para siempre.

El arreglo (PR #21) tiene dos partes. La primera es que el AppHost comprueba la salud por el endpoint HTTP, y los tests llaman a la API por HTTP. La segunda es lo que hace que un fallo así se diagnostique rápido: cada paso tiene un límite de tiempo (tres minutos para arrancar y uno para parar) y, si se agota, el fixture vuelca los logs de `postgres`, `api` y `reminders` antes de fallar.

```csharp
using var timeout = new CancellationTokenSource(StartupTimeout);
try
{
    await _app.StartAsync(timeout.Token);
    await _app.ResourceNotifications.WaitForResourceHealthyAsync("api", timeout.Token);
    await _app.ResourceNotifications.WaitForResourceAsync("reminders", KnownResourceStates.Running, timeout.Token);
}
catch (OperationCanceledException)
{
    await DumpLogsAsync();
    throw new TimeoutException($"The system did not start within {StartupTimeout}. The logs of its resources are above.");
}
```

Los logs salen de `ResourceLoggerService`, el servicio de Aspire que guarda lo que escribe cada recurso. Tiene una trampa: `GetAllAsync` no termina cuando se acaban las líneas, se queda esperando nuevas. Por eso cada lectura lleva su propio timeout de diez segundos, y agotarlo solo significa que no queda nada por leer:

```csharp
using var read = new CancellationTokenSource(TimeSpan.FromSeconds(10));
try
{
    await foreach (var batch in logs.GetAllAsync(resource).WithCancellation(read.Token))
    {
        foreach (var line in batch)
        {
            Console.WriteLine(line.Content);
        }
    }
}
catch (OperationCanceledException)
{
    // GetAllAsync keeps waiting for new lines, so a timeout simply means there is nothing more to read.
}
```

Al parar pasa algo parecido. Detener los contenedores puede tardar, pero no debe dejar la ejecución esperando, así que `DisposeAsync` espera como mucho un minuto:

```csharp
await Task.WhenAny(_app.DisposeAsync().AsTask(), Task.Delay(DisposeTimeout));
```

## En la CI

Estos tests necesitan Docker para el contenedor de PostgreSQL. Por eso llevan el trait `Category=Aspire`: el job `build` los excluye con `--filter "Category!=Aspire"` y un job aparte, `aspire`, los ejecuta. Los runners de Ubuntu de GitHub ya traen Docker, así que no hay que instalar nada:

```yaml
aspire:
  # Starts PostgreSQL, the API and the reminders service the way the AppHost does, and tests the result.
  # GitHub-hosted Ubuntu runners come with Docker, which Aspire uses to run the PostgreSQL container.
  runs-on: ubuntu-latest
  # A system that does not start must fail the job, not keep it running for the default six hours.
  timeout-minutes: 15

  steps:
    - uses: actions/checkout@v7

    - uses: actions/setup-dotnet@v6
      with:
        global-json-file: src/global.json
        cache: true
        cache-dependency-path: "**/packages.lock.json"

    - name: Test the whole system
      run: |
        dotnet restore --locked-mode
        dotnet test tests/EntryHub.AppHost.Tests -c Release --no-restore --filter "Category=Aspire" \
          --logger "console;verbosity=detailed" --blame-hang-timeout 8m
      working-directory: src
```

Hay dos límites, porque protegen cosas distintas. `--blame-hang-timeout 8m` corta `dotnet test` si una prueba lleva ocho minutos sin terminar y deja un informe de qué estaba haciendo. `timeout-minutes: 15` es la red de seguridad del job entero: sin él, GitHub deja correr un job colgado hasta seis horas. Y `verbosity=detailed` hace que el log del job muestre cada test y la salida de los recursos, que es lo que permitió encontrar el problema del certificado.

En la última ejecución, los tres tests tardaron 37 segundos, contando el arranque del sistema, y el job entero algo más de un minuto, desde el checkout hasta la limpieza.

## Qué no probar así

Los tests de sistema son pocos porque cada uno arranca contenedores y procesos, necesita Docker, y solo arrancar el sistema lleva decenas de segundos. Las reglas de negocio, la validación, los códigos de error y el contrato OpenAPI se quedan en `EntryHub.Api.Tests`, que los prueban con la API en memoria, mucho más rápido y con mensajes de fallo más claros.

Aquí va solo lo que necesita el sistema entero para tener sentido: que arranca, que la API llega a su base de datos con la configuración de verdad, y que dos servicios se entienden a través de PostgreSQL.

## Resumiendo

- `DistributedApplicationTestingBuilder` arranca el AppHost real desde xUnit, así que el test no repite la definición del sistema.
- Una API en otro proceso no ve la configuración del test: los tokens se aceptan pasándole variables de entorno con `WithEnvironment`.
- Para probar dos servicios juntos, comprueba el efecto en la base de datos y pon un límite de tiempo a la espera.
- Pon timeouts a todo y vuelca los logs cuando el sistema no arranque, para que un fallo se pueda diagnosticar desde el log del job.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el [siguiente post](/2026-10-05-aspire-kubernetes-helm-kind), el último de la serie, el AppHost deja de arrancar procesos en tu máquina y se convierte en un chart de Helm que instalamos en Kubernetes.
