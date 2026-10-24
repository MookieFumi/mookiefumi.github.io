---
title: "El pod viejo se apagó con trabajo pendiente"
subtitle: Tu rolling update no espera a tus background services
description: "Qué pasa con los trabajos en memoria de una API .NET cuando un rolling update de Kubernetes para el pod viejo: SIGTERM, preStop, el stoppingToken de BackgroundService, ShutdownTimeout y terminationGracePeriodSeconds, medido en un clúster kind."
date: 2026-10-07
topic: k8s
published: false
---

Una API con un solo pod, un rolling update con `maxUnavailable: 0` y, detrás de cada petición, un par de trabajos que se quedan en memoria para que los procesen dos background services. Despliegas una versión nueva. El pod nuevo arranca, pasa la readiness, el viejo se apaga, y nadie ve ningún error. ¿Qué ha pasado con los trabajos que el viejo tenía en cola?

En el clúster de prueba, con la configuración de casi cualquier proyecto, se perdieron 154 de 334. Solo falló una petición, y ningún log dijo nada alarmante. Este post va de por qué pasa, de las tres piezas que lo evitan y de cuánto aporta cada una, medido.

## El escenario

Para medirlo he montado un ejemplo aparte en [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/graceful-shutdown), sin tocar la API de la serie. Es una Minimal API con un endpoint, `POST /jobs`, que deja dos trabajos en memoria y responde `202` sin esperar a que se ejecuten:

```csharp
app.MapPost("/jobs", (
    [FromKeyedServices(JobKind.Confirmation)] Channel<Job> confirmations,
    [FromKeyedServices(JobKind.Audit)] Channel<Job> audits) =>
{
    var id = Guid.NewGuid();
    // ...
    confirmations.Writer.TryWrite(new Job(id));
    audits.Writer.TryWrite(new Job(id));
    return Results.Text(id.ToString(), statusCode: StatusCodes.Status202Accepted);
});
```

Cada cola es un `Channel<Job>`, la cola en memoria de .NET para pasar datos entre un productor y un consumidor. La consume un `BackgroundService`, uno para las confirmaciones y otro para la auditoría. Cada trabajo tarda 300 ms, lo que tardaría en mandar un correo o en llamar a otro servicio, y al terminar escribe una línea en un fichero. Ese fichero vive en un volumen que montan los dos pods, así que cuando el viejo ya no existe se puede contar qué hizo.

El bucle del worker es el de casi todos los ejemplos:

```csharp
await foreach (var job in _queue.ReadAllAsync(stoppingToken))
{
    await ProcessAsync(job, stoppingToken);
}
```

Una advertencia antes de seguir. Para montarlo registré los dos workers como dos `AddHostedService` con una factoría de la misma clase, y solo arrancaba uno. `AddHostedService` registra cada tipo de implementación una sola vez, así que la segunda llamada no hace nada y no avisa. Por eso cada cola tiene su propia clase, `ConfirmationWorker` y `AuditWorker`.

## Qué hace Kubernetes al parar un pod

Con `maxUnavailable: 0` y `maxSurge: 1`, el rolling update arranca primero el pod nuevo. Mientras el nuevo no pasa la readiness, el viejo sigue atendiendo. Cuando la pasa, los dos están en el Service durante un momento y los dos reciben tráfico. Luego Kubernetes borra el viejo, y al borrarlo pasan dos cosas a la vez:

- Lo saca de los endpoints del Service, para que no le lleguen peticiones nuevas.
- Le manda SIGTERM al proceso.

"A la vez" es literal: son dos caminos independientes, y el primero tarda un poco en llegar a todos los nodos. Durante ese rato el pod puede recibir peticiones después de haber empezado a apagarse.

Después espera. Si el proceso no ha terminado cuando se cumple `terminationGracePeriodSeconds` (30 segundos por defecto), Kubernetes le manda SIGKILL, y SIGKILL no se puede capturar. Lo que quede en memoria se pierde.

