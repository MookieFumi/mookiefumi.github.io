---
title: Creando un MCP Server con el SDK de .NET
subtitle: Exponer una API a los LLMs con el SDK oficial de C#
date: 2026-08-15
topic: ia
series: mcp-dotnet
published: true
---

Un modelo de lenguaje me resulta mucho más útil cuando puede consultar datos, lanzar acciones o hablar con mis sistemas. Para eso se ha impuesto el Model Context Protocol (MCP), y en .NET ya tenemos un SDK oficial y estable con el que montar un servidor MCP sin complicarnos demasiado.

En este post quiero contar cómo he creado un MCP Server con el SDK de C# que consume una API existente, orquestado con Aspire. En el siguiente haremos un laboratorio para desplegarlo en un clúster de Kubernetes local con Rancher Desktop.

## ¿Qué es un MCP Server?

Es un servicio que expone capacidades a un cliente compatible con MCP (Visual Studio Code, Claude, un agente propio...) siguiendo un protocolo común. Lo que más se usa son las **tools**, operaciones que el modelo puede descubrir y ejecutar.

Cuando un cliente se conecta, le pregunta al servidor qué tools tiene y recibe de cada una su nombre, su descripción y el esquema JSON de sus parámetros. A partir de ahí el modelo decide cuándo usarlas.

El protocolo también define resources (datos que el modelo puede leer) y prompts (plantillas reutilizables), pero en la práctica casi todo el mundo tira de tools y es en lo que me voy a centrar. El servidor se escribe una vez y sirve para cualquier cliente compatible, sin integraciones a medida.

## Antes de escribir código: ¿hace falta un SDK?

Si la API que queremos exponer ya está publicada en Azure API Management (APIM), hay una opción sin código: APIM permite [exponer una API REST gestionada como MCP Server](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server) y elegir qué operaciones se publican como tools.

Para prototipar, o para dar acceso rápido a APIs que ya tenemos gobernadas en APIM con sus políticas de autenticación y rate limiting, es una buena opción. Eso sí, tiene sus limitaciones:

* Cada operación de la API se convierte en una tool, en una relación 1:1 entre endpoints y tools.
* Solo expone tools, ni resources ni prompts.
* Hace falta un tier de APIM que soporte esta funcionalidad.

La que más me preocupa es la primera, porque replicar la API tal cual no suele ser el mejor diseño para un modelo:

* Con decenas de tools el modelo elige peor, y además gastamos contexto solo en sus descripciones.
* Si para responder una pregunta hay que encadenar tres llamadas, la orquestación recae en el modelo y cada paso es una oportunidad de fallo.
* Un endpoint puede devolver un JSON enorme con campos que al modelo no le aportan nada.

Con el SDK podemos diseñar las tools pensando en cada caso de uso, aunque la API esté organizada de otra forma. Pensemos en un MCP para el equipo de soporte, cuya pregunta habitual es *"¿qué le pasa a este cliente?"*. En lugar de exponer `/customers/{id}`, `/customers/{id}/orders` e `/issues?customer={id}` como tres tools independientes, tiene más sentido una única tool `DiagnoseCustomer(customerId)` que haga esas tres llamadas por dentro y devuelva un resumen con lo relevante.

El caso de uso también ayuda a decidir qué dejar fuera: lo más probable es que soporte solo necesite tools de lectura, sin borrados ni cambios de configuración.

## El SDK oficial de C#

### Un poco de historia

