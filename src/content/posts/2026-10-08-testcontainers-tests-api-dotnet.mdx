---
title: "Tus tests no deberían depender de quién los ejecuta"
subtitle: El PostgreSQL de los tests lo ponía la CI, o lo tenías tú instalado
description: "Testcontainers en .NET 10 para los tests de integración de una API: PostgreSQL en un contenedor por ejecución, migraciones una vez, tests en paralelo sobre una base de datos y su sitio en la pirámide de tests."
date: 2026-10-08
topic: dotnet
published: false
---

import TestPyramidDiagram from '../../components/TestPyramidDiagram.astro';

Los tests de la API de [entry-hub](https://github.com/MookieFumi/entry-hub) necesitan un PostgreSQL de verdad. Hasta hace poco, ese PostgreSQL no lo ponían los tests. En la CI lo ponía el job, y en tu máquina lo tenías que tener instalado tú, con el usuario, la contraseña y la base de datos que el código esperaba. Si no lo tenías, los tests fallaban al conectar, y el error no decía qué te faltaba.

El mismo test pasaba o fallaba según quién lo ejecutara. Este post va de cómo dejó de ser así con [Testcontainers](https://dotnet.testcontainers.org/), y de dónde encajan esos tests en la pirámide de tests.

## Antes: el contenedor de servicio

En GitHub Actions, un job puede arrancar contenedores de servicio al lado de sus pasos. Así estaba el job `build`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_USER: entryhub
      POSTGRES_PASSWORD: entryhub
      POSTGRES_DB: entryhub
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U entryhub -d entryhub"
      --health-interval 5s
      --health-timeout 3s
      --health-retries 10

env:
  ENTRYHUB_TEST_CONNECTION: Host=localhost;Port=5432;Database=entryhub;Username=entryhub;Password=entryhub
```

Los tests leían la cadena de conexión de `ENTRYHUB_TEST_CONNECTION` y, si no estaba, usaban un PostgreSQL en `localhost` con ese mismo usuario.

Funciona, pero la base de datos queda en la configuración de la CI. En local tienes que replicarla a mano. Y si mañana cambias de CI, el bloque `services` se queda atrás y hay que reescribirlo en el formato de la nueva.

## Después: el test arranca su base de datos

Con Testcontainers, el primer test que necesita la base de datos arranca un contenedor de PostgreSQL, y el resto de la ejecución lo comparte. Todo vive en una clase, `TestDatabase`:

```csharp
private const string Image = "postgres:17-alpine";

private static readonly Lazy<string> Connection = new(() =>
    Environment.GetEnvironmentVariable(EnvironmentVariable) ?? StartContainer());

public static string ConnectionString => Connection.Value;

private static string StartContainer()
{
    var container = new PostgreSqlBuilder(Image)
        .WithDatabase("entryhub")
        .WithUsername("entryhub")
        .WithPassword("entryhub")
        .Build();

    // Lazy<T> needs a synchronous factory. It runs once per test run, before any test touches the database.
    container.StartAsync().GetAwaiter().GetResult();
    return container.GetConnectionString();
}
```

Hay tres detalles en ese código. La imagen es la misma que usaba el contenedor de servicio, `postgres:17-alpine`. El cambio no debía mover nada más que quién arranca la base de datos.

Hay un contenedor por ejecución. `Lazy<T>` garantiza que `StartContainer` se ejecuta una sola vez aunque varios tests pidan la conexión a la vez. Un contenedor por test aislaría más, pero pagarías su arranque en cada test.

Y la conexión la da el contenedor: `GetConnectionString()` devuelve el host y el puerto que Docker le ha asignado, así que no hay puertos fijos que choquen con un PostgreSQL que ya tengas en la máquina.

Las migraciones se aplican también una sola vez, con otro `Lazy`:

```csharp
private static readonly Lazy<Task> Migrated = new(MigrateAsync);

public static Task EnsureMigratedAsync() => Migrated.Value;
```

Cada test que toca la base de datos empieza con `await TestDatabase.EnsureMigratedAsync()`. El primero aplica las migraciones y el resto espera a la misma tarea.

¿Y quién borra el contenedor? Testcontainers arranca a su lado un contenedor pequeño, Ryuk, que vigila el proceso de los tests. Cuando el proceso termina, aunque sea porque lo has parado a medias, Ryuk elimina los contenedores que creó. No hay que escribir ningún `DisposeAsync`.

Los tests no cambiaron ni una línea con esto, solo el sitio del que sale la cadena de conexión.

## Tests que no se pisan

Una sola base de datos para todos los tests, y xUnit ejecuta en paralelo las clases de test. Para que eso no dé resultados raros, cada test crea sus propios datos y no cuenta con los de nadie:

```csharp
private static string UniqueName() => $"Room {Guid.NewGuid():N}";
```

Las salas llevan un nombre único y los usuarios un identificador único. Así, un test que crea una sala y luego la busca encuentra la suya, aunque otros diez tests estén creando salas a la vez.

Hay tests que no pueden funcionar así, porque cuentan: listar las salas de una planta y comprobar que salen tres. Esos usan una planta reservada para ellos, la 90 por ejemplo, y la vacían antes de empezar. La base de datos dura toda la ejecución, y si usas un PostgreSQL propio, dura más que eso.

## Dónde encajan en la pirámide

La pirámide de tests la popularizó Mike Cohn en *Succeeding with Agile* (2009), con tres escalones: muchos tests unitarios en la base, menos tests de servicio en el medio y pocos tests de interfaz arriba. Ham Vocke la puso al día en [*The Practical Test Pyramid*](https://martinfowler.com/articles/practical-test-pyramid.html), en el blog de Martin Fowler, y le dio nombre a lo que hay en el medio: tests de integración y tests de contrato. El propio Fowler separa en [*IntegrationTest*](https://martinfowler.com/bliki/IntegrationTest.html) la integración estrecha, que prueba tu código contra una dependencia real, de la amplia, que levanta el servicio entero.

Con esas referencias, los tests de entry-hub quedan así:

<TestPyramidDiagram />

| Escalón | Tipo de test | En entry-hub | Tests | ¿Usa Testcontainers? |
|---|---|---|---:|---|
| Base | Unitario | Reglas puras: la política de reservas, la ocupación de una sala, la paginación | 26 | No: no hay base de datos |
| Medio | Integración estrecha | Los handlers, que son los casos de uso, contra PostgreSQL, sin HTTP | 28 | Sí |
| Medio | Integración amplia | Los endpoints con `WebApplicationFactory`: rutas, roles, validación, errores | 33 | Sí |
| Medio | Contrato | Las respuestas reales cumplen el contrato OpenAPI | 2 | Sí |
| Cima | End-to-end | Los tests de sistema: el AppHost arranca PostgreSQL, la API y los recordatorios | 3 | No: el PostgreSQL lo arranca Aspire |

Testcontainers no aparece como escalón porque no es un tipo de test. Es la forma de tener la base de datos real. En entry-hub la usa el escalón del medio.

Los casos de uso son integración estrecha: cada handler (crear una reserva, cancelarla) se prueba con la base de datos real pero sin HTTP. Los endpoints son integración amplia: la API entera en memoria, con su pipeline. El test de contrato es del lado del proveedor: comprueba que la API cumple su propio contrato, como conté en [el post de contract testing](/2026-09-30-contract-testing-openapi-dotnet). No es contrato dirigido por el consumidor, al estilo de Pact.

La cima de Cohn es la interfaz. entry-hub no tiene interfaz, así que sus tests end-to-end entran por HTTP. Esos 3 tests no usan Testcontainers porque el PostgreSQL lo arranca Aspire, pero un end-to-end también podría usarlo: arrancar la imagen de la API y la de PostgreSQL en una red de Docker y hablarles por HTTP. Lo que hace end-to-end a un test es que todo el sistema corre con sus piezas reales, no que corra en infraestructura de producción.

Si cuentas, el medio pesa más que la base: 63 tests frente a 26. La pirámide clásica pedía pocos tests de integración porque eran lentos y dependían de una base de datos compartida que alguien tenía que mantener. Testcontainers abarata ese escalón, pero no cambia el orden: la cima sigue siendo la más pequeña.

## Cuando no hay Docker

Testcontainers necesita un motor de Docker que ejecute contenedores Linux. Los runners de Ubuntu de GitHub Actions lo tienen. Los de Windows solo ejecutan contenedores Windows, y los de macOS no tienen Docker. En tu máquina, puede que no lo tengas arrancado.

Para esos casos queda la salida de antes: si `ENTRYHUB_TEST_CONNECTION` tiene valor, los tests usan ese PostgreSQL y no arrancan ningún contenedor.

```bash
ENTRYHUB_TEST_CONNECTION="Host=localhost;Port=5432;Database=entryhub;Username=entryhub;Password=entryhub" dotnet test
```

Y para que la CI no falle con un error de conexión en mitad de un test, antes de los tests se ejecuta `scripts/check-docker.sh`. Comprueba que hay un comando `docker`, que el motor responde y que ejecuta contenedores Linux. Si falta algo, falla en ese paso y dice qué hacer:

```text
No docker command on this machine. Install Docker (or Podman with its Docker-compatible socket), or set ENTRYHUB_TEST_CONNECTION to a PostgreSQL of your own to run the API tests without containers.
```

Podman también sirve, si expone su socket compatible con Docker y `DOCKER_HOST` apunta a él.

## Testcontainers no es Aspire

Es fácil mezclarlos, porque los dos arrancan PostgreSQL en Docker desde un test. La diferencia está en qué arranca cada uno. Testcontainers pone la base de datos que necesita un test, y la API corre dentro del proceso del test. Aspire arranca el sistema entero, cada pieza en su proceso, y el test lo ve desde fuera. Lo conté en [el post de tests de sistema con Aspire](/2026-10-04-tests-sistema-aspire), y por eso en la tabla Aspire está arriba.

## Resumiendo

- Antes, el PostgreSQL de los tests lo ponía la CI con un contenedor de servicio, o lo tenías que tener tú instalado. Ahora lo arranca el propio test con Testcontainers, y el mismo `dotnet test` funciona igual en todas partes.
- Un contenedor por ejecución, compartido con `Lazy<T>`, y migraciones una sola vez. Ryuk lo borra al terminar.
- Los tests comparten base de datos: cada uno crea sus datos con nombres únicos, y los que cuentan usan su propia planta.
- En la pirámide, Testcontainers da la base de datos real al escalón del medio: integración estrecha, integración amplia y contrato. No es un tipo de test.
- Sin Docker, `ENTRYHUB_TEST_CONNECTION` apunta a un PostgreSQL propio, y `check-docker.sh` hace que la CI falle con un mensaje claro.

El cambio completo está en [entry-hub](https://github.com/MookieFumi/entry-hub/blob/main/src/tests/EntryHub.Api.Tests/Support/TestDatabase.cs).
