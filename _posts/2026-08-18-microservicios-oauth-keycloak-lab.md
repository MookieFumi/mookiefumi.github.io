---
layout: post
title: "Laboratorio: securizando microservicios con OAuth 2.1 y Keycloak"
subtitle: Usuarios y aplicaciones contra los servicios de un clúster de Kubernetes local, con un MCP Server como ejemplo
topic: seguridad
published: true
---

En los primeros posts de la serie creamos un [MCP Server con el SDK de .NET](/2026-08-15-mcp-server-sdk-dotnet) y lo [desplegamos en un clúster de Kubernetes local](/2026-08-16-mcp-server-kubernetes-rancher-desktop) con Aspire y Rancher Desktop. Funciona, pero tiene un problema evidente: cualquiera que llegue a la URL puede usar sus tools.

En este laboratorio lo protegemos con **OAuth 2.1** usando **Keycloak**, desplegado en el mismo clúster. Al terminar, el servicio aceptará dos tipos de llamadas:

* **Usuarios**, que inician sesión desde Visual Studio Code con el flujo *authorization code + PKCE*.
* **Aplicaciones**, que se autentican con su propio `client_id` y `client_secret` mediante *client credentials*.

Usamos el MCP Server como ejemplo, pero casi todo lo que sigue vale igual para cualquier microservicio en ASP.NET Core: el despliegue de Keycloak, el realm, los clients, la audiencia, los roles y el problema de las dos URLs. Las piezas que son propias de MCP están marcadas, y al final hay un apartado con lo que cambia para una API normal.

Todos los conceptos de OAuth que aparecen aquí (actores, tokens, flujos, scopes y roles) están explicados en el [post de conceptos de autenticación y autorización](/2026-08-17-oauth-oidc-keycloak-entra-id). Este artículo se centra en llevarlos a la práctica.

Como en los anteriores laboratorios, no todo sale a la primera. Al final repasamos los problemas que aparecieron, por qué ocurren y cómo se resuelven.

## Lo que vamos a montar

<figure class="diagram">
  <img class="diagram-light" width="1289" height="204" src="{{ '/img/diagrams/05-keycloak-lab-light.svg' | prepend: site.baseurl }}" alt="Diagrama de la arquitectura: VS Code y una aplicación llegan a Traefik por 127.0.0.1; Traefik envía /auth a Keycloak, /mcp y /.well-known al MCP Server y el resto a la API; el MCP Server descarga las claves de Keycloak por su Service interno y llama a la API con service discovery.">
  <img class="diagram-dark" width="1289" height="204" src="{{ '/img/diagrams/05-keycloak-lab-dark.svg' | prepend: site.baseurl }}" alt="Diagrama de la arquitectura: VS Code y una aplicación llegan a Traefik por 127.0.0.1; Traefik envía /auth a Keycloak, /mcp y /.well-known al MCP Server y el resto a la API; el MCP Server descarga las claves de Keycloak por su Service interno y llama a la API con service discovery.">
</figure>

* **Keycloak** se despliega como un Deployment más, con almacenamiento persistente, y se expone por el Ingress en la ruta `/auth`.
* **El MCP Server** valida los tokens, publica sus metadatos de recurso protegido y aplica una política de autorización.
* **Traefik** enruta todo a partir de `127.0.0.1`, como en el laboratorio anterior.

## Conceptos nuevos

Los conceptos de OAuth están en el post anterior. Aquí aparecen algunos más, de Kubernetes, de Keycloak y de ASP.NET Core.

### Kubernetes

* **PersistentVolumeClaim (PVC)**: una solicitud de almacenamiento persistente para un pod. Los datos que un contenedor escribe en su propio sistema de ficheros desaparecen al recrearlo; los que escribe en un volumen respaldado por un PVC, no.
* **StorageClass**: define cómo se aprovisiona ese almacenamiento. Rancher Desktop incluye una por defecto, así que basta con pedir el PVC.
* **Estrategia `Recreate`**: en lugar de arrancar el pod nuevo antes de retirar el viejo (`RollingUpdate`), primero elimina el viejo. Es la adecuada cuando dos instancias no pueden compartir el mismo volumen a la vez.

