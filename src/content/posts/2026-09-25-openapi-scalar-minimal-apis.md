---
title: "OpenAPI y Scalar en Minimal APIs"
subtitle: Si un cambio en un endpoint no aparece en el diff del PR, alguien se va a enterar en producción
description: "OpenAPI nativo en .NET 10 con Microsoft.AspNetCore.OpenApi y Scalar: generar el documento en el build, revisarlo en CI, versionarlo y publicarlo con cada release."
date: 2026-09-25
topic: aspnet
series: minimal-apis-dotnet
published: false
---

Creas una API nueva con la plantilla de .NET, la arrancas y vas a `/swagger`. Un 404. Desde .NET 9 la plantilla ya no trae Swashbuckle ni Swagger UI. En su lugar trae `Microsoft.AspNetCore.OpenApi`, un paquete del propio ASP.NET Core que genera el documento OpenAPI, y no trae ninguna página para verlo.

Al principio parece que te han quitado algo. Pero el cambio tiene sentido: el documento lo genera el framework a partir del código, y la página que lo enseña es otra pieza que eliges tú. En [entry-hub](https://github.com/MookieFumi/entry-hub) hemos ido un paso más allá. El documento se escribe en un fichero en cada build, se revisa en cada PR y se publica con cada versión, así que hace de contrato de la API.

Este es el tercer post de la serie. En el [primero](/2026-09-23-minimal-apis-vertical-slice) organizamos la API por casos de uso y en el [segundo](/2026-09-24-validacion-errores-minimal-apis) vimos la validación y los errores. Aquí vemos qué cuenta el documento de todo eso y qué se le escapa.

## Quién hace qué

Son tres piezas y conviene no mezclarlas:

| Pieza | Qué hace | Dónde |
| --- | --- | --- |
| `Microsoft.AspNetCore.OpenApi` | Genera el documento a partir de los endpoints | En la aplicación, en `/openapi/v1.json` |
| `Scalar.AspNetCore` | Enseña el documento en una página interactiva | En la aplicación, en `/scalar/v1`, solo en Development |
| `Microsoft.Extensions.ApiDescription.Server` | Arranca la aplicación al compilar y escribe el documento en un fichero | En el build, en `contracts/EntryHub.Api.json` |

La primera es la única imprescindible. Las otras dos son opcionales y no dependen la una de la otra.

## El documento en dos líneas

Con el paquete instalado, registras el documento y mapeas su ruta:

```csharp
builder.Services.AddOpenApi("v1");

app.MapOpenApi();
```

`MapOpenApi()` sirve el documento en `/openapi/v1.json`. En entry-hub lo mapeamos dos veces, porque la extensión de la ruta decide el formato y así también está en YAML:

```csharp
var json = app.MapOpenApi("/openapi/{documentName}.json");
var yaml = app.MapOpenApi("/openapi/{documentName}.yaml");
```

Por defecto el documento sigue OpenAPI 3.1. El contrato de entry-hub empieza con `"openapi": "3.1.1"`. Con 3.1 los esquemas son JSON Schema de verdad, y eso se nota enseguida en cómo salen los tipos que admiten `null`, como `"type": ["null", "array"]`.

## Lo que el documento sabe sin que se lo digas

La mayor parte del documento sale del código que ya teníamos, sin atributos extra.

Empecemos por las respuestas. Los `TypedResults` y los `Results<...>` del primer post dicen qué devuelve cada endpoint. `Results<Ok<RoomResponse>, NotFound>` en `GetRoom` se convierte en un `200` con el esquema `RoomResponse` y un `404`. No hace falta `[ProducesResponseType]`.

Los atributos de validación del segundo post acaban en el esquema como restricciones. `CreateRoomRequest` tiene `[Range(1, 500)]` en `Capacity` y `[StringLength(100)]` en `Name`, y en el contrato quedan así:

```json
"capacity": {
  "maximum": 500,
  "minimum": 1,
  "pattern": "^-?(?:0|[1-9]\\d*)$",
  "type": ["integer", "string"],
  "format": "int32"
}
```

Con `GenerateDocumentationFile` activado (en entry-hub está en el `Directory.Build.props`), los comentarios XML pasan al documento como descripciones. Funciona también con los `<param>` de un record posicional, que es donde menos te lo esperas:

```csharp
/// <param name="Floor">Only rooms on this floor.</param>
/// <param name="MinCapacity">Only rooms that fit at least this many people.</param>
/// <param name="Page">One-based page number; defaults to 1.</param>
/// <param name="PageSize">Items per page; defaults to 20 and is capped at 100.</param>
public sealed record ListRoomsQuery(int? Floor, int? MinCapacity, int? Page, int? PageSize);
```

Cada parámetro de query de `GET /api/v1/rooms` sale con su `description`.

Por último, los metadatos del endpoint: `WithName` se convierte en el `operationId`, `WithSummary` y `WithDescription` en el resumen y la descripción, y `WithTags` agrupa las operaciones. El endpoint de salud de la API lo usa todo:

```csharp
group.MapGet("/health", HandleAsync).WithName("GetHealth").WithTags("Health").WithSummary("Reports whether the API and its database are reachable.")
    .WithDescription("Readiness for clients, as JSON. Kubernetes and the Aspire AppHost do not call this one: they use /health "
        + "(readiness) and /alive (liveness), described under the Probes tag, which sit outside the versioned API and answer plain text.");
```

### Una sorpresa: enteros que también son texto

Fíjate otra vez en `capacity`. El tipo no es `integer`, sino `["integer", "string"]`, con un `pattern` que solo admite dígitos. Pasa con todos los enteros del contrato, también con los parámetros de query.

No es un error del generador. Minimal APIs usa por defecto las opciones JSON "web" de `System.Text.Json`, que incluyen `JsonNumberHandling.AllowReadingFromString`: la API acepta `"capacity": "8"` igual que `"capacity": 8`. El generador lo cuenta tal cual. Un cliente generado a partir de ese contrato puede acabar con un tipo raro para lo que en C# es un `int`.

Si tu API no necesita aceptar números como texto, se cambia en las opciones JSON:

```csharp
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);
```

Lo he probado en el ejemplo de versionado de entry-hub: con `Strict`, los enteros salen como `"type": "integer"` a secas. Ojo, porque esto cambia también cómo se comporta la API: un cliente que hoy manda números entre comillas empezaría a recibir un 400. entry-hub lo deja como está.

### Lo que no sabe

El generador solo sabe lo que el tipo de retorno le cuenta. `ProblemHttpResult` no dice qué código de estado lleva, así que el `409` de crear una sala con un nombre repetido no aparece en el contrato:

```csharp
private static async Task<Results<Created<RoomResponse>, ProblemHttpResult>> HandleAsync(...)
```

`POST /api/v1/rooms` documenta un `201` y nada más. Lo mismo pasa con `POST /api/v1/bookings`: el `400` de la validación, el `422` de las reglas de negocio y el `409` del solape del segundo post no salen. Tampoco el `503` del endpoint de salud, que viaja en un `JsonHttpResult`. Lo apuntamos en el primer post y aquí se ve en el fichero. Lo arreglaremos en el post de contract testing, que es donde comparamos las respuestas reales con lo que dice el contrato.

## Transformers: completar el documento

Lo que el generador no puede deducir se añade con transformers. Hay tres tipos: de documento, de operación y de esquema. En entry-hub usamos los dos primeros, y todo vive en `Documentation/OpenApiExtensions.cs` para que `Program.cs` se quede en una línea:

```csharp
builder.Services.AddEntryHubOpenApi();
```

El transformer de documento pone el título, la versión y la descripción. Sin él, el documento se llama `EntryHub.Api | v1`:

```csharp
services.AddOpenApi(DocumentName, options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info = new OpenApiInfo
        {
            Title = "EntryHub API",
            Version = "1.0",
            Description = "Room booking: rooms, bookings with business rules and a live occupancy stream.",
        };

        AddProbes(document);

        return Task.CompletedTask;
    });
});
```

El mismo transformer describe las probes. `/health` y `/alive` las añade el proyecto de service defaults de Aspire, y no son endpoints sino middleware de health checks, así que el generador no las ve. Las describimos a mano, con su propia etiqueta y una respuesta en texto plano:

```csharp
document.Tags ??= new HashSet<OpenApiTag>();
document.Tags.Add(new OpenApiTag
{
    Name = ProbesTag,
    Description = "For Kubernetes and the Aspire AppHost, not for clients. /health is readiness: every check must pass, "
        + "PostgreSQL included, and Kubernetes holds traffic back until it does. /alive is liveness: it only says the process "
        + "responds, with no dependencies, and Kubernetes restarts the pod when it fails. ...",
});

document.Paths ??= new OpenApiPaths();
document.Paths["/health"] = Probe(
    "Readiness probe: every health check passes, PostgreSQL included.",
    "GetReadiness",
    "Healthy",
    "Unhealthy: a check failed, usually because PostgreSQL does not answer. Kubernetes stops sending traffic to the pod.");
```

`Probe` es un método pequeño que monta la operación `GET` con un `200` y un `503` en `text/plain`. Puede parecer mucho texto para dos rutas, pero la diferencia entre readiness y liveness es justo lo que la gente de plataforma necesita saber, y el documento es donde lo van a buscar.

El transformer de operación de entry-hub pone el candado en las operaciones que piden token. Lo vemos en el siguiente post, con la autenticación.

## Scalar en lugar de Swagger UI

Para ver el documento usamos [Scalar](https://scalar.com). Se instala `Scalar.AspNetCore` y se mapea su página:

```csharp
app.MapScalarApiReference(options => options
    .WithTitle("EntryHub API"));
```

Por defecto la página queda en `/scalar/v1` (`/scalar` redirige ahí) y lee el documento de `/openapi/v1.json`. Swashbuckle sigue existiendo y puedes usar Swagger UI con el documento nativo. Yo prefiero Scalar por esto:

| | Scalar | Swagger UI |
| --- | --- | --- |
| OpenAPI 3.1 | Sí | Depende de la versión |
| Ejemplos de cliente | `curl`, C#, JavaScript, Python y más, listos para copiar | Solo `curl` |
| Interfaz | Moderna, con búsqueda y modo oscuro | La de siempre |
| Paquete para .NET | `Scalar.AspNetCore`, mantenido por Scalar | Swashbuckle, que .NET dejó de traer en la plantilla |

Un detalle práctico: `Scalar.AspNetCore` lleva los ficheros de la página dentro del paquete y la aplicación los sirve ella misma. La página no tira de ningún CDN, así que funciona en una red sin salida a internet.

En entry-hub Scalar solo existe en Development. Fuera de ahí no se mapea, y el documento pide un rol. Eso también va en el siguiente post.

## Cuando hay varias versiones

entry-hub solo tiene `v1`, pero ¿qué pasa el día que salga una `v2` con cambios incompatibles? Los clientes de la `v1` necesitan su contrato, y los nuevos el suyo. Lo natural es un documento por versión. Para que el código sea real lo he montado en el [ejemplo de versionado](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/versioning/MapGroupVersioning) del repositorio, donde cada versión es un grupo de rutas:

```csharp
// One OpenAPI document per version. Each one keeps only the endpoints under its own prefix.
builder.Services.AddOpenApi("v1", options =>
{
    options.ShouldInclude = description => description.RelativePath?.StartsWith("api/v1/", StringComparison.Ordinal) == true;

    // Version 1 is on its way out: every operation of its document is marked as deprecated.
    options.AddOperationTransformer((operation, _, _) =>
    {
        operation.Deprecated = true;
        return Task.CompletedTask;
    });
});
builder.Services.AddOpenApi("v2", options =>
    options.ShouldInclude = description => description.RelativePath?.StartsWith("api/v2/", StringComparison.Ordinal) == true);
```

Sin `ShouldInclude`, los dos documentos llevarían todas las rutas. Con él, cada uno se queda con las de su prefijo. El transformer de operación marca la `v1` entera como obsoleta: cada operación de su documento lleva `"deprecated": true`, y Scalar la señala como tal.

`MapOpenApi()` sirve los dos documentos, en `/openapi/v1.json` y `/openapi/v2.json`, y Scalar los enseña en la misma página con un selector:

```csharp
app.MapOpenApi();
app.MapScalarApiReference(options => options
    .AddDocument("v2", "Version 2", isDefault: true)
    .AddDocument("v1", "Version 1 (deprecated)"));
```

La nueva va por defecto, para que quien llegue sin saber nada empiece por la buena.

Si el build genera los ficheros, como veremos ahora, también salen dos. Ojo con los nombres, porque no siguen la versión. El primero se llama como el proyecto, `MapGroupVersioning.json`, y el segundo lleva el nombre del documento como sufijo, `MapGroupVersioning_v2.json`. Si tu pipeline busca los ficheros por nombre, cuenta con eso.

El porqué de versionar en la URL con grupos de rutas, y no con `Asp.Versioning.Http`, lo dejamos para una píldora sobre `MapGroup`.

## El contrato vive en el repositorio

Hasta aquí el documento existe solo con la aplicación en marcha. Para revisarlo en un PR tiene que estar en un fichero. Lo hace `Microsoft.Extensions.ApiDescription.Server` con tres propiedades en el `.csproj` de la API:

```xml
<!-- Build-time OpenAPI generation: the committed contract lives next to the project and CI checks it is up to date. -->
<OpenApiGenerateDocuments>true</OpenApiGenerateDocuments>
<OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/../../contracts</OpenApiDocumentsDirectory>
<OpenApiGenerateDocumentsOptions>--document-name v1</OpenApiGenerateDocumentsOptions>
```

Al compilar, el paquete arranca la aplicación sin servidor HTTP, le pide el documento `v1` y lo escribe en `contracts/EntryHub.Api.json`, en la raíz del repositorio. Da igual que el build sea Debug o Release: cualquier build regenera el fichero. Y ese fichero se sube al repositorio con el resto del código.

La CI comprueba que el fichero subido es el que sale del código. El paso de gobernanza ya hace un build de Release, así que basta con mirar si `contracts` ha cambiado después:

```yaml
- name: API contract is up to date
  # The Release build in the governance step regenerates contracts/EntryHub.Api.json.
  # A different file means an endpoint changed without committing the new contract.
  run: git diff --exit-code -- contracts
```

Si cambias un endpoint y el contrato del repositorio no cambia con él, el PR falla.

Cuando lo monté me surgió una duda: si cada build regenera el fichero, ¿cómo puede llegar un PR con el endpoint cambiado y el contrato viejo? Pasa más de lo que parece:

- Compilas y no subes el JSON. El fichero cambia en tu disco, pero haces commit solo del `.cs`. Es el caso más habitual.
- Subes sin compilar. Un cambio desde el editor web de GitHub, un cherry-pick o un conflicto resuelto a mano. Nadie ha compilado esa combinación exacta.
- Cambia el generador. Dependabot sube `Microsoft.AspNetCore.OpenApi` y la nueva versión escribe el documento algo distinto. No has tocado ningún endpoint, pero el contrato cambia, y está bien que el PR te lo enseñe.

Lo mejor es lo que se ve en el PR. El diff del contrato aparece al lado del código que lo provoca. Si alguien renombra una propiedad de `RoomResponse`, el revisor ve el cambio en el esquema sin tener que deducirlo. Y un cambio incompatible sin querer se nota antes de mergear, no cuando falla un cliente.

## Publicar el contrato con cada versión

El último paso es que el contrato llegue a quien consume la API sin tener acceso al repositorio. El workflow `release.yml` se lanza al subir un tag como `v1.2.0`, compila en Release y adjunta el contrato a la GitHub Release:

```yaml
- name: Generate the contract
  # The Release build writes contracts/EntryHub.Api.json from the code at this tag.
  run: dotnet build src/EntryHub.slnx -c Release

- name: Static docs
  run: |
    mkdir -p site
    cp contracts/EntryHub.Api.json site/openapi.json
    cp docs/index.html site/index.html
```

Cada release lleva su `openapi-v1.json`, así que se puede descargar el contrato de cualquier versión publicada y compararlo con otro.

El mismo workflow publica en GitHub Pages una documentación estática de la última versión. Es una página HTML mínima, `docs/index.html`, que carga Scalar y lee el `openapi.json` de al lado:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.3"></script>
<script>
  Scalar.createApiReference("#app", { url: "./openapi.json" });
</script>
```

Aquí sí se usa el CDN, porque la página es estática y no hay una aplicación .NET detrás que sirva los ficheros. La versión va fijada para que una actualización de Scalar no cambie la página sin que nadie lo decida. Que la documentación sea pública es una decisión, y en el siguiente post vemos por qué no lo es el documento que sirve la API.

## Resumiendo

- En .NET 10 el documento OpenAPI lo genera el framework a partir de los resultados tipados, la validación y los comentarios XML. Lo que no puede deducir se añade con transformers.
- Scalar lo enseña en local, con un selector cuando hay varias versiones, y cada versión tiene su documento.
- El build escribe el contrato en el repositorio, la CI falla si no está al día y cada release lo publica. El cambio de la API se revisa en el PR, al lado del código.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el siguiente post cruzamos el documento y Scalar con la autenticación: el candado en las operaciones que piden token y cómo probarlas desde Scalar. Más adelante, en el post de contract testing, comprobaremos que las respuestas reales cumplen el contrato.
