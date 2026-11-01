---
title: "Bounded context: dónde acaba tu modelo"
subtitle: En entry-hub, «booking» significa una cosa para la API y otra para el servicio de recordatorios, y está bien que sea así
description: "Qué es un bounded context en Domain-Driven Design con el ejemplo real de entry-hub: dos modelos de la misma reserva, la traducción en la frontera, la diferencia con un microservicio y cuándo no hacen falta fronteras."
date: 2026-11-28
topic: desarrollo
series: concepts
published: false
---

En [entry-hub](https://github.com/MookieFumi/entry-hub), la palabra *booking* aparece en dos sitios: en la API que gestiona las reservas de salas y en un servicio aparte que avisa al organizador cuando una reunión está a punto de empezar. Es la misma reserva, pero cada uno ve otra cosa.

Para la API, una reserva tiene una sala con capacidad, un rango de tiempo, un estado que puede pasar a cancelada y unas reglas: duración mínima, antelación, cancelación con aviso. Para el servicio de recordatorios, lo que existe es un `DueReminder`:

```csharp
public sealed record DueReminder(Guid BookingId, string OrganizerId, string Title, string RoomName, DateTimeOffset StartAt);
```

Un identificador, a quién avisar, qué reunión, en qué sala y cuándo. No le importa la capacidad, ni quién puede cancelar, ni cuántos asistentes hay.

## Qué dice Evans

Eric Evans, en su *Domain-Driven Design Reference*, define el *bounded context* así:

> Explicitly define the context within which a model applies. Explicitly set boundaries in terms of team organization, usage within specific parts of the application, and physical manifestations such as code bases and database schemas.

Y añade una frase que explica por qué existen: «Model expressions, like any other phrase, only have meaning in context». Una palabra como *booking* no tiene un significado único. Lo tiene dentro de un contexto.

Martin Fowler, en su página sobre el patrón, lo ve en cualquier negocio: «Time and time again I see this confusion recur with polysemes like 'Customer' and 'Product'». Una misma palabra con significados distintos según quién la use. Fowler recuerda que el propio Evans ya lo advirtió: lo normal es tener varios modelos, porque «total unification of the domain model for a large system will not be feasible or cost-effective».

## Qué pasa cuando no hay frontera

Para ver el problema, imagina un único `Booking` con todos los campos, compartido por las dos partes:

```csharp
public sealed class Booking
{
    public required string RoomName { get; init; }
    public int RoomCapacity { get; init; }
    public required string OrganizerId { get; init; }
    public string Status { get; set; } = "Confirmed";
    public DateTimeOffset? CancelledAt { get; set; }
    public DateTimeOffset? ReminderSentAt { get; set; }
    public string ReminderChannel { get; set; } = "email";
    // ... and the rest
}
```

El código que crea reservas tiene que conocer los campos de los recordatorios, porque viven en la misma clase. Cada cambio de uno afecta al otro. Y el servicio de recordatorios puede cambiar lo que solo debería decidir la parte de reservas. En la demo exagero la situación para que se vea: el servicio de recordatorios cancela la reserva al avisar, y la salida lo muestra:

```text
Reminder for ana: 'Planning' in Lisbon
Status after the reminder ran: Cancelled
```

Nadie escribiría eso a propósito. Pasa por accidente, cuando el compilador no impide nada.

## Dos modelos y una traducción

La versión con fronteras separa los dos modelos y deja una sola pieza que conoce ambos:

```csharp
// Reminders context
public sealed record DueReminder(Guid BookingId, string OrganizerId, string Title, string RoomName, DateTimeOffset StartAt);

public interface IReminderSource
{
    IReadOnlyList<DueReminder> StartingBetween(DateTimeOffset from, DateTimeOffset until);
}

// Reservations context, at the boundary
public sealed class ReservationsReminderSource(ReservationService reservations) : IReminderSource
{
    public IReadOnlyList<DueReminder> StartingBetween(DateTimeOffset from, DateTimeOffset until)
    {
        return [.. reservations.ConfirmedStartingBetween(from, until)
            .Select(booking => new DueReminder(booking.Id, booking.OrganizerId, booking.Title, booking.RoomName, booking.StartAt))];
    }
}
```

El servicio de recordatorios solo conoce `DueReminder` y su interfaz. La traducción de `Booking` a `DueReminder` ocurre en un único sitio, y ahí se decide qué reservas cuentan: solo las confirmadas. En la salida, la reserva cancelada de Madrid no recibe aviso y la de Lisboa queda como estaba:

```text
Reminder for ana: 'Planning' in Lisbon
Status after the reminder ran: Confirmed
```

## Un contexto no es un microservicio

Es tentador pensar que cada contexto es un servicio. La guía de arquitectura de Microsoft lo matiza: un microservicio no debería ser más pequeño que un agregado ni más grande que un bounded context, y un contexto puede estar formado por varios servicios físicos que comparten un modelo. A la inversa, también puedes tener varios contextos dentro de un monolito, separados en módulos o carpetas, como en la demo.

## Lo que hace entry-hub hoy

El servicio de recordatorios de entry-hub tiene su propio modelo (`DueReminder`) y su propio proyecto, pero lee directamente las tablas de la API. Su propio código lo dice en un comentario: la API es dueña del esquema, y el servicio solo lee `bookings` y `rooms` y escribe `ReminderSentAt`. Es un compromiso razonable para empezar. La frontera del modelo existe, la del esquema de datos es compartida. Si algún día los recordatorios necesitan evolucionar solos, esa es la parte que habría que separar.

## Cuándo no hacen falta

Un sistema pequeño con un solo equipo y una palabra con un solo significado no necesita fronteras. Dibujar contextos tiene un coste, que es la traducción en cada frontera, y solo compensa cuando las mismas palabras empiezan a significar cosas distintas o cuando un cambio en una parte rompe otra sin motivo.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`10-bounded-context`](https://github.com/MookieFumi/concept-pills/tree/main/10-bounded-context) de concept-pills.
