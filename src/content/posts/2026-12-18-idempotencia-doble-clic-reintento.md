---
title: "Idempotencia: el doble clic y el reintento que no deberían costarte dos reservas"
subtitle: Desactivar el botón evita un doble clic, pero no el reintento que hace tu cliente HTTP cuando no recibe respuesta
description: "Qué es la idempotencia en APIs y cómo aplicarla en C# con una Idempotency-Key: ejemplo de reservas de salas, qué dicen el RFC 9110, Stripe y Microsoft, el cuidado con el reintento automático de POST en .NET y sus límites."
date: 2026-12-18
topic: desarrollo
series: concepts
published: false
---

El usuario pulsa «Reservar» y la respuesta tarda. Pulsa otra vez, o el cliente HTTP, al no recibir nada, reintenta por su cuenta. La primera petición había llegado y se había procesado, así que ahora la sala de Lisboa tiene dos reservas «Planning» a la misma hora, con identificadores distintos.

## El caso sin protección

Así se ve en la demo cuando el servidor trata cada petición como nueva:

```csharp
var first = Reserve("Lisbon", "Planning");
var second = Reserve("Lisbon", "Planning");
```

Salida: `Same booking returned? False` y `Bookings stored: 2`. Desactivar el botón en la interfaz ayuda con el doble clic, pero es una mitigación del cliente y no protege la API. Un móvil que pierde la conexión y reintenta no pasa por ese botón.

## Qué es idempotente

El RFC 9110 define así un método idempotente: aquel en el que el efecto previsto en el servidor de varias peticiones idénticas es el mismo que el de una sola. PUT, DELETE y los métodos seguros lo son. POST no lo es por definición, y crear una reserva es justo un POST.

Dos precisiones del propio RFC. Una: la propiedad se refiere al efecto que ha pedido el usuario; el servidor puede registrar cada petición por separado, por ejemplo. Otra: no exige que la respuesta sea la misma, y un `DELETE` repetido puede devolver 204 y luego 404.

El RFC también da una regla de seguridad para el cliente: no debería reintentar automáticamente un método no idempotente a menos que sepa que la petición es idempotente, o tenga forma de detectar que la original nunca se aplicó.

## Una clave por intención

La forma habitual de hacer idempotente un POST es una clave. Existe un borrador del IETF que define la cabecera `Idempotency-Key` para hacer tolerantes a fallos métodos como POST o PATCH. Sigue siendo un borrador activo (en el momento de escribir esto, la versión 08), no un estándar. Stripe la usa, y su documentación es una buena referencia práctica.

En la demo el cliente genera una clave por cada intención de reservar y la envía con cada intento. El servidor recuerda la clave, la petición con la que llegó y la respuesta que dio:

```csharp
if (_seenKeys.TryGetValue(idempotencyKey, out var seen))
{
    return seen.Command == command
        ? new ReserveResult(ReserveOutcome.Replayed, seen.BookingId)
        : new ReserveResult(ReserveOutcome.KeyReusedWithDifferentRequest, null);
}
```

Resultado: el primer intento es `Created`, el reintento es `Replayed`, devuelve la misma reserva y solo hay 1 almacenada. Si alguien reutiliza la clave con otra petición, `KeyReusedWithDifferentRequest`. El borrador va en esa línea: la clave no puede reutilizarse con otro contenido y propone un 422 en ese caso, y un 409 si llega un reintento mientras el original aún se procesa.

## Lo que hace Stripe

Stripe explica cómo lo resuelve. Guarda el código de estado y el cuerpo de la primera petición hecha con una clave, una vez que empieza a ejecutarse el endpoint, y los reintentos con la misma clave devuelven esa respuesta guardada, incluso los errores 500. Recomienda UUID v4 u otra cadena aleatoria con suficiente entropía, y las claves pueden eliminarse pasadas al menos 24 horas. Cada servicio decide cuánto tiempo recordarlas, y esa es una decisión de diseño tuya.

La demo es una versión mínima: la tabla de claves vive en memoria. En una aplicación real tendría que guardarse junto a los datos, en la misma transacción, o la clave se perdería con un reinicio y volverías al problema.

## El cuidado en .NET

En .NET hay un detalle que muerde. Según la documentación de Microsoft, `AddStandardResilienceHandler` reintenta todos los métodos HTTP, POST incluido. Microsoft avisa del riesgo: si un POST inserta un registro, reintentarlo puede duplicar datos. Se puede desactivar con `options.Retry.DisableFor(HttpMethod.Post, HttpMethod.Delete)` o con `DisableForUnsafeHttpMethods()`, que desactiva también PUT y DELETE aunque sean idempotentes. La alternativa a desactivar es hacer idempotente el POST, y entonces el reintento automático deja de ser un riesgo.

Microsoft lo resume en su guía de diseño de APIs: POST y PATCH no son idempotentes por naturaleza, y si admites reintentos de operaciones que no lo son, debes implementar y documentar cómo evita el servicio los efectos duplicados.

## Otras formas de lograrlo

La clave no es la única. Una restricción única en la base de datos (sala y franja) detecta el duplicado como última defensa, pero no devuelve «el mismo resultado» al reintento: da un error. Otra opción es hacer la operación un `PUT /bookings/{id}` con identificador generado por el cliente, que Microsoft recomienda para operaciones con efectos secundarios. Cada una resuelve una parte. Lo habitual es combinarlas.

## Cuándo no hace falta

Las operaciones que ya son idempotentes por naturaleza («poner el estado a cancelada») no necesitan clave. Y si tu API no admite reintentos ni la usan clientes que puedan fallar a medio camino, quizá el esfuerzo no compense. En cuanto haya mensajería o reintentos automáticos de por medio, sí.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`20-idempotency`](https://github.com/MookieFumi/concept-pills/tree/main/20-idempotency) de concept-pills.
