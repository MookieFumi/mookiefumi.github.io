---
title: "Cómo migrar una API sin que tus clientes se enteren"
subtitle: Una ruta cambia de sistema con solo cambiar un fichero, y nadie tiene que tocar su código
description: "Qué es un reverse proxy y un API gateway, y cómo usar YARP en .NET 10 para migrar una API antigua a una nueva ruta a ruta, sin cambiar la URL que usan los clientes."
date: 2026-11-02
topic: aspnet
published: false
---

Tienes un sistema antiguo que lleva años funcionando. Sus URLs son `/orders` y `/customers/1`, y devuelve campos como `ORDER_ID` y `CUST_NAME`. Has escrito la API nueva en Minimal APIs, con URLs `/api/v1/orders` y campos en camelCase. El problema no es escribirla. El problema es que hay una app móvil y dos integraciones de terceros que llaman al sistema antiguo, y no puedes pedirles que cambien de URL el mismo día.

Lo que se hace en estos casos es poner una puerta delante de los dos sistemas. Los clientes llaman siempre a la puerta, y la puerta decide a quién le pasa cada petición. Esa puerta es un API gateway, y se construye sobre algo más básico que quizá no hayas usado: un reverse proxy.

## Qué es un reverse proxy

Un proxy normal trabaja para el cliente: tú sales a internet a través de él, y el servidor ve la dirección del proxy en lugar de la tuya. Un reverse proxy trabaja para el servidor. Los clientes creen que hablan con tu API, pero hablan con él, y él reenvía la petición a la API real que esté detrás. El cliente solo conoce una dirección. No sabe cuántos sistemas hay detrás ni dónde viven.

Eso es lo que necesitamos aquí. Mientras los clientes sigan llamando a la misma dirección, lo que haya detrás puede cambiar.

