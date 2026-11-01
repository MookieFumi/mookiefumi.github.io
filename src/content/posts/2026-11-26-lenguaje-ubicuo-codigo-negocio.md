---
title: "Lenguaje ubicuo: que el código se lea como habla el negocio"
subtitle: Cuando la tabla dice «appointment», la API dice «reservation» y el equipo dice «bloquear sala», cada traducción es un sitio donde se pierde algo
description: "Qué es el lenguaje ubicuo de Domain-Driven Design con un ejemplo de reservas de salas en C#: el mismo concepto con cuatro nombres, cómo unificarlo con un glosario, cómo tratar el idioma y por qué no basta con renombrar clases."
date: 2026-11-26
topic: desarrollo
series: concepts
published: false
---

Imagina un equipo que gestiona reservas de salas de reuniones. La tabla de la base de datos se llama `Appointments`. El endpoint recibe un `ReservationDto`. El servicio se llama `MeetingService`. Y en las conversaciones del equipo se habla de «bloquear una sala». Es el mismo concepto con cuatro nombres.

Este escenario es inventado para ilustrar el problema. Esta es la salida real de ejecutar el código:

```text
Added meeting 0f31633b8ae34402bf9d03310dc8058c in Lisbon
Removed meeting 0f31633b8ae34402bf9d03310dc8058c (status=3)
```

Para el negocio, lo que ha pasado es sencillo: se ha creado una reserva y alguien la ha cancelado. En el código, se ha «añadido una reunión» y se ha «eliminado» poniendo un `Status` a 3, un número que nadie documentó.

## Cuatro nombres, cuatro traducciones

```csharp
// Table
public sealed class AppointmentRow
{
    public int Status { get; set; } = 1;   // 1 = open, 3 = "removed"
}

// API
public sealed record ReservationDto(string RoomName, DateTimeOffset From, DateTimeOffset To);

// Service
public sealed class MeetingService
{
    public Guid Add(ReservationDto reservation) { /* ... */ }

    public void Remove(Guid meetingId) { /* sets Status = 3 */ }
}
```

Cada vez que alguien pasa de una conversación al código, traduce: «cancelar» es `Remove`, «reserva» es `Reservation` en un sitio y `Appointment` en otro. La traducción mental funciona hasta que alguien nuevo llega al equipo o hasta que una frase se entiende de dos maneras. Un «borrado» en un informe puede significar que la fila desapareció o que está marcada con un 3.

## Qué propone Domain-Driven Design

Eric Evans llamó a la solución *ubiquitous language* (lenguaje ubicuo). En su *Domain-Driven Design Reference* lo define como un lenguaje «structured around the domain model and used by all team members within a bounded context to connect all the activities of the team with the software». Y el patrón dice:

> Use the model as the backbone of a language. Commit the team to exercising that language relentlessly in all communication within the team and in the code. Within a bounded context, use the same language in diagrams, writing, and especially speech.

La idea es que el modelo y el lenguaje del equipo sean uno: las palabras que se usan al hablar son las del código, las de los diagramas y las de la API. Fíjate en el final de la definición: «within a bounded context». El lenguaje es ubicuo dentro de un contexto, no entre todos los sistemas de una empresa. De eso hablaremos en el siguiente post.

## Un término por concepto

La versión corregida usa una sola palabra para cada cosa:

```csharp
public enum BookingStatus
{
    Confirmed,
    Cancelled,
}

public sealed class Booking(string roomName, DateTimeOffset startAt, DateTimeOffset endAt)
{
    public BookingStatus Status { get; private set; } = BookingStatus.Confirmed;

    public void Cancel()
    {
        Status = BookingStatus.Cancelled;
    }
}
```

Con ella, la salida cuenta lo que ha ocurrido en los términos del negocio:

```text
Booking c22e4da704cb4167999ec368f1550555 created in Lisbon
Booking c22e4da704cb4167999ec368f1550555 cancelled (status=Cancelled)
```

Ya no hay un `3` que interpretar. El estado se llama `Cancelled`, el método se llama `Cancel` y la clase se llama `Booking`, igual que se dice en voz alta.

## El idioma

Si el negocio habla en español y el código va en inglés (como en este blog), la traducción entre idiomas es inevitable. Lo que se puede evitar es la traducción *dentro* del mismo idioma. La solución práctica es un glosario que enlace los dos:

| Código | Negocio | Significado |
| --- | --- | --- |
| `Booking` | reserva | Una sala reservada para un rango de tiempo por una persona |
| `Room` | sala | Una sala de reuniones que se puede reservar |
| `Cancel` | cancelar | Retirar una reserva antes de que empiece; la reserva se conserva con estado `Cancelled` |

Es un fichero de texto en el repositorio, junto al código. Cuando aparece una palabra nueva, se discute y se añade. Cuando alguien propone `Remove`, el glosario dice que lo que se hace es cancelar.

## Lo que el código no te da

Renombrar clases no crea un lenguaje ubicuo. El lenguaje se acuerda hablando con las personas que conocen el negocio, y esa conversación es la parte que ninguna demo puede sustituir. Evans lo dice así: «With a ubiquitous language, the model is not just a design artifact. It becomes integral to everything the developers and domain experts do together.» El glosario del ejemplo lo escribí yo para el post; en un equipo real saldría de esas conversaciones.

## Cuándo no compensa

Un script que se ejecuta una vez o un CRUD sin reglas de negocio no necesita glosario. El lenguaje ubicuo merece la pena cuando hay un modelo con reglas y varias personas (programadores, analistas, el propio negocio) que tienen que entenderse sobre él.

El código de las dos versiones, junto con el glosario, está en la carpeta [`09-ubiquitous-language`](https://github.com/MookieFumi/concept-pills/tree/main/09-ubiquitous-language) de concept-pills.
