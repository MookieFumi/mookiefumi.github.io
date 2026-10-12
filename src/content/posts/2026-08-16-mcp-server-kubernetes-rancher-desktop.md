---
title: "Laboratorio: MCP Server en Kubernetes local con Aspire y Rancher Desktop"
subtitle: De la solución de Aspire a un clúster local, paso a paso y con sus tropiezos
date: 2026-08-16
topic: k8s
series: mcp-dotnet
published: true
---

En el [post anterior](/2026-08-15-mcp-server-sdk-dotnet) creamos un MCP Server con el SDK oficial de .NET que consume una API de ejemplo (`GET /brentforecast`), todo orquestado con Aspire. En este laboratorio vamos a llevar esa misma solución a un clúster de Kubernetes local, exponerla con un Ingress y conectarla desde Visual Studio Code.

No es un camino de rosas, y por eso me apetece contarlo: por el camino aparecen dos problemas muy habituales al trabajar con Kubernetes en local. Los veremos con su solución y algunas alternativas.

## Lo que vamos a montar

* Rancher Desktop como motor de contenedores y clúster de Kubernetes local (k3s).
* Aspire para generar, a partir del AppHost, un Helm chart con todo lo necesario.
* Traefik, que ya viene integrado en Rancher Desktop, como Ingress Controller.
* Visual Studio Code como cliente MCP.

Al final tendremos VS Code conectado al MCP Server que corre en Kubernetes, y este llamando a la API dentro del propio clúster.

## Conceptos clave

Antes de ponernos manos a la obra, conviene tener claras las piezas que vamos a usar. Son bastantes y cada una resuelve un problema distinto.

### Kubernetes, clúster y nodo

Kubernetes es un orquestador de contenedores: le decimos qué queremos tener en ejecución (qué imágenes, cuántas réplicas, cómo se comunican) y él se encarga de conseguirlo y mantenerlo, reiniciando lo que falle.

Un clúster es el conjunto de máquinas que gestiona Kubernetes, y cada una de esas máquinas es un nodo. En local tendremos un clúster de un solo nodo: nuestro propio equipo.

k3s es una distribución ligera de Kubernetes, pensada para entornos con pocos recursos, y es la que usa Rancher Desktop. Para lo que vamos a hacer se comporta igual que un Kubernetes completo.

Con Kubernetes se trabaja de forma declarativa: describimos los recursos en ficheros YAML (manifiestos) y los aplicamos con `kubectl`, la herramienta de línea de comandos del clúster.

### Pod, Deployment y Service

Estos son los tres recursos básicos con los que vamos a trabajar:

* Pod: la unidad mínima de ejecución, que envuelve uno o varios contenedores. Los pods son efímeros: se crean, se destruyen y cambian de IP.
* Deployment: describe cómo deben ejecutarse los pods de una aplicación (qué imagen, cuántas réplicas, qué variables de entorno) y se encarga de que se cumpla. Si un pod muere, el Deployment crea otro.
* Service (`svc` en `kubectl`): da un nombre y una dirección estables a un conjunto de pods y reparte el tráfico entre ellos. Como los pods cambian de IP, los demás componentes nunca hablan con un pod directamente, sino con su Service. Dentro del clúster, cada Service tiene un nombre DNS: nuestro MCP Server llegará a la API a través del Service `brent-api-service`.

Por defecto, un Service solo es accesible desde dentro del clúster. Para llegar desde fuera hace falta algo más: un Ingress.

### Imágenes y registry

Kubernetes no compila nada: ejecuta imágenes de contenedor que normalmente descarga de un registry (Docker Hub, Azure Container Registry, GitHub Container Registry...). En local podemos saltarnos el registry si el clúster comparte el motor de contenedores con el que construimos las imágenes, que es lo que haremos con Rancher Desktop. Tiene sus matices, como veremos en el primer problema.

### Helm