[YARP](https://learn.microsoft.com/aspnet/core/fundamentals/servers/yarp/getting-started) (Yet Another Reverse Proxy) es un reverse proxy que se usa como librería de ASP.NET Core. Se configura con rutas, clusters y destinos. Una ruta dice qué peticiones coge, por ejemplo las que empiezan por `/api/v1/orders`. Un cluster es un grupo de destinos, y cada destino es la dirección de un servidor. Con eso ya puedes montar el gateway.

## Gateway, balanceador e ingress

Los tres son reverse proxies con distinto trabajo, y es fácil mezclarlos:

| | Qué hace |
|---|---|
| Load balancer | Reparte las peticiones entre varias copias de la misma API |
| API gateway | Elige a qué servicio va cada petición y aplica reglas comunes (autenticación, límites, transformaciones) |
| Ingress de Kubernetes | Es la puerta de entrada del clúster, y normalmente lo implementa un proxy de este tipo |

Aquí nos interesa el gateway. El balanceador lo vemos en el siguiente post.

## La demo

En [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/gateway) hay tres proyectos pequeños. `LegacyApi` hace de sistema antiguo y `NewApi` de API nueva. `Gateway` es YARP delante de los dos. Ninguno de los dos backends es el código real de entry-hub: son piezas mínimas para ver el comportamiento. Cada respuesta lleva una cabecera `X-Served-By` con el nombre del backend que la ha dado, para ver quién contesta.

El gateway lee las rutas de un fichero propio. Este es el primero (he quitado las líneas del límite de peticiones, que vemos más abajo):

```json
{
  "ReverseProxy": {
    "Routes": {
      "orders": {
        "ClusterId": "new",
        "Match": { "Path": "/api/v1/orders/{**rest}" }
      },
      "customers": {
        "ClusterId": "legacy",
        "Match": { "Path": "/api/v1/customers/{**rest}" },
        "Transforms": [ { "PathRemovePrefix": "/api/v1" } ]
      },
      "everything-else": {
        "ClusterId": "legacy",
        "Order": 1000,
        "Match": { "Path": "/api/v1/{**rest}" },
        "Transforms": [ { "PathRemovePrefix": "/api/v1" } ]
      }
    },
    "Clusters": {
      "new": { "Destinations": { "d1": { "Address": "http://localhost:5401" } } },
      "legacy": { "Destinations": { "d1": { "Address": "http://localhost:5402" } } }
    }
  }
}
```

Los clientes solo conocen `/api/v1/...`. Los pedidos ya los sirve la API nueva, y todo lo que todavía no se ha migrado lo contesta el sistema antiguo sin que el cliente lo note. Para eso sirven dos detalles.

El primero es `PathRemovePrefix`. El sistema antiguo no conoce `/api/v1`, así que el gateway lo quita antes de reenviar: `/api/v1/customers/1` llega al antiguo como `/customers/1`. El cliente ve las URLs nuevas desde el primer día, aunque detrás siga el sistema viejo.

El segundo es `Order: 1000` en la ruta `everything-else`. YARP ya da prioridad a las rutas más específicas, y `Order` lo hace explícito: las rutas con un número menor tienen prioridad sobre las de número mayor. Esa ruta es el cajón de sastre. Coge todo lo que no tenga una ruta propia y lo manda al sistema antiguo, y cualquier ruta que añadas después gana a la comodín.

## Mover una ruta

Migrar `customers` es cambiar el cluster de esa ruta de `legacy` a `new` y quitar su transformación, porque la API nueva sí entiende `/api/v1`. Eso es todo el diff, en un segundo fichero:

```json
"customers": {
  "ClusterId": "new",
  "Match": { "Path": "/api/v1/customers/{**rest}" }
}
```

El gateway vigila el fichero de rutas y lo recarga solo. En el script de la demo arranco los tres procesos con el primer fichero, compruebo quién responde cada ruta, copio el segundo fichero encima y vuelvo a preguntar sin reiniciar el gateway. Lo que sale:

```text
== Step 1: only orders are on the new API ==
/api/v1/orders -> new
/api/v1/customers/1 -> legacy
== Step 2: customers move to the new API; the gateway is not restarted ==
/api/v1/customers/1 -> new
/api/v1/orders -> new
```

Para el cliente no hay cambio ninguno. Ni de URL, ni de despliegue. Si la ruta nueva da problemas, vuelves a copiar el primer fichero y la ruta regresa al sistema antiguo. Esa marcha atrás por fichero es lo que más me gusta de esta forma de migrar.

Hay dos cosas que la demo no resuelve. Las respuestas de los dos sistemas tienen formas distintas (`ORDER_ID` frente a `id`), y el gateway no las traduce. Si un cliente depende de la forma antigua, o migras esa ruta cuando el cliente ya acepte la nueva, o escribes una transformación de respuesta. Y la ruta se mueve entera. Si quieres mandar solo un porcentaje del tráfico a la API nueva, [YARP no lo trae hecho](https://learn.microsoft.com/aspnet/core/fundamentals/servers/yarp/ab-testing); expone las piezas para construirlo tú.

## Lo que el gateway añade

Una vez que todo pasa por una sola puerta, es el sitio natural para lo que quieres aplicar a todas las rutas. Ahí tampoco hay magia: son las mismas piezas de ASP.NET Core.

La autenticación es un ejemplo. YARP permite poner una política de autorización de ASP.NET Core en cada ruta, así que el gateway puede exigir un JWT válido antes de reenviar nada. En la demo no lo he montado, así que no tengo ninguna medida que enseñarte.

Sí he montado el límite de peticiones, o rate limiting. Consiste en poner un tope a cuántas peticiones puede hacer un cliente en una ventana de tiempo, por ejemplo 20 por minuto por API key. Cuando se supera, el servidor responde `429 Too Many Requests` en lugar de procesar la petición. Sirve para que un cliente con un bucle roto, o uno abusivo, no degrade la API para los demás. En el gateway es una política con el middleware de .NET:

```csharp
options.AddPolicy("per-client", context =>
{
    var key = context.Request.Headers["X-Api-Key"].FirstOrDefault() ?? "anonymous";
    return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
    {
        PermitLimit = 20,
        Window = TimeSpan.FromMinutes(1),
    });
});
```

La ruta se engancha a esa política con `"RateLimiterPolicy": "per-client"`. Con 30 peticiones seguidas de una misma API key, el script cuenta 20 respuestas `200` y 10 respuestas `429`. Con otra API key, otras 20 y otras 10. Los servicios de detrás nunca ven las que sobran.

## Qué ofrece cada nube

Si no quieres mantener el gateway tú, las tres nubes tienen uno gestionado. Esto es lo que he podido comprobar en su documentación:

| | Gateway de APIs | Notas |
|---|---|---|
| Azure | API Management | Aplica políticas como `validate-jwt` y `rate-limit-by-key` (la segunda no está en el nivel Consumption). Application Gateway es un balanceador de capa 7 regional con WAF, más cercano a un balanceador que a un gateway de APIs |
| Cloudflare | API Shield | Valida JWT, mTLS y esquemas OpenAPI, y se combina con las reglas de rate limiting |
| Google Cloud | API Gateway y Apigee | Solo lo he visto en comparativas de terceros, no en la documentación de Google: API Gateway sería la opción ligera para backends serverless y Apigee la plataforma completa |

Y en .NET, YARP te da lo que hemos visto aquí sin pagar por servicio. A cambio, el despliegue, las actualizaciones y la disponibilidad son tuyos.

## Cuándo no hace falta

Si tu API es una sola, la consumen tus propios clientes y puedes cambiarla cuando quieras, un gateway es una pieza más que desplegar y vigilar. Un fallo en la puerta tumba todo lo que hay detrás, así que tampoco es gratis en operación. Yo lo pondría cuando haya dos sistemas que conviven (como en esta migración), cuando haya reglas que quieras aplicar a varios servicios a la vez, o cuando no controles a los clientes y no puedas obligarlos a cambiar de URL.

## Resumiendo

- Un reverse proxy recibe las peticiones en nombre de tus servicios y las reenvía. Un API gateway es un reverse proxy que elige a qué servicio va cada ruta y aplica reglas comunes.
- Con YARP, migrar una ruta es cambiar su cluster en el fichero de rutas. El gateway lo recarga sin reiniciarse.
- La ruta comodín con `Order` alto manda al sistema antiguo todo lo que aún no esté migrado, y `PathRemovePrefix` le quita el prefijo nuevo.
- El rate limiting en el gateway dio 20 respuestas `200` y 10 respuestas `429` de 30 peticiones por API key.
- La demo no traduce el formato de las respuestas ni reparte porcentajes de tráfico.

El código y el script están en [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/gateway).
