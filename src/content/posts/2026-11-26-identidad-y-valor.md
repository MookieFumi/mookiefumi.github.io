---
title: "Identidad y valor: la pregunta que decide cómo modelas"
subtitle: Dos reservas con los mismos datos, ¿son la misma? Depende de si preguntas por quién es o por cuánto vale
description: "Entidades y value objects en C# con un ejemplo de reservas de salas: cómo decide la identidad el modelo, qué pasa si modelas una entidad como record, cómo cambia según el bounded context y cuándo usar cada uno."
date: 2026-11-26
topic: desarrollo
series: concepts
published: false
---

Dos personas reservan la sala de Lisboa a la misma hora, con el mismo título y el mismo organizador. Los datos son idénticos. ¿Son la misma reserva?

Si comparas campo a campo, sí. Si preguntas cuántas reservas hizo el organizador, son dos, aunque se parezcan en todo. Esa diferencia entre «qué contiene» y «quién es» separa una entidad de un value object.

## Dos definiciones de Evans

En su *Domain-Driven Design Reference*, Eric Evans define la entidad por su identidad y no por lo que tiene:

> When an object is distinguished by its identity, rather than its attributes, make this primary to its definition in the model.

Y añade una frase que resume el trabajo del modelador: «The model must define what it means to be the same thing». El value object es el caso contrario:

> When you care only about the attributes and logic of an element of the model, classify it as a value object... Treat the value object as immutable... Don't give a value object any identity and avoid the design complexities necessary to maintain entities.

Una reserva es una entidad: sigue siendo la misma reserva cuando se cancela o cuando cambia el título. Un rango de tiempo es un valor: 10:00 a 11:00 es lo mismo allí donde aparezca.

## El error que se ve al ejecutarlo

En C# es fácil equivocarse aquí. Los `record` comparan por valor todos sus campos, y es muy tentador usarlos también para entidades:

```csharp
public sealed record Booking(Guid Id, string RoomName, string Title, DateTimeOffset StartAt)
{
    public bool IsCancelled { get; set; }
}
```

Con ese modelo, dos reservas distintas con los mismos datos resultan iguales, y la misma reserva deja de serlo en cuanto cambias algo:

```csharp
var first = new Booking(Guid.Empty, "Lisbon", "Planning", start);
var second = new Booking(Guid.Empty, "Lisbon", "Planning", start);
Console.WriteLine($"Same data, equal? {first == second}");          // True

var tracked = new Dictionary<Booking, string> { [booking] = "tracked" };
booking.IsCancelled = true;
Console.WriteLine($"Found after cancelling it? {tracked.ContainsKey(booking)}");   // False
```

El diccionario no encuentra la reserva cancelada porque su código hash ha cambiado con el campo. Lo ejecuté tal cual y el resultado es `True` y `False`. En una aplicación real lo verías como una reserva que «desaparece» de una colección después de cancelarla.

## Identidad en la entidad, valor en el valor

La versión correcta separa los dos conceptos:

```csharp
// A value: two ranges with the same start and end are the same range.
public readonly record struct TimeRange(DateTimeOffset Start, DateTimeOffset End);

// An entity: the same booking whenever the Id is the same.
public sealed class Booking(Guid id, string roomName, TimeRange range) : IEquatable<Booking>
{
    public Guid Id { get; } = id;

    public bool IsCancelled { get; private set; }

    public void Cancel() => IsCancelled = true;

    public bool Equals(Booking? other) => other is not null && Id == other.Id;

    public override bool Equals(object? obj) => Equals(obj as Booking);

    public override int GetHashCode() => Id.GetHashCode();
}
```

Ahora los resultados cambian: dos reservas con los mismos datos y distinto `Id` no son iguales, la reserva cancelada se sigue encontrando en el diccionario y dos `TimeRange` con los mismos extremos sí son iguales.

Aquí la identidad es un `Guid`. Entity Framework Core hace la misma separación: la entidad lleva una clave y los value objects se guardan como *complex types*, que se comparan por valor. Ya los vimos en el [post sobre value objects](/2026-11-12-value-objects-sin-ceremonia).

## El contexto decide

Algo puede ser una entidad en un sitio y un valor en otro. La sala es una entidad en el contexto de reservas: tiene un identificador, una capacidad y se cierra o se abre. En el contexto de recordatorios, en cambio, la sala es solo un nombre dentro de un `DueReminder`, un texto que se imprime en el aviso. Cada [bounded context](/2026-11-24-bounded-context-donde-acaba-tu-modelo) contesta distinto a la pregunta de identidad.

## Cuándo no darle vueltas

La guía de Azure da un punto de partida práctico: «Prefer value objects as your default modeling choice. Only promote a concept to an entity when you need to track its identity over time». Empieza por un valor y pásalo a entidad cuando necesites seguirlo en el tiempo: ver sus cambios, cancelarlo, buscarlo por un identificador. Y no todo tiene que ser una de las dos: los DTO y los modelos de lectura no son ni entidad ni value object.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`11-identity`](https://github.com/MookieFumi/concept-pills/tree/main/11-identity) de concept-pills.