### Keycloak

* **Realm**: el espacio aislado donde viven usuarios, clients y roles. Equivale al *tenant* de Entra ID. El realm `master` es el de administración de Keycloak y no debe usarse para aplicaciones.
* **Client**: el registro de una aplicación dentro del realm. Equivale a la *app registration* de Entra ID.
* **Client role**: un rol definido dentro de un client concreto. Lo usaremos como permiso de aplicación.
* **Client scope**: un conjunto reutilizable de configuración (scopes y mappers) que se asigna a los clients. Lo usaremos como permiso delegado del usuario.
* **Mapper**: una regla que añade o transforma claims en los tokens. Usaremos uno para añadir la audiencia.
* **Service account**: la identidad que Keycloak crea para un client que usa client credentials. Es a quien se le asignan los roles.

### ASP.NET Core

* **Esquema de autenticación**: un manejador con nombre que sabe autenticar peticiones de una forma concreta. Usaremos dos: el de **JWT Bearer**, que valida tokens, y el de **MCP**, que publica los metadatos del recurso protegido.
* **Autenticar frente a desafiar (*challenge*)**: autenticar es leer y validar las credenciales de la petición; desafiar es responder cuando faltan, con un `401` que le dice al cliente cómo conseguirlas. Cada operación puede tener su propio esquema por defecto, y esto será importante.
* **Política de autorización**: una regla con nombre que decide si una identidad ya autenticada puede acceder a un endpoint.

## Desplegar Keycloak

Creamos `k8s-manual/keycloak.yaml`, en una carpeta separada del chart que genera Aspire, para que un nuevo `aspire publish` no la sobrescriba:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: keycloak-data
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak-deployment
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      securityContext:
        fsGroup: 1000
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:26.0
          args: ["start-dev"]
          env:
            - name: KEYCLOAK_ADMIN
              value: "admin"
            - name: KEYCLOAK_ADMIN_PASSWORD
              value: "admin"
            - name: KC_PROXY_HEADERS
              value: "xforwarded"
            - name: KC_HOSTNAME_STRICT
              value: "false"
            - name: KC_HTTP_RELATIVE_PATH
              value: "/auth"
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: data
              mountPath: /opt/keycloak/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: keycloak-data
---
apiVersion: v1
kind: Service
metadata:
  name: keycloak-service
spec:
  selector:
    app: keycloak
  ports:
    - port: 8080
      targetPort: 8080
```

Un fichero puede contener varios recursos separados por `---`, y `kubectl apply` los crea todos. Qué hace cada pieza:

* **`start-dev`**: el modo de desarrollo de Keycloak, con una base de datos H2 embebida y sin TLS. Ideal para un laboratorio; nunca para producción.
* **El PVC montado en `/opt/keycloak/data`**: ahí guarda `start-dev` su base de datos. Sin él, cada reinicio del pod borra toda la configuración.
* **`KC_HTTP_RELATIVE_PATH`**: Keycloak sirve todo bajo `/auth`. Traefik no recorta prefijos, así que la ruta del Ingress y la de Keycloak deben coincidir.
* **`KC_PROXY_HEADERS`**: Keycloak está detrás de Traefik, que le informa de la URL original con las cabeceras `X-Forwarded-*`. Con esta opción, Keycloak calcula sus propias URLs a partir de ellas. Lo explicamos en detalle al hablar del issuer.
* **`KC_HOSTNAME_STRICT`**: permite que Keycloak calcule su URL a partir de la petición en lugar de exigir un hostname fijo.

`KEYCLOAK_ADMIN` y `KEYCLOAK_ADMIN_PASSWORD` siguen funcionando en Keycloak 26, pero están marcadas como obsoletas en favor de `KC_BOOTSTRAP_ADMIN_USERNAME` y `KC_BOOTSTRAP_ADMIN_PASSWORD`.

```powershell
kubectl apply -f k8s-manual/keycloak.yaml
kubectl get pods -w
```

Keycloak es una aplicación Java y tarda un poco en arrancar. Espera a que el pod esté en `1/1 Running`.

## Exponer Keycloak y los metadatos por el Ingress

Partimos del Ingress del laboratorio anterior, que enrutaba por ruta. Lo movemos a `k8s-manual/ingress.yaml` y le añadimos dos reglas:

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
          - path: /auth
            pathType: Prefix
            backend:
              service:
                name: keycloak-service
                port:
                  number: 8080
          - path: /.well-known/oauth-protected-resource
            pathType: Prefix
            backend:
              service:
                name: mcp-service
                port:
                  number: 8080
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

* **`/auth`** lleva a Keycloak. El navegador del usuario necesita llegar a él para iniciar sesión.
* **`/.well-known/oauth-protected-resource`** lleva al MCP Server, que publicará ahí sus metadatos de recurso protegido (específico de MCP). Sin esta regla, esas peticiones caerían en la regla `/` y acabarían en la API.

```powershell
kubectl apply -f k8s-manual/ingress.yaml
```

### Comprobar el issuer

Abre en el navegador:

```
http://127.0.0.1/auth/realms/master/.well-known/openid-configuration
```

El campo `issuer` debe ser `http://127.0.0.1/auth/realms/master`. Si aparece eso, Keycloak está calculando bien su URL pública a partir de las cabeceras de Traefik.

