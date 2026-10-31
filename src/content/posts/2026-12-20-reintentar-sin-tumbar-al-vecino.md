---
title: "Reintentar sin tumbar al vecino: timeouts, reintentos y circuit breaker"
subtitle: Cada capa de tu aplicación reintenta por si acaso, y cuando el calendario falla, 20 peticiones se convierten en 1.280 llamadas
description: "Resiliencia en .NET con Polly: timeouts, reintentos con backoff y jitter y circuit breaker. Una demo con cifras (1.280 llamadas frente a 5), lo que dicen AWS, Fowler y Microsoft, los defaults de AddStandardResilienceHandler y sus límites."
date: 2026-12-20
topic: desarrollo
series: concepts
published: false
---

El servicio de calendario con el que se sincronizan las reservas se cae. Tu endpoint reintenta tres veces. También el servicio que lo llama, y el cliente HTTP que hay debajo, cada uno con su «por si acaso». Nadie ha hecho nada raro, pero ya no hay una llamada fallida por petición, sino sesenta y cuatro.

## Reintentos que se multiplican

La demo tiene tres capas (endpoint, servicio y cliente), y cada una envuelve su llamada en un reintento de tres:

```csharp
Retry.Run(calendar.Sync, retries: 3);   // in the client
Retry.Run(client.Sync, retries: 3);     // in the service
Retry.Run(service.Reserve, retries: 3); // in the endpoint
```

Cada intento de una capa dispara cuatro intentos de la de abajo: 4 × 4 × 4 = 64 llamadas por petición. Con 20 peticiones, el calendario recibe **1.280 llamadas** y ninguna sale bien. AWS describe exactamente este efecto en su *Builders' Library*: si cada capa reintenta por su cuenta, la carga sobre la base de datos de su ejemplo aumenta 243 veces, porque los reintentos de cada nivel se multiplican. Su recomendación: reintentar en un único punto de la pila.

Y lo califican con una frase que merece recordarse: los reintentos son «selfish». Cuando un cliente reintenta, gasta más tiempo del servidor para tener más probabilidades de éxito. Si el servidor ya está mal, empeora.

## Los tres mecanismos

**Timeout.** Un límite de espera. Sin él, una llamada colgada ocupa un hilo y una conexión. `HttpClient` trae 100 segundos por defecto, que suele ser demasiado para una llamada interna.

**Reintento.** Repetir tras un fallo transitorio, con un retraso creciente (*backoff*) y aleatorio (*jitter*). Polly lo describe: `MaxRetryAttempts` es 3 *in addition to the original call*, y ojo, `UseJitter` está desactivado por defecto. El jitter evita que muchos clientes reintenten a la vez. Microsoft lo recoge entre las malas prácticas con el antipatrón *Retry Storm*: nunca implementes un mecanismo de reintento infinito y respeta la cabecera `retry-after`.

**Circuit breaker.** Cortar las llamadas a un recurso no sano. Martin Fowler explica que Michael Nygard lo popularizó en *Release It!* para evitar una cascada catastrófica de fallos. Cuando el porcentaje de fallos supera un umbral, el circuito se abre y las siguientes llamadas fallan al instante sin molestar a quien ya está caído.

## Resiliencia en un único punto

La versión de la demo pone una `ResiliencePipeline` de Polly solo en `CalendarClient`, la llamada a la dependencia:

```csharp
new ResiliencePipelineBuilder()
    .AddRetry(new RetryStrategyOptions
    {
        MaxRetryAttempts = 2,
        BackoffType = DelayBackoffType.Exponential,
        UseJitter = true,
        ShouldHandle = new PredicateBuilder().Handle<HttpRequestException>(),
    })
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions
    {
        FailureRatio = 0.5,
        MinimumThroughput = 5,
        BreakDuration = TimeSpan.FromSeconds(30),
        ShouldHandle = new PredicateBuilder().Handle<HttpRequestException>(),
    })
    .AddTimeout(TimeSpan.FromSeconds(2))
    .Build();
```

Resultado con las mismas 20 peticiones: **5 llamadas** llegan al calendario. A la quinta fallida, el circuito se abre y las otras quince peticiones fallan al instante. El orden importa: Microsoft lo indica, cada estrategia se ejecuta en el orden en que la configuras. Aquí el reintento envuelve al circuit breaker, y excluí del reintento la excepción de circuito abierto para no reintentar contra algo que ya sabemos que está cortado.

Los valores de la demo son míos, elegidos para que el efecto se vea. Los de producción dependen de tu dependencia. El breaker de Polly no gestiona reintentos por sí solo, como aclara su documentación: hay que combinarlo con una estrategia de reintento.

## Si usas HttpClient

Para llamadas HTTP, `AddStandardResilienceHandler` te da todo esto ya montado. Sus valores por defecto, de fuera adentro: limitador de tasa, timeout total de 30 segundos, 3 reintentos exponenciales con jitter, circuit breaker (ratio del 10 %, mínimo de 100 peticiones, muestreo de 30 s, ruptura de 5 s) y timeout por intento de 10 segundos. Maneja errores 5xx, 408, 429 y excepciones de red.

Cuidado: ese manejador **reintenta todos los métodos HTTP, POST incluido**. El RFC 9110 dice que un cliente no debería reintentar automáticamente un método no idempotente salvo que sepa que no hay riesgo. Dos salidas: desactivar el reintento para POST con `options.Retry.DisableFor(HttpMethod.Post, HttpMethod.Delete)`, o hacer idempotente la operación, como vimos en el [post de idempotencia](/2026-12-14-idempotencia-doble-clic-reintento). AWS lo resume así: las API con efectos secundarios no son seguras de reintentar si no ofrecen idempotencia.

## Una voz discrepante

AWS tiene una opinión poco habitual sobre el circuit breaker. Reconoce que está muy promovido, pero que introduce un comportamiento modal que puede ser difícil de probar y puede añadir tiempo significativo a la recuperación. Ellos prefieren limitar los reintentos localmente con un *token bucket*, y dicen que lo incorporaron a su SDK en 2016. Es la postura de una empresa con su escala, no una verdad general, pero conviene saber que no todo el mundo comparte el entusiasmo.

## Cuándo no

Más reintentos no equivalen a más resiliencia, y una política agresiva sobre un servicio saturado lo degrada. Si la operación falla por una causa que no es transitoria (una validación, un 404), reintentar es gastar. Y no pongas la misma política en todas partes: decide en qué capa vive y deja las demás sin ella.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`23-resilience`](https://github.com/MookieFumi/concept-pills/tree/main/23-resilience) de concept-pills.