## Qué hace .NET con el SIGTERM

El host de .NET captura SIGTERM y empieza a pararse:

1. Dispara `IHostApplicationLifetime.ApplicationStopping`.
2. Para los hosted services en orden inverso al de registro. El servidor web, Kestrel, se registra el último, así que se para el primero: deja de aceptar conexiones y termina las peticiones en curso. Lo comprobé listando los `IHostedService` del contenedor: `ConfirmationWorker`, `AuditWorker` y `GenericWebHostService`, en ese orden.
3. Para cada background service, cancela su `stoppingToken` y espera a que `ExecuteAsync` termine.

Todo eso tiene un límite, `HostOptions.ShutdownTimeout`, que por defecto es de 30 segundos para la parada entera, no para cada servicio. Si se agota, el host deja de esperar y el proceso sale con lo que haya pendiente.

El punto 2 tiene una consecuencia buena: cuando los workers reciben la orden de parar, el servidor ya no acepta peticiones, así que nadie puede encolar nada nuevo mientras vacían la cola.

## Las tres piezas

### 1. Un `preStop` que espere

Un `preStop` es un hook que Kubernetes ejecuta antes de mandar SIGTERM. Con un `sleep`, el pod sigue vivo unos segundos mientras sale del Service, y cuando llega el SIGTERM ya no le entran peticiones:

```yaml
lifecycle:
  preStop:
    sleep:
      seconds: 10
```

La acción `sleep` existe desde Kubernetes 1.30. En versiones anteriores se hace con `exec` y el comando `sleep` de la imagen.

### 2. Un worker que vacíe la cola

En el bucle de antes, el `stoppingToken` va a dos sitios: a `ReadAllAsync` y al trabajo. El problema está en el segundo. Al cancelarse el token, el `Task.Delay` del trabajo en curso lanza `OperationCanceledException`, el bucle se rompe, y lo que quedaba en la cola se queda en memoria hasta que el proceso sale.

El arreglo es cambiar un argumento:

```csharp
await foreach (var job in _queue.ReadAllAsync(stoppingToken))
{
    await ProcessAsync(job, CancellationToken.None);
}
```

Me esperaba tener que vaciar la cola a mano después del bucle, y no hace falta. `ChannelReader.ReadAllAsync` solo mira el token cuando espera un elemento nuevo. Mientras haya trabajos en la cola, los sigue entregando aunque el token esté cancelado, y termina cuando la cola se vacía. Así que el token del bucle solo corta la espera de trabajos nuevos, y lo que decide si se vacía la cola es el token que recibe el trabajo.

Si el trabajo hace llamadas que conviene poder cortar, se le puede pasar un token propio con un límite, en lugar de `CancellationToken.None`. Lo importante es que no sea el de parada.

### 3. Tiempos que encajen

Vaciar la cola lleva tiempo, y hay dos relojes:

```csharp
builder.Services.Configure<HostOptions>(host => host.ShutdownTimeout = TimeSpan.FromSeconds(45));
```

```yaml
terminationGracePeriodSeconds: 60
```

`terminationGracePeriodSeconds` empieza a contar al empezar el `preStop`, así que tiene que cubrir los diez segundos de espera más el `ShutdownTimeout`, con algo de margen. Si es más corto, el SIGKILL llega en mitad del vaciado y da igual lo bien que esté escrito el worker.

## Medirlo

El script `scripts/test-graceful-shutdown.sh` despliega el ejemplo en kind tres veces y en cada una lanza una versión nueva con carga. La carga sale de un pod dentro del clúster y va por el Service, como la mandaría un cliente: un flujo constante que el pod aguanta sin problema, y una ráfaga de 80 peticiones justo antes del despliegue que deja unos 24 segundos de trabajos en la cola del pod viejo. Lo ejecuta la CI de entry-hub en cada PR.

Las tres variantes:

- **Sin nada**: el bucle de siempre, sin `preStop` y con los tiempos por defecto.
- **Solo `preStop`**: diez segundos de espera y los tiempos ampliados, pero el worker sigue pasando el `stoppingToken` al trabajo.
- **Las tres piezas**.

