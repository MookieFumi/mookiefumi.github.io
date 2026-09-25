---
layout: post
title: Creando un MCP Server con el SDK de .NET
subtitle: Exponer una API a los LLMs con el SDK oficial de C#
topic: ia
published: true
---

Los modelos de lenguaje son cada vez más útiles cuando pueden **hacer cosas**: consultar datos, lanzar acciones o hablar con nuestros sistemas. El **Model Context Protocol (MCP)** es el estándar que se ha impuesto para ello, y en .NET ya tenemos un SDK oficial y estable para construir servidores MCP de forma sencilla.

En este artículo veremos cómo crear un MCP Server con el SDK de C# que consume una API existente, orquestado con Aspire. En el siguiente post haremos un laboratorio completo para desplegarlo en un clúster de Kubernetes local con Rancher Desktop.

## ¿Qué es un MCP Server?

Un MCP Server es un servicio que expone capacidades a un cliente compatible con MCP (Visual Studio Code, Claude, un agente propio...) de forma estandarizada. La pieza principal son las **tools**: operaciones que el modelo puede descubrir y ejecutar.

Cuando un cliente se conecta, le pregunta al servidor qué tools tiene y recibe, para cada una, su nombre, su descripción y el esquema JSON de sus parámetros. A partir de ahí es el propio modelo el que decide cuándo usarlas.

Además de tools, el protocolo define **resources** (datos que el modelo puede leer) y **prompts** (plantillas reutilizables), aunque en la práctica las tools son lo más utilizado y es en lo que nos centraremos.

Lo interesante es que el servidor se escribe **una sola vez** y funciona con cualquier cliente compatible, sin integraciones a medida.

## Antes de escribir código: ¿hace falta un SDK?

Si la API que queremos exponer ya está publicada en **Azure API Management (APIM)**, existe una opción sin código: APIM permite [exponer una API REST gestionada como MCP Server](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server), eligiendo qué operaciones se publican como tools.

Es una opción muy válida para prototipar o para dar acceso rápido a APIs que ya tenemos gobernadas en APIM, con sus políticas de autenticación y rate limiting. Pero tiene sus limitaciones:

* **Genera una relación 1:1 entre endpoints y tools.** Cada operación de la API se convierte en una tool.
* **Solo expone tools**, no resources ni prompts.
* Requiere un tier de APIM que soporte esta funcionalidad.

El 1:1 es el punto clave. Replicar la API tal cual no suele ser el mejor diseño para un modelo:

* **Demasiadas tools**: con decenas de ellas, el modelo elige peor y gastamos contexto solo en sus descripciones.
* **La orquestación recae en el modelo**: si para responder una pregunta hay que encadenar tres llamadas, cada paso es una oportunidad de fallo.
* **Respuestas pensadas para máquinas**: un endpoint puede devolver un JSON enorme con campos que al modelo no le aportan nada.

Con el SDK tenemos control total para diseñar las tools **por caso de uso** y no por cómo está organizada la API. Pensemos, por ejemplo, en un MCP para el **equipo de soporte**. Su pregunta habitual es *"¿qué le pasa a este cliente?"*. En lugar de exponer `/customers/{id}`, `/customers/{id}/orders` e `/issues?customer={id}` como tres tools independientes, tiene más sentido una única tool `DiagnoseCustomer(customerId)` que haga esas tres llamadas internamente y devuelva un resumen con lo relevante.

El caso de uso también ayuda a decidir **qué no exponer**: probablemente soporte solo necesite tools de lectura, sin borrados ni cambios de configuración.

## El SDK oficial de C#

### Un poco de historia

