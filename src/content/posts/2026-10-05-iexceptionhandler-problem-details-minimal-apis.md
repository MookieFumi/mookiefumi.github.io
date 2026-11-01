---
title: "Un manejo global de errores con ProblemDetails"
subtitle: Si la base de datos no contesta, el cliente debería saber que puede reintentar en cinco segundos
description: "Manejo global de errores en Minimal APIs con .NET 10: AddProblemDetails, UseExceptionHandler e IExceptionHandler para devolver 503 con Retry-After sin exponer la traza, con tests."
date: 2026-10-05
topic: aspnet
series: minimal-apis-dotnet
published: false
---

En el [post de validación](/2026-09-24-validacion-errores-minimal-apis) vimos los errores que decide el código: el `400` de un cuerpo mal formado y el `422` de una regla de negocio. Quedaban los que no decide nadie. Si PostgreSQL deja de contestar o un handler tiene un bug, la excepción sube hasta arriba y [entry-hub](https://github.com/MookieFumi/entry-hub) respondía un `500` con el cuerpo vacío. El cliente no sabía si reintentar, y quien leyera los logs tampoco tenía cómo cruzar ese fallo con la petición.

Y había un cabo suelto del [post de contract testing](/2026-10-01-contract-testing-openapi-dotnet): el `400` de la validación integrada salía como `application/json`, sin `type` ni `status`, así que no lo podíamos declarar en el contrato como un `ProblemDetails`.

Las dos cosas se arreglan con lo que trae el framework.

## AddProblemDetails y UseExceptionHandler

Son dos líneas en `Program.cs`:

```csharp
builder.Services.AddValidation();
// Every error the framework writes (validation, unhandled exceptions) becomes application/problem+json.
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<DatabaseUnavailableHandler>();

var app = builder.Build();

// First in the pipeline, so it catches what everything after it throws. Exceptions no handler takes become a 500
// problem details without the stack trace, which stays in the logs.
app.UseExceptionHandler();
```

`AddProblemDetails()` registra el servicio que escribe errores con el formato de la [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457). A partir de ahí, el framework lo usa para los errores que escribe él, también los de la validación. El mismo cuerpo de reserva vacío de antes ahora responde así:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Title": ["The Title field is required."],
    "Attendees": ["The field Attendees must be between 1 and 500."]
  },
  "traceId": "00-c782a41fe26f0867ad772ff73f1d3faa-74d6bd407d147780-01"
}
```

`UseExceptionHandler()` es el middleware que captura las excepciones. Va el primero para que envuelva todo lo demás. Sin `AddProblemDetails()`, llamarlo sin argumentos falla al arrancar, porque no sabría qué responder. Con él, una excepción que nadie maneja acaba en esto:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.6.1",
  "title": "An error occurred while processing your request.",
  "status": 500,
  "traceId": "00-73f7c9ab7bbba74b1ef7d13f131397db-40b8cad3e6defed2-01"
}
```

Ni el mensaje de la excepción ni la traza llegan al cliente. Lo que llega es el `traceId`, el identificador de la traza de esa petición, con el que se puede buscar el error en los logs. El middleware sigue registrando la excepción completa.

## Un IExceptionHandler para la base de datos

Un `500` genérico está bien para un bug. Pero que la base de datos no conteste es otra cosa: probablemente se arregle sola en unos segundos, y el cliente debería saberlo. Para eso está `IExceptionHandler`, una interfaz con un solo método que el middleware llama antes de su respuesta por defecto:

```csharp
public sealed partial class DatabaseUnavailableHandler(
    IProblemDetailsService problemDetails,
    ILogger<DatabaseUnavailableHandler> logger) : IExceptionHandler
{
    private const int RetryAfterSeconds = 5;

    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (!IsTransientDatabaseError(exception))
        {
            return false;
        }

        // Since .NET 10 the middleware does not log exceptions that a handler handles, so the handler logs its own.
        LogDatabaseUnavailable(logger, exception, httpContext.Request.Method, httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        httpContext.Response.Headers.RetryAfter = RetryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Title = "Database unavailable",
                Detail = $"The booking database did not answer. Try again in {RetryAfterSeconds} seconds.",
            },
        });
    }
}
```

