---
title: "Versionar con MapGroup o con Asp.Versioning.Http"
subtitle: Llega la v2, la v1 tiene que seguir viva y lo primero que pide el cuerpo es instalar un paquete
description: "Versionado de Minimal APIs en .NET 10: grupos de rutas con MapGroup frente a Asp.Versioning.Http, con cabeceras de obsolescencia, OpenAPI por versión y cuándo compensa cada uno."
date: 2026-09-28
topic: aspnet
series: minimal-apis-dotnet
published: false
---

Un día la API necesita un cambio que rompe a los clientes: un campo nuevo obligatorio, una respuesta con otra forma. Sale la `v2`, y la `v1` tiene que seguir funcionando mientras los clientes migran. Lo primero que pide el cuerpo es buscar una librería de versionado. En .NET la conocida es [Asp.Versioning](https://github.com/dotnet/aspnet-api-versioning), y para Minimal APIs su paquete es `Asp.Versioning.Http`.

En [entry-hub](https://github.com/MookieFumi/entry-hub) no la usamos. Todo cuelga de `/api/v1` desde el primer día, con un grupo de rutas y nada más. Para que la comparación sea justa, el repositorio tiene un ejemplo en `src/samples/versioning` con la misma API de dos versiones hecha de las dos formas: `GET /rooms`, que en la `v2` añade la planta.

## Con grupos de rutas

Un grupo de rutas por versión, cada uno con sus endpoints:

```csharp
// Each version is a plain route group: the version is just part of the path.
var v1 = app.MapGroup("/api/v1");
v1.MapGet("/rooms", () => new[] { new RoomV1("A-101", 8) });

var v2 = app.MapGroup("/api/v2");
v2.MapGet("/rooms", () => new[] { new RoomV2("A-101", 8, Floor: 1) });
```

La versión es parte de la ruta y el framework no sabe nada más de ella. Es lo mismo que hace entry-hub en `V1Endpoints.cs`, que vimos en el [primer post](/2026-09-23-minimal-apis-vertical-slice):

```csharp
var v1 = app.MapGroup("/api/v1");

GetHealthEndpoint.Map(v1);
v1.MapRoomsEndpoints();
v1.MapBookingsEndpoints();
```

Ninguna petición a la `v1` dice en la respuesta que esa versión está de salida:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

[{"name":"A-101","capacity":8}]
```

La obsolescencia solo aparece en el documento OpenAPI, donde un transformer marca cada operación de la `v1` como `deprecated`. Lo vimos en el [post de OpenAPI](/2026-09-25-openapi-scalar-minimal-apis). Quien lea la documentación lo sabrá, y quien solo llame a la API, no.

## Con Asp.Versioning.Http

La misma API con la librería:

```csharp
builder.Services.AddApiVersioning(options =>
{
    // Adds the api-supported-versions and api-deprecated-versions headers to every response.
    options.ReportApiVersions = true;
    options.ApiVersionReader = new UrlSegmentApiVersionReader();
});

var app = builder.Build();

var versions = app.NewApiVersionSet()
    .HasDeprecatedApiVersion(new ApiVersion(1, 0))
    .HasApiVersion(new ApiVersion(2, 0))
    .Build();

var api = app.MapGroup("/api/v{version:apiVersion}").WithApiVersionSet(versions);

api.MapGet("/rooms", () => new[] { new RoomV1("A-101", 8) }).MapToApiVersion(1, 0);
api.MapGet("/rooms", () => new[] { new RoomV2("A-101", 8, Floor: 1) }).MapToApiVersion(2, 0);
```

Aquí hay un solo grupo, con la versión como parámetro de la ruta (`{version:apiVersion}`). El conjunto de versiones dice cuáles existen y cuál está obsoleta, y cada endpoint se asigna a la suya con `MapToApiVersion`.

Lo que se gana se ve en la respuesta. Con `ReportApiVersions`, cada respuesta lleva dos cabeceras:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
api-supported-versions: 2.0
api-deprecated-versions: 1.0

[{"name":"A-101","capacity":8}]
```

Un cliente que siga en la `v1` puede detectar la cabecera y avisar, sin que nadie lea un changelog. Y con `ApiVersionReader` la versión puede venir de otro sitio: una cabecera, la query string o el tipo de contenido. En el ejemplo usamos `UrlSegmentApiVersionReader` para que las dos versiones de la API tengan las mismas URL.

## Las dos, lado a lado

| | Grupos de rutas | Asp.Versioning.Http |
| --- | --- | --- |
| Paquetes | Ninguno | `Asp.Versioning.Http` |
| Versión en la URL | `MapGroup("/api/v1")` | `MapGroup("/api/v{version:apiVersion}")` |
| Versión obsoleta | Solo en el documento OpenAPI, con un transformer | `HasDeprecatedApiVersion`, también en las respuestas |
| Cabeceras de versiones | Las escribes tú | `ReportApiVersions = true` |
| Versión por cabecera o query string | No | `ApiVersionReader` |
| Un documento OpenAPI por versión | `AddOpenApi` por versión con un filtro de rutas | Lo mismo, más `Asp.Versioning.Mvc.ApiExplorer` para repartir los endpoints |
| Versión que no existe (`/api/v3/rooms`) | 404 | 404 |

He comprobado la última fila con las dos aplicaciones en marcha: las dos devuelven un 404 sin cuerpo para `/api/v3/rooms`.

## Cuándo elegir cada una

Los grupos de rutas bastan mientras la versión solo vive en la URL, tu equipo controla a los clientes y la obsolescencia se anuncia por otro canal: un changelog, un mensaje al equipo que consume la API o el propio documento OpenAPI. No añaden ningún paquete y cualquiera entiende el código a la primera.

`Asp.Versioning.Http` compensa cuando hay clientes que no controlas y tienen que enterarse de la obsolescencia en la propia respuesta, cuando necesitas leer la versión de una cabecera o cuando conviven muchas versiones a la vez y quieres que la librería lleve la cuenta.

entry-hub se queda con grupos de rutas. Tiene una sola versión, los clientes son de la empresa y, si algún día llega la `v2`, el documento OpenAPI la marcará como obsoleta, igual que en el ejemplo. Si cambian esas condiciones, migrar es mover los endpoints a un grupo con versión y añadir el conjunto de versiones. Los handlers no se enteran.

## Resumiendo

- Para versionar por URL no hace falta ninguna librería: un `MapGroup` por versión y, si quieres, un documento OpenAPI por versión.
- `Asp.Versioning.Http` añade lo que los grupos no tienen: obsolescencia anunciada en cada respuesta y la versión desde cabeceras o query string.

El código de las dos versiones está en [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/versioning). En la siguiente píldora vemos cómo entry-hub envía la ocupación de una sala en tiempo real con Server-Sent Events.
