---
layout: post
title: "Laboratorio: MCP Server en Kubernetes local con Aspire y Rancher Desktop"
subtitle: De la solución de Aspire a un clúster local, paso a paso y con sus tropiezos
topic: k8s
published: true
---

En el [post anterior](/2026-09-25-mcp-server-sdk-dotnet) creamos un MCP Server con el SDK oficial de .NET que consume una API de ejemplo (`GET /weatherforecast`), todo orquestado con Aspire. En este laboratorio vamos a llevar esa misma solución a un **clúster de Kubernetes local**, exponerla con un Ingress y conectarla desde Visual Studio Code.

No es un camino de rosas, y precisamente por eso merece la pena contarlo: por el camino aparecen dos problemas muy habituales al trabajar con Kubernetes en local, que veremos en detalle junto con su solución y algunas alternativas.

## Lo que vamos a montar

* **Rancher Desktop** como motor de contenedores y clúster de Kubernetes local (k3s).
* **Aspire** para generar, a partir del AppHost, un **Helm chart** con todo lo necesario.
* **Traefik**, que ya viene integrado en Rancher Desktop, como Ingress Controller.
* **Visual Studio Code** como cliente MCP.

El resultado final: VS Code conectado al MCP Server que corre en Kubernetes, que a su vez llama a la API dentro del propio clúster.

## Conceptos clave

Antes de ponernos manos a la obra, conviene tener claras las piezas que vamos a usar. Son muchas, y cada una resuelve un problema distinto.

### Kubernetes, clúster y nodo

**Kubernetes** es un orquestador de contenedores: le decimos qué queremos tener en ejecución (qué imágenes, cuántas réplicas, cómo se comunican) y él se encarga de conseguirlo y mantenerlo, reiniciando lo que falle.

Un **clúster** es el conjunto de máquinas que gestiona Kubernetes, y cada una de esas máquinas es un **nodo**. En local tendremos un clúster de un solo nodo: nuestro propio equipo.

**k3s** es una distribución ligera de Kubernetes, pensada para entornos con pocos recursos. Es la que usa Rancher Desktop. Para lo que vamos a hacer, se comporta igual que un Kubernetes completo.

Con Kubernetes se trabaja de forma **declarativa**: describimos los recursos en ficheros YAML (manifiestos) y los aplicamos con `kubectl`, la herramienta de línea de comandos del clúster.

### Pod, Deployment y Service

Son los tres recursos básicos con los que vamos a trabajar:

* **Pod**: la unidad mínima de ejecución. Envuelve uno o varios contenedores. Los pods son efímeros: se crean, se destruyen y cambian de IP.
* **Deployment**: describe cómo deben ejecutarse los pods de una aplicación (qué imagen, cuántas réplicas, qué variables de entorno) y se encarga de que siempre se cumpla. Si un pod muere, el Deployment crea otro.
* **Service** (abreviado `svc` en `kubectl`): da un **nombre y una dirección estables** a un conjunto de pods y reparte el tráfico entre ellos. Como los pods cambian de IP, los demás componentes nunca hablan con un pod directamente, sino con su Service. Dentro del clúster, cada Service tiene un nombre DNS: nuestro MCP Server llegará a la API a través del Service `api-service`.

Por defecto, un Service solo es accesible **desde dentro del clúster**. Para llegar desde fuera necesitaremos algo más: un Ingress.

### Imágenes y registry

Kubernetes no compila nada: ejecuta **imágenes** de contenedor que normalmente descarga de un **registry** (Docker Hub, Azure Container Registry, GitHub Container Registry...). En local podemos saltarnos el registry si el clúster comparte el motor de contenedores con el que construimos las imágenes, que es lo que haremos con Rancher Desktop. Esto tiene sus matices, como veremos en el primer problema del laboratorio.

### Helm