Si devuelve `false`, el middleware pasa al siguiente handler registrado o, si no hay más, al `500` genérico. Si devuelve `true`, la respuesta ya está escrita. El cuerpo lo escribe `IProblemDetailsService`, así que el `503` tiene la misma forma que el resto de errores, con su `traceId`:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.6.4",
  "title": "Database unavailable",
  "status": 503,
  "detail": "The booking database did not answer. Try again in 5 seconds.",
  "traceId": "00-cf569213e23d6c41298b9344077b5cff-23435fa6817f32c8-01"
}
```

La cabecera `Retry-After: 5` es la que le dice a un cliente HTTP bien hecho cuánto esperar antes de reintentar.

El log va dentro del handler porque, desde .NET 10, el middleware [no registra las excepciones que un `IExceptionHandler` marca como manejadas](https://learn.microsoft.com/aspnet/core/breaking-changes/10/exception-handler-diagnostics-suppressed). Tiene sentido para errores esperados, pero una base de datos caída la quiero ver en los logs, así que el handler la registra él mismo.

La comprobación de la excepción me la corrigió el test. Mi primera versión comprobaba `exception is NpgsqlException { IsTransient: true }`, y el test seguía devolviendo `500`. La excepción que llegaba era esta:

```text
System.InvalidOperationException: An exception has been raised that is likely due to a transient failure.
 ---> Npgsql.NpgsqlException (0x80004005): Failed to connect to 127.0.0.1:1
 ---> System.Net.Sockets.SocketException (111): Connection refused
```

La estrategia de ejecución del proveedor de Npgsql para EF Core envuelve los errores transitorios en una `InvalidOperationException`, incluso con los reintentos desactivados, como los tiene entry-hub. Así que el handler recorre la cadena de excepciones:

```csharp
// EF Core's Npgsql execution strategy wraps transient errors in an InvalidOperationException, even with retries
// off, so the Npgsql exception can be the inner one.
private static bool IsTransientDatabaseError(Exception? exception)
{
    for (; exception is not null; exception = exception.InnerException)
    {
        if (exception is NpgsqlException { IsTransient: true })
        {
            return true;
        }
    }

    return false;
}
```

`IsTransient` lo pone Npgsql cuando el error es de los que pueden desaparecer solos: una conexión rechazada, un timeout. Un error de sintaxis SQL no lo es, y ese sigue siendo un `500`.

## Los tests

Para el `503`, el test arranca la API contra un puerto en el que no escucha nadie, con la misma cadena de conexión que ya usaban los tests del endpoint de salud:

```csharp
await using var factory = new ApiFactory(TestDatabase.Unreachable);
using var client = ClientFor(factory);

var response = await client.GetAsync("/api/v1/rooms", CancellationToken.None);

Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
Assert.Equal(TimeSpan.FromSeconds(5), response.Headers.RetryAfter?.Delta);
```

Para el `500` hace falta una excepción que nadie espere. El test registra un interceptor de EF Core que lanza en cada consulta, y comprueba que el mensaje no aparece en la respuesta:

```csharp
private sealed class FailingCommandInterceptor : DbCommandInterceptor
{
    public const string Message = "Something nobody expected.";

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException(Message);
}
```

## El 400, por fin en el contrato

Con el `400` en formato `ProblemDetails`, los endpoints con cuerpo validado ya lo pueden declarar:

```csharp
group.MapPost("/", HandleAsync).WithName("CreateRoom").WithSummary("Creates a room. Facilities only.").RequireAuthorization(Policies.Facilities)
    .ProducesValidationProblem()
    .ProducesProblem(StatusCodes.Status409Conflict);
```

`ProducesValidationProblem()` declara un `application/problem+json` con el esquema `HttpValidationProblemDetails`, que incluye `errors`. El test de contrato añade un cuerpo inválido para salas y otro para reservas, y los valida contra ese esquema. Y el check de [cambios incompatibles](/2026-10-03-cambios-incompatibles-contrato-openapi) lo clasifica como lo que es, dos respuestas de error nuevas que no rompen a nadie:

```text
2 changes: 0 error, 0 warning, 2 info
info	[response-non-success-status-added] at contracts/EntryHub.Api.json
	in API POST /api/v1/bookings
		added the non-success response with the status `400`
```

El `500` y el `503` no los declaramos en cada operación, porque cualquier endpoint puede devolverlos.

## Resumiendo

- `AddProblemDetails()` y `UseExceptionHandler()` bastan para que todos los errores, también la validación, salgan como `application/problem+json` con un `traceId` y sin la traza.
- Un `IExceptionHandler` convierte los fallos que tienen arreglo en algo útil para el cliente, como un `503` con `Retry-After`. Desde .NET 10, lo que maneja no se registra solo, y la excepción de Npgsql puede venir envuelta.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). Con esto cerramos la parte de Minimal APIs; en el siguiente post llega Aspire.
