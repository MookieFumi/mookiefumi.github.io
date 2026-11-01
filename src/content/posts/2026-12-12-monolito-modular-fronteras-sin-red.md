---
title: "Monolito modular: fronteras de microservicio sin pagar la red"
subtitle: Catering cancela una reserva que no es suya porque nada se lo impide, y un compilador puede impedirlo
description: "Qué es un monolito modular en .NET y cómo imponer fronteras con proyectos, tipos internal y una API pública por módulo: ejemplo de reservas y catering, lo que dicen Fowler y Shopify y lo que no está demostrado."
date: 2026-12-12
topic: desarrollo
series: concepts
published: false
---

En un monolito, catering puede leer la lista de reservas. Es la misma aplicación, la misma memoria y el mismo proyecto. Un día, para tapar un caso, el código de catering marca como cancelada una reserva de la sala de Berlín, que no tiene cocina. Funciona, y nadie lo ve en la revisión porque está dentro de `CateringService` y no en el módulo de reservas.

## Lo que pasa sin fronteras

Este es el servicio de catering de la demo, en una versión con un solo proyecto:

```csharp
public sealed class CateringService(BookingStore bookings)
{
    public string Order(Guid bookingId, string menu)
    {
        var booking = bookings.All.Single(b => b.Id == bookingId);

        if (booking.RoomName == "Berlin")
        {
            booking.IsCancelled = true;
            return "Berlin has no kitchen: reservation cancelled by Catering";
        }

        return $"Ordered {menu} for {booking.RoomName}";
    }
}
```

La salida de la demo es `Reservation cancelled: True`. Catering decidió el destino de una reserva porque podía. Con el tiempo, cada módulo conoce las tripas de los demás, y cambiar uno obliga a mirar todos.

## Qué es un monolito modular

Es un despliegue único con módulos de límites explícitos, por capacidad de negocio, y una API pública por módulo. Martin Fowler lo plantea en «Monolith First» como diseñar el monolito con cuidado, «paying attention to modularity within the software, both at the API boundaries and how the data is stored». Shopify lo eligió para su aplicación: «keep all of the code in one codebase, but ensure that boundaries were defined and respected between different components».

La idea tiene dos mitades, y la segunda es la difícil: que las fronteras existan, y que alguien las respete.

## Fronteras que impone el compilador

En .NET, una frontera barata es un proyecto por módulo, con lo que no quiera exponerse marcado `internal`. En la demo hay tres proyectos: `Reservations`, `Catering` y un `Host` que los une. `Reservations` publica solo esto:

```csharp
public interface IReservationsApi
{
    Guid Reserve(string roomName);

    BookingSummary? Find(Guid id);
}
```

`Booking`, su lista y la implementación son `internal`. Catering recibe un `IReservationsApi` y lee un `BookingSummary`, un resumen de solo lectura. Si el código de catering intenta crear o modificar una `Booking`, no compila:

```
error CS0122: 'Booking' is inaccessible due to its protection level
```

Lo probé añadiendo esa línea a `CateringApi` y revirtiéndola. Con la frontera puesta, catering decide por su cuenta («Berlin has no kitchen: nothing ordered») y la reserva sigue sin cancelar (`Reservation cancelled: False`). Además, la demo recorre los tipos públicos de cada ensamblado con reflexión: `Reservations` expone `BookingSummary`, `IReservationsApi` y `ReservationsModule`, y `Catering` expone `CateringModule` e `ICateringApi`. Eso es todo lo que el resto del sistema puede usar.

## Lo que no te da

Con esta frontera, los módulos siguen compartiendo proceso y base de datos, y el compilador no vigila los datos: si ambos módulos acceden a las mismas tablas, el acoplamiento sigue ahí aunque el código no lo parezca. Fowler lo dice cuando habla de modularidad «at the API boundaries and how the data is stored». El proyecto de referencia de Kamil Grzybek lleva el criterio más lejos: cada módulo tiene su propio esquema, no se comparten datos y los módulos se comunican con eventos. Son decisiones de ese proyecto, no la definición del patrón.

## Una advertencia de Shopify

Shopify es el ejemplo que más se cita, pero su propia historia no es un éxito limpio. En un artículo posterior escribieron que «we generally stand by the original ideas... but almost all of the details have changed». Contaron que el grafo de dependencias entre componentes era tan denso que «every component depended on over half of all the other components». Y sobre su herramienta de comprobar fronteras reconocieron que los desarrolladores agrupan el código «based strongly on semantic clues that in many cases have little relation to how the code actually runs». Dibujar módulos por nombres de negocio no garantiza que los acoplamientos sigan esas líneas. Hay que medirlo.

## Monolith First, sin dogma

Fowler defiende empezar por un monolito: casi todas las historias de microservicios exitosas que conoce empezaron con un monolito que creció demasiado y se dividió. Él mismo pone un límite: le tranquilizaría más la variante modular si hubiera oído un buen número de historias donde funcionó, y la mayoría de sus contactos se inclina por empezar con el monolito, pero no es unánime. Stefan Tilkov defiende en el sitio de Fowler lo contrario. No hay consenso.

Una ventaja práctica es el coste de pasar a microservicios: según Microsoft exige gestionar «event bus handling, message resiliency and retries, eventual consistency, and more». Un monolito modular te deja posponer esa factura hasta que sepas si la necesitas. Y si un día hay que separar algún módulo, la frontera ya está dibujada.

## Cuándo no merece la pena

Si tu aplicación es pequeña y la hace una persona, tres proyectos por tres módulos son más ceremonia que protección. Microsoft advierte del extremo opuesto: si la arquitectura es demasiado simple para el dominio, puede acabar en «a big ball of mud, where dependencies aren't well managed». El punto medio es tuyo: módulos cuando tengas capacidades de negocio claras y más de una persona tocándolas.

El código de las dos versiones está en la carpeta [`17-modular-monolith`](https://github.com/MookieFumi/concept-pills/tree/main/17-modular-monolith) de concept-pills.