**[Helm](https://helm.sh)** es el gestor de paquetes de Kubernetes. Igual que NuGet empaqueta librerías, Helm empaqueta aplicaciones completas para Kubernetes. Tiene tres conceptos principales:

* **Chart**: el paquete. Es una carpeta con plantillas de manifiestos (Deployments, Services...) y un fichero de valores por defecto.
* **Values**: los parámetros del chart, definidos en `values.yaml`. Permiten reutilizar el mismo chart con distintas configuraciones (nombres de imagen, puertos, variables de entorno) sin tocar las plantillas. Se pueden sobrescribir al instalar con `--set` o con otro fichero de valores.
* **Release**: una instalación concreta de un chart en un clúster, con un nombre. El mismo chart puede instalarse varias veces con releases distintas.

Los comandos que usaremos:

```powershell
helm install <release> <chart>     # instala un chart
helm upgrade <release> <chart>     # actualiza una release existente
helm list                          # lista las releases instaladas
helm template <release> <chart>    # renderiza el YAML final sin instalar nada
helm uninstall <release>           # elimina la release y sus recursos
```

¿Por qué Helm y no manifiestos sueltos? Porque agrupa todos los recursos de la aplicación, permite parametrizarlos y gestiona su ciclo de vida como una unidad: instalar, actualizar o eliminar todo de una vez. En nuestro caso, además, es el formato que genera Aspire.

### Ingress e Ingress Controller

Aquí hay dos piezas que se suelen confundir:

* **Ingress** es un recurso de Kubernetes que define **reglas de enrutado HTTP** desde fuera del clúster hacia los Services: *"las peticiones a este host o a esta ruta van a este Service"*. Por sí solo no hace nada; es solo configuración.
* **Ingress Controller** es el componente que **lee esas reglas y las aplica**. Es un proxy inverso que se ejecuta dentro del clúster, recibe el tráfico externo y lo reparte según los Ingress definidos.

La relación entre ambos la establece la **IngressClass**: cada Ingress indica en `ingressClassName` qué controlador debe gestionarlo. Así pueden convivir varios controladores en el mismo clúster.

El flujo completo de una petición en nuestro laboratorio será:

```
VS Code ──► Traefik (Ingress Controller) ──► regla del Ingress ──► mcp-service ──► pod del MCP Server
                                                                                        │
                                                            api-service ◄───────────────┘
                                                                 │
                                                                 ▼
                                                          pod de la API
```

Más detalles en la [documentación de Kubernetes sobre Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/).

### Traefik

**[Traefik](https://doc.traefik.io/traefik/)** es un proxy inverso y balanceador de carga open source, muy extendido como Ingress Controller. Es el que incluye k3s por defecto, y por tanto Rancher Desktop, así que no tendremos que instalar nada.

Además de entender los recursos Ingress estándar, tiene sus propios recursos (como los *Middlewares*, para reescribir rutas o añadir cabeceras) y soporta Gateway API. Una particularidad que nos afecta: sus opciones avanzadas no se configuran con las anotaciones de otros controladores, así que los ejemplos que encuentres para NGINX no siempre sirven tal cual.

### Alternativas a Traefik

Traefik no es la única opción. Estas son algunas de las más habituales:

| Controlador | Características | Cuándo tiene sentido |
| --- | --- | --- |
| **Traefik** | Ligero, configuración sencilla, incluido en k3s. | Entornos locales, clústeres pequeños y medianos. |
| **Ingress NGINX** (`kubernetes/ingress-nginx`) | Ha sido el más usado durante años. **Retirado en marzo de 2026**: ya no recibe actualizaciones ni parches de seguridad. | No debería usarse en nuevos proyectos. |
| **NGINX Ingress Controller** (de F5/NGINX) | Proyecto distinto al anterior, pese al nombre parecido, y con mantenimiento activo. | Si ya trabajas con NGINX y quieres seguir en ese ecosistema. |
| **HAProxy Ingress** | Basado en HAProxy, con muy buen rendimiento. | Cargas con mucho tráfico. |
| **Kong** | Ingress Controller con funcionalidades de API Gateway (autenticación, rate limiting, plugins). | Cuando además del enrutado necesitas gestionar APIs. |
| **Envoy Gateway / Contour** | Basados en Envoy, muy orientados a Gateway API. | Plataformas que apuestan por Gateway API. |
| **Istio** | Service mesh con su propia puerta de entrada al clúster. | Cuando ya usas o necesitas un service mesh. |
| **Application Gateway for Containers** | Servicio gestionado de Azure para AKS, compatible con Ingress y Gateway API. | Producción en AKS con un balanceador gestionado. |

La retirada de Ingress NGINX merece una mención especial, porque durante mucho tiempo ha sido la opción por defecto en tutoriales y ejemplos. El proyecto de Kubernetes [anunció su retirada](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) y [recomienda migrar](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/), preferiblemente a Gateway API. Las instalaciones existentes siguen funcionando, pero sin parches de seguridad. Si encuentras un tutorial que lo instala, tenlo en cuenta.

Hay una [lista completa de controladores](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) en la documentación de Kubernetes.

### Gateway API

**[Gateway API](https://gateway-api.sigs.k8s.io)** es la evolución de Ingress. Resuelve varias de sus limitaciones: separa responsabilidades entre quien gestiona la infraestructura (`Gateway`) y quien define las rutas de cada aplicación (`HTTPRoute`), y estandariza funcionalidades que con Ingress dependían de anotaciones específicas de cada controlador.

No es un controlador, sino una API que implementan los controladores: Traefik, Envoy Gateway, Istio, Kong o Application Gateway for Containers, entre otros. Para este laboratorio usaremos Ingress, que es más sencillo y suficiente, pero Gateway API es hacia donde se mueve el ecosistema.

### `port-forward`

`kubectl port-forward` crea un túnel temporal entre un puerto de nuestra máquina y un Service o pod del clúster. Es la forma más rápida de probar un servicio sin configurar un Ingress, pero solo funciona mientras el comando está en ejecución y solo para quien lo lanza. Es una herramienta de depuración, no una forma de exponer servicios.

### Aspire: `publish` frente a `deploy`

Aspire tiene dos comandos relacionados con el despliegue:

* **`aspire publish`** genera los artefactos de despliegue (en nuestro caso, un Helm chart) a partir del AppHost, sin tocar ningún entorno.
* **`aspire deploy`** además los despliega en el entorno de destino.

Usaremos `publish` para ver y entender qué genera Aspire antes de instalarlo, que es justo lo que nos interesa en un laboratorio.

> Los comandos están pensados para **PowerShell 7** en Windows. Uso `curl.exe` en lugar de `curl` para evitar el alias de `Invoke-WebRequest` de Windows PowerShell, y `Select-String` en lugar de `grep`.

## Prerrequisitos

### .NET 10 SDK

Necesario para compilar la solución y para el AppHost de Aspire. Se descarga desde la [web oficial de .NET](https://dotnet.microsoft.com/download/dotnet/10.0).

### Rancher Desktop

[Rancher Desktop](https://rancherdesktop.io) nos da, en una sola instalación, motor de contenedores, un clúster de Kubernetes basado en k3s y `kubectl`. Es una buena alternativa si no puedes o no quieres usar Docker Desktop.

Un apunte honesto: Aspire soporta oficialmente **Docker Desktop** y **Podman** como runtimes de contenedores. Rancher Desktop aparece en la [documentación de prerrequisitos](https://aspire.dev/get-started/prerequisites/) como una opción reportada por la comunidad, que funciona especialmente bien cuando se configura con el motor compatible con Docker. Para este laboratorio ha funcionado sin problemas.

### Helm

Aspire genera un Helm chart, así que necesitamos Helm para instalarlo:

```powershell
winget install Helm.Helm
helm version
```

### Aspire CLI

La forma más rápida de instalarla en Windows es con el script oficial:

```powershell
irm https://aspire.dev/install.ps1 | iex
```

También puede instalarse como herramienta global de .NET:

```powershell
dotnet tool install -g Aspire.Cli
```

En ambos casos, comprobamos la instalación con:

```powershell
aspire --version
```

Más detalles en la [guía de instalación de la CLI](https://aspire.dev/get-started/install-cli/).

## Configurar Rancher Desktop

En **Preferences** (o **Settings**, según la versión):

1. **Container Engine**: seleccionamos **dockerd (moby)**. Es el motor compatible con la CLI de Docker, lo que nos permite construir imágenes con `docker build` y que el clúster las vea directamente, sin registry intermedio.
2. **Kubernetes**: activamos **Enable Kubernetes** y elegimos una versión estable.
3. **Traefik**: lo dejamos activado. Rancher Desktop lo instala por defecto como Ingress Controller y nos sirve perfectamente.

Aplicamos los cambios y esperamos a que el clúster arranque. Comprobamos que `kubectl` apunta al clúster correcto:

```powershell
kubectl config current-context   # rancher-desktop
kubectl get nodes                # un nodo en estado Ready
```

Y que Traefik está disponible. Vive en el namespace `kube-system`, por eso no aparece en los listados del namespace `default`:

```powershell
kubectl get pods -n kube-system | Select-String traefik
kubectl get ingressclass
```

El segundo comando debe mostrar una IngressClass llamada `traefik`.

## Preparar el AppHost para Kubernetes

Partimos del AppHost del post anterior, con la API y el MCP Server:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.WeatherApi>("api");

builder.AddProject<Projects.WeatherMcp>("mcp")
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
```

Añadimos la integración de Kubernetes desde la carpeta del AppHost:

```powershell
aspire add kubernetes
```

Y declaramos un entorno de Kubernetes en el AppHost:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

builder.AddKubernetesEnvironment("k8s");

var api = builder.AddProject<Projects.WeatherApi>("api");

builder.AddProject<Projects.WeatherMcp>("mcp")
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
```

`AddKubernetesEnvironment` es lo que indica a Aspire que, al publicar, debe generar artefactos para Kubernetes. Toda la documentación de esta integración está en la [página de la integración de Kubernetes](https://aspire.dev/integrations/compute/kubernetes/).

## Generar el Helm chart

```powershell
aspire publish -p kubernetes -o k8s-output
```

Aspire **no despliega**: genera los artefactos para que los despleguemos nosotros. En la carpeta `k8s-output` tendremos un Helm chart con `Chart.yaml`, `values.yaml` y una carpeta `templates` con los Deployments, Services y ConfigMaps.

Merece la pena echar un vistazo al `values.yaml`. Estas son las partes que nos interesan:

```yaml
parameters:
  api:
    port_http: 8080
    api_image: "api:latest"
  mcp:
    port_http: 8080
    mcp_image: "mcp:latest"
config:
  mcp:
    services__api__http__0: ""
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://k8s-dashboard-service:18889"
    # ...
```

Tres detalles:

* Las imágenes se llaman `api:latest` y `mcp:latest`, sin registry. Volveremos a esto enseguida.
* Las variables `services__api__http__0` son la traducción del `WithReference(api)`: es el mismo service discovery que usábamos en local, ahora apuntando al Service de Kubernetes.
* La telemetría apunta a `k8s-dashboard-service`: Aspire incluye **su propio dashboard** en el chart. Lo veremos al final.

## Construir las imágenes

Con el motor `dockerd` de Rancher Desktop, las imágenes que construimos con `docker build` quedan directamente disponibles para el clúster. Las construimos con los nombres exactos que espera el chart, desde la carpeta que contiene los proyectos (el contexto de build debe incluir los proyectos referenciados):

```powershell
cd src
docker build -t api:latest -f WeatherApi/Dockerfile .
docker build -t mcp:latest -f WeatherMcp/Dockerfile .
```

Comprobamos que existen:

```powershell
docker images | Select-String "api|mcp"
```

## Instalar el chart

Antes de instalar, podemos ver el YAML final que Helm aplicará al clúster, con los valores ya sustituidos:

```powershell
helm template weather-solution ./k8s-output
```

Si todo cuadra, instalamos la release:

```powershell
helm install weather-solution ./k8s-output
kubectl get pods
```

Helm nos dice que la instalación ha ido bien... pero los pods no opinan lo mismo:

```
NAME                                   READY   STATUS         RESTARTS
api-deployment-6fdfc7ddd5-s8v4h        0/1     ErrImagePull   0
k8s-dashboard-deployment-596c65c744-vx8tz  1/1  Running       0
mcp-deployment-5b6df5b94f-w8r7g        0/1     ErrImagePull   0
```

## Problema 1: `ErrImagePull` con imágenes locales

### Qué ocurre

Las imágenes existen en local, pero Kubernetes intenta **descargarlas** igualmente. La clave está en la **política de descarga por defecto**, `imagePullPolicy`, que Kubernetes asigna [según el tag de la imagen](https://kubernetes.io/docs/concepts/containers/images/#imagepullpolicy-defaulting):

* Si el tag es `:latest`, o no hay tag, la política por defecto es **`Always`**: descargar siempre.
* Con cualquier otro tag, la política por defecto es **`IfNotPresent`**: descargar solo si no está en el nodo.

Como el chart usa `api:latest` y `mcp:latest` sin registry, Kubernetes intenta descargarlas de Docker Hub (`docker.io/library/api:latest`), donde no existen. De ahí el `ErrImagePull`.

El dashboard, en cambio, arranca sin problemas porque su imagen es pública y sí se puede descargar.

Podemos confirmarlo en los eventos del pod:

```powershell
kubectl describe pod <api-pod-name>
```

### Cómo lo solucionamos

Forzamos la política `Never` en los dos Deployments, para que Kubernetes use siempre la imagen local. Primero comprobamos el nombre del contenedor dentro de cada Deployment:

```powershell
kubectl get deployment api-deployment -o jsonpath="{.spec.template.spec.containers[*].name}"
```

Creamos un fichero de patch por Deployment, usando el nombre del contenedor obtenido. Por ejemplo, `patch-api.yaml`:

```yaml
spec:
  template:
    spec:
      containers:
        - name: api
          imagePullPolicy: Never
```

Y lo aplicamos (lo mismo para `mcp` con su propio fichero):

```powershell
kubectl patch deployment api-deployment --patch-file patch-api.yaml
kubectl patch deployment mcp-deployment --patch-file patch-mcp.yaml
kubectl get pods
```

Usar un fichero en lugar de JSON en línea evita los problemas de escapado de comillas entre shells. Al modificar el Deployment, Kubernetes recrea los pods, que ahora pasan a `Running`.

### Alternativas

El patch funciona, pero tiene un inconveniente: **se pierde en el siguiente `helm upgrade`**, porque el chart no sabe nada de él. Estas son otras opciones:

* **Usar un tag distinto de `latest`**. Es probablemente la más limpia. Si construimos las imágenes como `api:1.0` y `mcp:1.0`, la política por defecto pasa a ser `IfNotPresent` y Kubernetes usará las imágenes locales sin tocar nada más. Como los nombres de imagen son parámetros del chart, basta con sobrescribirlos al instalar:

  ```powershell
  docker build -t api:1.0 -f WeatherApi/Dockerfile .
  docker build -t mcp:1.0 -f WeatherMcp/Dockerfile .

  helm install weather-solution ./k8s-output `
    --set parameters.api.api_image=api:1.0 `
    --set parameters.mcp.mcp_image=mcp:1.0
  ```

* **Editar las plantillas del chart** para añadir `imagePullPolicy`. Funciona, pero el chart es generado: cada `aspire publish` sobrescribe los cambios.

* **Usar un registry local**, por ejemplo levantando un contenedor `registry:2`, y publicar ahí las imágenes. Es lo más parecido a un entorno real, a cambio de un paso más en cada build.

* **En un clúster real** (AKS, por ejemplo), lo correcto es publicar las imágenes en un registry como Azure Container Registry y dejar la política por defecto. El problema desaparece.

## Comprobación intermedia

Antes de configurar el Ingress, comprobamos que todo responde usando `port-forward`, que redirige un puerto local a un Service del clúster.

Para la API:

```powershell
kubectl port-forward svc/api-service 8080:8080
```

Y en otra terminal:

```powershell
curl.exe http://localhost:8080/weatherforecast
```

Lo mismo para el MCP Server, que responderá en `http://localhost:8081/mcp`:

```powershell
kubectl port-forward svc/mcp-service 8081:8080
```

## Exponer los servicios con un Ingress

Aspire no genera un Ingress para este escenario, así que lo creamos nosotros. Antes, confirmamos los nombres y puertos de los Services:

```powershell
kubectl get svc
```

Veremos `api-service` y `mcp-service` en el puerto 8080, además del Service del dashboard y el Service `kubernetes`, que existe siempre y apunta a la API del propio clúster.

### Primer intento: enrutado por host

La opción más habitual es un host por servicio. Creamos `ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: weather-ingress
spec:
  ingressClassName: traefik
  rules:
    - host: api.weather.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
    - host: mcp.weather.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mcp-service
                port:
                  number: 8080
```

```powershell
kubectl apply -f ingress.yaml
kubectl get ingress
```

Para que esos nombres resuelvan a nuestra máquina, lo normal es añadirlos al fichero `hosts`. Aquí apareció el primer obstáculo: en un equipo corporativo, sin permisos de administrador, no siempre es posible modificarlo.

Podemos comprobar que el Ingress funciona igualmente enviando la cabecera `Host` a mano, que es lo que Traefik usa para elegir la regla:

```powershell
curl.exe http://127.0.0.1/weatherforecast -H "Host: api.weather.local"
```

Funciona. Así que intentamos lo mismo en VS Code, apuntando a `127.0.0.1` y añadiendo la cabecera en `.vscode/mcp.json`:

```json
{
  "servers": {
    "weather-mcp": {
      "type": "http",
      "url": "http://127.0.0.1/mcp",
      "headers": {
        "Host": "mcp.weather.local"
      }
    }
  }
}
```

Y aquí llega el segundo problema.

## Problema 2: VS Code y el enrutado por host

### Qué ocurre

VS Code no consigue conectar. En el log del servidor MCP vemos algo así:

```
404 status sending message to http://127.0.0.1/mcp, will attempt to fall back to legacy SSE
Connection state: Error 404 status connecting to http://127.0.0.1/mcp as SSE: 404 page not found
```

Ese `404 page not found`, en texto plano, es la respuesta por defecto de **Traefik cuando ninguna regla coincide**. Es decir, la petición ni siquiera llega al MCP Server.

La razón es que la cabecera `Host` personalizada **no llega a enviarse**. `Host` no es una cabecera cualquiera: el cliente HTTP la calcula a partir de la URL, y en este caso el valor configurado no se aplicó. La petición sale con `Host: 127.0.0.1`, y como nuestras reglas solo contemplan `api.weather.local` y `mcp.weather.local`, Traefik devuelve 404.

### Cómo lo diagnosticamos

La herramienta clave es `curl.exe -v`, que muestra la conversación HTTP completa: las líneas que empiezan por `>` son lo que se envía y las que empiezan por `<` lo que se recibe. Reproducimos lo que hace VS Code, sin cabecera `Host`, con una petición MCP real:

```powershell
curl.exe -v http://127.0.0.1/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

En la salida se ve claramente:

```
> POST /mcp HTTP/1.1
> Host: 127.0.0.1
...
< HTTP/1.1 404 Not Found
< Content-Type: text/plain; charset=utf-8
...
404 page not found
```

`Host: 127.0.0.1` y un 404 de Traefik. Con la cabecera correcta, en cambio, la petición sí llega al pod. El problema no está en Kubernetes ni en el MCP Server, sino en la dependencia de una cabecera que el cliente no envía.

### Cómo lo solucionamos

Si el problema es depender del host, **dejamos de depender de él**. Reescribimos el Ingress para enrutar por **ruta** en lugar de por host:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: weather-ingress
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /mcp
            pathType: Prefix
            backend:
              service:
                name: mcp-service
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8080
```

Sin `host`, las reglas aplican a cualquier petición que llegue a Traefik. Las peticiones a `/mcp` van al MCP Server y el resto a la API, porque Traefik prioriza la regla más específica.

```powershell
kubectl apply -f ingress.yaml
kubectl get ingress
```

La columna `HOSTS` debe aparecer vacía o con `*`. Si todavía muestra los hosts anteriores, el cambio no se ha aplicado. Y ahora sí:

```powershell
curl.exe http://127.0.0.1/weatherforecast
```

### Alternativas

* **Editar el fichero `hosts`**, si tienes permisos de administrador. Es la vía clásica: añadir `127.0.0.1 api.weather.local` y `127.0.0.1 mcp.weather.local` en `C:\Windows\System32\drivers\etc\hosts`, abriendo el editor como administrador.
* **Usar un servicio de DNS comodín** como `nip.io`, donde cualquier nombre del tipo `mcp.127.0.0.1.nip.io` resuelve a `127.0.0.1` sin tocar el fichero `hosts`. Solo hay que usar esos nombres en las reglas del Ingress. Requiere acceso a DNS público.
* **Usar `port-forward`** directamente contra el Service, como hicimos en la comprobación intermedia. Sirve para probar, pero hay que mantener el comando en marcha.
* **En un clúster real**, con nombres DNS de verdad, el enrutado por host funciona sin problemas, porque el cliente envía el `Host` que corresponde a la URL. El problema es propio de trabajar contra `127.0.0.1`.

## Conectar el MCP Server desde Visual Studio Code

Con el Ingress por ruta, la configuración de `.vscode/mcp.json` queda así de sencilla:

```json
{
  "servers": {
    "weather-mcp": {
      "type": "http",
      "url": "http://127.0.0.1/mcp"
    }
  }
}
```

Arrancamos el servidor desde VS Code y descubre la tool `GetWeatherForecast`. A partir de aquí, el modelo puede usarla en modo agente: la petición pasa por Traefik, llega al MCP Server y este llama a la API dentro del clúster usando el service discovery de Aspire.

## Extra: el dashboard de Aspire en el clúster

Al revisar los pods habrás visto `k8s-dashboard-deployment`. A pesar del nombre, **no es el Kubernetes Dashboard**, sino el **dashboard de Aspire**, que el chart incluye para recibir la telemetría de la API y del MCP Server.

Para acceder a él, redirigimos su puerto:

```powershell
kubectl get svc k8s-dashboard-service
kubectl port-forward svc/k8s-dashboard-service 18888:18888
```

Al abrir `http://localhost:18888`, el dashboard pide un **token**. Se genera al arrancar y aparece en sus logs:

```powershell
kubectl logs deployment/k8s-dashboard-deployment
```

Buscamos una línea con `login?t=...`: el valor de `t` es el token.

Desde el dashboard podemos seguir cada llamada de extremo a extremo, desde la petición del cliente MCP hasta la llamada a la API. Eso sí, es una herramienta de desarrollo: en un entorno real, la telemetría debería ir a una plataforma de observabilidad como Application Insights o Prometheus.

## Conclusiones

Hemos llevado una solución de Aspire con un MCP Server a un clúster de Kubernetes local sin escribir manifiestos a mano, salvo el Ingress. Por el camino nos quedan dos lecciones útiles más allá de este laboratorio:

* **Las imágenes con tag `latest` siempre intentan descargarse.** En local, conviene usar tags explícitos o forzar `imagePullPolicy`.
* **El enrutado por host depende de que el cliente envíe el `Host` correcto.** Contra `127.0.0.1`, el enrutado por ruta evita el problema.

Quedan fuera de este laboratorio dos temas importantes que merecen su propio artículo: la **seguridad** del MCP Server (autenticación con Microsoft Entra ID, tanto de usuarios como de aplicaciones) y el paso a un **clúster real en AKS**.

## Referencias

* [Prerrequisitos de Aspire](https://aspire.dev/get-started/prerequisites/)
* [Instalación de la CLI de Aspire](https://aspire.dev/get-started/install-cli/)
* [Integración de Kubernetes en Aspire](https://aspire.dev/integrations/compute/kubernetes/)
* [Rancher Desktop](https://rancherdesktop.io)
* [Helm](https://helm.sh) y su [guía de instalación](https://helm.sh/docs/intro/install/)
* [Kubernetes: imágenes e `imagePullPolicy`](https://kubernetes.io/docs/concepts/containers/images/)
* [Kubernetes: Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
* [Kubernetes: Ingress Controllers disponibles](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/)
* [Traefik](https://doc.traefik.io/traefik/)
* [Gateway API](https://gateway-api.sigs.k8s.io)
* [Retirada de Ingress NGINX](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
