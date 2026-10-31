---
title: "Eventos de dominio: dejar de avisar a todos desde el mismo método"
subtitle: Cancelar una reserva es una línea, pero el método acaba conociendo el correo, el catering y el calendario
description: "Qué son los eventos de dominio en DDD y cómo usarlos en C# con un ejemplo de reservas de salas: un agregado que registra lo ocurrido, manejadores que reaccionan, cómo despacharlos con EF Core y cuándo basta una llamada directa."
date: 2026-11-30
topic: desarrollo
series: concepts
published: false
---

Cancelar una reserva es cambiar un valor. Pero cuando alguien lo hace en producción hay que avisar al organizador, liberar el pedido de catering y quitar el evento del calendario. Y el sitio más cómodo para añadir todo eso es el propio método `Cancel`.

## Un método que conoce a medio sistema

Así queda cuando cada aviso se suma a mano:

```csharp
public void Cancel(IEmailSender email, ICatering catering, ICalendar calendar)
{
    IsCancelled = true;
    email.SendCancellation(Title);
    catering.ReleaseOrder(Id);
    calendar.RemoveEvent(Id);
}
```

La regla de negocio ocupa una línea. Las otras tres son «además, avisa a este». Probar la cancelación exige montar tres colaboradores, y cada vez que alguien pide una reacción nueva (por ejemplo, ofrecer la franja a otro equipo) hay que abrir `Cancel` y añadir otro parámetro. Al ejecutar la demo, los tres avisos salen y la reserva queda cancelada, pero el método ha dejado de ser solo la regla.

## Qué es un evento de dominio

Evans lo añadió a su *Domain-Driven Design Reference* como término nuevo respecto al libro de 2003, y lo define así:

> Something happened that domain experts care about.

Y la forma de modelarlo:

> Model information about activity in the domain as a series of discrete events. Represent each event as a domain object.

Además, dice que los eventos de dominio «are ordinarily immutable, as they are a record of something in the past». Por eso se nombran en pasado y suelen ser un `record`:

```csharp
public sealed record BookingCancelled(Guid BookingId, string Title) : IDomainEvent;
```

## El agregado cuenta lo que pasó

La versión con eventos no avisa a nadie. Anota lo ocurrido:

```csharp
public void Cancel()
{
    if (IsCancelled)
    {
        return;
    }

    IsCancelled = true;
    _events.Add(new BookingCancelled(Id, Title));
}
```

`Cancel()` ya no recibe nada. Se prueba en una línea, mirando `booking.Events`. Y cancelar dos veces registra un solo evento, porque la propia regla lo impide (en la demo salen `1` y `1`).

Quien reacciona es un manejador por cada aviso:

```csharp
public sealed class ReleaseCateringOrder : IDomainEventHandler<BookingCancelled>
{
    public void Handle(BookingCancelled domainEvent)
    {
        Console.WriteLine("  catering: order released");
    }
}
```

Un despachador pequeño busca los manejadores registrados para cada evento y los ejecuta. En la demo hay tres manejadores iguales a los de antes y un cuarto, `FreeRoomForWaitingList`, que añadí después. `Booking.Cancel()` no cambió: solo se registró la clase nueva.

## Dentro del contexto, no entre sistemas

Un evento de dominio es una pieza interna del modelo. La guía de Azure distingue dos tipos: los eventos internos «stay within a bounded context», y los que cruzan hacia otros sistemas se publican por un broker de mensajes «after the transaction that originated them commits». Son cosas distintas, y mezclarlas acopla un contexto con otro, como vimos en el [post de bounded context](/2026-11-24-bounded-context-donde-acaba-tu-modelo).

Con los agregados del [post anterior](/2026-11-28-agregados-trozo-de-modelo-consistente) encaja bien. Vernon propone que un método del agregado publique un evento que otros reciben «in time», y así lo que pasa entre agregados queda en consistencia eventual en lugar de ir todo en una transacción.

## Con EF Core: cuándo despachar

Una forma habitual es que la entidad acumule los eventos, como hace `Booking`, y que la capa de aplicación los despache al guardar. Aquí hay una decisión que no es menor. Si despachas antes de confirmar, los manejadores corren en la misma transacción y, si uno falla, se revierte todo. Si despachas después, ya no puedes deshacer la cancelación: un fallo en el correo deja la reserva cancelada sin aviso, y tienes que compensarlo. La guía de Microsoft sobre eventos de dominio recoge las dos opciones. Esta parte no está en la demo, que despacha sin base de datos.

Un detalle más: según esa guía, un evento puede procesarse cero o varias veces, así que los manejadores deben tolerar repeticiones.

## Cuándo no hace falta

Si al cancelar solo tienes que hacer una cosa, una llamada directa es más fácil de leer y de depurar que un evento. Los eventos dan indirección: el flujo ya no se lee de arriba abajo. Merecen la pena cuando las reacciones son varias, cambian a menudo o pertenecen a otras partes del sistema. Y no todo cambio es un evento de dominio. Según la guía de Azure, «a delivery was canceled» lo es, pero «a record was inserted into a table» no.

El código de las dos versiones está en la carpeta [`13-domain-events`](https://github.com/MookieFumi/concept-pills/tree/main/13-domain-events) de concept-pills.
