---
title: "Server-Sent Events en Minimal APIs"
subtitle: La pantalla de la puerta de la sala no necesita SignalR para saber cuándo queda libre
description: "Server-Sent Events en .NET 10 con TypedResults.ServerSentEvents: un IAsyncEnumerable, PeriodicTimer, cancelación al desconectar, curl, EventSource, OpenAPI y tests con SseParser."
date: 2026-09-29
topic: aspnet
series: minimal-apis-dotnet
published: false
---

En la puerta de cada sala de [entry-hub](https://github.com/MookieFumi/entry-hub) hay una pantalla que dice si la sala está libre y hasta cuándo. Tiene que enterarse de los cambios sin que nadie recargue nada. Se puede hacer con polling, preguntando cada pocos segundos, o con SignalR. Pero la información solo va en un sentido, del servidor a la pantalla, y para eso hay algo más sencillo: Server-Sent Events.

Con SSE el cliente hace una petición HTTP normal y la respuesta no se cierra. El servidor va escribiendo eventos de texto por esa misma respuesta, con tipo `text/event-stream`. .NET 10 lo trae de serie en Minimal APIs con `TypedResults.ServerSentEvents`.

## El endpoint

Devuelve `TypedResults.ServerSentEvents` con un `IAsyncEnumerable`. Cada elemento que produce el enumerable sale como un evento:

```csharp
public static void Map(RouteGroupBuilder group) =>
    group.MapGet("/{id:guid}/occupancy", HandleAsync).WithName("StreamRoomOccupancy").WithSummary("Live occupancy of a room as server-sent events.");

private static async Task<Results<ServerSentEventsResult<RoomOccupancy>, NotFound>> HandleAsync(
    Guid id,
    StreamRoomOccupancyHandler handler,
    CancellationToken cancellationToken)
{
    var stream = await handler.HandleAsync(id, cancellationToken);

    return stream is null
        ? TypedResults.NotFound()
        : TypedResults.ServerSentEvents(stream, eventType: "occupancy");
}
```

`eventType` es el nombre del evento, el que el cliente usa para suscribirse. El resto es lo mismo que en cualquier endpoint de la serie: un handler inyectado y un resultado tipado con `Results<...>`.

## El handler: comprobar primero, emitir después

El handler tiene dos partes, y el orden importa:

```csharp
/// <returns>A stream of snapshots, or <see langword="null"/> when the room does not exist.</returns>
public async Task<IAsyncEnumerable<RoomOccupancy>?> HandleAsync(Guid roomId, CancellationToken cancellationToken)
{
    if (!await db.Rooms.AnyAsync(room => room.Id == roomId, cancellationToken))
    {
        return null;
    }

    return StreamAsync(roomId, cancellationToken);
}
```

Primero comprueba que la sala existe. Una vez que empieza el stream, el código de estado ya se ha enviado como `200`, así que el `404` hay que decidirlo antes. Por eso `HandleAsync` es un método normal que devuelve el enumerable, y no un iterador.

El iterador calcula la ocupación cada pocos segundos con un `PeriodicTimer`:

```csharp
private async IAsyncEnumerable<RoomOccupancy> StreamAsync(
    Guid roomId,
    [EnumeratorCancellation] CancellationToken cancellationToken)
{
    using var timer = new PeriodicTimer(options.Value.Interval, clock);

    do
    {
        var now = clock.GetUtcNow();

        var busy = await db.Bookings.AsNoTracking()
            .Where(booking => booking.RoomId == roomId && booking.Status == BookingStatus.Confirmed && booking.EndAt > now)
            .Select(booking => new TimeRange(booking.StartAt, booking.EndAt))
            .ToListAsync(cancellationToken);

        yield return OccupancyCalculator.Calculate(roomId, busy, now);
    }
    while (await timer.WaitForNextTickAsync(cancellationToken));
}
```

El primer evento sale nada más conectar, sin esperar al primer tic. El intervalo está en `StreamRoomOccupancyOptions` (cinco segundos por defecto), y el `PeriodicTimer` recibe el `TimeProvider` inyectado, así que los tests pueden usar un intervalo de milisegundos.

La lógica de "libre u ocupada, y hasta cuándo" está en `OccupancyCalculator`, una función pura que no sabe nada de SSE ni de la base de datos.

## Cuando el cliente se va

Cuando la pantalla se apaga o el usuario cierra la pestaña, ASP.NET Core cancela el `CancellationToken` de la petición. `[EnumeratorCancellation]` hace que ese token llegue al iterador, y `WaitForNextTickAsync` lanza `OperationCanceledException`, con lo que el bucle termina y el `using` libera el temporizador. No hay que llevar la cuenta de los clientes conectados ni limpiar nada a mano.

## Verlo con curl

`curl -N` desactiva el buffer y va pintando los eventos según llegan. Con un token de `dotnet user-jwts`, como en el [post de autenticación](/2026-09-26-openapi-autenticacion-scalar), y una sala con una reserva el lunes a las nueve:

```bash
curl -N -i -H "Authorization: Bearer <token>" http://localhost:5178/api/v1/rooms/<id>/occupancy
```

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache,no-store
Content-Encoding: identity
Pragma: no-cache
Transfer-Encoding: chunked

event: occupancy
data: {"roomId":"01a14e0b-2f14-7fcd-ac9a-435896cb2714","status":"Free","at":"2026-10-18T08:05:42.9591674+00:00","nextChange":"2026-10-19T09:00:00+00:00"}

event: occupancy
data: {"roomId":"01a14e0b-2f14-7fcd-ac9a-435896cb2714","status":"Free","at":"2026-10-18T08:05:47.9601922+00:00","nextChange":"2026-10-19T09:00:00+00:00"}
```

Un evento cada cinco segundos, cada uno con su línea `event:` y su línea `data:` con el JSON. Las cabeceras de caché y `Content-Encoding: identity` las pone el framework para que ningún proxy ni la compresión retengan los eventos.

## En el navegador

El navegador trae `EventSource`, que abre la conexión, separa los eventos y reconecta solo si se corta:

```javascript
const source = new EventSource(`/api/v1/rooms/${roomId}/occupancy`);
source.addEventListener("occupancy", (event) => {
  const occupancy = JSON.parse(event.data);
  render(occupancy);
});
```

Hay un detalle que conviene saber antes de diseñar la autenticación: `EventSource` no deja añadir cabeceras, así que no puede mandar `Authorization: Bearer`. Para la pantalla de una sala, lo habitual es autenticar con una cookie del mismo dominio o leer el stream con `fetch`, que sí admite cabeceras, a costa de parsear los eventos a mano. entry-hub solo expone el endpoint; el cliente lo dejamos fuera.

## En el contrato y en los tests

El generador de OpenAPI entiende `ServerSentEventsResult<T>`. En el contrato, la operación responde `text/event-stream` con un esquema que envuelve el tipo de cada evento:

```json
"200": {
  "description": "OK",
  "content": {
    "text/event-stream": {
      "schema": { "$ref": "#/components/schemas/SseItemOfRoomOccupancy" }
    }
  }
}
```

Para probarlo, el test lee la respuesta con `SseParser`, de `System.Net.ServerSentEvents`, que convierte el stream en eventos:

```csharp
using var response = await client.GetAsync(
    $"/api/v1/rooms/{room!.Id}/occupancy",
    HttpCompletionOption.ResponseHeadersRead,
    cancellation.Token);
await using var body = await response.Content.ReadAsStreamAsync(cancellation.Token);
var events = new List<SseItem<string>>();
await foreach (var item in SseParser.Create(body).EnumerateAsync(cancellation.Token))
{
    events.Add(item);
    if (events.Count == 2)
    {
        break;
    }
}

Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
Assert.All(events, item => Assert.Equal("occupancy", item.EventType));
```

`HttpCompletionOption.ResponseHeadersRead` es la clave: sin él, `HttpClient` esperaría a que la respuesta terminase, y esta respuesta no termina nunca. El test lee dos eventos y corta. Otro test comprueba el `404` de una sala que no existe.

## ¿Y SignalR?

SignalR sigue siendo la opción cuando el cliente también tiene que mandar mensajes, cuando necesitas grupos de conexiones o cuando quieres que elija el transporte por ti. Para un flujo de un solo sentido, SSE es HTTP normal: pasa por los mismos proxies, usa la misma autorización del grupo de rutas y se prueba con `curl`.

## Resumiendo

- `TypedResults.ServerSentEvents` con un `IAsyncEnumerable` basta para emitir eventos. Comprueba lo que pueda dar `404` antes de empezar el stream.
- La desconexión del cliente cancela el token y el iterador termina solo. En el navegador, `EventSource` reconecta solo, pero no admite cabeceras de autenticación.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En el siguiente post comprobamos que lo que responde la API cumple el contrato OpenAPI.
