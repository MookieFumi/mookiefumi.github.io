---
title: "Primitive obsession: dale nombre a tus datos con value objects, sin ceremonia"
subtitle: Una reserva con -3 asistentes y fin antes del inicio compila, se guarda y nadie se queja hasta que alguien la lee
description: "Primitive obsession y value objects en C# con un ejemplo de reservas de salas: cómo un readonly record struct con validación evita datos imposibles, qué pasa con default, cómo mapearlos en EF Core y cuándo no merece la pena."
date: 2026-11-12
topic: desarrollo
series: concepts
published: false
---

Hay una reserva de sala con el organizador vacío, tres asistentes en negativo y un final una hora antes del inicio. Compila, se crea y se guarda sin una sola queja:

```text
Organizer: '', attendees: -3, duration: -01:00:00
```

El código que la produjo es el de cualquier aplicación: un método con cinco parámetros de tipos primitivos.

## Cinco parámetros que se pueden mezclar

```csharp
public static Booking Create(Guid roomId, string organizerId, int attendees, DateTimeOffset startAt, DateTimeOffset endAt)
{
    return new Booking(roomId, organizerId, attendees, startAt, endAt);
}

var booking = BookingFactory.Create(Guid.NewGuid(), "", -3, end, start);
```

En la llamada, `end` y `start` van al revés, el organizador está vacío y el número de asistentes es imposible. El compilador no puede saberlo: para él, `start` y `end` son dos `DateTimeOffset` intercambiables y `""` es un `string` válido.

Este patrón tiene nombre. Se llama *primitive obsession* y está en el catálogo de refactorizaciones de Martin Fowler, con su solución: *Replace Primitive with Object*. Fowler explica por qué en su página sobre value objects:

> It's often a good idea to replace common primitives, such as strings, with appropriate value objects. While I can represent a telephone number as a string, turning into a telephone number object makes variables and parameters more explicit (with type checking when the language supports it), a natural focus for validation, and avoiding inapplicable behaviors (such as doing arithmetic on integer id numbers).

Tres ventajas en una frase: parámetros explícitos, un sitio natural donde validar y operaciones que no tienen sentido que dejan de compilar.

## Un tipo por concepto

Cada concepto con reglas propias pasa a ser un tipo que se valida al construirse:

```csharp
public readonly record struct Attendees
{
    public Attendees(int value)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(value, 1);
        Value = value;
    }

    public int Value { get; }
}

public readonly record struct TimeRange
{
    public TimeRange(DateTimeOffset start, DateTimeOffset end)
    {
        if (end <= start)
        {
            throw new ArgumentException("The end must be after the start.", nameof(end));
        }

        Start = start;
        End = end;
    }

    public DateTimeOffset Start { get; }

    public DateTimeOffset End { get; }

    public TimeSpan Duration => End - Start;
}
```

`OrganizerId` sigue el mismo patrón y rechaza el texto vacío. La reserva pasa a ser `Booking(Guid RoomId, OrganizerId Organizer, Attendees Attendees, TimeRange Range)`. Ya no hay dos fechas sueltas que puedas poner al revés: hay un rango que no se deja construir con el final antes del inicio. Intentarlo lanza `The end must be after the start.` y con `new Attendees(-3)` pasa lo mismo.

Es la idea que Eric Evans describe en su *Domain-Driven Design Reference*: cuando solo importan los atributos y la lógica de un elemento del modelo, se clasifica como value object, se trata como inmutable y no se le da identidad. Dos `TimeRange` con los mismos extremos son el mismo rango, y un `record` te da esa igualdad por valor sin escribir nada.

## Dos trampas de C# que conviene conocer

La primera es el modificador `readonly`. Un `record struct` a secas genera propiedades con `set`, así que es mutable. Con `readonly record struct` las propiedades solo se asignan al construir, y eso es lo que quieres en un value object.

La segunda es `default`. Un `struct` siempre puede crearse sin pasar por tu constructor:

```csharp
var range = default(TimeRange);
// range.Start == range.End == 0001-01-01, duration 00:00:00
```

Lo he ejecutado: el resultado es un rango de duración cero, justo lo que tu constructor rechaza. Lo mismo ocurre con los elementos de un `new TimeRange[2]`. Si esto te preocupa, usa `record` de clase en lugar de `struct` (la validación del constructor es la única forma de crearlo), o trata el valor por defecto como «sin valor» a propósito. Pasa también con `OrganizerId`: su constructor rechaza el texto vacío, pero `default(OrganizerId)` tiene un `Value` nulo.

## Cómo se guardan en EF Core

Para persistir un value object, la documentación actual de EF Core recomienda los *complex types* frente a los *owned types*. Los complex types se comparan por valor y la misma instancia puede compartirse entre entidades, que es lo que esperas de un value object. Aparecieron en EF Core 8 y las versiones siguientes los han ido ampliando. La propia página lo resume así:

> For these reasons, complex types are generally the better choice for modeling value objects with table splitting or JSON mapping.

## Cuándo no merece la pena

No hace falta envolver cada `string` de tu código. Un tipo nuevo cuesta un fichero, un constructor y conversiones en los bordes (al leer del JSON, al mapear a la base de datos). Compensa en dos casos: cuando el valor tiene una regla que quieres garantizar en un único sitio, y cuando hay dos parámetros del mismo tipo que se pueden confundir. Un `Title` que acepta cualquier texto y se muestra tal cual puede seguir siendo un `string`.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`04-value-objects`](https://github.com/MookieFumi/concept-pills/tree/main/04-value-objects) de concept-pills.
