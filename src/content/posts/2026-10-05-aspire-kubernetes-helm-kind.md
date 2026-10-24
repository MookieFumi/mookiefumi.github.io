---
title: "Lo que Aspire lleva a Kubernetes (y lo que tienes que poner tú)"
subtitle: El chart pasaba la revisión y la CI, y el primer helm install falló en menos de un segundo
description: "Del AppHost de Aspire a un chart de Helm instalado de verdad: aspire publish, un clúster kind en cada PR, migraciones de EF Core en un init container y maxUnavailable para que helm --wait no mienta."
date: 2026-10-05
topic: dotnet
series: aspire
published: false
---

El chart de Helm de [entry-hub](https://github.com/MookieFumi/entry-hub) llevaba tiempo en el repositorio. Lo genera Aspire a partir del AppHost, lo habíamos revisado, y la CI comprobaba en cada PR que estaba al día. Parecía completo: Deployments, un StatefulSet para PostgreSQL, Services, ConfigMaps y Secrets. Nadie lo había instalado.

El día que lo instalamos en un clúster de verdad, `helm install` falló en menos de un segundo. Y si hubiera pasado, la API habría arrancado contra una base de datos que no existía. Este post va de eso: qué viaja de Aspire a Kubernetes, qué se queda por el camino y cómo comprobarlo en cada PR para no volver a enterarnos tarde.

## Dos proyectos con destinos opuestos

En los posts anteriores hemos usado dos proyectos de Aspire que se parecen en el nombre pero no en el destino.

El **AppHost** describe el sistema: qué recursos hay (PostgreSQL, la API, el servicio de recordatorios) y cómo se relacionan. Se ejecuta en tu máquina con `aspire run`, en los [tests de sistema](/2026-10-04-tests-sistema-aspire) y, como veremos ahora, en la CI para generar el chart. Nunca llega al clúster. ¿Cuántos pods de AppHost hay en Kubernetes? Ninguno.

**ServiceDefaults** es lo contrario: una librería que cada servicio compila dentro de su imagen. Trae la telemetría, la resiliencia de `HttpClient` y los endpoints de salud `/health` y `/alive`. Eso sí viaja, porque va dentro de la API y del servicio de recordatorios.

Por eso Aspire no despliega nada en producción. El AppHost genera artefactos (en nuestro caso, un chart de Helm) y ahí acaba su trabajo. Lo que pase después es cosa de Kubernetes.

## Del modelo al chart

El destino se declara en el propio AppHost:

```csharp
// The target for `aspire publish`: it turns the model below into a Helm chart. It does nothing when running locally.
// The Aspire dashboard is left out of the chart: it is a development tool, and the cluster has its own monitoring.
var kubernetes = builder.AddKubernetesEnvironment("k8s").WithDashboard(false);
```

`AddKubernetesEnvironment` viene del paquete `Aspire.Hosting.Kubernetes`, que en la versión 13.6.1 sigue en preview (esto importa luego). Al ejecutar `aspire run` no hace nada. Al ejecutar `aspire publish`, recorre el modelo y escribe un chart. En entry-hub lo hace un script, `scripts/publish-k8s.sh`, que compila el AppHost y lanza el CLI de Aspire que viene con el SDK:

```bash
rm -rf "$root/deploy/k8s"
(cd "$root/src/EntryHub.AppHost" && "$aspire" publish --non-interactive -o "$root/deploy/k8s")
```

El resultado es `deploy/k8s`: un `Chart.yaml`, un `values.yaml` y una carpeta de plantillas por recurso. La API y los recordatorios salen como Deployments, PostgreSQL como StatefulSet con su volumen, y cada uno con su ConfigMap y su Secret.

Hay cosas que no tienen sentido igual en local y en el clúster, y para eso están `IsRunMode` e `IsPublishMode`. Con `IsRunMode`, el AppHost se está ejecutando con `aspire run`, en tu máquina o en un test. Con `IsPublishMode`, está generando el chart. En entry-hub hay tres diferencias:

```csharp
var postgres = builder.AddPostgres("postgres");
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithDataVolume();
}
else
{
    // A named Docker volume becomes an emptyDir in the chart, which is gone with the pod. A persistent volume
    // claim is what keeps the data across restarts and upgrades.
    var data = kubernetes.AddPersistentVolume("postgres-data").WithCapacity("5Gi");
    postgres.WithPersistentVolume(data, "/var/lib/postgresql");
}
```

La primera es el volumen. En local, un volumen de Docker con nombre basta para que los datos sobrevivan. En el chart, ese mismo volumen se convierte en un `emptyDir`, un directorio que desaparece con el pod. Para que los datos aguanten un reinicio hace falta un PersistentVolumeClaim, que es lo que pide `AddPersistentVolume`.

La segunda son los secretos. La configuración JWT de la API solo existe al publicar, como parámetros que tendrá que rellenar quien instale el chart:

```csharp
var issuer = builder.AddParameter("jwt-issuer");
var audience = builder.AddParameter("jwt-audience");
var signingKey = builder.AddParameter("jwt-signing-key", secret: true);
```

Con `secret: true`, la clave de firma acaba en la sección `secrets` del chart y nunca en un ConfigMap. En `values.yaml` aparece vacía, igual que las contraseñas de PostgreSQL: se pasan al instalar y no se guardan en el repositorio.

La tercera es [Scalar](/2026-09-25-openapi-scalar-minimal-apis), que solo se añade con `IsRunMode`. La referencia de la API es para desarrollar; no tiene sentido como pod.

El chart va en el repositorio, igual que el [contrato OpenAPI](/2026-09-30-contract-testing-openapi-dotnet), y la CI lo regenera en cada PR para comprobar que no ha cambiado:

```yaml
- name: Kubernetes chart is up to date
  # Regenerates the chart from the AppHost. A different file means the application model changed
  # without committing the new chart (run scripts/publish-k8s.sh).
  run: |
    scripts/publish-k8s.sh
    git diff --exit-code -- deploy
```

Esto garantiza que el chart refleja el AppHost, pero no que funcione, y eso es lo que nos faltaba por comprobar.

## Instalarlo de verdad: un clúster kind en cada PR

[kind](https://kind.sigs.k8s.io/) (Kubernetes in Docker) levanta un clúster de Kubernetes completo dentro de un contenedor de Docker. No sirve para producción, pero para comprobar que un chart se instala y que la aplicación funciona sobra. Además, los runners de Ubuntu de GitHub Actions ya traen Docker, kind, kubectl y helm, así que el job de la CI no instala nada:

```yaml
kubernetes:
  # Installs the committed chart in a kind cluster and checks the application there (scripts/test-k8s.sh).
  # GitHub-hosted Ubuntu runners come with Docker, kind, kubectl and helm.
  runs-on: ubuntu-latest
  timeout-minutes: 20

  steps:
    - uses: actions/checkout@v7

    - uses: actions/setup-dotnet@v6
      with:
        global-json-file: src/global.json
        cache: true
        cache-dependency-path: "**/packages.lock.json"

    - name: Tools
      run: |
        kind version
        kubectl version --client
        helm version

    - name: Install the chart and check the application
      run: scripts/test-k8s.sh
```

Todo el trabajo está en `scripts/test-k8s.sh`, que se puede ejecutar igual en local. Primero, las imágenes. El chart no las construye: solo recibe sus nombres como parámetros. El SDK de .NET sabe crear la imagen de un proyecto sin Dockerfile, así que basta con `dotnet publish` y cargarlas en el clúster:

```bash
for project in Api Reminders; do
  name="entryhub-${project,,}"
  dotnet publish "$root/src/EntryHub.$project" -c Release --nologo -v quiet \
    -t:PublishContainer -p:ContainerRepository="$name" -p:ContainerImageTag="$tag"
done

if ! kind get clusters | grep -qx "$cluster"; then
  kind create cluster --name "$cluster" --wait 2m
fi
kind load docker-image "entryhub-api:$tag" "entryhub-reminders:$tag" --name "$cluster"
```

Después, los secretos. Se generan en cada ejecución y no salen de ella:

```bash
password="$(openssl rand -hex 16)"
signing_key="$(openssl rand -base64 32)"
issuer="entryhub-k8s-test"
audience="entryhub-api"

helm upgrade --install entry-hub "$root/deploy/k8s" --wait --timeout 5m \
  --set parameters.api.api_image="entryhub-api:$tag" \
  --set parameters.reminders.reminders_image="entryhub-reminders:$tag" \
  --set secrets.postgres.postgres_password="$password" \
  --set secrets.api.postgres_password="$password" \
  --set secrets.reminders.postgres_password="$password" \
  --set secrets.api.jwt_signing_key="$signing_key" \
  --set config.api.jwt_issuer="$issuer" \
  --set config.api.jwt_audience="$audience"
```

`--wait` le pide a Helm que no dé la instalación por buena hasta que los recursos estén listos.

## Primer fallo: una probe que Kubernetes no acepta

La primera ejecución del job no llegó ni a arrancar un pod de la API:

```text
Error: 1 error occurred:
	* Deployment.apps "api-deployment" is invalid: [spec.template.spec.containers[0].livenessProbe.httpGet.scheme: Unsupported value: "http": supported values: "HTTP", "HTTPS", spec.template.spec.containers[0].readinessProbe.httpGet.scheme: Unsupported value: "http": supported values: "HTTP", "HTTPS"]
```

Una probe es la comprobación que hace Kubernetes contra un contenedor. La API tiene dos, que declara el AppHost con `WithHttpProbe`: la de readiness (`/health`), que decide si el pod recibe tráfico, y la de liveness (`/alive`), que decide si hay que reiniciarlo. El publicador en preview escribe el esquema de esas probes como `"http"`, en minúsculas, y Kubernetes solo acepta `"HTTP"` o `"HTTPS"`. El chart no se podía instalar, y ninguna revisión lo había visto, porque `scheme: "http"` parece correctísimo.

Editar el chart a mano no es una opción, porque la CI lo regenera y el cambio desaparecería. La salida es `PublishAsKubernetesService`, que deja retocar desde el AppHost el recurso de Kubernetes que genera el publicador, antes de que se escriba:

```csharp
.PublishAsKubernetesService(service =>
{
    var deployment = (Deployment)service.Workload!;
    var pod = deployment.PodTemplate.Spec;
    var container = pod.Containers.Single();

    // The preview Kubernetes publisher writes the probe scheme in lower case ("http"), and the API server only
    // accepts "HTTP" or "HTTPS": the chart would not install. Remove once the publisher writes it correctly.
    foreach (var probe in new[] { container.LivenessProbe, container.ReadinessProbe, container.StartupProbe })
    {
        if (probe?.HttpGet is { Scheme: not null } httpGet)
        {
            httpGet.Scheme = httpGet.Scheme.ToUpperInvariant();
        }
    }

    // ...
});
```

El chart sigue siendo cien por cien generado, y el día que el publicador lo escriba bien, se borra el bucle. Son cosas que pasan con un paquete en preview, y esta solo salió al instalar.

## Segundo hueco: la base de datos que nadie crea

Este no llegó a romper la CI, porque lo vimos al preparar la instalación, pero habría sido el siguiente.

En local, Aspire crea la base de datos `entryhub` al arrancar PostgreSQL, y la API aplica las migraciones de EF Core al arrancar en Development. En el clúster no pasa ninguna de las dos cosas. El PostgreSQL del chart arranca vacío y la API corre en Production. Nadie crea la base de datos ni el esquema.

El primer intento fue el más corto: migrar al arrancar la API también en el clúster, con un flag que el AppHost solo ponía al publicar. `MigrateAsync` crea la base de datos si no existe, y desde EF Core 9 toma un bloqueo antes de migrar. En PostgreSQL se ve en el log:

```text
LOCK TABLE "__EFMigrationsHistory" IN ACCESS EXCLUSIVE MODE
```

Así, si arrancan varias réplicas a la vez, solo una aplica cada migración. Funcionó. En la primera ejecución en verde, la API se reinició dos veces y estuvo lista 22 segundos después de instalar. Los reinicios eran el síntoma: mientras PostgreSQL arrancaba, la API intentaba migrar, fallaba y Kubernetes la volvía a lanzar. Un mismo proceso hacía dos trabajos, preparar la base de datos y servir peticiones, y el fallo de uno tumbaba el otro.

La versión que quedó en el repositorio los separa con un init container: un contenedor que Kubernetes ejecuta hasta el final antes de arrancar los contenedores del pod, y que reintenta mientras falla. Es la misma imagen de la API con un argumento, `migrate`:

```csharp
// Local runs create the schema on startup. In the cluster an init container runs the same image with `migrate`, which
// applies the migrations and exits, so the API starts only once the schema exists. Since EF Core 9, MigrateAsync
// takes a database lock, so several pods starting at once apply each migration only once.
if (app.Environment.IsDevelopment() || args is ["migrate"])
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<EntryHubDbContext>().Database.MigrateAsync();
    if (args is ["migrate"])
    {
        return;
    }
}
```

Y el init container se añade desde el mismo `PublishAsKubernetesService`, copiando la imagen y la configuración del contenedor de la API:

```csharp
// The PostgreSQL container of the chart starts empty. Before the API starts, the same image with `migrate`
// creates the database and applies the migrations; Kubernetes retries it until PostgreSQL accepts connections.
var migrate = new ContainerV1
{
    Name = "migrate",
    Image = container.Image,
    ImagePullPolicy = container.ImagePullPolicy,
};
migrate.Args.Add("migrate");
// Copies, not the same objects: shared objects come out as YAML anchors and aliases in the chart.
migrate.EnvFrom.AddRange(container.EnvFrom.Select(source => new EnvFromSourceV1
{
    ConfigMapRef = source.ConfigMapRef is { } map ? new ConfigMapEnvSourceV1 { Name = map.Name } : null,
    SecretRef = source.SecretRef is { } secret ? new SecretEnvSourceV1 { Name = secret.Name } : null,
}));
pod.InitContainers.Add(migrate);
```

El comentario de las copias tiene su historia. La primera versión reutilizaba la misma lista de `EnvFrom` de la API, y el serializador, al ver los mismos objetos dos veces, escribió anclas y alias de YAML (`&o0`, `*o0`) en la plantilla. Es YAML válido, pero nadie quiere leer eso en un chart.

En el chart queda así:

```yaml
initContainers:
  - image: "{{ .Values.parameters.api.api_image }}"
    name: "migrate"
    envFrom:
      - configMapRef:
          name: "api-config"
      - secretRef:
          name: "api-secrets"
    args:
      - "migrate"
    imagePullPolicy: "IfNotPresent"
```

¿Por qué no lo que trae Aspire para esto? `Aspire.Hosting.EntityFrameworkCore` tiene `AddEFMigrations` y puede publicar las migraciones como un bundle en su propio contenedor, pero también está en preview, y en Kubernetes hay que convertirlo a mano en un Job. El init container no necesita otra imagen. Tiene un coste: el pod de la API sigue llevando credenciales con permiso para cambiar el esquema.

## Tercer tropiezo: helm --wait dio por buena una API caída

Con la probe arreglada, la segunda ejecución sí instaló el chart. Helm respondió `STATUS: deployed`, el script siguió adelante, y el primer `curl` contra la API falló con el código 7: no había nada escuchando. La API estaba en `CrashLoopBackOff`, el estado de un contenedor que Kubernetes reinicia una y otra vez porque se cae al arrancar.

¿Cómo puede Helm decir que está listo? Por cómo genera el publicador los Deployments:

```yaml
replicas: 1
strategy:
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 1
  type: "RollingUpdate"
```

`maxUnavailable` es cuántos pods pueden faltar mientras se despliega una versión nueva. Con una réplica y `maxUnavailable: 1`, cero pods listos está dentro de lo permitido. Para `helm --wait`, eso es "listo".

El primer arreglo fue en el script, esperando a los pods con `kubectl wait --for condition=Ready`. Pero el mismo ajuste tiene otra cara peor que una CI engañada: en una actualización, Kubernetes puede quitar el único pod de la API antes de que el nuevo esté listo. Cada despliegue dejaría la API sin servicio un rato.

Así que el arreglo definitivo está, otra vez, en el AppHost:

```csharp
// The publisher allows one pod unavailable, which with one replica means none at all: an upgrade could stop the
// only API pod before the new one is ready, and `helm --wait` would report the release ready with no pod ready.
deployment.Spec.Strategy.RollingUpdate.MaxUnavailable = 0;
```

Con `maxUnavailable: 0`, Kubernetes arranca el pod nuevo y no quita el viejo hasta que el nuevo pasa la probe de readiness. Y `helm --wait` vuelve a significar algo: no termina hasta que la API responde a `/health`, que también comprueba PostgreSQL.

El servicio de recordatorios se queda con lo que genera el publicador. No recibe tráfico, así que si se queda unos segundos sin pod durante una actualización no corta a nadie: los recordatorios pendientes salen en la siguiente pasada. Para él, el script sigue esperando a su pod:

```bash
# The AppHost sets maxUnavailable: 0 on the API, so helm --wait above waited for its pod to pass the readiness probe,
# which checks PostgreSQL too. The reminders Deployment keeps the publisher's maxUnavailable: 1, with which Helm counts
# it ready with no pod ready at all, so the script waits for its pod itself.
kubectl wait pod -l app.kubernetes.io/component=reminders --for condition=Ready --timeout 2m
```

## Comprobar que funciona, no solo que arranca

Que un pod esté en `Running` dice poco de la aplicación. El script comprueba que los dos servicios trabajan con la misma base de datos dentro del clúster.

Primero la API. El script abre un `kubectl port-forward` al Service y crea una sala con un token JWT firmado con la clave de esta instalación. El token se construye en bash con `openssl`, con la misma forma que los que crea `dotnet user-jwts`:

```bash
room="$(curl -sf -X POST "http://localhost:$port/api/v1/rooms" \
  -H "Authorization: Bearer $(token facilities Facilities)" -H "Content-Type: application/json" \
  -d '{"name":"Kind room","floor":1,"capacity":6,"equipment":null}')"
```

Después, los recordatorios. Las reglas de reserva solo aceptan horario de oficina, así que la reserva entra directamente en PostgreSQL, como en los tests de sistema. Lo que se prueba es que el servicio de recordatorios la encuentre:

```bash
kubectl exec postgres-statefulset-0 -- env PGPASSWORD="$password" psql -U postgres -d entryhub -v ON_ERROR_STOP=1 -c \
  "INSERT INTO bookings (\"Id\", \"RoomId\", \"OrganizerId\", \"Title\", \"StartAt\", \"EndAt\", \"Attendees\", \"Status\", \"CreatedAt\")
   VALUES (gen_random_uuid(), '$room_id', 'ana', 'Kind check', now() + interval '5 minutes', now() + interval '65 minutes', 4, 'Confirmed', now());"
```

Y espera a que aparezca en su log. Esta es la salida real de la ejecución del job con la versión final:

```text
NAME                                   READY   STATUS    RESTARTS   AGE
api-deployment-74c997968f-8bxrc        1/1     Running   0          28s
postgres-statefulset-0                 1/1     Running   0          28s
reminders-deployment-d55766d9b-nhxvs   1/1     Running   0          28s
Probes:
Healthy
The API writes to PostgreSQL:
{"id":"01a1500a-d340-7e9b-b6a1-68252e87bef0","name":"Kind room","floor":1,"capacity":6,"equipment":[],"isActive":true,"createdAt":"2026-10-18T17:24:09.1521668+00:00"}
The reminders service reads from PostgreSQL:
INSERT 0 1
      Reminder for ana: "Kind check" in Kind room starts at 2026-10-18 17:29:09Z
The application works in the cluster.
```

`helm --wait` tardó 29 segundos y, esta vez, la API no se reinició ni una vez. El recordatorio salió tres segundos después de insertar la reserva. Eso fue suerte: el servicio revisa las reservas cada 30 segundos, así que puede tardar hasta medio minuto. El script espera hasta dos.

Si algo falla, una trampa de bash vuelca el estado de los pods, su `describe` y sus logs. De ahí salen los errores que he copiado en los apartados anteriores.

## Las probes, otra vez

En el [post anterior](/2026-10-03-aspire-sin-humo#health-y-alive-no-son-lo-mismo) vimos qué contesta cada endpoint: `/health` ejecuta todos los health checks, PostgreSQL incluido, y `/alive` solo los marcados como `live`. En el clúster es donde esa diferencia tiene consecuencias.

Cada `WithHttpProbe` del AppHost acaba en el Deployment de la API como una probe de Kubernetes:

```yaml
readinessProbe:
  failureThreshold: 3
  successThreshold: 1
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 1
  httpGet:
    scheme: "HTTP"
    path: "/health"
    port: {{ .Values.parameters.api.port_http | int }}
```

La liveness es igual, con `path: "/alive"`. Esos números no los he elegido yo: son los que pone Aspire cuando `WithHttpProbe` no recibe otros. Leídos en voz alta:

- `initialDelaySeconds: 5`: la primera comprobación llega cinco segundos después de arrancar el contenedor.
- `periodSeconds: 5`: después, una cada cinco segundos.
- `timeoutSeconds: 1`: si el endpoint tarda más de un segundo, cuenta como fallo.
- `failureThreshold: 3`: hacen falta tres fallos seguidos para actuar.
- `successThreshold: 1`: basta un acierto para volver a estar bien.

Con esos valores, si PostgreSQL se cae, la readiness falla tres veces seguidas, unos quince segundos, y el pod sale del Service: deja de recibir tráfico. La liveness sigue bien, así que Kubernetes no reinicia la API, que no arreglaría nada. Cuando PostgreSQL vuelve, basta una comprobación buena para que el pod reciba tráfico otra vez. Si las dos probes apuntaran a `/health`, la misma caída acabaría en una cadena de reinicios.

La readiness también es la que mira el despliegue. Con `maxUnavailable: 0`, el pod viejo no se quita hasta que el nuevo pasa esta probe, y es la misma que espera `helm --wait`.

Los cinco valores se pueden cambiar desde el AppHost, porque `WithHttpProbe` acepta `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `failureThreshold` y `successThreshold`. Un `timeoutSeconds` de un segundo es justo para un `/health` que consulta la base de datos. Si la tuya tarda en contestar, súbelo antes de que un PostgreSQL lento te saque los pods del Service.

El tercer tipo, `ProbeType.Startup`, no hace falta aquí. La espera larga, la de las migraciones, ya la hace el init container `migrate` antes de que arranque la API. Sin él, una API que tardara medio minuto en arrancar necesitaría una startup probe para que la liveness no la matara antes de tiempo. Las tres probes y los errores típicos al apuntarlas tienen [su propia píldora](/2026-10-06-probes-kubernetes-readiness-liveness-startup).

ServiceDefaults mapea los dos endpoints en todos los entornos, porque Kubernetes los necesita. Solo responden `Healthy` o `Unhealthy`, sin detalles, y el chart no publica ningún ingress. Si añades uno, que no los exponga.

## Lo que el chart sigue sin darte

El chart instala y la aplicación funciona, pero no es un despliegue de producción. Faltan:

- Un registro de imágenes y su versionado. El script construye y carga imágenes con la etiqueta `test`. En un despliegue real, la CI tendría que publicarlas en un registro con la versión que ya calcula [GitVersion](/2026-09-21-gitversion-versionado-semantico-dotnet).
- Un ingress. El chart no publica la API fuera del clúster. En el [laboratorio del MCP Server](/2026-08-16-mcp-server-kubernetes-rancher-desktop) hay un ejemplo con Rancher Desktop.
- Copias de seguridad de PostgreSQL. El PersistentVolumeClaim aguanta reinicios, no desastres.
- Un PostgreSQL gestionado. Para producción, un contenedor de PostgreSQL en el clúster es la opción que menos recomendaría. El AppHost puede apuntar a una base de datos externa con una cadena de conexión.
- Más de una réplica. Lo explico abajo, porque es lo que más se nota.

### Con una réplica, cuándo te quedas sin API

`maxUnavailable: 0` cubre las actualizaciones: el pod viejo sigue atendiendo hasta que el nuevo está listo. Si el nuevo no llega a estarlo, o no cabe en el clúster, la actualización se queda parada, pero la API sigue respondiendo con la versión anterior. Fuera de las actualizaciones, en cambio, el chart tiene un solo pod de la API, y la API se queda sin servicio cada vez que ese pod no está listo. El Service se queda sin a quién mandar las peticiones, y el cliente recibe un error de conexión. Pasa en estos casos:

| Qué pasa | Cuánto dura sin servicio |
|---|---|
| PostgreSQL deja de contestar | Desde que la readiness falla tres veces, unos quince segundos, hasta que PostgreSQL vuelve |
| La API se cae o falla la liveness | Lo que tarda en reiniciarse y pasar la readiness: como poco los cinco segundos de `initialDelaySeconds` |
| Alguien vacía el nodo (`kubectl drain`, una actualización del clúster) | Kubernetes borra el pod y crea otro en otro nodo. Hasta que esté listo: descargar la imagen, el init container `migrate`, el arranque y la readiness |
| El nodo se cae | Kubernetes espera cinco minutos por defecto antes de dar el nodo por perdido y mover el pod, y luego lo mismo que en la fila anterior |

El primer caso no lo arregla tener más réplicas: si la base de datos es una sola, todas fallan la readiness a la vez (en la [píldora de las probes](/2026-10-06-probes-kubernetes-readiness-liveness-startup) está el porqué y la alternativa). Los otros tres sí. Con dos réplicas, un `PodDisruptionBudget` con `minAvailable: 1`, para que vaciar un nodo no se lleve las dos a la vez, y las réplicas repartidas en nodos distintos, la caída de un pod o de un nodo deja de cortar el servicio. Hay una condición más: la aplicación no puede guardar nada en memoria que otro pod necesite, porque cada conexión puede ir a un pod distinto. entry-hub la cumple: el token se valida en cada petición y la pantalla de la sala lee PostgreSQL en cada pasada.


## Cierre de la serie

Con este post acaban las dos series. La API se construyó así, post a post:

- [Minimal APIs sin el Program.cs de 800 líneas](/2026-09-23-minimal-apis-vertical-slice): vertical slices y handlers propios.
- [Enséñale a tu API a decir que no (sin mentir)](/2026-09-24-validacion-errores-minimal-apis): validación y reglas de negocio.
- [Bienvenido, Scalar](/2026-09-25-openapi-scalar-minimal-apis): OpenAPI nativo y su referencia.
- [El candado que tu documentación OpenAPI no enseñaba](/2026-09-26-openapi-autenticacion-scalar): la autenticación en el documento.
- [Que tu documentación OpenAPI no parezca la de todo el mundo](/2026-09-27-personalizar-openapi-scalar): personalizar el documento y Scalar.
- [MapGroup o Asp.Versioning](/2026-09-28-versionado-mapgroup-asp-versioning): versionar sin instalar nada de más.
- [La pantalla de la sala no necesita SignalR](/2026-09-29-server-sent-events-minimal-apis): Server-Sent Events.
- [Tu API dice cumplir su contrato: compruébalo con un test](/2026-09-30-contract-testing-openapi-dotnet): contract testing.
- [El PR que rompía a los clientes y nadie lo vio](/2026-10-01-cambios-incompatibles-contrato-openapi): cambios incompatibles en la CI.
- [Se acabaron los 500 vacíos](/2026-10-02-iexceptionhandler-problem-details-minimal-apis): errores con `ProblemDetails`.

Y Aspire, en tres:

- [Aspire sin humo: qué es y qué no](/2026-10-03-aspire-sin-humo): el AppHost, ServiceDefaults y el dashboard.
- [Los tests de sistema con Aspire](/2026-10-04-tests-sistema-aspire): el sistema entero levantado desde un test.
- Este: lo que Aspire lleva a Kubernetes y lo que tienes que poner tú.

## Resumiendo

- El AppHost no se despliega: genera el chart con `aspire publish` y ahí acaba su trabajo. ServiceDefaults sí viaja, dentro de cada imagen.
- Que la CI compruebe que el chart está al día no demuestra que funcione. Un clúster kind en cada PR sí, y los runners de GitHub ya traen todo lo necesario.
- `PublishAsKubernetesService` permite corregir lo que genera el publicador sin tocar el chart a mano: el esquema de las probes, un init container para las migraciones y `maxUnavailable: 0` para que `helm --wait` y las actualizaciones no te dejen sin API.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub).
