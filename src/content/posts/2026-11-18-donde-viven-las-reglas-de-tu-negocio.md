---
title: Dónde viven las reglas de tu negocio
subtitle: Una reserva puede quedar cancelada sin pasar por la regla de cancelación si el estado lo puede cambiar cualquiera
description: "Modelo de dominio anémico frente a modelo rico en C# con un ejemplo de reservas de salas: qué dice Martin Fowler, cómo mover la regla de cancelación al objeto que la protege, cómo lo guarda EF Core y cuándo el anémico es suficiente."
date: 2026-11-18
topic: desarrollo
series: concepts
published: false
---

Una reserva empieza dentro de 10 minutos. La política de la empresa dice que se puede cancelar hasta 15 minutos antes, y el servicio que cancela reservas lo sabe: responde `Too late to cancel`. Aun así, la reserva termina cancelada:

```text
Policy says: Too late to cancel.
Status: Cancelled, cancelled at: nobody knows
```

La regla existe, está bien escrita y funciona. Pero no manda sobre nada, porque cualquier línea de código puede escribir `booking.Status = BookingStatus.Cancelled` sin preguntarle.

## Datos por un lado, reglas por otro

Este es el diseño de partida:

```csharp
public sealed class Booking
{
    public Guid Id { get; init; } = Guid.NewGuid();

    public DateTimeOffset StartAt { get; init; }

    public BookingStatus Status { get; set; } = BookingStatus.Confirmed;

    public DateTimeOffset? CancelledAt { get; set; }
}

public sealed class BookingPolicy
{
    public static readonly TimeSpan CancellationNotice = TimeSpan.FromMinutes(15);

    public string? CanCancel(Booking booking, DateTimeOffset now)
    {
        if (booking.Status == BookingStatus.Cancelled)
        {
            return "The booking is already cancelled.";
        }

        return booking.StartAt - now < CancellationNotice ? "Too late to cancel." : null;
    }
}
```

`Booking` solo tiene datos con `get` y `set` públicos. `BookingPolicy` tiene las reglas y recibe la reserva como argumento. Para cancelar con seguridad, quien llama debe acordarse de consultar la política, y después acordarse de cambiar el estado y de rellenar `CancelledAt`. Si se olvida de cualquiera de los tres pasos, la reserva queda en un estado que el negocio no permite.

Martin Fowler dio nombre a este diseño en 2003: *Anemic Domain Model*. Lo describe así:

> The catch comes when you look at the behavior, and you realize that there is hardly any behavior on these objects, making them little more than bags of getters and setters.

Y lo llama «el horror fundamental» de este antipatrón porque es contrario a la idea básica del diseño orientado a objetos, que es combinar datos y proceso.

## Un objeto que protege sus propias reglas

La alternativa es que la reserva decida cuándo se puede cancelar:

```csharp
public sealed class Booking(DateTimeOffset startAt)
{
    public static readonly TimeSpan CancellationNotice = TimeSpan.FromMinutes(15);

    public Guid Id { get; } = Guid.NewGuid();

    public DateTimeOffset StartAt { get; } = startAt;

    public BookingStatus Status { get; private set; } = BookingStatus.Confirmed;

    public DateTimeOffset? CancelledAt { get; private set; }

    public void Cancel(DateTimeOffset now)
    {
        if (Status == BookingStatus.Cancelled)
        {
            throw new InvalidOperationException("The booking is already cancelled.");
        }

        if (StartAt - now < CancellationNotice)
        {
            throw new InvalidOperationException("Too late to cancel.");
        }

        Status = BookingStatus.Cancelled;
        CancelledAt = now;
    }
}
```

`Status` y `CancelledAt` tienen `set` privado, así que solo `Cancel` puede cambiarlos. La regla y el cambio de estado van juntos y no se pueden separar. Si intentas cancelar la reserva que empieza dentro de 10 minutos, el resultado es `Rejected: Too late to cancel. Status stays Confirmed.`, y si cancelas una con dos horas de margen, `Status` pasa a `Cancelled` con su fecha rellena.

Fíjate en que `Cancel` recibe `now` como argumento. Es la misma idea del post sobre el acoplamiento: la hora entra por fuera, y la regla se prueba con cualquier hora que quieras.

Es lo que pide Eric Evans para los agregados: definir las invariantes del conjunto y dar la responsabilidad de hacerlas cumplir a su raíz. Aquí la raíz es `Booking`, y la invariante es «una reserva solo se cancela con antelación suficiente y una sola vez».

## Y EF Core

Que los setters sean privados no impide guardar la reserva. La documentación de Microsoft sobre el modelo de dominio con EF Core indica que, para cumplir estos requisitos de DDD, puedes usar campos sencillos en lugar de propiedades públicas, y también setters privados. EF Core escribe esos valores al cargar la entidad sin pasar por tu método.

## Cuándo el modelo anémico basta

Conviene no leer el artículo de Fowler como una condena. En él mismo escribe que los modelos de dominio no siempre son la mejor herramienta. Si una pantalla guarda datos y no hay reglas que proteger, un objeto con propiedades y un servicio que lo guarda es suficiente, y un modelo rico solo añade código.

El modelo rico cuesta algo más: la clase necesita saber más (aquí, la antelación mínima) y sus métodos reciben lo que antes consultaba una política. La señal para pasar de uno a otro es la de este post: una regla que existe, pero que alguien puede saltarse sin querer.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`05-rich-model`](https://github.com/MookieFumi/concept-pills/tree/main/05-rich-model) de concept-pills.
