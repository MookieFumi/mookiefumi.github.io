---
title: "Dos instancias, dos verdades: lo que no ves hasta que añades un balanceador"
subtitle: La API que funcionaba con una instancia empieza a contestar cosas distintas cuando levantas la segunda
description: "Qué es un load balancer y qué se rompe al pasar una API de .NET de una a dos instancias: caché en memoria inconsistente y rate limiter por instancia, medidos con YARP y Redis."
date: 2026-11-04
topic: aspnet
series: minimal-apis-dotnet
published: false
---

Una API que funciona bien con una instancia puede romperse sin dar ningún error al levantar una segunda. Nada falla en el arranque ni en los logs, y los tests pasan. Lo que cambia es que cada petición puede caer en una instancia distinta, y todo lo que tu API guardaba en su propia memoria deja de ser compartido.

En este post pongo una API pequeña detrás de un balanceador con dos instancias y mido qué se rompe. Son dos casos: la caché en memoria y el límite de peticiones.

## Qué es un load balancer

Un load balancer es un [reverse proxy](/2026-11-02-migrar-api-sin-que-clientes-se-enteren) que reparte las peticiones entre varias copias de la misma API. El cliente llama a una sola dirección y el balanceador decide a qué copia le toca. Se usa para aguantar más tráfico y para que la caída de una copia no tumbe el servicio.