* **Noviembre de 2024**: Anthropic publica el Model Context Protocol como estándar abierto.
* **2 de abril de 2025**: Microsoft y Anthropic [anuncian el SDK oficial de C#](https://developer.microsoft.com/blog/microsoft-partners-with-anthropic-to-create-official-c-sdk-for-model-context-protocol), un proyecto open source dentro de la organización `modelcontextprotocol` en GitHub. Nace a partir de *mcpdotnet*, un proyecto de la comunidad que inició Peder Holdgaard Pedersen, y sale en preview.
* **5 de marzo de 2026**: llega la [versión 1.0](https://devblogs.microsoft.com/dotnet/release-v10-of-the-official-mcp-csharp-sdk/), la primera estable, con soporte completo de la especificación 2025-11-25. Desde aquí el SDK sigue versionado semántico.
* **28 de julio de 2026**: sale la [versión 2.0](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk/), alineada con la especificación 2026-07-28. El cambio que más se nota es que el transporte HTTP pasa a ser sin estado por defecto. Es compatible hacia atrás, así que el código estable de la 1.x sigue compilando y funcionando.

### Los paquetes

El SDK se distribuye en tres paquetes NuGet:

| Paquete | Para qué sirve |
| --- | --- |
| `ModelContextProtocol.Core` | API de bajo nivel, para quien necesite el mínimo de dependencias. |
| `ModelContextProtocol` | Integración con hosting e inyección de dependencias. Suficiente para servidores stdio. |
| `ModelContextProtocol.AspNetCore` | Servidores MCP sobre HTTP en ASP.NET Core. |

Nuestro servidor va a ser remoto y accesible por HTTP, así que usamos `ModelContextProtocol.AspNetCore`, que ya incluye el paquete base:

```bash
dotnet add package ModelContextProtocol.AspNetCore
```

## El ejemplo: una API, su MCP Server y Aspire

Partimos de una solución con tres proyectos:

* **La API**: un proyecto ASP.NET Core creado a partir de la plantilla, con su endpoint renombrado a `GET /brentforecast`, sin parámetros. No voy a entrar en su código; es el backend que queremos exponer y poco más.
* **El MCP Server**: un proyecto ASP.NET Core que consume esa API y la expone como tool.
* **El AppHost de Aspire**: orquesta los dos proyectos y hace que el MCP Server encuentre la API sin URLs fijas.

### El AppHost

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.BrentApi>("brent-api");

builder.AddProject<Projects.BrentMcp>("brent-mcp")
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
```

Con `WithReference(api)`, Aspire inyecta en el MCP Server lo necesario para llegar a la API por su nombre lógico, `brent-api`, sin fijar host ni puerto. `WaitFor(api)` hace que el MCP Server no arranque hasta que la API esté lista.

### El MCP Server

```csharp
using ModelContextProtocol.Server;
using System.ComponentModel;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddHttpClient("BrentApi", client =>
{
    client.BaseAddress = new Uri("https+http://brent-api");
});

builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithToolsFromAssembly();

var app = builder.Build();

app.MapDefaultEndpoints();
app.MapMcp("/mcp");

app.Run();

[McpServerToolType]
public static class BrentTools
{
    [McpServerTool, Description("Gets the Brent forecast for the next days")]
    public static async Task<string> GetBrentForecast(IHttpClientFactory httpClientFactory)
    {
        var client = httpClientFactory.CreateClient("BrentApi");
        return await client.GetStringAsync("/brentforecast");
    }
}
```

`AddServiceDefaults()` viene del proyecto `ServiceDefaults` que genera la plantilla de Aspire. Además de telemetría, health checks y resiliencia, registra el service discovery, y por eso `https+http://brent-api` funciona aunque no sea un host real: es el nombre lógico definido en el AppHost, que se resuelve al endpoint de la API usando HTTPS si está disponible y HTTP si no.

Esta tool es un reflejo 1:1 del endpoint, que para un ejemplo me vale. En un sistema real es aquí donde aplicaría lo que contaba antes: combinar llamadas, filtrar datos y devolver solo lo que el modelo necesita.

## Las piezas del SDK

### `AddMcpServer()`

Registra el núcleo del protocolo en el contenedor de dependencias. Es el punto de entrada y no depende del transporte que usemos.

### `WithHttpTransport()` vs `WithStdioServerTransport()`

El SDK soporta dos transportes:

* `WithHttpTransport()` usa *Streamable HTTP*. Es el que necesitamos para un servidor remoto al que los clientes se conectan por red, y se combina con `MapMcp()`.
* Con `WithStdioServerTransport()` el cliente lanza el servidor como un proceso local y se comunican por la entrada y salida estándar. Viene bien para herramientas locales; en ese caso la aplicación es de consola y no se usa `MapMcp()`.

En el transporte HTTP hay que tener en cuenta las sesiones. Desde la versión 2.0 el servidor es sin estado por defecto: cada petición es independiente, y eso encaja muy bien con balanceadores y varias réplicas. Si nuestras tools necesitan mantener estado entre llamadas, podemos activar las sesiones de forma explícita:

```csharp
builder.Services
    .AddMcpServer()
    .WithHttpTransport(options => options.Stateless = false)
    .WithToolsFromAssembly();
```

En las versiones 1.x era al revés, con sesión por defecto, y con varias réplicas había que usar sticky sessions o activar el modo sin estado.

### `WithToolsFromAssembly()`

Escanea el ensamblado en busca de clases marcadas con `[McpServerToolType]` y registra como tools sus métodos marcados con `[McpServerTool]`. Si prefieres registrar las tools una a una, sin escanear todo el ensamblado, tienes `WithTools<T>()`:

```csharp
builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithTools<BrentTools>();
```

### `[McpServerTool]` y la inyección de dependencias

Los métodos de las tools pueden ser estáticos o de instancia:

* Si son estáticos, como en el ejemplo, el SDK inspecciona la firma y resuelve desde el contenedor los parámetros que son servicios registrados, como `IHttpClientFactory`. Esos parámetros no aparecen en el esquema que ve el modelo.
* Si son de instancia, el SDK crea la clase desde el contenedor, así que podemos inyectar servicios por constructor.

Los parámetros que sí tiene que rellenar el modelo se declaran como parámetros normales, y el SDK genera su esquema JSON a partir del tipo. Por ejemplo, si nuestra API aceptara un número de días:

```csharp
[McpServerTool, Description("Gets the Brent forecast for the given number of days")]
public static async Task<string> GetBrentForecast(
    IHttpClientFactory httpClientFactory,
    [Description("Number of days to forecast, between 1 and 5")] int days)
{
    // ...
}
```

Aquí `httpClientFactory` lo resuelve el contenedor y `days` lo decide el modelo.

### `Description`

El atributo `Description` (de `System.ComponentModel`) es lo que lee el modelo para decidir cuándo usar una tool y cómo rellenar sus parámetros. Con una descripción vaga, el modelo no usa la tool o la usa cuando no toca. Para mí es donde más merece la pena invertir tiempo, y suelo seguir estas pautas:

* Contar para qué sirve la tool. Cómo está implementada al modelo le da igual.
* Indicar los rangos y formatos esperados de cada parámetro.
* Si hay tools parecidas, dejar claro en qué se diferencian.

### `MapMcp()`

Expone el endpoint de Streamable HTTP en la ruta indicada (`/mcp` en nuestro caso). Como es un endpoint más de ASP.NET Core, le podemos aplicar lo de siempre, por ejemplo autenticación con `.RequireAuthorization()`.

## Probándolo desde Visual Studio Code

Arrancamos la solución desde el AppHost:

```bash
aspire run
```

En el dashboard de Aspire aparecen los dos recursos, `brent-api` y `brent-mcp`, con sus endpoints. Copiamos la URL del MCP Server y la añadimos en `.vscode/mcp.json`:

```json
{
  "servers": {
    "brent-mcp": {
      "type": "http",
      "url": "http://localhost:<port>/mcp"
    }
  }
}
```

Al iniciar el servidor desde VS Code debería descubrir la tool `GetBrentForecast`, y el modelo podrá usarla en modo agente para responder preguntas sobre la previsión. Como el MCP Server usa `ServiceDefaults`, en el propio dashboard podemos seguir las trazas de cada llamada, desde la petición del cliente MCP hasta la llamada a la API.

Si quieres inspeccionar el servidor sin pasar por un modelo, el MCP Inspector permite conectarse, listar las tools y ejecutarlas a mano:

```bash
npx @modelcontextprotocol/inspector
```

## Conclusiones

Con el SDK de C#, crear un MCP Server es poco más que registrar unos servicios y decorar unos métodos. Donde de verdad hay que pensar es en el diseño de las tools. Si solo necesitamos exponer rápido una API que ya está en APIM, la opción sin código puede bastar. Si queremos que el modelo trabaje bien, conviene diseñar las tools por caso de uso, con buenas descripciones y respuestas acotadas.

En el siguiente artículo nos ponemos manos a la obra con un laboratorio: llevaremos esta solución a un clúster de Kubernetes local con Aspire y Rancher Desktop, y la conectaremos desde Visual Studio Code.

## Documentación oficial

* [Especificación y documentación de MCP](https://modelcontextprotocol.io)
* [Repositorio del SDK de C#](https://github.com/modelcontextprotocol/csharp-sdk)
* [Documentación del SDK de C#](https://csharp.sdk.modelcontextprotocol.io)
* [Anuncio del SDK de C# (abril 2025)](https://developer.microsoft.com/blog/microsoft-partners-with-anthropic-to-create-official-c-sdk-for-model-context-protocol)
* [Release v1.0 del SDK de C#](https://devblogs.microsoft.com/dotnet/release-v10-of-the-official-mcp-csharp-sdk/)
* [Release v2.0 del SDK de C#](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk/)
* [Exponer una API REST de API Management como MCP Server](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server)
