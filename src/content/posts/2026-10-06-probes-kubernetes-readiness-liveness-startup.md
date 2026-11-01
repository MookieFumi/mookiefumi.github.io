---
title: "Readiness, liveness y startup: a quién preguntar y qué"
subtitle: Una probe mal apuntada convierte una caída de la base de datos en reinicios en cadena
description: "Las tres probes de Kubernetes (startup, readiness y liveness): qué hace el clúster cuando falla cada una, contra qué endpoint apuntarlas, los errores típicos y sus parámetros, con el ejemplo de una API .NET con Aspire."
date: 2026-10-06
topic: k8s
published: false
---

En los posts de Aspire salieron las probes de pasada: `/health` para una, `/alive` para otra, y una tercera que [entry-hub](https://github.com/MookieFumi/entry-hub) no usa. Aquí van las tres juntas, con lo que importa: qué hace Kubernetes cuando una falla y, por tanto, qué debe comprobar cada una.

## Las tres probes

Una probe es una comprobación que el kubelet, el agente de Kubernetes en cada nodo, hace contra un contenedor cada cierto tiempo. Lo normal es una petición HTTP (cualquier código entre 200 y 399 cuenta como bien), pero también puede abrir un puerto TCP, ejecutar un comando dentro del contenedor o llamar a un servicio gRPC.

| Probe | Pregunta | Si falla |
|---|---|---|
| Startup | ¿Ha terminado de arrancar? | Mientras no pase, las otras dos no se ejecutan. Si se agota su margen, Kubernetes reinicia el contenedor |
| Readiness | ¿Puede atender peticiones ahora mismo? | El pod sale del Service y deja de recibir tráfico. El contenedor sigue corriendo |
| Liveness | ¿Sigue vivo el proceso? | Kubernetes reinicia el contenedor |

La diferencia que más se olvida es la de las dos últimas. La readiness aparta el pod y espera, y la liveness lo reinicia. Por eso cada una tiene que comprobar cosas distintas.

## Contra qué endpoint va cada una

**Liveness, contra algo barato y sin dependencias.** Solo tiene que fallar cuando reiniciar arregla el problema: el proceso colgado, un bloqueo interno, una aplicación que ya no contesta. En entry-hub es `/alive`, que solo ejecuta los health checks marcados como `live`, y el único es uno que siempre responde bien si el proceso contesta. Si la liveness comprobara la base de datos, una caída de PostgreSQL reiniciaría todos los pods de la API, y reiniciar no arregla la base de datos.

**Readiness, contra lo que el pod necesita para atender.** En entry-hub es `/health`, que ejecuta todos los health checks, PostgreSQL incluido. Si la base de datos no contesta, el pod deja de recibir tráfico. Cuando vuelve, el pod vuelve solo, sin reiniciarse.

Esta tiene un matiz. Si la dependencia es compartida, como una única base de datos, cuando se cae fallan las readiness de todos los pods a la vez y el Service se queda sin ninguno. El cliente ya no recibe un `503` con `Retry-After` de la API: recibe un error de conexión. Hay equipos que por eso dejan las dependencias compartidas fuera de la readiness y prefieren que la API conteste el error. Las dos opciones son defendibles, pero conviene elegir sabiendo lo que pasa.

**Startup, contra el mismo endpoint que la liveness, con más margen.** Pregunta lo mismo, "¿estás vivo?", pero solo durante el arranque y con paciencia. Su margen es `failureThreshold × periodSeconds`: con 30 intentos cada 2 segundos, el contenedor tiene un minuto para arrancar antes de que Kubernetes lo dé por perdido. Es para servicios que tardan en arrancar, y evita tener que poner un `initialDelaySeconds` enorme en la liveness. entry-hub no la necesita porque lo lento, aplicar las migraciones, lo hace un init container antes de que arranque la API.

## Errores típicos

- **Comprobar la base de datos en la liveness.** Es el que más duele, porque convierte una caída de la base de datos en reinicios en cadena.
- **Meter servicios de terceros en la readiness.** Si una API externa va lenta, todos tus pods salen del Service a la vez. Un fallo ajeno se convierte en una caída tuya.
- **Checks lentos.** El `timeoutSeconds` por defecto es de un segundo. Un `/health` que hace consultas pesadas falla por tiempo aunque todo esté bien.
- **Probes con autenticación.** El kubelet no manda tokens. Si el endpoint pide uno, la probe falla siempre.
- **La misma URL para todo.** Si readiness y liveness apuntan a `/health`, la liveness hereda todas las dependencias, y con ellas el primer error de esta lista.
- **Exponer las probes por el ingress.** Son para el clúster. Que respondan solo `Healthy` o `Unhealthy` y que no salgan hacia fuera.

## Los parámetros

| Parámetro | Qué hace | Por defecto en Kubernetes | Lo que pone Aspire en entry-hub |
|---|---|---|---|
| `initialDelaySeconds` | Espera antes de la primera comprobación | 0 | 5 |
| `periodSeconds` | Cada cuánto comprueba | 10 | 5 |
| `timeoutSeconds` | Cuánto espera la respuesta | 1 | 1 |
| `failureThreshold` | Fallos seguidos antes de actuar | 3 | 3 |
| `successThreshold` | Aciertos seguidos para volver a estar bien (en liveness y startup solo puede ser 1) | 1 | 1 |

Con los valores de entry-hub, un pod deja de recibir tráfico unos quince segundos después de que PostgreSQL deje de contestar: tres fallos, uno cada cinco segundos. En el [post de Kubernetes de la serie de Aspire](/2026-10-05-aspire-kubernetes-helm-kind#las-probes-otra-vez) está cómo salen esos valores del AppHost y cómo cambiarlos con `WithHttpProbe`.

Como punto de partida, para una API con una base de datos:

- Liveness contra un endpoint sin dependencias, con los valores por defecto.
- Readiness contra el endpoint que comprueba lo que el pod necesita, con un `timeoutSeconds` que cubra la consulta más lenta del check.
- Startup solo si el arranque tarda más que la paciencia de la liveness, contra el mismo endpoint que esta y con un `failureThreshold` alto.

## Resumiendo

- La startup protege el arranque, la readiness decide el tráfico y la liveness decide los reinicios.
- La liveness no comprueba dependencias, la readiness comprueba las que el pod necesita para atender, y la startup pregunta lo mismo que la liveness con más paciencia.
- Antes de añadir algo a una probe, pregúntate qué hará Kubernetes cuando falle. Si la respuesta es reiniciar y el reinicio no arregla nada, no va en la liveness.
