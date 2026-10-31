---
title: "Tu carpeta Services tiene un problema (y no es el nombre)"
subtitle: Añadir una funcionalidad te obliga a abrir cinco carpetas, y quizá el problema es cómo las has dibujado
description: "Arquitectura por capas, hexagonal y clean frente a vertical slice en C#: qué dice Cockburn, Martin y Bogard, una demo con 'reservar con catering' contando qué ficheros toca cada estilo y cuánta arquitectura necesita un CRUD."
date: 2026-12-06
topic: desarrollo
series: concepts
published: false
---

Te piden «reservar con catering». Es una funcionalidad pequeña: se elige un menú al reservar. Y acabas abriendo el controlador, el servicio y su interfaz, el modelo, un DTO nuevo y el `Program`. Seis ficheros en cinco sitios distintos para un solo cambio.

## Lo que cuesta una funcionalidad por capas

Con la organización clásica, cada carpeta agrupa por tipo técnico: `Controllers`, `Services`, `Repositories`, `Models`, `Dtos`. En la demo, buscar `Catering` en la versión por capas da esto:

```
before/Controllers/BookingsController.cs
before/Dtos/ReserveWithCateringRequest.cs
before/Models/Booking.cs
before/Program.cs
before/Services/BookingService.cs
before/Services/IBookingService.cs
```

Seis ficheros. Cuatro eran existentes, que hubo que modificar, y entre ellos `Booking`, que ahora lleva un `CateringMenu` que no le sirve a quien solo reserva sala. Todo lo relacionado con catering está esparcido por carpetas que no se llaman «catering».

## Tres formas de dibujarlo

Esto no es nuevo, y cada estilo lo plantea distinto.

**Hexagonal.** Alistair Cockburn la describió con la intención de permitir que una aplicación sea usada igual por usuarios, programas, pruebas automáticas o scripts, y que se desarrolle y pruebe «in isolation from its eventual run-time devices and databases». El dominio queda en el centro y habla con el exterior por puertos, con un adaptador por cada actor externo. Y sobre el nombre, Cockburn aclara que el hexágono no es un hexágono porque el seis importe: es para dejar espacio al dibujar puertos y adaptadores, sin la limitación de un dibujo en capas de una sola dimensión.

**Clean.** Robert C. Martin (2012) la presenta como una forma de reunir varias ideas anteriores (hexagonal, onion, screaming). Su regla es la *Dependency Rule*: «source code dependencies can only point inwards. Nothing in an inner circle can know anything at all about something in an outer circle». Los círculos son un esquema: «you may find that you need more than just these four».

**Vertical slice.** Jimmy Bogard propone organizar alrededor de peticiones en lugar de capas, agrupando todo lo de cada una, del front-end a la base de datos. Su resumen: «Minimize coupling between slices, and maximize coupling in a slice».

## La misma funcionalidad por slices

En la versión por slices, cada funcionalidad es una carpeta (`Reserve`, `Cancel`, `ReserveWithCatering`) con su petición y su manejador. Al buscar `Catering`:

```
after/Features/ReserveWithCatering/ReserveWithCateringHandler.cs
after/Features/ReserveWithCatering/ReserveWithCateringRequest.cs
after/Program.cs
```

Dos ficheros nuevos en una carpeta, más la línea para registrarlo en `Program`. No hubo que tocar `Booking`, porque el menú vive dentro del slice. Es el efecto que describe Bogard: la mayoría de las abstracciones «melt away» y no necesitas capas compartidas como repositorios, servicios o controladores, aunque a veces las herramientas los pidan.

Ojo con lo que esto no demuestra. Es una demo pequeña con una funcionalidad sencilla, y no hay ninguna fuente que cuantifique la productividad de un estilo frente a otro. Lo que sí enseña es el coste de cambio, que se puede contar tú mismo con un `grep`.

## Lo que protege cada estilo

La hexagonal protege otra cosa: que el dominio no dependa de la base de datos ni del framework, y que se pueda probar sin ellos. En el ejemplo de la demo, con un `BookingStore` en memoria no se nota, pero en cuanto el almacenamiento sea una base de datos real o una API externa, esa separación vale lo que cuesta. El vertical slice protege el coste de cambiar una funcionalidad concreta.

No son enemigos. Bogard describe el vertical slice como tomar una arquitectura «n-tier or hexagonal/whatever» y quitar las barreras entre las capas, y esa estructura puede vivir dentro de un slice cuando lo necesita. Aun así, también presenta el slice como alternativa a las arquitecturas tipo clean u onion: según él, esas capas solo encajan bien en una minoría de las peticiones de un sistema típico, y cuenta que su equipo abandonó una onion architecture a los pocos meses. Hay debate de verdad, y no una respuesta única.

## Cuánta arquitectura necesita un CRUD

Para un CRUD sin reglas, el menor coste lo da un slice con un manejador directo, o incluso un endpoint que hable con `DbContext`. Bogard lo dice con una condición: empezar simple («Transaction Script») y refactorizar hacia los patrones que aparezcan al oler el código. Y avisa de a quién no le sirve: si tu equipo no sabe cuándo un servicio hace demasiado y mover la lógica al dominio, «this pattern is likely not for you».

La hexagonal compensa cuando hay un dominio con reglas (como los agregados de la serie anterior) o varios adaptadores para lo mismo: una base de datos y otra en memoria para pruebas, dos proveedores de calendario. Si no los hay, los puertos y adaptadores son carpetas y ficheros que mantener sin que alguien los use.

## Una pregunta para decidir

Antes de elegir, cuenta: para tu último cambio, ¿cuántos ficheros tocaste y en cuántas carpetas? Si siempre abres las mismas cinco, quizá tu estructura agrupa por lo que el código es y no por lo que el negocio pide.

El código de las dos versiones está en la carpeta [`16-layers-vs-slices`](https://github.com/MookieFumi/concept-pills/tree/main/16-layers-vs-slices) de concept-pills.
