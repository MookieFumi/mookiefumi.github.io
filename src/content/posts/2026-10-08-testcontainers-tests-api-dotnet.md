---
title: "Tus tests no deberían depender de quién los ejecuta"
subtitle: El PostgreSQL de los tests lo ponía la CI, o lo tenías tú instalado
description: "Testcontainers en .NET 10 para los tests de integración de una API: PostgreSQL en un contenedor por ejecución, migraciones una vez, tests en paralelo sobre una base de datos y qué hacer sin Docker."
date: 2026-10-08
topic: dotnet
series: aspire
published: false
---

Los tests de la API de [entry-hub](https://github.com/MookieFumi/entry-hub) necesitan un PostgreSQL de verdad. Hasta hace poco, ese PostgreSQL no lo ponían los tests. En la CI lo ponía el job, y en tu máquina lo tenías que tener instalado tú, con el usuario, la contraseña y la base de datos que el código esperaba. Si no lo tenías, los tests fallaban al conectar, y el error no decía qué te faltaba.

El mismo test pasaba o fallaba según quién lo ejecutara. Este post va de cómo dejó de ser así con [Testcontainers](https://dotnet.testcontainers.org/).

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

Es fácil mezclarlos, porque los dos arrancan PostgreSQL en Docker desde un test. La diferencia está en qué arranca cada uno. Testcontainers pone la base de datos que necesita un test, y la API corre dentro del proceso del test. Aspire arranca el sistema entero, cada pieza en su proceso, y el test lo ve desde fuera. Lo conté en [el post de tests de sistema con Aspire](/2026-10-04-tests-sistema-aspire).

## Resumiendo

- Antes, el PostgreSQL de los tests lo ponía la CI con un contenedor de servicio, o lo tenías que tener tú instalado. Ahora lo arranca el propio test con Testcontainers, y el mismo `dotnet test` funciona igual en todas partes.
- Un contenedor por ejecución, compartido con `Lazy<T>`, y migraciones una sola vez. Ryuk lo borra al terminar.
- Los tests comparten base de datos: cada uno crea sus datos con nombres únicos, y los que cuentan usan su propia planta.
- Sin Docker, `ENTRYHUB_TEST_CONNECTION` apunta a un PostgreSQL propio, y `check-docker.sh` hace que la CI falle con un mensaje claro.

El cambio completo está en [entry-hub](https://github.com/MookieFumi/entry-hub/blob/main/src/tests/EntryHub.Api.Tests/Support/TestDatabase.cs).
