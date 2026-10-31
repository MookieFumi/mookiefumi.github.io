---
title: "Herencia o composición sin dogmas: cuándo cada una"
subtitle: La sala de Berlín tiene videoconferencia y pizarra, y tu jerarquía de clases solo sabe de una de las dos
description: "Cuándo usar herencia y cuándo composición en C#, con un ejemplo de salas de reuniones que se ejecuta: qué se rompe con la herencia, qué dice el libro de GoF y tres preguntas para decidir."
date: 2026-11-06
topic: desarrollo
series: concepts
published: false
---

Tienes una aplicación para reservar salas de reuniones. Hay salas con videoconferencia y salas con pizarra, así que creas dos clases que heredan de `Room`. Funciona hasta que alguien pide la sala de Berlín, que tiene las dos cosas.

## Lo que pasa con la herencia

Esto es lo que tienes:

```csharp
public abstract class Room(string name, int capacity)
{
    public string Name { get; } = name;

    public int Capacity { get; } = capacity;
}

public class VideoConferenceRoom(string name, int capacity) : Room(name, capacity)
{
    public string StartCall(string meetingLink)
    {
        return $"{Name}: call started at {meetingLink}";
    }
}

public class WhiteboardRoom(string name, int capacity) : Room(name, capacity)
{
    public string CaptureWhiteboard()
    {
        return $"{Name}: whiteboard captured";
    }
}
```

C# solo deja heredar de una clase. Berlín no puede ser a la vez `VideoConferenceRoom` y `WhiteboardRoom`, así que creas una tercera, `VideoConferenceWhiteboardRoom`, y copias dentro los dos métodos. Para usar el equipamiento, el código que recibe una `Room` tiene que averiguar de qué clase concreta se trata:

```csharp
foreach (var room in rooms)
{
    switch (room)
    {
        case VideoConferenceWhiteboardRoom both:
            Console.WriteLine(both.StartCall("https://meet.example/berlin"));
            Console.WriteLine(both.CaptureWhiteboard());
            break;
        case VideoConferenceRoom video:
            Console.WriteLine(video.StartCall("https://meet.example/lisbon"));
            break;
        case WhiteboardRoom whiteboard:
            Console.WriteLine(whiteboard.CaptureWhiteboard());
            break;
    }
}
```

Con tres salas la salida es la esperada. El problema aparece al crecer: con un tipo de equipamiento nuevo, por ejemplo una pantalla interactiva, necesitas una clase por cada combinación posible. Con `n` tipos son `2ⁿ` combinaciones, y con tres ya son ocho. Cada combinación repite código y añade un `case` a cada `switch` de la aplicación.

## La composición

La alternativa es que la sala *tenga* su equipamiento en lugar de *ser* un tipo concreto de sala:

```csharp
public interface IEquipment
{
    string Name { get; }
}

public sealed class Room(string name, int capacity, params IEquipment[] equipment)
{
    public string Name { get; } = name;

    public int Capacity { get; } = capacity;

    public IReadOnlyCollection<IEquipment> Equipment { get; } = equipment;

    public T? Find<T>() where T : class, IEquipment
    {
        return Equipment.OfType<T>().FirstOrDefault();
    }
}
```

`VideoSystem` y `Whiteboard` implementan `IEquipment` y cada una guarda su comportamiento. Ahora Berlín no necesita una clase propia:

```csharp
var rooms = new[]
{
    new Room("Lisbon", 8, new VideoSystem()),
    new Room("Madrid", 6, new Whiteboard()),
    new Room("Berlin", 12, new VideoSystem(), new Whiteboard()),
};

foreach (var room in rooms)
{
    if (room.Find<VideoSystem>() is { } video)
    {
        Console.WriteLine($"{room.Name}: {video.StartCall($"https://meet.example/{room.Name.ToLowerInvariant()}")}");
    }

    if (room.Find<Whiteboard>() is { } whiteboard)
    {
        Console.WriteLine($"{room.Name}: {whiteboard.Capture()}");
    }
}
```

Las tres salas hacen lo mismo que con la jerarquía. Una pantalla interactiva pasa a ser una clase más y una línea al construir la sala, sin tocar `Room` ni los bucles que ya existen.

## Lo que dice el origen

El consejo viene de *Design Patterns*, el libro de la «banda de los cuatro» (Gamma, Helm, Johnson y Vlissides). En el capítulo 1 lo presentan como su segundo principio de diseño:

> Favor object composition over class inheritance.

La razón que dan es que la herencia expone al hijo a los detalles de la clase padre («inheritance breaks encapsulation»), y que el vínculo se fija al compilar, así que no puedes cambiarlo en tiempo de ejecución. Con la composición los objetos se relacionan solo por su interfaz.

Pocas veces se cita el resto del párrafo. Los propios autores dicen que la composición cuesta algo: hay más objetos y el comportamiento del sistema depende de cómo se relacionan, en lugar de estar definido en una sola clase. Y añaden que la herencia y la composición «trabajan juntas» (en el original, «work together»).

## Cuándo la herencia sigue siendo la respuesta

Heredar tiene sentido cuando la relación es de verdad «es un» y cualquier código que use el padre funciona igual con el hijo. `ArgumentNullException` hereda de `ArgumentException` y nadie se sorprende: un argumento nulo es un argumento inválido. Joshua Bloch defiende lo mismo en *Effective Java*: la herencia de implementación solo se justifica cuando existe un subtipo real, y aun así es frágil si el padre no se diseñó para ser extendido.

En el ejemplo de las salas, heredar de `Room` estaba bien. Lo que falló fue usar la herencia para modelar el equipamiento, que se combina.

## Tres preguntas para decidir

1. ¿Es un «es un» o un «tiene»? Una sala *tiene* pizarra; no *es* una pizarra.
2. ¿Las variantes se combinan? Si una sala puede tener dos cosas a la vez, la herencia simple no da para tanto.
3. ¿Puede cambiar con el tiempo? Si mañana instalan una pantalla en Lisboa, con herencia tendrías que cambiar su clase.

Si las tres respuestas apuntan a «tiene», combinan y cambian, usa composición. Si es un «es un» estable y el padre está pensado para extenderse, hereda sin culpa.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`01-composition`](https://github.com/MookieFumi/concept-pills/tree/main/01-composition) de concept-pills.