El resultado de la ejecución:

| | Peticiones aceptadas | Peticiones fallidas | Trabajos encolados | Procesados | Perdidos |
|---|---:|---:|---:|---:|---:|
| Sin nada | 167 | 1 | 334 | 180 | 154 |
| Solo `preStop` | 167 | 0 | 334 | 242 | 92 |
| Las tres piezas | 167 | 0 | 334 | 334 | 0 |

Sin nada, el pod viejo recibió el SIGTERM con 76 trabajos en cada cola y los perdió todos, más los dos que estaban a medias. Y una petición falló: llegó cuando el proceso ya se estaba parando y el pod todavía estaba en el Service.

Con solo el `preStop`, la petición fallida desaparece, y el pod aprovecha los diez segundos de espera para adelantar trabajo. Pero la cola era más larga que la espera: cuando llegó el SIGTERM quedaban 45 trabajos por cola, y se perdieron igual.

Con las tres piezas, el log del pod viejo (resumido) cuenta el resto:

```text
11:08:38.761  SIGTERM received: the host is stopping
11:08:52.216  JobWorker.Audit: Stopped after draining 44 queued jobs
11:08:52.219  JobWorker.Confirmation: Stopped after draining 0 queued jobs
```

La auditoría vació 44 trabajos en trece segundos y medio. La confirmación, ninguno, y no porque no tuviera cola. Los servicios se paran de uno en uno, y mientras la auditoría vaciaba la suya, la confirmación aún no había recibido la orden y seguía trabajando con normalidad. Cuando le tocó, ya no le quedaba nada.

Ese detalle importa al calcular el `ShutdownTimeout`. Es un único límite para todos los servicios, así que lo que cuenta es la suma de lo que tarda cada uno en vaciarse, no el que más tarde. Si eso no te cabe, `HostOptions.ServicesStopConcurrently = true` los para a la vez.

## Lo que esto no cubre

Las tres piezas cubren las paradas que Kubernetes anuncia: un despliegue, vaciar un nodo, escalar hacia abajo. No cubren las que no anuncia:

- El proceso se cae por una excepción no controlada.
- El contenedor se queda sin memoria y el kernel lo mata (un OOMKill).
- El nodo se apaga de golpe.

En los tres casos no hay SIGTERM ni nada que vaciar: lo que estaba en memoria se pierde. Si perder uno de esos trabajos no es aceptable, la cola no puede estar en memoria. Hay dos opciones habituales:

- Una tabla en la base de datos, que la petición escribe en su misma transacción y el worker lee con `FOR UPDATE SKIP LOCKED`, para que dos copias del worker no cojan la misma fila. Es lo que hace el servicio de recordatorios de entry-hub.
- Un broker de mensajes, como RabbitMQ o Azure Service Bus.

Y hay una tercera salida, que no es excluyente: sacar los background services de la API a su propio Deployment. Así la API y los workers se despliegan por separado, y un cambio en un endpoint no para los trabajos.

## Resumiendo

- Al parar un pod, Kubernetes lo saca del Service y le manda SIGTERM a la vez, y SIGKILL cuando se agota `terminationGracePeriodSeconds`. Lo que quede en memoria se pierde.
- Las tres piezas: un `preStop` con `sleep` para dejar de recibir peticiones antes del SIGTERM, un worker que no le pasa el `stoppingToken` al trabajo, y un `ShutdownTimeout` y un `terminationGracePeriodSeconds` que cubran la suma.
- Medido en kind: 154 trabajos perdidos sin nada, 92 con solo el `preStop` y ninguno con las tres piezas.
- Nada de esto cubre una caída. Si un trabajo no se puede perder, la cola va fuera de la memoria.

El código, los manifiestos y el script están en [entry-hub](https://github.com/MookieFumi/entry-hub/tree/main/src/samples/graceful-shutdown).