## Configurar Keycloak paso a paso

Entra en la consola de administración en `http://127.0.0.1/auth`, con `admin` / `admin`.

### 1. El realm

1. Abre el desplegable de realms, arriba a la izquierda, y pulsa **Create realm**.
2. **Realm name**: `mcp-lab`. **Create**.

A partir de aquí, comprueba siempre que el desplegable muestra `mcp-lab`. Todo lo que sigue se crea dentro de este realm.

El realm ya publica su descubrimiento en `http://127.0.0.1/auth/realms/mcp-lab/.well-known/openid-configuration`, con el issuer `http://127.0.0.1/auth/realms/mcp-lab`.

### 2. El client del servicio protegido

El MCP Server es el resource server: no pide tokens, solo los valida. Aun así lo registramos como client, porque es donde vivirán sus roles y porque su identificador será la audiencia de los tokens. Cada microservicio que quieras proteger tendrá su propio client de este tipo.

1. **Clients** → **Create client**.
2. **Client type**: `OpenID Connect`. **Client ID**: `mcp-server`. **Next**.
3. **Client authentication**: `Off`. En *Authentication flow*, **desmarca todo**: este client no inicia ningún login. **Next** y **Save**.
4. Pestaña **Roles** → **Create role**. **Role name**: `Mcp.Access`. **Save**.

### 3. El scope de usuario y la audiencia

1. **Client scopes** → **Create client scope**.
2. **Name**: `mcp.tools`. **Type**: `None`. **Protocol**: `OpenID Connect`. **Include in token scope**: `On`. **Save**.
3. Pestaña **Mappers** → **Configure a new mapper** → **Audience**.
4. **Name**: `mcp-server-audience`. **Included Client Audience**: `mcp-server`. **Add to ID token**: `Off`. **Add to access token**: `On`. **Save**.

El tipo `None` evita que el scope se aplique a todos los clients del realm: lo asignaremos solo a los que corresponda. Y el mapper es imprescindible: **Keycloak no añade por sí solo la audiencia del recurso** en los tokens de usuario, y el servicio rechazará cualquier token que no la lleve.

### 4. El client de la aplicación

Representa a una aplicación que llama al servicio sin usuario.

1. **Clients** → **Create client**. **Client ID**: `mcp-app`. **Next**.
2. **Client authentication**: `On`. En *Authentication flow*, deja marcado **solo** `Service accounts roles`. **Next** y **Save**.
3. Pestaña **Credentials**: copia el **Client secret** con el botón de copiar.
4. Pestaña **Client scopes** → **Add client scope** → `mcp.tools` → **Add** como **Default**.
5. Pestaña **Service accounts roles** → **Assign role** → cambia el filtro a **Filter by clients** → marca `Mcp.Access` → **Assign**.

### 5. El usuario de prueba

