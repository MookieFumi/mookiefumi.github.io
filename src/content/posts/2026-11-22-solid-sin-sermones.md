---
title: "SOLID sin sermones: dos principios y una regla nueva"
subtitle: Un validador con cuatro reglas en un método funciona hasta que llega la quinta, y entonces toca decidir si vale la pena separarlas
description: "SRP y DIP en C# con un ejemplo de validación de reservas de salas: qué dice Robert C. Martin sobre las razones para cambiar, cómo añadir una regla sin tocar las demás y cuándo cuatro clases para cuatro if es sobreingeniería."
date: 2026-11-22
topic: desarrollo
series: concepts
published: false
---

El validador de reservas tiene cuatro reglas: duración mínima, duración máxima, solo de lunes a viernes y capacidad de la sala. Todas viven en el mismo método:

```csharp
public sealed class BookingValidator
{
    public List<string> Validate(BookingCandidate candidate)
    {
        var violations = new List<string>();
        var duration = candidate.EndAt - candidate.StartAt;

        if (duration < TimeSpan.FromMinutes(15))
        {
            violations.Add("A booking lasts at least 15 minutes.");
        }

        if (duration > TimeSpan.FromHours(4))
        {
            violations.Add("A booking lasts at most 4 hours.");
        }

        if (candidate.StartAt.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
        {
            violations.Add("Rooms are booked Monday to Friday.");
        }

        if (candidate.Attendees > candidate.RoomCapacity)
        {
            violations.Add("The room is too small.");
        }

        return violations;
    }
}
```

Para una reserva de seis horas un sábado, para 20 personas en una sala de 12, devuelve tres mensajes:

```text
A booking lasts at most 4 hours.
Rooms are booked Monday to Friday.
The room is too small.
```

Funciona. Y llega la quinta regla: no se puede reservar en festivos.

## Qué cambia cuando llega la quinta

Hay que abrir `Validate`, añadir otro `if` y volver a probar las otras cuatro, porque comparten método y comparten la lista `violations`. Cada regla nueva toca el mismo sitio. Tampoco hay forma de probar la regla de capacidad sin pasar por las demás.

Aquí es donde entra el primer principio de SOLID. Robert C. Martin lo describió en 2014 así:

> The Single Responsibility Principle (SRP) states that each software module should have one and only one reason to change.

Y en el mismo artículo aclara qué entiende por «razón»: «This principle is about people». Los cambios los piden personas, y un módulo debería responder a una sola de ellas, o a un grupo con una única función de negocio. En el validador conviven razones distintas: quien decide la duración de las reuniones, quien decide el calendario laboral y quien gestiona la capacidad de las salas. Cada una pide cambios por su cuenta, y el método los recibe todos.

## Una regla, una clase

La solución es que cada regla sea un objeto con una interfaz común, y que el validador solo las ejecute:

```csharp
public interface IBookingRule
{
    string? Check(BookingCandidate candidate);
}

public sealed class WeekdayRule : IBookingRule
{
    public string? Check(BookingCandidate candidate)
    {
        return candidate.StartAt.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday ? "Rooms are booked Monday to Friday." : null;
    }
}

public sealed class BookingValidator(IEnumerable<IBookingRule> rules)
{
    public IReadOnlyList<string> Validate(BookingCandidate candidate)
    {
        return [.. rules.Select(rule => rule.Check(candidate)).OfType<string>()];
    }
}
```

`MinimumDurationRule`, `MaximumDurationRule` y `CapacityRule` siguen el mismo patrón. El validador ya no sabe cuántas reglas hay ni cuáles son: recibe una lista. Esto es la inversión de dependencias, el segundo principio: `BookingValidator` depende de la abstracción `IBookingRule` y no de las reglas concretas.

La salida con la misma reserva de antes es idéntica. Lo que cambia es cómo crece. La regla de festivos pasa a ser una clase nueva, `HolidayRule`, y una línea donde se construye la lista:

```csharp
var validator = new BookingValidator([new MinimumDurationRule(), new MaximumDurationRule(), new WeekdayRule(), new CapacityRule(), new HolidayRule()]);
```

No se toca ninguna de las otras cuatro, y cada regla se prueba sola. Es el efecto que busca el principio abierto/cerrado de Bertrand Meyer, que Martin resume como que debería ser fácil cambiar el comportamiento de un módulo sin cambiar su código fuente. Él mismo matizó en 2013 que su formulación de 1996 era algo exagerada: no significa que nunca vayas a tocar el código de un módulo.

## Cuándo es demasiado

Cuatro clases para cuatro `if` son, a menudo, una mala compra. Si las reglas son estables y nadie las toca en años, el método original es más corto, se lee de arriba abajo y se entiende de un vistazo. Separar tiene un coste: más ficheros, más nombres y una lista que alguien debe acordarse de montar.

Un criterio práctico es esperar a que duela. Con dos reglas estables, un `if` está bien. Cuando una regla nueva te obliga a tocar un método que ya habías tocado por otra regla, o cuando no puedes probar una sin arrastrar las demás, ese es el momento de separar.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`07-solid`](https://github.com/MookieFumi/concept-pills/tree/main/07-solid) de concept-pills.
