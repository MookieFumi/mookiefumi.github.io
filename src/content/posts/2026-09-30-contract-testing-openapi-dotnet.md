---
title: "Tu API dice cumplir su contrato: compruébalo con un test"
subtitle: Que el contrato esté al día no significa que la API lo cumpla
description: "Contract testing en .NET 10: validar las respuestas reales de una Minimal API contra los esquemas del documento OpenAPI con JsonSchema.Net, y declarar los errores con ProducesProblem."
date: 2026-09-30
topic: aspnet
series: minimal-apis-dotnet
published: false
---

En el [post de OpenAPI](/2026-09-25-openapi-scalar-minimal-apis) dejamos el contrato de [entry-hub](https://github.com/MookieFumi/entry-hub) en el repositorio, generado en cada build y vigilado por la CI: si cambia un endpoint y el contrato no, el PR falla. Eso asegura que el fichero refleja el código. Lo que no asegura es que la API, en marcha, responda lo que el fichero dice.

Son dos direcciones distintas. El generador lee los tipos de los endpoints, pero la respuesta real pasa por la serialización, por los filtros y por el código que decide el estado HTTP. Y el post de OpenAPI ya dejó un ejemplo de que no siempre coinciden: crear una sala con un nombre repetido responde `409`, y el contrato no lo mencionaba.

En este post comprobamos la otra dirección con un test: llamar a la API de verdad y validar cada respuesta contra el esquema que el contrato declara para ella.

## Qué se comprueba

Para cada llamada, el test mira tres cosas:

1. Que el código de estado esté declarado en el contrato para esa operación.
2. Si el contrato declara un cuerpo, que la respuesta cumpla su esquema JSON.
3. Si no lo declara, que la respuesta venga vacía.

No hace falta ninguna herramienta externa. El documento es OpenAPI 3.1, y en 3.1 los esquemas son JSON Schema de verdad, así que basta una librería de JSON Schema. En entry-hub usamos [JsonSchema.Net](https://github.com/json-everything/json-everything).

## Leer el contrato desde el test

El proyecto de tests enlaza el fichero del contrato y lo copia a la salida, para leer el mismo fichero que está en el repositorio:

```xml
<Content Include="..\..\..\contracts\EntryHub.Api.json" Link="contracts\EntryHub.Api.json" CopyToOutputDirectory="PreserveNewest" />
```

El único truco está en sacar el esquema de una operación. Los esquemas de OpenAPI se referencian entre sí con `#/components/schemas/...`, y `components` no existe en JSON Schema. Así que el test copia todos los esquemas del contrato a `$defs` y reescribe las referencias:

```csharp
/// <summary>
/// The response schema of one operation, with the schemas of the contract moved to <c>$defs</c> and the
/// <c>#/components/schemas/...</c> references pointed there, because JSON Schema has no <c>components</c> keyword.
/// </summary>
private static JsonSchema SchemaOf(JsonNode contract, string path, string method, string status, string? mediaType)
{
    var content = contract["paths"]![path]![method]!["responses"]![status]!["content"]!;
    var schema = content[mediaType ?? "application/json"]!["schema"]!.DeepClone();
    schema["$defs"] = contract["components"]!["schemas"]!.DeepClone();
    return JsonSchema.FromText(schema.ToJsonString().Replace("#/components/schemas/", "#/$defs/", StringComparison.Ordinal));
}
```

El esquema se busca por el tipo de contenido de la respuesta real. Si la API responde `application/problem+json` y el contrato solo declara `application/json`, el test falla al buscarlo, que también es un desajuste que queremos ver.

## La comprobación

La comprobación de cada respuesta queda en un método:

```csharp
private static async Task AssertMatchesAsync(JsonNode contract, HttpResponseMessage response, string path, string method, string status)
{
    Assert.Equal(status, ((int)response.StatusCode).ToString(System.Globalization.CultureInfo.InvariantCulture));

    var declared = contract["paths"]![path]![method]!["responses"]![status];
    Assert.True(declared is not null, $"{method.ToUpperInvariant()} {path} answers {status}, which the contract does not declare.");

    var body = await response.Content.ReadAsStringAsync(CancellationToken.None);
    if (declared["content"] is null)
    {
        Assert.Empty(body);
        return;
    }

    var schema = SchemaOf(contract, path, method, status, response.Content.Headers.ContentType?.MediaType);
    using var json = JsonDocument.Parse(body);
    var result = schema.Evaluate(json.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List });

    Assert.True(result.IsValid, $"{method.ToUpperInvariant()} {path} -> {status} does not match the contract: {JsonSerializer.Serialize(result)}");
}
```

`OutputFormat.List` hace que, si el esquema no se cumple, el mensaje del test diga qué propiedad falla y por qué, en vez de un simple `false`.

Los tests arrancan la API con `WebApplicationFactory` contra un PostgreSQL real, como el resto de tests de endpoints de la serie. El primero recorre respuestas correctas: crear una sala, leerla, listarlas y la salud de la API.

```csharp
var calls = new[]
{
    (Response: created, Path: "/api/v1/rooms", Method: "post", Status: "201"),
    (Response: await facilities.GetAsync($"/api/v1/rooms/{room!.Id}", CancellationToken.None), Path: "/api/v1/rooms/{id}", Method: "get", Status: "200"),
    (Response: await facilities.GetAsync("/api/v1/rooms", CancellationToken.None), Path: "/api/v1/rooms", Method: "get", Status: "200"),
    (Response: await facilities.GetAsync("/api/v1/health", CancellationToken.None), Path: "/api/v1/health", Method: "get", Status: "200"),
};

foreach (var (response, path, method, status) in calls)
{
    await AssertMatchesAsync(contract, response, path, method, status);
}
```

## Los errores también son contrato

El segundo test fuerza respuestas de error: un nombre de sala repetido, una sala que no existe, una reserva en sábado para más gente de la que cabe y una reserva que pisa otra. Con el contrato tal como estaba, falla en la primera:

```text
Failed EntryHub.Api.Tests.Documentation.ContractTests.Error_responses_match_the_contract
  POST /api/v1/rooms answers 409, which the contract does not declare.
```

Es el hueco que vimos en el post de OpenAPI. El generador documenta las respuestas a partir del tipo de retorno, y `ProblemHttpResult` no dice qué código lleva. `ForbidHttpResult` tampoco, así que el `403` de leer la reserva de otra persona tampoco estaba. La solución es declararlos en el endpoint:

```csharp
group.MapPost("/", HandleAsync).WithName("CreateRoom").WithSummary("Creates a room. Facilities only.").RequireAuthorization(Policies.Facilities)
    .ProducesProblem(StatusCodes.Status409Conflict);
```

`ProducesProblem` declara una respuesta `application/problem+json` con el esquema estándar de `ProblemDetails`. Para el `403`, que no tiene cuerpo, basta `Produces(StatusCodes.Status403Forbidden)`.

El `422` de las reglas de negocio merece algo más. Como vimos en el [post de validación](/2026-09-24-validacion-errores-minimal-apis), lleva una extensión `violations` con el código de cada regla rota, que es justo lo que el cliente necesita para reaccionar. Con `ProducesProblem` el contrato solo diría "un `ProblemDetails`", y el cliente no sabría que existe `violations`. Así que lo declaramos con un tipo propio, que solo existe para el contrato:

```csharp
// Only for the contract: BookingProblems.RulesBroken writes these same fields, so clients learn about "violations".

/// <summary>
/// A booking that breaks one or more booking rules.
/// </summary>
/// <param name="Type">A URI that identifies the kind of problem.</param>
/// <param name="Title">A short summary of the problem.</param>
/// <param name="Status">Always 422.</param>
/// <param name="Detail">The messages of the broken rules, joined.</param>
/// <param name="Violations">Every rule the booking breaks, with a stable code.</param>
public sealed record RulesBrokenProblem(string Type, string Title, int Status, string Detail, IReadOnlyList<RuleViolation> Violations);
```

```csharp
group.MapPost("/", HandleAsync).WithName("CreateBooking").WithSummary("Books a room, enforcing the booking rules.")
    .Produces<RulesBrokenProblem>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")
    .ProducesProblem(StatusCodes.Status409Conflict);
```

El endpoint no construye nunca un `RulesBrokenProblem`: sigue devolviendo el `ProblemHttpResult` de siempre. Y ese es el riesgo de declarar un tipo aparte, que el día que alguien cambie una cosa y no la otra, el contrato mienta. Para eso está el test: valida el `422` real contra este esquema, que exige `violations` con su `code` y su `message`.

Con los errores declarados, el contrato pasa de responder solo `201` en `POST /api/v1/bookings` a esto:

```json
"responses": {
  "201": { "description": "Created", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/BookingResponse" } } } },
  "422": { "description": "Unprocessable Entity", "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/RulesBrokenProblem" } } } },
  "409": { "description": "Conflict", "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/ProblemDetails" } } } }
}
```

Y los dos tests pasan.

## Lo que queda fuera

El `400` de la validación integrada sigue sin declarar. Sin `AddProblemDetails()`, ese error sale como `application/json`, sin `type` ni `status`, así que declararlo como `ProblemDetails` sería mentir. Lo arreglamos en la píldora de manejo global de errores, que añade `AddProblemDetails()`.

Tampoco validamos el stream de [Server-Sent Events](/2026-09-29-server-sent-events-minimal-apis): su contenido no es un documento JSON, sino una secuencia de eventos, y ya tiene su propio test.

Y esto es contract testing del lado del proveedor: comprobamos que la API cumple el contrato que publica. El enfoque guiado por los consumidores, en el que cada cliente declara lo que espera (con herramientas como Pact), resuelve otro problema y no lo cubre este post.

## Resumiendo

- Que la CI compruebe que el contrato está al día con el código no basta: hay que comprobar también que las respuestas reales lo cumplen. Con OpenAPI 3.1 basta una librería de JSON Schema y un test de integración.
- Los errores son parte del contrato. `ProducesProblem`, `Produces` y un tipo propio para el `422` los declaran, y el mismo test los valida.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En la siguiente píldora vemos cómo detectar en la CI los cambios del contrato que rompen a los clientes.