1. **Users** → **Create new user**.
2. Rellena **Username** (`test.user`), **Email**, **First name** y **Last name**, con **Email verified** en `On`. **Create**.
3. Pestaña **Credentials** → **Set password**, con **Temporary** en `Off`.

Los campos de email, nombre y apellido no son opcionales en la práctica: el perfil de usuario de Keycloak los exige por defecto, y si falta alguno el login no se completa (según el flujo, Keycloak pide rellenarlos o responde con *"Account is not fully set up"*).

### 6. El client de Visual Studio Code

Es un client **público**: VS Code se ejecuta en el equipo del usuario y no puede guardar un secreto, así que usará PKCE.

1. **Clients** → **Create client**. **Client ID**: `vscode-mcp`. **Next**.
2. **Client authentication**: `Off`. En *Authentication flow*, solo `Standard flow`. **Next**.
3. **Valid redirect URIs**:

   ```
   http://127.0.0.1:33418
   http://127.0.0.1:33418/*
   https://vscode.dev/redirect
   ```

   **Web origins**: `+`. **Save**.
4. Pestaña **Advanced** → **Proof Key for Code Exchange Code Challenge Method**: `S256`. **Save**. Así Keycloak rechaza cualquier login sin PKCE.
5. Pestaña **Client scopes** → **Add client scope** → `mcp.tools` → **Add** como **Default**.

Las redirect URIs son las que usa VS Code para recibir el resultado del login: un servidor local en el puerto 33418 o su página de redirección web.

### Comprobar un token de aplicación

Antes de tocar código, comprobamos que Keycloak emite los tokens como esperamos. Pide un token **a través del Ingress** con las credenciales de `mcp-app`:

```powershell
$secret = "<client-secret>"
$token = (curl.exe -s -X POST http://127.0.0.1/auth/realms/mcp-lab/protocol/openid-connect/token -d "grant_type=client_credentials" -d "client_id=mcp-app" -d "client_secret=$secret" | ConvertFrom-Json).access_token
```

Y decodifica su contenido sin enviarlo a ningún servicio externo:

```powershell
$p = $token.Split('.')[1].Replace('-','+').Replace('_','/')
switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

Comprueba cuatro claims:

* `iss`: `http://127.0.0.1/auth/realms/mcp-lab`.
* `aud`: incluye `mcp-server`.
* `resource_access.mcp-server.roles`: contiene `Mcp.Access`.
* `azp`: `mcp-app`.

## Proteger el servicio

### Las dos URLs de Keycloak

Antes del código, hay que entender un detalle de red que condiciona la configuración, y que afecta a cualquier servicio del clúster, no solo al MCP Server.

El **issuer** es la URL que Keycloak escribe en el claim `iss`. Como el navegador del usuario llega a Keycloak por Traefik, los tokens llevan el issuer público: `http://127.0.0.1/auth/realms/mcp-lab`.

Pero el servicio corre **dentro** del clúster, y para él `127.0.0.1` es su propio pod. No puede descargar las claves de Keycloak desde esa URL. Tiene que usar la interna, la del Service: `http://keycloak-service:8080/...`.

Así que el servicio necesita dos URLs:

* **La pública**, para validar el `iss` de los tokens y para anunciársela a los clientes.
* **La interna**, para descargar el documento de descubrimiento y las claves públicas.

### Paquete

```powershell
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

### Configuración

En el `appsettings.json` del MCP Server:

```json
{
  "Logging": {
    "LogLevel": {
      "Microsoft.AspNetCore.Authentication": "Information"
    }
  },
  "Mcp": {
    "ResourceUrl": "http://127.0.0.1/mcp"
  },
  "Auth": {
    "Issuer": "http://127.0.0.1/auth/realms/mcp-lab",
    "MetadataAddress": "http://keycloak-service:8080/auth/realms/mcp-lab/.well-known/openid-configuration",
    "Audience": "mcp-server"
  }
}
```

Son los valores de este laboratorio. En otros entornos se sobrescriben con variables de entorno, como `Auth__Issuer`. El nivel `Information` en `Microsoft.AspNetCore.Authentication` hace que el log explique por qué se rechaza un token, y nos será muy útil.

### Program.cs

```csharp
using System.ComponentModel;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using ModelContextProtocol.AspNetCore.Authentication;
using ModelContextProtocol.Server;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