[Helm](https://helm.sh) es el gestor de paquetes de Kubernetes. Igual que NuGet empaqueta librerías, Helm empaqueta aplicaciones completas para Kubernetes. Maneja tres conceptos:

* Chart: el paquete. Es una carpeta con plantillas de manifiestos (Deployments, Services...) y un fichero de valores por defecto.
* Values: los parámetros del chart, definidos en `values.yaml`. Permiten reutilizar el mismo chart con distintas configuraciones (nombres de imagen, puertos, variables de entorno) sin tocar las plantillas. Se pueden sobrescribir al instalar con `--set` o con otro fichero de valores.
* Release: una instalación concreta de un chart en un clúster, con un nombre. El mismo chart puede instalarse varias veces con releases distintas.

Los comandos que usaremos:

```powershell
helm install <release> <chart>     # instala un chart
helm upgrade <release> <chart>     # actualiza una release existente
helm list                          # lista las releases instaladas
helm template <release> <chart>    # renderiza el YAML final sin instalar nada
helm uninstall <release>           # elimina la release y sus recursos
```

¿Por qué Helm y no manifiestos sueltos? Porque agrupa los recursos de la aplicación, permite parametrizarlos y gestiona su ciclo de vida como una unidad, así que se instala, actualiza o elimina todo de una vez. Además, es el formato que genera Aspire.

### Ingress e Ingress Controller

Son dos piezas que se suelen confundir:

* Ingress es un recurso de Kubernetes que define reglas de enrutado HTTP desde fuera del clúster hacia los Services: *"las peticiones a este host o a esta ruta van a este Service"*. Por sí solo no hace nada, es configuración.
* Ingress Controller es el componente que lee esas reglas y las aplica. Es un proxy inverso que se ejecuta dentro del clúster, recibe el tráfico externo y lo reparte según los Ingress definidos.

La relación entre ambos la establece la IngressClass: cada Ingress indica en `ingressClassName` qué controlador debe gestionarlo. Así pueden convivir varios controladores en el mismo clúster.

El recorrido de una petición en el laboratorio será este:

```
VS Code ──► Traefik (Ingress Controller) ──► regla del Ingress ──► brent-mcp-service ──► pod del MCP Server
                                                                                                  │
                                                            brent-api-service ◄───────────────────┘
                                                                    │
                                                                    ▼
                                                              pod de la API
```

Más detalles en la [documentación de Kubernetes sobre Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/).

### Traefik

[Traefik](https://doc.traefik.io/traefik/) es un proxy inverso y balanceador de carga open source, muy extendido como Ingress Controller. Es el que incluye k3s por defecto, y por tanto Rancher Desktop, así que no hay que instalar nada.

Además de entender los recursos Ingress estándar, tiene los suyos (como los *Middlewares*, para reescribir rutas o añadir cabeceras) y soporta Gateway API. Sus opciones avanzadas no se configuran con las anotaciones de otros controladores, así que los ejemplos para NGINX no siempre sirven tal cual.

### Alternativas a Traefik

Traefik no es la única opción. Estas son algunas de las habituales:

| Controlador | Características | Cuándo tiene sentido |
| --- | --- | --- |
| Traefik | Ligero, configuración sencilla, incluido en k3s. | Entornos locales, clústeres pequeños y medianos. |
| Ingress NGINX (`kubernetes/ingress-nginx`) | Ha sido el más usado durante años. Retirado en marzo de 2026: ya no recibe actualizaciones ni parches de seguridad. | No debería usarse en nuevos proyectos. |
| NGINX Ingress Controller (de F5/NGINX) | Proyecto distinto al anterior, pese al nombre parecido, y con mantenimiento activo. | Si ya trabajas con NGINX y quieres seguir en ese ecosistema. |
| HAProxy Ingress | Basado en HAProxy, con muy buen rendimiento. | Cargas con mucho tráfico. |
| Kong | Ingress Controller con funcionalidades de API Gateway (autenticación, rate limiting, plugins). | Cuando además del enrutado necesitas gestionar APIs. |
| Envoy Gateway / Contour | Basados en Envoy, muy orientados a Gateway API. | Plataformas que apuestan por Gateway API. |
| Istio | Service mesh con su propia puerta de entrada al clúster. | Cuando ya usas o necesitas un service mesh. |
| Application Gateway for Containers | Servicio gestionado de Azure para AKS, compatible con Ingress y Gateway API. | Producción en AKS con un balanceador gestionado. |

Ingress NGINX merece un apunte, porque durante mucho tiempo ha sido la opción por defecto en tutoriales y ejemplos. El proyecto de Kubernetes [anunció su retirada](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) y [recomienda migrar](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/), preferiblemente a Gateway API. Las instalaciones existentes siguen funcionando, pero sin parches de seguridad, así que desconfía de cualquier tutorial que lo instale.

Hay una [lista completa de controladores](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/) en la documentación de Kubernetes.

### Gateway API

[Gateway API](https://gateway-api.sigs.k8s.io) es la evolución de Ingress y resuelve varias de sus limitaciones: separa responsabilidades entre quien gestiona la infraestructura (`Gateway`) y quien define las rutas de cada aplicación (`HTTPRoute`), y estandariza funcionalidades que con Ingress dependían de anotaciones específicas de cada controlador.

No es un controlador sino una API que implementan los controladores (Traefik, Envoy Gateway, Istio, Kong o Application Gateway for Containers, entre otros). En este laboratorio usaremos Ingress, que es más sencillo y nos basta, aunque el ecosistema se mueve hacia Gateway API.

### `port-forward`

`kubectl port-forward` crea un túnel temporal entre un puerto de nuestra máquina y un Service o pod del clúster. Es la forma más rápida de probar un servicio sin configurar un Ingress, pero solo funciona mientras el comando está en ejecución y solo para quien lo lanza. Sirve para depurar, no para exponer servicios.

### Aspire: `publish` frente a `deploy`

Aspire tiene dos comandos relacionados con el despliegue:

* `aspire publish` genera los artefactos de despliegue (en nuestro caso, un Helm chart) a partir del AppHost, sin tocar ningún entorno.
* `aspire deploy` además los despliega en el entorno de destino.

Usaremos `publish` para ver qué genera Aspire antes de instalarlo, que es lo que interesa en un laboratorio.

> Los comandos están pensados para PowerShell 7 en Windows. Uso `curl.exe` en lugar de `curl` para evitar el alias de `Invoke-WebRequest` de Windows PowerShell, y `Select-String` en lugar de `grep`.

## Prerrequisitos

### .NET 10 SDK

Hace falta para compilar la solución y para el AppHost de Aspire. Se descarga desde la [web oficial de .NET](https://dotnet.microsoft.com/download/dotnet/10.0).

### Rancher Desktop

[Rancher Desktop](https://rancherdesktop.io) trae en una sola instalación un motor de contenedores, un clúster de Kubernetes basado en k3s y `kubectl`. Es una buena alternativa si no puedes o no quieres usar Docker Desktop.

Un apunte: Aspire soporta oficialmente Docker Desktop y Podman como runtimes de contenedores. Rancher Desktop aparece en la [documentación de prerrequisitos](https://aspire.dev/get-started/prerequisites/) como una opción reportada por la comunidad, que funciona bien cuando se configura con el motor compatible con Docker. En este laboratorio me ha funcionado sin problemas.

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

En Preferences (o Settings, según la versión):

1. Container Engine: seleccionamos dockerd (moby). Es el motor compatible con la CLI de Docker, así que podemos construir imágenes con `docker build` y el clúster las ve directamente, sin registry intermedio.
2. Kubernetes: activamos Enable Kubernetes y elegimos una versión estable.
3. Traefik: lo dejamos activado. Rancher Desktop lo instala por defecto como Ingress Controller y nos vale.

Aplicamos los cambios y esperamos a que el clúster arranque. Después comprobamos que `kubectl` apunta al clúster correcto:

```powershell
kubectl config current-context   # rancher-desktop
kubectl get nodes                # un nodo en estado Ready
```

Y que Traefik está disponible. Vive en el namespace `kube-system`, por eso no aparece en los listados del namespace `default`:

```powershell
kubectl get pods -n kube-system | Select-String traefik
kubectl get ingressclass
```

El segundo comando tiene que mostrar una IngressClass llamada `traefik`.

## Preparar el AppHost para Kubernetes

Partimos del AppHost del post anterior, con la API y el MCP Server:

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.BrentApi>("brent-api");

builder.AddProject<Projects.BrentMcp>("brent-mcp")
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

var api = builder.AddProject<Projects.BrentApi>("brent-api");

builder.AddProject<Projects.BrentMcp>("brent-mcp")
    .WithReference(api)
    .WaitFor(api);

builder.Build().Run();
```

`AddKubernetesEnvironment` indica a Aspire que, al publicar, genere artefactos para Kubernetes. La integración está documentada en la [página de la integración de Kubernetes](https://aspire.dev/integrations/compute/kubernetes/).

## Generar el Helm chart

```powershell
aspire publish -p kubernetes -o k8s-output
```

Aspire no despliega, genera los artefactos para que los despleguemos nosotros. En la carpeta `k8s-output` tendremos un Helm chart con `Chart.yaml`, `values.yaml` y una carpeta `templates` con los Deployments, Services y ConfigMaps.

Conviene echar un vistazo al `values.yaml`. Estas son las partes que nos interesan:

```yaml
parameters:
  brent_api:
    port_http: 8080
    brent_api_image: "brent-api:latest"
  brent_mcp:
    port_http: 8080
    brent_mcp_image: "brent-mcp:latest"
config:
  brent_mcp:
    services__brent-api__http__0: ""
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://k8s-dashboard-service:18889"
    # ...
```

Hay tres cosas que ver:

* Las imágenes se llaman `brent-api:latest` y `brent-mcp:latest`, sin registry. Volveremos a esto enseguida.
* Las variables `services__brent-api__http__0` son la traducción del `WithReference(api)`: es el mismo service discovery de local, ahora apuntando al Service de Kubernetes.
* La telemetría apunta a `k8s-dashboard-service`: Aspire incluye su propio dashboard en el chart. Lo veremos al final.

## Construir las imágenes

Con el motor `dockerd` de Rancher Desktop, las imágenes que construimos con `docker build` quedan disponibles para el clúster directamente. Las construimos con los nombres exactos que espera el chart y desde la carpeta que contiene los proyectos, porque el contexto de build debe incluir los proyectos referenciados:

```powershell
cd src
docker build -t brent-api:latest -f BrentApi/Dockerfile .
docker build -t brent-mcp:latest -f BrentMcp/Dockerfile .
```

Comprobamos que existen:

```powershell
docker images | Select-String "api|mcp"
```

## Instalar el chart

Antes de instalar, podemos ver el YAML final que Helm aplicará al clúster, con los valores ya sustituidos:

```powershell
helm template brent-solution ./k8s-output
```

Si todo cuadra, instalamos la release:

```powershell
helm install brent-solution ./k8s-output
kubectl get pods
```

Helm dice que la instalación ha ido bien, pero los pods no opinan lo mismo:

```
NAME                                   READY   STATUS         RESTARTS
brent-api-deployment-6fdfc7ddd5-s8v4h        0/1     ErrImagePull   0
k8s-dashboard-deployment-596c65c744-vx8tz  1/1  Running       0
brent-mcp-deployment-5b6df5b94f-w8r7g        0/1     ErrImagePull   0
```

## Problema 1: `ErrImagePull` con imágenes locales

### Qué ocurre

Las imágenes existen en local, pero Kubernetes intenta descargarlas igualmente. La clave está en la política de descarga por defecto, `imagePullPolicy`, que Kubernetes asigna [según el tag de la imagen](https://kubernetes.io/docs/concepts/containers/images/#imagepullpolicy-defaulting):

* Si el tag es `:latest`, o no hay tag, la política por defecto es `Always`: descargar siempre.
* Con cualquier otro tag, la política por defecto es `IfNotPresent`: descargar solo si no está en el nodo.

Como el chart usa `brent-api:latest` y `brent-mcp:latest` sin registry, Kubernetes intenta descargarlas de Docker Hub (`docker.io/library/brent-api:latest`), donde no existen. De ahí el `ErrImagePull`.

El dashboard arranca sin problemas porque su imagen es pública y sí se puede descargar.

Podemos confirmarlo en los eventos del pod:

```powershell
kubectl describe pod <api-pod-name>
```

### Cómo lo solucionamos

Forzamos la política `Never` en los dos Deployments para que Kubernetes use siempre la imagen local. Primero comprobamos el nombre del contenedor dentro de cada Deployment:

```powershell
kubectl get deployment brent-api-deployment -o jsonpath="{.spec.template.spec.containers[*].name}"
```

Creamos un fichero de patch por Deployment, usando el nombre del contenedor obtenido. Por ejemplo, `patch-brent-api.yaml`:

```yaml
spec:
  template:
    spec:
      containers:
        - name: brent-api
          imagePullPolicy: Never
```

Y lo aplicamos (lo mismo para `brent-mcp` con su propio fichero):

```powershell
kubectl patch deployment brent-api-deployment --patch-file patch-brent-api.yaml
kubectl patch deployment brent-mcp-deployment --patch-file patch-brent-mcp.yaml
kubectl get pods
```

Usamos un fichero en lugar de JSON en línea para evitar los problemas de escapado de comillas entre shells. Al modificar el Deployment, Kubernetes recrea los pods, que ahora pasan a `Running`.

### Alternativas

El patch funciona, pero se pierde en el siguiente `helm upgrade`, porque el chart no sabe nada de él. Hay otras opciones:

* Usar un tag distinto de `latest`. Es probablemente la más limpia. Si construimos las imágenes como `brent-api:1.0` y `brent-mcp:1.0`, la política por defecto pasa a ser `IfNotPresent` y Kubernetes usará las imágenes locales sin tocar nada más. Como los nombres de imagen son parámetros del chart, basta con sobrescribirlos al instalar:

  ```powershell
  docker build -t brent-api:1.0 -f BrentApi/Dockerfile .
  docker build -t brent-mcp:1.0 -f BrentMcp/Dockerfile .

  helm install brent-solution ./k8s-output `
    --set parameters.brent_api.brent_api_image=brent-api:1.0 `
    --set parameters.brent_mcp.brent_mcp_image=brent-mcp:1.0
  ```

* Editar las plantillas del chart para añadir `imagePullPolicy`. Funciona, pero el chart es generado y cada `aspire publish` sobrescribe los cambios.

* Usar un registry local, por ejemplo con un contenedor `registry:2`, y publicar ahí las imágenes. Se parece más a un entorno real, a cambio de un paso más en cada build.

* En un clúster real (AKS, por ejemplo) lo correcto es publicar las imágenes en un registry como Azure Container Registry y dejar la política por defecto. Ahí el problema no existe.

## Comprobación intermedia

Antes de configurar el Ingress, comprobamos con `port-forward` que todo responde. Redirige un puerto local a un Service del clúster.

Para la API:

```powershell
kubectl port-forward svc/brent-api-service 8080:8080
```

Y en otra terminal:

```powershell
curl.exe http://localhost:8080/brentforecast
```

Hacemos lo mismo con el MCP Server, que responderá en `http://localhost:8081/mcp`:

```powershell
kubectl port-forward svc/brent-mcp-service 8081:8080
```

## Exponer los servicios con un Ingress

Aspire no genera un Ingress para este escenario, así que lo creamos nosotros. Antes, confirmamos los nombres y puertos de los Services:

```powershell
kubectl get svc
```

Aparecen `brent-api-service` y `brent-mcp-service` en el puerto 8080, además del Service del dashboard y el Service `kubernetes`, que existe siempre y apunta a la API del propio clúster.

### Primer intento: enrutado por host

Lo más habitual es un host por servicio. Creamos `ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: brent-ingress
spec:
  ingressClassName: traefik
  rules:
    - host: api.brent.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: brent-api-service
                port:
                  number: 8080
    - host: mcp.brent.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: brent-mcp-service
                port:
                  number: 8080
```

```powershell
kubectl apply -f ingress.yaml
kubectl get ingress
```

Para que esos nombres resuelvan a nuestra máquina, lo normal es añadirlos al fichero `hosts`. Ahí me topé con el primer obstáculo: en un equipo corporativo, sin permisos de administrador, no siempre se puede modificar.

Aun así podemos comprobar que el Ingress funciona enviando a mano la cabecera `Host`, que es lo que Traefik usa para elegir la regla:

```powershell
curl.exe http://127.0.0.1/brentforecast -H "Host: api.brent.local"
```

Funciona, así que probamos lo mismo en VS Code, apuntando a `127.0.0.1` y añadiendo la cabecera en `.vscode/mcp.json`:

```json
{
  "servers": {
    "brent-mcp": {
      "type": "http",
      "url": "http://127.0.0.1/mcp",
      "headers": {
        "Host": "mcp.brent.local"
      }
    }
  }
}
```

Y aquí llega el segundo problema.

## Problema 2: VS Code y el enrutado por host

### Qué ocurre

VS Code no consigue conectar. En el log del servidor MCP aparece algo así:

```
404 status sending message to http://127.0.0.1/mcp, will attempt to fall back to legacy SSE
Connection state: Error 404 status connecting to http://127.0.0.1/mcp as SSE: 404 page not found
```

Ese `404 page not found`, en texto plano, es la respuesta por defecto de Traefik cuando ninguna regla coincide. La petición ni siquiera llega al MCP Server.

La cabecera `Host` personalizada no llega a enviarse. `Host` no es una cabecera cualquiera: el cliente HTTP la calcula a partir de la URL, y aquí el valor configurado no se aplicó. La petición sale con `Host: 127.0.0.1` y, como nuestras reglas solo contemplan `api.brent.local` y `mcp.brent.local`, Traefik devuelve 404.

### Cómo lo diagnosticamos

Lo que más ayuda es `curl.exe -v`, que muestra la conversación HTTP completa: las líneas con `>` son lo que se envía y las que llevan `<` lo que se recibe. Reproducimos lo que hace VS Code, sin cabecera `Host`, con una petición MCP real:

```powershell
curl.exe -v http://127.0.0.1/mcp `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

En la salida se ve:

```
> POST /mcp HTTP/1.1
> Host: 127.0.0.1
...
< HTTP/1.1 404 Not Found
< Content-Type: text/plain; charset=utf-8
...
404 page not found
```

`Host: 127.0.0.1` y un 404 de Traefik. Con la cabecera correcta la petición sí llega al pod. El fallo no está en Kubernetes ni en el MCP Server, sino en depender de una cabecera que el cliente no envía.

### Cómo lo solucionamos

Si el problema es depender del host, dejamos de depender de él. Reescribimos el Ingress para enrutar por ruta en lugar de por host:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: brent-ingress
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /mcp
            pathType: Prefix
            backend:
              service:
                name: brent-mcp-service
                port:
                  number: 8080
          - path: /
            pathType: Prefix
            backend:
              service:
                name: brent-api-service
                port:
                  number: 8080
```

Sin `host`, las reglas aplican a cualquier petición que llegue a Traefik. Las peticiones a `/mcp` van al MCP Server y el resto a la API, porque Traefik prioriza la regla más específica.

```powershell
kubectl apply -f ingress.yaml
kubectl get ingress
```

La columna `HOSTS` debe aparecer vacía o con `*`; si todavía muestra los hosts anteriores, el cambio no se ha aplicado. Y ahora sí:

```powershell
curl.exe http://127.0.0.1/brentforecast
```

### Alternativas

* Editar el fichero `hosts`, si tienes permisos de administrador. Es la vía clásica: añadir `127.0.0.1 api.brent.local` y `127.0.0.1 mcp.brent.local` en `C:\Windows\System32\drivers\etc\hosts`, abriendo el editor como administrador.
* Usar un servicio de DNS comodín como `nip.io`, donde cualquier nombre del tipo `mcp.127.0.0.1.nip.io` resuelve a `127.0.0.1` sin tocar el fichero `hosts`. Basta con usar esos nombres en las reglas del Ingress, y hace falta acceso a DNS público.
* Usar `port-forward` contra el Service, como en la comprobación intermedia. Sirve para probar, pero hay que mantener el comando en marcha.
* En un clúster real, con nombres DNS de verdad, el enrutado por host funciona sin problemas porque el cliente envía el `Host` que corresponde a la URL. El problema viene de trabajar contra `127.0.0.1`.

## Conectar el MCP Server desde Visual Studio Code

Con el Ingress por ruta, la configuración de `.vscode/mcp.json` se queda en esto:

```json
{
  "servers": {
    "brent-mcp": {
      "type": "http",
      "url": "http://127.0.0.1/mcp"
    }
  }
}
```

Arrancamos el servidor desde VS Code y descubre la tool `GetBrentForecast`. El modelo ya puede usarla en modo agente: la petición pasa por Traefik, llega al MCP Server y este llama a la API dentro del clúster con el service discovery de Aspire.

## Extra: el dashboard de Aspire en el clúster

Al revisar los pods habrás visto `k8s-dashboard-deployment`. A pesar del nombre no es el Kubernetes Dashboard sino el dashboard de Aspire, que el chart incluye para recibir la telemetría de la API y del MCP Server.

Para entrar redirigimos su puerto:

```powershell
kubectl get svc k8s-dashboard-service
kubectl port-forward svc/k8s-dashboard-service 18888:18888
```

Al abrir `http://localhost:18888`, el dashboard pide un token. Se genera al arrancar y aparece en sus logs:

```powershell
kubectl logs deployment/k8s-dashboard-deployment
```

Buscamos una línea con `login?t=...`: el valor de `t` es el token.

Desde el dashboard se puede seguir cada llamada de extremo a extremo, desde la petición del cliente MCP hasta la llamada a la API. Eso sí, es una herramienta de desarrollo: en un entorno real la telemetría debería ir a una plataforma de observabilidad como Application Insights o Prometheus.

## Conclusiones

Hemos llevado una solución de Aspire con un MCP Server a un clúster de Kubernetes local sin escribir manifiestos a mano, salvo el Ingress. Me quedo con dos cosas de los tropiezos:

* Las imágenes con tag `latest` siempre intentan descargarse. En local conviene usar tags explícitos o forzar `imagePullPolicy`.
* El enrutado por host depende de que el cliente envíe el `Host` correcto. Contra `127.0.0.1`, enrutar por ruta evita el problema.

Quedan fuera dos temas que merecen su propio artículo: la seguridad del MCP Server (autenticación con Microsoft Entra ID, tanto de usuarios como de aplicaciones) y el paso a un clúster real en AKS.

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
