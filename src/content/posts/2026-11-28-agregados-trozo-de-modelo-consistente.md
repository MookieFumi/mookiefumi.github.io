---
title: "Agregados: el trozo de tu modelo que nunca puede quedar a medias"
subtitle: Dos reservas se pisan en la misma sala y las dos se guardan. La regla existía, pero nadie estaba obligado a cumplirla
description: "Qué es un agregado en DDD y cómo diseñarlo en C# con un ejemplo de reservas de salas: raíz del agregado, invariantes, las cuatro reglas de Vernon, concurrencia con EF Core y cuándo no hace falta."
date: 2026-11-28
topic: desarrollo
series: concepts
published: false
---

Dos reuniones se solapan en la sala de Lisboa, de 10:00 a 11:00 y de 10:30 a 11:30, y las dos están guardadas. El servicio de reservas rechaza los solapes, y hasta tiene un test que lo demuestra. Lo que pasa es que la segunda reunión no entró por el servicio, sino por el importador de calendarios.

## La regla estaba, pero no era obligatoria

Este es el punto de partida. La colección de reservas es una lista pública y la regla de solape vive en un servicio:

```csharp
public sealed class BookingService(BookingStore store)
{
    public bool TryBook(string roomName, string title, DateTimeOffset startAt, DateTimeOffset endAt)
    {
        var overlaps = store.All.Any(b => b.RoomName == roomName && b.StartAt < endAt && startAt < b.EndAt);
        // ...
        store.All.Add(new Booking(Guid.NewGuid(), roomName, title, startAt, endAt));
        return true;
    }
}
```

El importador recibe la misma lista y añade directamente:

```csharp
public void Import(string roomName, string title, DateTimeOffset startAt, DateTimeOffset endAt)
{
    store.All.Add(new Booking(Guid.NewGuid(), roomName, title, startAt, endAt));
}
```

Al ejecutarlo, el servicio rechaza la reserva de las 10:30 (`False`) y el importador la mete igualmente. La sala acaba con 2 reservas solapadas. Nadie hizo nada raro y cada pieza cumplía con lo suyo, pero ninguna era responsable de que la sala no llegara a un estado imposible.

## Qué es un agregado

Evans lo define en su *Domain-Driven Design Reference* así:

> Cluster the entities and value objects into aggregates and define boundaries around each. Choose one entity to be the root of each aggregate, and allow external objects to hold references to the root only... Define properties and invariants for the aggregate as a whole and give enforcement responsibility to the root.

Un agregado es un grupo de objetos que se trata como una unidad, con una raíz que es la única puerta de entrada. Una invariante, según Vaughn Vernon en *Effective Aggregate Design*, es «a business rule that must always be consistent». Y de ahí sale su idea central: el agregado es «synonymous with transactional consistency boundary», la frontera dentro de la cual la regla se cumple siempre.

## La sala como raíz

Aquí la raíz es `Room`, que guarda sus reservas y es la única que puede añadirlas:

```csharp
public sealed class Room(Guid id, string name)
{
    private const int MaxBookingsPerDay = 3;

    private readonly List<Booking> _bookings = [];

    public IReadOnlyList<Booking> Bookings => _bookings;

    public BookingResult Book(string title, TimeRange range)
    {
        if (_bookings.Any(b => b.Range.Overlaps(range)))
        {
            return BookingResult.Overlaps;
        }

        if (_bookings.Count(b => b.Range.Start.Date == range.Start.Date) >= MaxBookingsPerDay)
        {
            return BookingResult.DayIsFull;
        }

        _bookings.Add(new Booking(Guid.NewGuid(), title, range));
        return BookingResult.Booked;
    }
}
```

El constructor de `Booking` es `internal` y la lista es privada, así que desde fuera no hay forma de colar una reserva sin pasar por `Book`. El importador ya no tiene atajo: llama a `room.Book(...)` como cualquier otro. Con el mismo caso, el resultado es `Booked`, `Overlaps` y `Overlaps`, y la sala acaba con 1 reserva.

Esto enlaza con la pregunta del post anterior: `Room` es una entidad con identidad, y `Booking` y `TimeRange` viven dentro de ella. Y con lo que contamos sobre el [modelo rico](/2026-11-14-donde-viven-las-reglas-de-tu-negocio): la regla vive en el objeto que protege el dato.

## Las cuatro reglas de Vernon

Vernon resume cómo acotar un agregado en cuatro reglas, con estos títulos:

1. **Model True Invariants In Consistency Boundaries.** Mete dentro del agregado solo lo que debe ser consistente en cada instante. Un máximo de reservas por persona cruza muchas salas, así que no cabe en `Room`.
2. **Design Small Aggregates.** Cuanto más grande, más operaciones compiten por él. Mi `Room` guarda todas las reservas para simplificar; en un sistema real crecería sin parar, y habría que partirlo por día.
3. **Reference Other Aggregates By Identity.** Un agregado apunta a otro por su identificador y no por un objeto. Si una reserva necesitara saber quién la pide, guardaría un `Guid`, no un objeto `Attendee` entero.
4. **Use Eventual Consistency Outside the Boundary.** Lo que pase entre agregados puede tardar un poco. Lo dice Evans (p. 128 del libro, citado por Vernon): una regla que cruza agregados «will not be expected to be up-to-date at all times».

De ahí sale una pauta práctica: Vernon dice que un bounded context bien diseñado modifica una sola instancia de agregado por transacción. Si necesitas tocar varias a la vez, lo toma como indicio de que las fronteras están mal puestas. También dedica una sección a «Reasons To Break the Rules» y avisa de que solo se rompen «with good reason».

## Dos personas, una franja

Queda el caso del principio, pero ahora en concurrencia: dos peticiones leen la sala a la vez, las dos ven la franja libre y las dos guardan. `Room` no lo evita por sí sola, porque cada petición trabaja con su copia en memoria.

Con EF Core, la forma habitual de resolverlo es un token de concurrencia sobre la raíz. La documentación de Microsoft lo describe con `IsConcurrencyToken()` o `IsRowVersion()`: al guardar, EF comprueba que la fila no haya cambiado desde que la leíste, y si cambió lanza una `DbUpdateConcurrencyException`. La petición perdedora recarga la sala, vuelve a llamar a `Book` y ahora recibe `Overlaps`. Esta parte no está en la demo: la demo solo cubre la regla dentro del agregado.

Por eso conviene que la raíz sea el límite de la transacción: un token en `Room` protege todas sus reservas con una sola comprobación.

## Cuándo no hace falta

Si tu entidad no tiene reglas que deban cumplirse siempre, como una tabla de países o de categorías, un agregado es ceremonia. Basta con CRUD. Un agregado merece la pena cuando hay una invariante de verdad, de las que el negocio no tolera romper ni un instante, y varios objetos que deben cambiar juntos para respetarla.

El código de las dos versiones está en la carpeta [`12-aggregates`](https://github.com/MookieFumi/concept-pills/tree/main/12-aggregates) de concept-pills.