var resourceUrl = builder.Configuration["Mcp:ResourceUrl"]
    ?? throw new InvalidOperationException("Mcp:ResourceUrl is not configured");
var issuer = builder.Configuration["Auth:Issuer"]
    ?? throw new InvalidOperationException("Auth:Issuer is not configured");
var metadataAddress = builder.Configuration["Auth:MetadataAddress"]
    ?? throw new InvalidOperationException("Auth:MetadataAddress is not configured");
var audience = builder.Configuration["Auth:Audience"]
    ?? throw new InvalidOperationException("Auth:Audience is not configured");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.MetadataAddress = metadataAddress;   // internal URL, to download the keys
    options.RequireHttpsMetadata = false;        // lab only: Keycloak over HTTP
    options.MapInboundClaims = false;            // keep the original claim names
    options.TokenValidationParameters.ValidIssuer = issuer;      // public URL, the one in "iss"
    options.TokenValidationParameters.ValidAudience = audience;
    options.TokenValidationParameters.NameClaimType = "preferred_username";
    options.TokenValidationParameters.RoleClaimType = ClaimTypes.Role;

    options.Events = new JwtBearerEvents
    {
        // Keycloak nests client roles in resource_access.<client>.roles
        OnTokenValidated = context =>
        {
            var resourceAccess = context.Principal?.FindFirst("resource_access")?.Value;
            if (resourceAccess is not null && context.Principal?.Identity is ClaimsIdentity identity)
            {
                using var doc = JsonDocument.Parse(resourceAccess);
                if (doc.RootElement.TryGetProperty(audience, out var client) &&
                    client.TryGetProperty("roles", out var roles))
                {
                    foreach (var role in roles.EnumerateArray())
                    {
                        identity.AddClaim(new Claim(ClaimTypes.Role, role.GetString()!));
                    }
                }
            }
            return Task.CompletedTask;
        }
    };
})
.AddMcp(options =>
{
    options.ResourceMetadata = new()
    {
        Resource = new Uri(resourceUrl),
        AuthorizationServers = { new Uri(issuer) },
        ScopesSupported = ["mcp.tools"],
    };
});

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("McpAccess", policy => policy.RequireAssertion(context =>
        context.User.IsInRole("Mcp.Access") ||
        (context.User.FindFirst("scope")?.Value.Split(' ').Contains("mcp.tools") ?? false)));
});

builder.Services.AddHttpClient("WeatherApi", client =>
{
    client.BaseAddress = new Uri("https+http://api");
});

builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithToolsFromAssembly();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapDefaultEndpoints();
app.MapMcp("/mcp").RequireAuthorization("McpAccess");

app.Run();