Para decidir a qué copia envía cada petición usa una política de reparto. La más sencilla es el round robin: la primera petición a la copia 1, la segunda a la 2, la tercera otra vez a la 1. Un balanceador también hace comprobaciones de salud: si una copia deja de responder, deja de enviarle tráfico. [YARP lo hace](https://learn.microsoft.com/aspnet/core/fundamentals/servers/yarp/dests-health-checks) con comprobaciones activas y pasivas.

Los balanceadores se dividen por la capa en la que trabajan. Uno de capa 4 reparte conexiones TCP o UDP y no mira dentro de la petición. Uno de capa 7 entiende HTTP, así que puede enrutar por URL o por cabecera, terminar TLS y fijar sesiones con cookies. Para una API HTTP quieres casi siempre capa 7.

## La demo

En [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/two-instances) hay dos proyectos. `ProductsApi` tiene dos endpoints: `GET /products/{id}` lee un producto a través de una caché, y `PUT /products/{id}/price/{price}` le cambia el precio. Las dos instancias comparten un fichero JSON como base de datos. `Balancer` es YARP delante de las dos instancias, con round robin. El precio de cada producto empieza en 10.

Un script ejecuta cada experimento. Todos los números de este post salen de ahí, en local y sin Docker.

## Primer problema: la caché en memoria

La caché de la API es una `IMemoryCache` de ASP.NET Core:

```csharp
internal sealed class MemoryProductCache(IMemoryCache cache) : IProductCache
{
    public Task<Product?> GetAsync(int id)
    {
        return Task.FromResult(cache.TryGetValue(id, out Product? product) ? product : null);
    }

    public Task SetAsync(Product product)
    {
        cache.Set(product.Id, product, TimeSpan.FromMinutes(5));
        return Task.CompletedTask;
    }
}
```

Cuatro lecturas seguidas llenan la caché de las dos instancias con el precio 10. Después cambio el precio a 20 con un `PUT`, que cae en una sola instancia: guarda el precio en el fichero y actualiza su propia caché. La otra instancia no se entera. Diez lecturas después del cambio:

```text
10 reads after the price changed from 10 to 20: 5 with the old price, 5 with the new one
```

Mismo recurso, misma petición y dos respuestas distintas, según a qué instancia te toque. Con una sola instancia esto no podía pasar. La [documentación de ASP.NET Core](https://learn.microsoft.com/aspnet/core/performance/caching/memory) lo dice sin rodeos: las apps que corren en varios servidores deberían usar sesiones fijas con la caché en memoria, y sin ellas hace falta una caché distribuida para evitar problemas de consistencia.

### Salida 1: afinidad de sesión

La sesión fija (session affinity) hace que un mismo cliente vaya siempre a la misma instancia. En YARP se activa en el cluster:

```json
"SessionAffinity": {
  "Enabled": true,
  "Policy": "Cookie",
  "AffinityKeyName": ".Balancer.Affinity"
}
```

Con esto, el cliente que cambia el precio lo ve siempre. Lo medí con dos clientes, cada uno anclado a una instancia distinta. Los dos leen el precio antes del cambio, y el primero hace el `PUT`:

```text
client that changed the price: 0 reads with the old price, 10 with the new one
another client:                10 reads with the old price, 0 with the new one
```

El segundo cliente sigue viendo 10 en todas sus lecturas. La afinidad esconde el problema para quien lo provoca y lo deja intacto para los demás, y además ata a cada cliente a una instancia. Si esa instancia desaparece, YARP por defecto redistribuye al cliente a otra, que tiene una caché distinta. La afinidad sirve para que una caché local rinda más, no para que los datos sean consistentes.

### Salida 2: una caché compartida

Si las dos instancias leen y escriben la misma caché, no hay dos verdades. Con Redis y `IDistributedCache` el cambio en la API es un registro:

```csharp
services.AddStackExchangeRedisCache(options => options.Configuration = configuration["Cache:Redis"]);
services.AddSingleton<IProductCache, DistributedProductCache>();
```

Misma prueba, ahora con Redis:

```text
10 reads after the price changed from 10 to 20: 0 with the old price, 10 with the new one
```

El coste es una pieza más que operar y una ida y vuelta de red en cada lectura que antes era memoria local. En la demo el `PUT` escribe el valor nuevo en la caché, y no he medido casos de invalidación más difíciles, como varios escritores a la vez.

## Segundo problema: el límite de peticiones

El rate limiter de ASP.NET Core pone un tope de peticiones por ventana de tiempo, por ejemplo 20 por minuto por API key. Cuando se supera, devuelve `429 Too Many Requests`. La API de la demo lo tiene configurado así en cada instancia.

El middleware guarda sus contadores en memoria, igual que la caché. La [documentación](https://learn.microsoft.com/aspnet/core/performance/rate-limit) lo explica: cada instancia aplica su límite por separado, y el límite efectivo es el configurado multiplicado por el número de instancias. Con tres instancias, 100 por minuto pasan a ser hasta 300.

Lo medí con 30 peticiones seguidas de la misma API key, con dos instancias:

```text
30 requests with one API key: 30 x 200, 0 x 429
```

El límite era 20 y pasaron las 30. Con round robin, cada instancia recibió unas 15, menos que su tope. Es la caché otra vez: dos contadores en lugar de uno.

La salida que recomienda la documentación es aplicar el límite en una capa compartida, como un gateway. Con la misma política puesta en el balanceador, que sí ve todas las peticiones:

```text
30 requests with one API key: 20 x 200, 10 x 429
```

La otra opción es escribir un limitador propio que guarde los contadores en un almacén compartido, como Redis.

## Qué ofrece cada nube

Si no quieres mantener el balanceador, cada nube tiene uno gestionado. Esto es lo que he comprobado en su documentación:

| | Capa 4 | Capa 7 |
|---|---|---|
| Azure | Load Balancer (TCP/UDP, regional) | Application Gateway (regional, con WAF) y Front Door (global) |
| Google Cloud | Network Load Balancer | Application Load Balancer |
| Cloudflare | Spectrum | Load Balancing con proxy HTTP |

Azure documenta que el Load Balancer de capa 4 no puede inspeccionar cabeceras, URLs ni cookies, y que Application Gateway y Front Door sí enrutan por ruta y fijan sesiones con cookies. Cloudflare ofrece además un balanceador solo por DNS.

## Cuándo no hace falta

Si tu API corre en una sola instancia y aguanta el tráfico, un balanceador no te aporta nada, y es una pieza más que puede fallar. Tampoco hace falta ponerlo tú si ya despliegas en Kubernetes, porque un Service reparte las peticiones entre los pods. Aun así, los dos problemas de este post existen igual: cada pod tiene su memoria y sus contadores.

## Resumiendo

- Un load balancer reparte las peticiones entre varias copias de la API. Con round robin, cada petición puede caer en una copia distinta.
- La `IMemoryCache` no se comparte. Tras un cambio de precio, 10 lecturas dieron 5 con el valor viejo y 5 con el nuevo.
- La afinidad de sesión esconde el problema al cliente que cambia el dato y lo deja para los demás. Con Redis, las 10 lecturas dieron el valor nuevo.
- El rate limiter de .NET cuenta por instancia. Con dos instancias pasaron las 30 peticiones de un límite de 20. En el balanceador pasaron 20.
- Los números salen de un script que se puede ejecutar en local, sin Docker.

El código y el script están en [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/two-instances).