* **Noviembre de 2024**: Anthropic publica el Model Context Protocol como estándar abierto.
* **2 de abril de 2025**: Microsoft y Anthropic [anuncian el SDK oficial de C#](https://developer.microsoft.com/blog/microsoft-partners-with-anthropic-to-create-official-c-sdk-for-model-context-protocol), desarrollado como proyecto open source dentro de la organización `modelcontextprotocol` en GitHub. Nace a partir de *mcpdotnet*, un proyecto de la comunidad iniciado por Peder Holdgaard Pedersen, y se publica en preview.
* **5 de marzo de 2026**: llega la [versión 1.0](https://devblogs.microsoft.com/dotnet/release-v10-of-the-official-mcp-csharp-sdk/), la primera estable, con soporte completo de la especificación 2025-11-25. A partir de aquí el SDK sigue versionado semántico.
* **28 de julio de 2026**: se publica la [versión 2.0](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk/), alineada con la especificación 2026-07-28. El cambio más visible es que el transporte HTTP pasa a ser **sin estado por defecto**. Es compatible hacia atrás: el código estable de la 1.x sigue compilando y funcionando.

### Los paquetes

El SDK se distribuye en tres paquetes NuGet:

| Paquete | Para qué sirve |
| --- | --- |
| `ModelContextProtocol.Core` | API de bajo nivel, para quien necesite el mínimo de dependencias. |
| `ModelContextProtocol` | Integración con hosting e inyección de dependencias. Suficiente para servidores stdio. |
| `ModelContextProtocol.AspNetCore` | Servidores MCP sobre HTTP en ASP.NET Core. |

Como nuestro servidor va a ser remoto y accesible por HTTP, usaremos `ModelContextProtocol.AspNetCore`, que ya incluye el paquete base:

```bash
dotnet add package ModelContextProtocol.AspNetCore
```

## El ejemplo: una API, su MCP Server y Aspire

Partimos de una solución con tres proyectos:

* **La API**: el proyecto de plantilla de ASP.NET Core con su endpoint `GET /weatherforecast`, sin parámetros. No entraremos en su código; es simplemente el backend que queremos exponer.
* **El MCP Server**: un proyecto ASP.NET Core que consume esa API y la expone como tool.
* **El AppHost de Aspire**: orquesta ambos proyectos y hace que el MCP Server encuentre la API sin URLs fijas.

### El AppHost

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.WeatherApi>("api");

builder.AddProject<Projects.WeatherMcp>("mcp")
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
```

`WithReference(api)` es la pieza clave: Aspire inyecta en el MCP Server la información necesaria para llegar a la API por su nombre lógico, `api`, sin que tengamos que fijar ningún host ni puerto. `WaitFor(api)` hace que el MCP Server no arranque hasta que la API esté lista.

### El MCP Server

```csharp
using ModelContextProtocol.Server;
using System.ComponentModel;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

builder.Services.AddHttpClient("WeatherApi", client =>
{
    client.BaseAddress = new Uri("https+http://api");
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
public static class WeatherTools
{
    [McpServerTool, Description("Gets the weather forecast for the next days")]
    public static async Task<string> GetWeatherForecast(IHttpClientFactory httpClientFactory)
    {
        var client = httpClientFactory.CreateClient("WeatherApi");
        return await client.GetStringAsync("/weatherforecast");
    }
}
```

`AddServiceDefaults()` viene del proyecto `ServiceDefaults` que genera la plantilla de Aspire y, entre otras cosas (telemetría, health checks, resiliencia), registra el **service discovery**. Gracias a él, `https+http://api` no es un host real sino el nombre lógico definido en el AppHost: se resuelve al endpoint real de la API, prefiriendo HTTPS y usando HTTP si no está disponible.

Esta tool es un reflejo 1:1 del endpoint, que para un ejemplo es más que suficiente. En un sistema real es aquí donde aplicaríamos lo visto antes: combinar llamadas, filtrar datos y devolver solo lo que el modelo necesita.

## Las piezas del SDK, una a una

### `AddMcpServer()`

Registra el núcleo del protocolo en el contenedor de dependencias. Es el punto de entrada y es independiente del transporte que usemos.

### `WithHttpTransport()` vs `WithStdioServerTransport()`

El SDK soporta dos transportes:

* **`WithHttpTransport()`**: usa *Streamable HTTP*. Es el que necesitamos para un servidor remoto al que se conectan clientes por red. Se combina con `MapMcp()`.
* **`WithStdioServerTransport()`**: el cliente lanza el servidor como un proceso local y se comunican por la entrada y salida estándar. Útil para herramientas locales; en este caso la aplicación es de consola y no se usa `MapMcp()`.

Un detalle importante del transporte HTTP es la gestión de **sesiones**. Desde la versión 2.0 el servidor es **sin estado por defecto**: cada petición es independiente, lo que encaja muy bien con balanceadores y varias réplicas. Si nuestras tools necesitan mantener estado entre llamadas, podemos activar las sesiones de forma explícita:

```csharp
builder.Services
    .AddMcpServer()
    .WithHttpTransport(options => options.Stateless = false)
    .WithToolsFromAssembly();
```

En las versiones 1.x el comportamiento era el contrario: con sesión por defecto. En ese caso, con varias réplicas, había que usar sticky sessions o activar el modo sin estado.

### `WithToolsFromAssembly()`

Escanea el ensamblado en busca de clases marcadas con `[McpServerToolType]` y registra como tools sus métodos marcados con `[McpServerTool]`. Si preferimos registrar las tools de forma explícita, sin escanear todo el ensamblado, tenemos `WithTools<T>()`:

```csharp
builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithTools<WeatherTools>();
```

### `[McpServerTool]` y la inyección de dependencias

Los métodos de las tools pueden ser estáticos o de instancia:

* **Estáticos**, como en el ejemplo: el SDK inspecciona la firma y resuelve desde el contenedor de dependencias los parámetros que son servicios registrados, como `IHttpClientFactory`. Esos parámetros **no forman parte del esquema** que ve el modelo.
* **De instancia**: el SDK crea la clase desde el contenedor, así que podemos inyectar servicios por constructor.

Los parámetros que sí debe rellenar el modelo se declaran como parámetros normales, y el SDK genera su esquema JSON a partir del tipo. Por ejemplo, si nuestra API aceptara un número de días:

```csharp
[McpServerTool, Description("Gets the weather forecast for the given number of days")]
public static async Task<string> GetWeatherForecast(
    IHttpClientFactory httpClientFactory,
    [Description("Number of days to forecast, between 1 and 5")] int days)
{
    // ...
}
```

Aquí `httpClientFactory` lo resuelve el contenedor y `days` lo decide el modelo.

### `Description`: la parte que más importa

El atributo `Description` (de `System.ComponentModel`) es lo que el modelo lee para decidir **cuándo** usar una tool y **cómo** rellenar sus parámetros. Una descripción vaga produce un modelo que no usa la tool, o que la usa cuando no toca.

Algunas recomendaciones:

* Describir **para qué sirve** la tool, no cómo está implementada.
* Indicar los rangos y formatos esperados de cada parámetro.
* Si hay tools parecidas, dejar claro en qué se diferencian.

Es, con diferencia, donde más merece la pena invertir tiempo.

### `MapMcp()`

Expone el endpoint de Streamable HTTP en la ruta indicada (`/mcp` en nuestro caso). Al ser un endpoint más de ASP.NET Core, podemos aplicarle lo habitual, como autenticación con `.RequireAuthorization()`.

## Probándolo desde Visual Studio Code

Arrancamos la solución desde el AppHost:

```bash
aspire run
```

En el dashboard de Aspire veremos los dos recursos, `api` y `mcp`, con sus endpoints. Tomamos la URL del MCP Server y la añadimos en `.vscode/mcp.json`:

```json
{
  "servers": {
    "weather-mcp": {
      "type": "http",
      "url": "http://localhost:<port>/mcp"
    }
  }
}
```

Al iniciar el servidor desde VS Code, debería descubrir la tool `GetWeatherForecast` y el modelo podrá usarla en modo agente para responder preguntas sobre la previsión. Además, como el MCP Server usa `ServiceDefaults`, en el propio dashboard podemos seguir las trazas de cada llamada: desde la petición del cliente MCP hasta la llamada a la API.

Si quieres inspeccionar el servidor sin pasar por un modelo, el **MCP Inspector** permite conectarse, listar las tools y ejecutarlas a mano:

```bash
npx @modelcontextprotocol/inspector
```

## Conclusiones

Con el SDK de C#, crear un MCP Server es poco más que registrar unos servicios y decorar unos métodos. La parte técnica es sencilla; lo que marca la diferencia es el **diseño de las tools**:

* Si solo necesitamos exponer rápidamente una API que ya está en APIM, la opción sin código puede ser suficiente.
* Si queremos que el modelo trabaje bien, conviene diseñar tools por caso de uso, con buenas descripciones y respuestas acotadas.

En el siguiente artículo nos pondremos manos a la obra con un laboratorio: llevaremos esta solución a un clúster de Kubernetes local con Aspire y Rancher Desktop, y la conectaremos desde Visual Studio Code.

## Documentación oficial

* [Especificación y documentación de MCP](https://modelcontextprotocol.io)
* [Repositorio del SDK de C#](https://github.com/modelcontextprotocol/csharp-sdk)
* [Documentación del SDK de C#](https://csharp.sdk.modelcontextprotocol.io)
* [Anuncio del SDK de C# (abril 2025)](https://developer.microsoft.com/blog/microsoft-partners-with-anthropic-to-create-official-c-sdk-for-model-context-protocol)
* [Release v1.0 del SDK de C#](https://devblogs.microsoft.com/dotnet/release-v10-of-the-official-mcp-csharp-sdk/)
* [Release v2.0 del SDK de C#](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk/)
* [Exponer una API REST de API Management como MCP Server](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server)
