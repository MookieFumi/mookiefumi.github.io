---
title: El test que solo falla por la tarde
subtitle: Un handler que crea todo lo que usa depende de la base de datos, del correo y de la hora a la que lo ejecutes
description: "Acoplamiento y cohesión en C# con un ejemplo de reservas de salas: por qué un handler que crea sus dependencias no se puede probar, cómo inyectar base de datos, correo y reloj con TimeProvider y cuándo no hace falta abstraer."
date: 2026-11-08
topic: desarrollo
series: concepts
published: false
---

El test reserva una sala para hoy a las 15:00 y comprueba que la reserva se acepta. Pasa por la mañana. A las 15:01 falla, sin que nadie haya tocado el código. Si lo ejecutas mañana, vuelve a pasar hasta las 15:00.

El fallo está en el código que prueba, que lee la hora del sistema por su cuenta y por eso no se puede probar de forma fiable.

## Un handler que crea todo lo que usa

Este es el handler que crea reservas de salas:

```csharp
public sealed class CreateBookingHandler
{
    private readonly SqlBookingStore _store = new();
    private readonly SmtpNotifier _notifier = new();

    public bool Handle(BookingRequest request)
    {
        if (request.StartAt < DateTimeOffset.UtcNow)
        {
            Console.WriteLine("Rejected: the booking starts in the past.");
            return false;
        }

        _store.Insert(request);
        _notifier.Send(request.OrganizerEmail, $"{request.RoomName} booked");

        return true;
    }
}
```

Hace tres cosas que parecen razonables. Crea su almacén con `new`, crea su notificador con `new` y pregunta la hora a `DateTimeOffset.UtcNow`. Cada una es una decisión que el handler toma por sí mismo y que no puedes cambiar desde fuera.

Si lo ejecutas con una reserva del 12 de enero de 2026, la salida depende del día en que lo hagas. Una vez pasada esa fecha, la respuesta es `Rejected: the booking starts in the past`. El mismo código, con la misma petición, la habría aceptado en enero. Para probarlo necesitas una base de datos real, un servidor de correo y la hora exacta. Cualquiera de las tres cosas falla por razones ajenas a lo que quieres comprobar.

## Qué es el acoplamiento

Acoplamiento es cuánto depende un trozo de código de los detalles de otro. Aquí el handler depende de cómo se guarda una reserva (SQL), de cómo se avisa (SMTP) y de dónde sale la hora (el reloj del sistema). Cambiar cualquiera de esos detalles obliga a tocar el handler.

La idea de separar el código por sus decisiones de diseño viene de lejos. En 1972, David Parnas propuso dividir un sistema en módulos de modo que cada uno oculte una decisión que pueda cambiar. Un módulo no debería saber cómo se guarda una reserva si eso puede cambiar mañana.

## Dependencias pequeñas

La solución es que el handler pida lo que necesita en lugar de crearlo:

```csharp
public interface IBookingStore
{
    void Insert(BookingRequest request);
}

public interface INotifier
{
    void Send(string recipient, string message);
}

public sealed class CreateBookingHandler(IBookingStore store, INotifier notifier, TimeProvider timeProvider)
{
    public bool Handle(BookingRequest request)
    {
        if (request.StartAt < timeProvider.GetUtcNow())
        {
            Console.WriteLine("Rejected: the booking starts in the past.");
            return false;
        }

        store.Insert(request);
        notifier.Send(request.OrganizerEmail, $"{request.RoomName} booked");

        return true;
    }
}
```

El almacén y el notificador son interfaces pequeñas, con un solo método. La hora ya no hace falta inventarla: desde .NET 8, el framework trae `TimeProvider`, una clase que representa el tiempo. En producción pasas `TimeProvider.System`. En las pruebas, el paquete `Microsoft.Extensions.TimeProvider.Testing` incluye `FakeTimeProvider`, donde tú decides qué hora es:

```csharp
var clock = new FakeTimeProvider(new DateTimeOffset(2026, 1, 12, 9, 0, 0, TimeSpan.Zero));
var handler = new CreateBookingHandler(new InMemoryBookingStore(), new ConsoleNotifier(), clock);

handler.Handle(future);   // accepted: it starts at 10:00 and it is 09:00

clock.Advance(TimeSpan.FromHours(2));
handler.Handle(future);   // rejected: now it is 11:00
```

La misma petición se acepta a las 9:00 y se rechaza a las 11:00, y el resultado es el mismo en tu máquina, en el CI y dentro de un año.

## Cohesión

La otra cara es la cohesión: cuánto tienen en común las cosas que hace una clase. Ahora el handler solo coordina: comprueba la regla, guarda y avisa. Cómo se guarda y cómo se avisa son asuntos de otras clases, cada una con una sola tarea. Esto hace que sea fácil cambiar el correo por un mensaje a Teams sin tocar la regla de la reserva.

## Cuándo no abstraer

No hace falta una interfaz por cada clase. Una interfaz tiene un coste: otro fichero, otro nombre y una indirección más al leer el código. Compensa donde el código cruza una frontera que cambia o que no controlas: la base de datos, el correo, la red y el reloj. No compensa para una clase que calcula algo con sus argumentos y no toca nada fuera. Un `BookingPolicy` que recibe datos y devuelve un resultado se prueba tal cual.

Como regla práctica, pregúntate qué necesitarías para probar esta clase en un test. Si la respuesta incluye algo que no controlas (una base de datos, un servidor, la hora), eso es lo que debe entrar por el constructor.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`02-coupling`](https://github.com/MookieFumi/concept-pills/tree/main/02-coupling) de concept-pills.