[McpServerToolType]
public static class WeatherTools
{
    [McpServerTool, Description("Gets the weather forecast for the next days")]
    public static async Task<string> GetWeatherForecast(IHttpClientFactory httpClientFactory)
    {
        var client = httpClientFactory.CreateClient("WeatherApi");
        return await client.GetStringAsync("/weatherforecast");
    }
}
```

Las piezas, una a una:

* **`DefaultAuthenticateScheme`** es JWT Bearer: valida la firma con las claves de Keycloak y comprueba issuer, audiencia y caducidad.
* **`DefaultChallengeScheme`** es el de MCP (específico de MCP). Cuando falta el token, responde con un `401` que incluye la cabecera `WWW-Authenticate` con el parámetro `resource_metadata`, que es lo que permite a VS Code descubrir dónde iniciar sesión.
* **`MetadataAddress`** apunta a la URL interna y **`ValidIssuer`** a la pública. Es la solución al problema de las dos URLs.
* **`MapInboundClaims = false`** conserva los nombres originales de los claims (`scope`, `resource_access`...). Sin esta opción, .NET renombra algunos al formato de Microsoft.
* **`OnTokenValidated`** traduce los roles de Keycloak. Keycloak los anida en `resource_access.mcp-server.roles`, una estructura que .NET no reconoce. Los copiamos a claims de rol estándar para que funcione `IsInRole`.
* **`AddMcp`** (específico de MCP) publica los **Protected Resource Metadata**: qué recurso es, qué authorization server acepta y qué scopes soporta. El SDK los sirve en la ruta *well-known* que define RFC 9728, `/.well-known/oauth-protected-resource`, con la ruta del recurso añadida cuando la tiene (`/mcp`). La regla del Ingress con `pathType: Prefix` cubre las dos formas.
* **La política `McpAccess`** acepta a una aplicación con el rol `Mcp.Access` o a un usuario con el scope `mcp.tools`. Keycloak entrega los scopes en un único claim, separados por espacios.

### Desplegar

Como en el laboratorio anterior, reconstruimos la imagen con el nombre que espera el chart y reiniciamos el Deployment:

```powershell
cd src
docker build -t mcp:latest -f WeatherMcp/Dockerfile .
kubectl rollout restart deployment mcp-deployment
```

No usamos `helm upgrade` a propósito: revertiría el parche de `imagePullPolicy: Never`.

## Verificación con la aplicación

### Sin token, el servidor se niega y explica por qué

```powershell
curl.exe -i -X POST http://127.0.0.1/mcp
```

Debe devolver `401` con una cabecera `WWW-Authenticate` que incluye `resource_metadata` y la URL de los metadatos. Si abres esa URL en el navegador, verás el documento con `resource`, `authorization_servers` y `scopes_supported`.

### Con el token de la aplicación, entra

Crea la petición de inicialización de MCP:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' | Set-Content init.json -Encoding ascii
```

Pide un token nuevo (caducan a los pocos minutos) y llama al servidor:

```powershell
curl.exe -i -X POST http://127.0.0.1/mcp -H "Authorization: Bearer $token" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@init.json"
```

Debe devolver `200`. En la respuesta verás `"capabilities":{"tools":{}}`: el servidor declara que soporta tools. La lista real se pide con otro método:

```powershell
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | Set-Content list.json -Encoding ascii
curl.exe -i -X POST http://127.0.0.1/mcp -H "Authorization: Bearer $token" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@list.json"
```

### Con un token falso, no entra

```powershell
curl.exe -i -X POST http://127.0.0.1/mcp -H "Authorization: Bearer not-a-real-token" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@init.json"
```

Debe devolver `401`.

## Verificación con un usuario desde Visual Studio Code

En `.vscode/mcp.json`, indicamos el client registrado para VS Code:

```json
{
  "servers": {
    "weather-mcp": {
      "type": "http",
      "url": "http://127.0.0.1/mcp",
      "oauth": { "clientId": "vscode-mcp" }
    }
  }
}
```

La propiedad `oauth.clientId` está disponible desde VS Code 1.123. No debe haber ninguna cabecera `Authorization` fija en la configuración: anularía el login.

Al iniciar el servidor desde VS Code ocurre toda la cadena de descubrimiento:

1. VS Code llama a `/mcp`, recibe el `401` con `resource_metadata` y descarga los metadatos del recurso.
2. Descubre que el authorization server es `http://127.0.0.1/auth/realms/mcp-lab`.
3. Abre el navegador con el login de Keycloak. Iniciamos sesión con `test.user`.
4. Keycloak redirige a `http://127.0.0.1:33418`, VS Code canjea el código por el token y el servidor pasa a **Running**, con su tool descubierta.

Usamos un client registrado previamente, con su `clientId` en la configuración. Es la vía preferida por la especificación de MCP. Keycloak también soporta los *Client ID Metadata Documents* desde la versión 26.6, como funcionalidad experimental; la 26.0 de este laboratorio no los incluye.

## ¿Y si no es un MCP Server?

Para proteger cualquier otra API del clúster, como la propia API del tiempo, la configuración de Keycloak es la misma (un client por servicio, su rol, un client scope con su mapper de audiencia) y el problema de las dos URLs también. En el código desaparecen las tres piezas específicas de MCP:

