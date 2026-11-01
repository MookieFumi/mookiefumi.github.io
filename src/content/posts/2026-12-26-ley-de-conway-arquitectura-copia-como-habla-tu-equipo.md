---
title: "Ley de Conway: tu arquitectura copia cómo habla tu equipo"
subtitle: Añadir catering a una reserva necesita la firma de tres equipos si los equipos son las capas, y de uno si son las funcionalidades
description: "Qué dice la ley de Conway, de dónde viene y qué evidencia hay: 'How Do Committees Invent?' (1968), Fowler, el Inverse Conway Maneuver, un ejemplo con CODEOWNERS sobre reservas de salas y los límites de reorganizar equipos para cambiar una arquitectura."
date: 2026-12-26
topic: desarrollo
series: concepts
published: false
---

Te piden añadir catering a las reservas. En el repositorio, el cambio toca el controlador, el servicio, el modelo y un DTO. Y cada carpeta tiene un equipo propietario. Para cerrar una funcionalidad pequeña, tres equipos tienen que revisar.

## Lo que dice el fichero CODEOWNERS

En la demo hay un fichero `CODEOWNERS` con los equipos organizados por capa técnica, como en la versión por capas de la [píldora de arquitecturas](/2026-12-10-tu-carpeta-services-tiene-un-problema):

```
Controllers/ api-team
Dtos/ api-team
Services/ domain-team
Models/ domain-team
Repositories/ data-team
```

Con los seis ficheros que tocó «reservar con catering» en la demo, el programa calcula los equipos que deben revisar: `3 (api-team, domain-team, platform-team)`. Con la versión por funcionalidades, donde el catering tiene su propia carpeta y su equipo, el resultado es `2 (catering-team, platform-team)`, y el equipo de plataforma solo aparece por la línea que registra el manejador en `Program`.

Esto es un ejemplo ilustrativo, no una medición, pero enseña lo que enuncia Conway: la estructura del código y la de los equipos tiran una de la otra.

## La ley original

Melvin Conway la publicó en abril de 1968 en *Datamation*, en un artículo titulado «How Do Committees Invent?». La tesis está en la conclusión: las organizaciones que diseñan sistemas «are constrained to produce designs which are copies of the communication structures of these organizations». Décadas después, en una nota de autor, lo reformuló en una versión más conocida: toda organización que diseña un sistema producirá inevitablemente un diseño cuya estructura es una copia de su estructura de comunicación.

Dos detalles que se pierden. El primero: habla de estructura de comunicación, no de organigrama, aunque en el propio artículo señala que las organizaciones de estilo militar diseñan sistemas que se parecen a su organigrama. El segundo: Conway comenta con humor que lo más notable de su artículo es que llegó a publicarse con la tesis en el antepenúltimo párrafo.

El nombre de «ley de Conway» lo puso Fred Brooks en *The Mythical Man-Month*, según cuenta Martin Fowler.

## ¿Es una ley?

Fowler la trata como una observación poderosa con base anecdótica. Hay un estudio empírico: MacCormack, Baldwin y Rusnak (*Research Policy*, 2012) concluyen que los productos tienden a reflejar las arquitecturas de las organizaciones que los desarrollan, porque las estructuras de gobierno, las rutinas de resolución de problemas y los patrones de comunicación limitan el espacio en el que se buscan nuevas soluciones. Es evidencia a favor del espejo en una muestra concreta, no una demostración de cada afirmación del tipo «equipos igual a microservicios». No lo tomaría como más que eso.

Fowler añade el efecto práctico: si diseñas una arquitectura en contra de la estructura de tu organización de desarrollo, aparecen tensiones en la estructura del software.

## Dar la vuelta a la ley

La consecuencia es obvia: si la arquitectura copia a la organización, organiza a la gente para obtener la arquitectura que quieres. Thoughtworks lo llamó *Inverse Conway Maneuver* y lo recomendó en su Radar en 2014 y 2015, en la categoría «Trial», no «Adopt», y hoy ya no está en la edición vigente. Microsoft, en su guía de microservicios para .NET, habla de «reverse»: a veces hay que construir las fronteras como quieres que se organice la empresa. Una nota de vocabulario: el nombre de Fowler y Thoughtworks es *Inverse*.

Fowler avisa de que no es omnipotente. Si tienes un sistema existente con una arquitectura rígida, reorganizar los equipos no basta para cambiarla.

## Conectarlo con lo anterior

Esta serie ya apuntaba a la ley sin nombrarla. Un [bounded context](/2026-11-28-bounded-context-donde-acaba-tu-modelo) se delimita muchas veces por la cultura de un grupo de personas, porque el lenguaje cambia donde cambia quien lo habla. Un módulo de un [monolito modular](/2026-12-12-monolito-modular-fronteras-sin-red) con propietario evita que catering decida sobre reservas. Un slice con dueño es una funcionalidad que un equipo puede terminar sin pedir permiso a otros tres.

## Cuándo la ley te ayuda y cuándo no

Te ayuda como diagnóstico. Si cada cambio pequeño cruza equipos, o dos equipos se pisan en el mismo módulo, o hay un sitio al que todo el mundo tiene que ir, mira antes la organización que el código. Y te ayuda como diseño: antes de partir un sistema en servicios, pregúntate quién los va a mantener.

No te ayuda como excusa. Los equipos no se reorganizan por un diagrama, y el coste de mover personas es real. Tampoco como regla de conducta: «un equipo, un microservicio» es una lectura posible, no lo que dice Conway.

Si hoy tuvieras que ordenar el código por quién tiene que hablar con quién para terminar una funcionalidad, ¿cómo quedaría tu estructura de carpetas?

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`24-conway`](https://github.com/MookieFumi/concept-pills/tree/main/24-conway) de concept-pills.
