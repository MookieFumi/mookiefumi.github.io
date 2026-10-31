---
title: "Inmutabilidad: lo que ve quien solo quería leer"
subtitle: Un cambio en la reserva que pediste tú acaba en el recordatorio que lee otro, y cuatro trampas de C# que no se ven a simple vista
description: "Inmutabilidad en C# con un ejemplo de reservas de salas: el bug de compartir una referencia mutable, cómo lo evitan los records con with, y cuatro trampas que comprobé ejecutando: copia superficial, IReadOnlyList, arrays dentro de records y el default de ImmutableArray."
date: 2026-11-16
topic: desarrollo
series: concepts
published: false
---

Una caché guarda la reserva «Planning» para las 10:00 con un asistente, `ana`. Dos servicios la piden. El primero la reprograma a las 13:00 y añade a `luis`. El segundo, el de recordatorios, solo quería leerla:

```text
Reminder reads: 13:00, ana,luis
```

El recordatorio no ha pedido ningún cambio y ve la reserva modificada. Nadie ha cometido un error evidente: los dos hicieron su trabajo con el objeto que les dieron.

## El problema es compartir

```csharp
public sealed class Booking
{
    public required string Title { get; set; }

    public DateTimeOffset StartAt { get; set; }

    public List<string> Attendees { get; set; } = [];
}

var forReschedule = cache.Get(id);
forReschedule.StartAt = start.AddHours(3);
forReschedule.Attendees.Add("luis");

var forReminder = cache.Get(id);   // same object
```

`Get` devuelve la misma instancia a quien la pida. Todos mantienen una referencia al mismo objeto, y quien lo cambia lo cambia para todos. Es un fallo de *aliasing*, de varias variables apuntando a lo mismo, y es difícil de encontrar porque el cambio y el efecto ocurren en sitios sin relación entre sí.

Martin Fowler propone una regla simple para evitarlo en sus value objects:

> To avoid aliasing bugs I follow a simple but important rule: value objects should be immutable.

## Cada cambio, un valor nuevo

En C#, un `record` con `with` hace que cambiar sea crear otro:

```csharp
public sealed record Booking(string Title, DateTimeOffset StartAt, ImmutableArray<string> Attendees)
{
    public Booking Reschedule(DateTimeOffset newStart)
    {
        return this with { StartAt = newStart };
    }

    public Booking AddAttendee(string attendee)
    {
        return this with { Attendees = Attendees.Add(attendee) };
    }
}

var changed = original.Reschedule(start.AddHours(3)).AddAttendee("luis");
```

La salida de la demo:

```text
Original: 10:00, ana
Changed:  13:00, ana,luis
```

El original sigue siendo el de las 10:00 con `ana`. Quien reprograma recibe una reserva nueva, y quien solo lee conserva lo que leyó. Ya no hay nada que se pueda cambiar «por debajo».

## Cuatro trampas de C# que comprobé

**`IReadOnlyList` no es inmutable.** Es una vista de solo lectura, no una garantía. La documentación de Microsoft avisa de que el contenido no está garantizado como de solo lectura, porque `List<T>` también lo implementa. En la demo, el que conserva su `List` original puede seguir cambiándola:

```text
IReadOnlyList sees 2 people, ImmutableArray sees 1
```

Por eso la versión de arriba usa `ImmutableArray<string>`, que es una copia y no puede cambiar después.

**`with` copia de forma superficial.** Copia los valores de las propiedades, pero no recalcula nada. Si el record tiene una propiedad calculada al construirse, queda con el valor viejo. Lo comprobé con un `Shape(3, 4)` cuya `Distance` vale 5: al hacer `with { X = 6 }`, la distancia seguía siendo 5. Es un ejemplo que la propia documentación de Microsoft usa. La regla es calcular esos valores bajo demanda y no guardarlos.

**La igualdad del record no mira dentro de un array.** Dos records con arrays de contenido idéntico se comparan como distintos, porque la comparación de un array es por referencia. Lo ejecuté y el resultado es `False`.

**`ImmutableArray<T>` es un `struct`.** Su valor por defecto (`default`) no tiene array dentro, y leer su `Length` lanza `NullReferenceException`. Si lo recibes de un sitio que no controlas, conviene comprobar `IsDefault`.

## Cuándo no

Copiar tiene un coste. En una colección de miles de elementos que se modifica en un bucle, crear una copia por cada cambio es una mala idea, y ahí lo normal es construir con una colección mutable y convertirla a inmutable al final. En el ejemplo de las reservas, con un puñado de asistentes, el coste es irrelevante. No afirmo que sea más rápido ni más seguro con hilos sin haberlo medido: la ventaja que sí he comprobado es que el aliasing desaparece.

Tampoco todo lo que cambia debe ser un record. Un contador, una conexión o una entidad con identidad y ciclo de vida no es un valor, y tiene sentido que mute dentro de sus reglas (como la reserva del post anterior, que se cancela a sí misma).

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`06-immutability`](https://github.com/MookieFumi/concept-pills/tree/main/06-immutability) de concept-pills.