* No hay `AddMcp` ni metadatos de recurso protegido, ni la regla `/.well-known/oauth-protected-resource` en el Ingress.
* JWT Bearer puede ser el esquema por defecto para todo, incluido el desafío, porque no hay que anunciar nada en el `401`.
* Los clientes no descubren el authorization server a partir del servicio: se les configura directamente.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Same configuration as above: MetadataAddress, ValidIssuer,
        // ValidAudience, MapInboundClaims and the OnTokenValidated role mapping
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("WeatherRead", policy => policy.RequireRole("Weather.Read"));
});

// ...

app.MapGet("/weatherforecast", GetForecast).RequireAuthorization("WeatherRead");
```

Y si el MCP Server llamara a esa API protegida, tendría que pedir su propio token: con client credentials si basta con su identidad, o con un intercambio de token si la API necesita saber qué usuario originó la llamada. Nunca reenviando el token que recibió, como vimos en el post de conceptos.

## Problemas que encontramos

### 1. Keycloak pierde toda la configuración al reiniciarse

**Qué ocurre.** En la primera versión del laboratorio, Keycloak no tenía volumen persistente. Al cambiar su configuración, Kubernetes recreó el pod y el realm desapareció, con todos sus clients, roles y usuarios. `start-dev` guarda su base de datos dentro del contenedor, y todo lo que se escribe ahí se pierde al recrearlo.

**Cómo lo solucionamos.** Con el PVC montado en `/opt/keycloak/data`. Para recuperar el trabajo hecho, exportamos el realm antes del cambio (**Realm settings** → **Action** → **Partial export**, incluyendo clients, grupos y roles) y lo importamos al crear el realm de nuevo.

La exportación parcial tiene dos limitaciones: **no incluye usuarios**, que hay que volver a crear, y **no conserva los secretos** de los clients, que hay que regenerar.

Al añadir el PVC cambiamos también la estrategia del Deployment a `Recreate`, y `kubectl apply` falla al cambiar la estrategia de un Deployment existente. La forma más simple de resolverlo fue eliminar el Deployment y volver a crearlo.

**Alternativas.** Importar el realm desde un JSON al arrancar, con la opción `--import-realm` y un ConfigMap montado en `/opt/keycloak/data/import`, para que la configuración sea reproducible y viva en el repositorio. En producción, una base de datos externa como PostgreSQL.

### 2. El issuer no puede ser el mismo para todos

**Qué ocurre.** El navegador ve Keycloak en `http://127.0.0.1/auth` y el pod del servicio, en `http://keycloak-service:8080/auth`. Si configuramos en .NET la URL pública como `Authority`, el pod no puede descargar las claves. Si configuramos la interna, el issuer de los tokens no coincide.

**Cómo lo solucionamos.** Separando las dos funciones: `MetadataAddress` apunta a la URL interna y `ValidIssuer` fija la pública. Keycloak, por su parte, calcula su URL a partir de las cabeceras `X-Forwarded-*` de Traefik, de modo que los tokens pedidos por el Ingress llevan siempre el issuer público.

**Alternativas.** Configurar en Keycloak un hostname fijo para la parte pública (`KC_HOSTNAME`) y activar `KC_HOSTNAME_BACKCHANNEL_DYNAMIC`, para que los endpoints internos (como el de las claves) se resuelvan con la URL de la petición. Con un proveedor externo como Entra ID el problema desaparece: hay una única URL pública, a cambio de que el pod necesite salida a internet.

### 3. El `401` no incluye `resource_metadata` (específico de MCP)

**Qué ocurre.** Sin token, el servidor devolvía `401` con la cabecera `WWW-Authenticate: Bearer`, sin más. Los metadatos se publicaban correctamente, pero el desafío lo estaba generando el esquema de JWT Bearer y no el de MCP, que es el que añade el parámetro `resource_metadata`.

**Cómo lo solucionamos.** Fijando el esquema de desafío por defecto al de MCP, sin dejar que JWT Bearer asuma los dos papeles:

```csharp
options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
options.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme;
```

