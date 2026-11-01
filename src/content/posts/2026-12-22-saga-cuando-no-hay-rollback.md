---
title: "Saga: cuando no puedes hacer rollback porque ya han pasado cosas"
subtitle: Reservas la sala, el catering falla, y la sala se queda bloqueada para una reserva que nunca existió
description: "Qué es una saga y cómo implementar una orquestada en C#: transacciones locales y compensaciones, ejemplo de reserva de sala con catering, orquestación frente a coreografía, estados de fallo, aislamiento y cuándo evitarla."
date: 2026-12-22
topic: desarrollo
series: concepts
published: false
---

Reservar una sala con catering son dos pasos en dos servicios: bloquear la sala y encargar la comida. Si el segundo falla, el primero ya ocurrió. No hay un `ROLLBACK` que cruce las dos bases de datos, y la sala se queda bloqueada para una reserva que no llegó a existir.

## Qué pasa sin nada que deshaga

La demo hace exactamente eso:

```csharp
rooms.Hold(bookingId);
catering.Order(bookingId);   // throws: the caterer cannot serve this room
```

Salida: `Room still held by a booking that never completed: True`. Cada servicio hizo su transacción local correctamente. Lo que falta es una forma de decir «el conjunto no ha salido bien, deshaz lo anterior».

## De dónde viene

La idea es anterior a los microservicios. Hector Garcia-Molina y Kenneth Salem la propusieron en 1987 en el artículo «SAGAS», para un problema de una sola base de datos: las transacciones largas retienen recursos durante mucho tiempo y retrasan las transacciones cortas y más comunes, y su propuesta fue dividirlas. Una saga, según el resumen del informe, es una transacción larga que puede escribirse como secuencia de transacciones intercaladas con otras, y el sistema garantiza que o se completan todas o se ejecutan transacciones compensatorias que corrigen la ejecución parcial.

La adaptación a servicios es la que cita Chris Richardson: «A saga is a reliably coordinated sequence of local transactions». No la atribuyo a los autores de 1987, que hablaban de otra cosa.

## Compensar no es hacer rollback

Un rollback borra como si no hubiera pasado. Una compensación es otra transacción de negocio que contrarresta la anterior: liberar la sala, anular el pedido. Y puede fallar. Microsoft lo dice: las transacciones compensatorias pueden no tener éxito y dejar el sistema inconsistente. Richardson añade dos retos: no hay rollback automático, así que el desarrollador debe diseñar las compensaciones, y falta aislamiento (la «I» de ACID), de modo que hay que aplicar contramedidas.

## Un orquestador con compensaciones

En la demo, cada paso lleva su acción y su compensación, y un orquestador los ejecuta en orden:

```csharp
new SagaStep("Hold room", () => rooms.Hold(bookingId), () => rooms.Release(bookingId)),
new SagaStep("Order catering", () => catering.Order(bookingId), () => { }),
```

Si un paso falla, el orquestador deshace los ya completados en orden inverso. Con el catering fallando, salida: `Saga status: Cancelled` y `Room still held: False`. Y la demo prueba el caso feo: si también falla la liberación de la sala, el estado es `CompensationFailed`. No se hace pasar por cancelada una saga que dejó la sala bloqueada. Microsoft lo recomienda en su patrón Scheduler Agent Supervisor: estados distintos para «compensación en curso, completada o fallida» en lugar de un único «error». Alguien tendrá que mirar ese estado.

## Orquestación o coreografía

Richardson distingue dos formas. En la coreografía, cada transacción local publica eventos que disparan las transacciones locales de otros servicios. En la orquestación, un orquestador dice a los participantes qué transacción local ejecutar, como en la demo. Según Microsoft, la coreografía es buena para flujos simples, con el riesgo de dependencias cíclicas; la orquestación es mejor para flujos complejos, a costa de un punto de fallo y de lógica de coordinación en un sitio.

## La ventana en la que se ve a medias

Mientras la saga corre, otros ven estados intermedios. Microsoft describe las anomalías (lost updates, dirty reads, fuzzy reads) y contramedidas como el bloqueo semántico, que marca el registro como «pendiente» para que nadie lo trate como definitivo. En el ejemplo, la reserva sería `Pending` hasta que la saga termine. Eso encaja con los estados de la demo (`Pending`, `Confirmed`, `Cancelled`).

Microsoft clasifica además las transacciones de una saga: las compensables, el punto de no retorno (*pivot*) y las reintentables, que deben ser idempotentes. En el ejemplo, reservar sala y pedir catering son compensables mientras el catering no se prepare, y confirmar el cobro sería el punto de no retorno. Esa clasificación es del ejemplo; no viene del artículo de 1987.

## Cuándo no

Si los pasos viven en una misma base de datos, una transacción normal es más simple y más fiable. Si puedes agrupar la operación en un único agregado, ídem. Una saga es el último recurso, cuando la operación cruza servicios que no pueden compartir transacción, y exige diseñar compensaciones, idempotencia y estados de fallo. Antes de montar una, pregúntate si esos dos pasos tienen que estar en servicios distintos.

El código de las dos versiones, para ejecutar y comparar, está en la carpeta [`22-saga`](https://github.com/MookieFumi/concept-pills/tree/main/22-saga) de concept-pills.
