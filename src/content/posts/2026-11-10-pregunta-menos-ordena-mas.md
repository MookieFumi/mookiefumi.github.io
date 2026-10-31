---
title: "Pregunta menos, ordena más: quién debe saber si algo encaja"
subtitle: Si cada sitio que necesita saber si una sala sirve repite la misma condición, la regla no vive en ningún sitio
description: "Tell, don't ask y la ley de Demeter en C# con un ejemplo de reservas de salas: cómo mover una condición repetida al objeto que tiene los datos, de dónde vienen estos principios y cuándo no aplicarlos."
date: 2026-11-10
topic: desarrollo
series: concepts
published: false
---

¿Sirve esta sala para esta reserva? Para contestarlo hay que mirar si la sala está activa, si caben los asistentes y si tiene el equipamiento que se pidió. En muchas bases de código esa respuesta es una condición de tres líneas, escrita donde hizo falta y copiada donde volvió a hacer falta.

## La condición que se copia

Así se ve cuando quien pregunta recorre el objeto por dentro:

```csharp
var fits = booking.Room.IsActive
    && booking.Attendees <= booking.Room.Capacity
    && booking.RequiredEquipment.All(item => booking.Room.Equipment.Contains(item));
```

El código que llama conoce tres cosas que no debería. Sabe que una reserva tiene una sala, que la sala tiene una lista de equipamiento y que «encajar» significa esa combinación de comprobaciones. Si mañana una sala puede estar en mantenimiento, hay que encontrar todos los sitios donde alguien escribió esta condición y cambiarlos. Si se olvida uno, el sistema acepta reservas en una sala cerrada.

## Decirle a la sala

La alternativa es pedirle al objeto que tiene los datos que haga la comprobación:

```csharp
public sealed class Room(string name, int capacity, IEnumerable<string> equipment, bool isActive = true)
{
    private readonly HashSet<string> _equipment = [.. equipment];

    public bool CanHost(int attendees, IReadOnlyCollection<string> requiredEquipment)
    {
        return isActive
            && attendees <= capacity
            && requiredEquipment.All(_equipment.Contains);
    }
}

public sealed class Booking(Room room, int attendees, IReadOnlyCollection<string> requiredEquipment)
{
    public bool Fits()
    {
        return room.CanHost(attendees, requiredEquipment);
    }
}
```

Quien llama escribe `booking.Fits()`. La lista de equipamiento es ahora privada, así que nadie puede recorrerla desde fuera, y la regla está en un solo método. La salida es la misma que antes (`Fits: True`), pero el día que una sala pueda estar en mantenimiento, se cambia `CanHost` y todos los llamadores lo reciben.

## Lo que ganas al probar

La regla ahora se prueba sin montar reservas. Una sala de 12 plazas con vídeo y pizarra responde `true` para 10 personas que piden vídeo, `false` para 13 personas y `false` si pides un equipamiento que no tiene. Tres líneas de test cubren lo que antes dependía de que cada llamador copiara bien la condición. Y si una sala puede estar inactiva, otra línea cubre ese caso en el único sitio donde existe la regla.

## De dónde vienen estos principios

El nombre «Tell, don't ask» lo popularizaron Andy Hunt y Dave Thomas. En un boletín de 1998, Hunt recoge una frase de Alec Sharp que lo resume:

> Procedural code gets information then makes decisions. Object-oriented code tells objects to do things.

La ley de Demeter es anterior y tiene otro origen. Se formuló en la Northeastern University en 1987, en el proyecto Demeter, y se publicó en OOPSLA '88 (Lieberherr, Holland y Riel). La idea es que un método solo debería hablar con sus colaboradores cercanos y no con los objetos que cuelgan de ellos. `booking.Room.Equipment.Contains(...)` es justo lo contrario: atraviesa tres niveles.

## Los límites

Ninguno de los dos es una norma absoluta. En 2013, Martin Fowler escribió que personalmente no usa Tell, don't ask, y el propio paper de Demeter reconoce que seguir la ley obliga a escribir más métodos. En el ejemplo se nota: `Room` ha ganado `CanHost`, `Booking` ha ganado `Fits`, y si hay diez preguntas distintas sobre una sala, la clase crece.

Tampoco tiene sentido en todas partes. Un registro de datos que viaja de la base de datos a una respuesta HTTP no tiene reglas que proteger, y preguntarle por sus campos es lo normal. Lo mismo pasa con una consulta que solo muestra información. Según mi criterio, y las fuentes no lo dicen, las APIs fluidas como `query.Where(...).Select(...)` tampoco rompen la idea, porque cada llamada devuelve el mismo tipo de objeto y no se asoma al interior de otro.

La señal para actuar es la repetición: cuando la misma condición aparece en dos sitios y alguna vez tendrás que cambiarla, ese es el momento de preguntarte quién debería saber la respuesta.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`03-tell-dont-ask`](https://github.com/MookieFumi/concept-pills/tree/main/03-tell-dont-ask) de concept-pills.