Usar `AddAuthentication(JwtBearerDefaults.AuthenticationScheme)` configura JWT Bearer como esquema por defecto **para todo**, incluido el desafío, y produce justo este problema. En una API normal es lo correcto; en un MCP Server, no.

**Alternativas.** La especificación permite a los clientes buscar los metadatos en las rutas `.well-known` aunque falte el parámetro en la cabecera, así que algunos clientes funcionarían igualmente. Pero no conviene depender de ello.

### 4. `Invalid parameter: redirect_uri`

**Qué ocurre.** Al iniciar el login desde VS Code, Keycloak mostraba ese error. VS Code enviaba `http://127.0.0.1:33418`, y ese valor no estaba en la lista de *Valid redirect URIs* del client tal como Keycloak lo tenía guardado. Keycloak compara las redirect URIs carácter a carácter.

**Cómo lo diagnosticamos.** El valor enviado aparece en la URL de la página de error (parámetro `redirect_uri`, codificado) y en el log de Keycloak:

```powershell
kubectl logs deployment/keycloak-deployment --tail=100 | Select-String invalid_redirect_uri
```

Para aislar el problema, sustituimos temporalmente la lista por un comodín, `http://127.0.0.1:*`. Con él, el login funcionó, lo que confirmó que el fallo estaba en la lista guardada y no en VS Code.

**Cómo lo solucionamos.** Volviendo a escribir la lista exacta, guardando y comprobando el aviso de confirmación. Después **retiramos el comodín**: acepta cualquier puerto local como destino del código de autorización. Para comprobar el cambio hay que cerrar la sesión en VS Code (menú **Accounts**), porque si no, reutiliza la sesión guardada y no vuelve a pasar por Keycloak.

### 5. `Invalid client or Invalid client credentials`

**Qué ocurre.** Tras reimportar el realm, la petición de token con `mcp-app` empezó a fallar con este error. El secreto que usábamos era el del realm anterior, y la exportación parcial no conserva los secretos.

**Cómo lo solucionamos.** Regenerando el secreto en **Credentials** y copiándolo con el botón de copiar. Si persiste, conviene comprobar que **Client authentication** sigue activado: sin él, el client es público y no acepta secretos.

### 6. Los metadatos del recurso acaban en la API (específico de MCP)

**Qué ocurre.** El Ingress del laboratorio anterior enviaba a la API todo lo que no fuera `/mcp`. Las peticiones a `/.well-known/oauth-protected-resource` acababan en la API, que respondía `404`.

**Cómo lo solucionamos.** Con una regla específica para esa ruta hacia el MCP Server. Con `pathType: Prefix`, la regla cubre también la variante `/.well-known/oauth-protected-resource/mcp`.

## Conclusiones

Con Keycloak en el mismo clúster, el servicio queda protegido para los dos tipos de llamada: usuarios con login interactivo desde VS Code y aplicaciones con sus propias credenciales. El código .NET es relativamente corto; la complejidad está en los detalles de configuración, y casi todos valen para cualquier microservicio:

* **La audiencia hay que configurarla de forma explícita en Keycloak**, con un mapper por servicio.
* **Los roles de Keycloak hay que traducirlos** para que .NET los reconozca.
* **Las URLs importan**: la del issuer, la interna para las claves y las redirect URIs deben coincidir exactamente con lo que espera cada parte.
* **En un MCP Server, el esquema de desafío** es el que permite a los clientes descubrir solos dónde iniciar sesión.

En el siguiente laboratorio repetiremos el escenario con **Microsoft Entra ID**, y veremos qué se simplifica y qué cambia al pasar a un proveedor gestionado.

## Referencias

* [Keycloak como authorization server para MCP](https://www.keycloak.org/securing-apps/mcp-authz-server)
* [Keycloak: configuración del hostname](https://www.keycloak.org/server/hostname)
* [Keycloak: configuración detrás de un proxy inverso](https://www.keycloak.org/server/reverseproxy)
* [SDK de C# para MCP](https://github.com/modelcontextprotocol/csharp-sdk)
* [Especificación de autorización de MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
* [Kubernetes: Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
