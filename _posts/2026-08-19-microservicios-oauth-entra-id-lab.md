---
layout: post
title: "Laboratorio: securizando microservicios con OAuth 2.1 y Microsoft Entra ID"
subtitle: Los mismos servicios y el mismo código, con un proveedor de identidad gestionado
topic: seguridad
published: false
---

En el [laboratorio anterior](/2026-08-18-microservicios-oauth-keycloak-lab) protegimos nuestros servicios con Keycloak, desplegado en el mismo clúster de Kubernetes local. Ahora repetimos el escenario con **Microsoft Entra ID**, el proveedor de identidad de Microsoft.

El objetivo es el mismo: que el servicio acepte a **usuarios** que inician sesión desde Visual Studio Code y a **aplicaciones** que se autentican con sus propias credenciales. Pero el recorrido cambia bastante, y esas diferencias son lo más interesante del artículo: algunas cosas que en Keycloak exigían configuración explícita aquí desaparecen, y aparecen otras nuevas.

Y hay un detalle que conviene adelantar: **el código .NET es el mismo**. Al final del laboratorio, la misma imagen funcionará con Keycloak o con Entra ID según su configuración.

Como en el laboratorio de Keycloak, el ejemplo es el MCP Server de la serie, pero casi todo vale para cualquier microservicio en ASP.NET Core. Las piezas propias de MCP están marcadas, y al final hay un apartado con lo que cambia para una API normal.

Los conceptos de OAuth, la tabla de equivalencias entre los dos proveedores y el porqué de cada validación están en el [post de conceptos de autenticación y autorización](/2026-08-17-oauth-oidc-keycloak-entra-id).

## Qué cambia respecto a Keycloak

| | Keycloak | Entra ID |
| --- | --- | --- |
| Authorization server | En el clúster, expuesto en `/auth` | Externo: `login.microsoftonline.com` |
| URLs que necesita el servicio | Dos: pública e interna | Una, pública. El pod necesita salida a internet |
| Client de VS Code | Registro propio, con PKCE y redirect URIs | VS Code usa su propia aplicación de Microsoft. Solo hay que **autorizarla** |
| Audiencia | Mapper explícito | La asigna la plataforma |
| Roles | Anidados en `resource_access` y traducidos en código | Claim `roles` plano |
| Scopes | Claim `scope` | Claim `scp` |
| Permisos de aplicación | Basta con asignar el rol | Requieren **consentimiento de administrador** |

## Lo que vamos a montar

<figure class="diagram">
  <img class="diagram-light" width="1088" height="220" src="{{ '/img/diagrams/06-entra-lab-light.svg' | prepend: site.baseurl }}" alt="Diagrama de la arquitectura: VS Code inicia sesión en Microsoft Entra ID y una aplicación pide su token con client credentials; las dos llaman a /mcp por Traefik en 127.0.0.1; el MCP Server descarga las claves de Entra ID y llama a la API con service discovery.">
  <img class="diagram-dark" width="1088" height="220" src="{{ '/img/diagrams/06-entra-lab-dark.svg' | prepend: site.baseurl }}" alt="Diagrama de la arquitectura: VS Code inicia sesión en Microsoft Entra ID y una aplicación pide su token con client credentials; las dos llaman a /mcp por Traefik en 127.0.0.1; el MCP Server descarga las claves de Entra ID y llama a la API con service discovery.">
</figure>

A diferencia del laboratorio anterior, el authorization server ya no vive en el clúster. Tanto VS Code como el servicio hablan directamente con Entra ID por internet.

## Conceptos nuevos

* **Tenant**: el directorio de Entra ID de una organización, con sus usuarios y aplicaciones. Equivale al realm de Keycloak.
* **App registration**: el registro de una aplicación en el tenant. Equivale al client de Keycloak. Cada uno tiene un **Application (client) ID**, un GUID.
* **Application ID URI**: un identificador de la API en forma de URI, por defecto `api://<client-id>`. Sirve como prefijo de sus scopes.
* **Expose an API**: la sección donde una aplicación define los **scopes** que otras pueden solicitar en nombre de un usuario.
* **App role**: un rol definido en la aplicación. Según sus *allowed member types*, se asigna a usuarios y grupos, a aplicaciones o a ambos. Los de aplicaciones son los permisos del flujo client credentials.
* **Authorized client applications**: aplicaciones a las que la API autoriza de antemano para pedir sus scopes, sin pantalla de consentimiento.
* **Enterprise application (service principal)**: la instancia de una aplicación dentro de un tenant concreto. El app registration es la definición; la enterprise application es donde se gestionan los usuarios asignados y los consentimientos.
* **Consentimiento de administrador**: los permisos de aplicación no tienen un usuario que los apruebe, así que debe concederlos un administrador del tenant.
* **Versión del token**: Entra ID emite tokens v1 o v2. Cambian el issuer y la audiencia, y la API decide cuál recibe.
* **Scope `/.default`**: en client credentials, pide un token con todos los permisos de aplicación concedidos para una API.

## Requisitos: un tenant propio

Para el laboratorio hay que poder hacer dos cosas: **registrar aplicaciones** y **dar consentimiento de administrador**. En la mayoría de los tenants corporativos, ambas están restringidas.

La opción más limpia es un **tenant de pruebas propio**, en el que seas administrador global. Si no tienes uno, la vía más sencilla es darte de alta en una [cuenta gratuita de Azure](https://azure.microsoft.com/pricing/purchase-options/azure-account): el alta crea un tenant nuevo y te hace su administrador. Desde un tenant que ya administras también puedes [crear otro](https://learn.microsoft.com/entra/fundamentals/create-new-tenant) (**Entra ID** → **Overview** → **Manage tenants** → **Create**), aunque Microsoft solo lo permite a clientes de pago. El nivel gratuito de Entra ID cubre todo lo que usamos aquí.

Ten en cuenta que los tenants nuevos tienen activados los **valores predeterminados de seguridad** (*security defaults*). Tras un margen de 24 horas desde su creación, todos los usuarios tienen que registrar un segundo factor, normalmente Microsoft Authenticator, en su siguiente inicio de sesión. Tú incluido, y también el usuario de prueba que crearemos más adelante.

## 1. El app registration del servicio

Usamos los mismos nombres que en Keycloak, para que la comparación sea directa.

### Crear el registro

1. En el [centro de administración de Microsoft Entra](https://entra.microsoft.com), **Entra ID** → **App registrations** → **New registration**.
2. **Name**: `mcp-server`.
3. **Supported account types**: *Accounts in this organizational directory only*.
4. Sin redirect URI. **Register**.
5. Apunta el **Application (client) ID** y el **Directory (tenant) ID** de la página *Overview*.

### Tokens v2

En **Manifest**, cambia `requestedAccessTokenVersion` (dentro del objeto `api`) a `2` y guarda. En el formato antiguo del manifiesto, la misma propiedad se llama `accessTokenAcceptedVersion`.

Este paso es fácil de pasar por alto, y su efecto es grande:

| | Token v1 (por defecto) | Token v2 |
| --- | --- | --- |
| `iss` | `https://sts.windows.net/<tenant-id>/` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `aud` | `api://<client-id>` | `<client-id>` |

La versión la decide la API que recibe el token, no el cliente que lo pide. Usaremos v2 en todo el laboratorio.

### Exponer la API con un scope

1. **Expose an API** → junto a **Application ID URI**, **Add**, y acepta `api://<client-id>`.
2. **Add a scope**:
   * **Scope name**: `mcp.tools`
   * **Who can consent**: *Admins and users*
   * Textos de consentimiento, por ejemplo *"Use the MCP server tools"*.
   * **Add scope**.

### El app role para aplicaciones

**App roles** → **Create app role**:

* **Display name** y **Value**: `Mcp.Access`
* **Allowed member types**: *Applications*
* **Description**: *Allows an application to call the MCP server*

### Autorizar a Visual Studio Code (específico de MCP)

Cuando el authorization server es Entra ID, VS Code no necesita un client registrado por nosotros: inicia sesión con su propia aplicación, que Microsoft tiene registrada con el client ID `aebc6443-996d-45c2-90f0-388ff96faa56`. Basta con autorizarla:

**Expose an API** → **Authorized client applications** → **Add a client application**, con ese client ID y el scope `api://<client-id>/mcp.tools` marcado.

En Keycloak tuvimos que registrar un client público, configurar PKCE y escribir las redirect URIs exactas. Aquí todo eso lo resuelve la aplicación de Microsoft. Para otros clientes, como una SPA que llame a una API, sí habría que registrar su propia aplicación y concederle el scope.

## 2. El app registration de la aplicación

Representa a una aplicación que llama al servicio sin usuario.

1. **New registration** → **Name**: `mcp-app`, un solo tenant, sin redirect URI.
2. Apunta su **Application (client) ID**.
3. **Certificates & secrets** → **New client secret**, con una caducidad corta. Copia el **Value** en ese momento: Entra ID solo lo muestra una vez. No lo confundas con el **Secret ID**.
4. **API permissions** → **Add a permission** → **My APIs** → `mcp-server` → **Application permissions** → `Mcp.Access` → **Add permissions**.
5. **Grant admin consent for &lt;tu tenant&gt;** y confirma. El estado debe quedar como *Granted*.

El registro incluye por defecto el permiso delegado `User.Read` de Microsoft Graph. No lo necesitamos y se puede quitar.

## 3. Comprobar un token de aplicación

Antes de tocar código, comprobamos que Entra ID emite los tokens como esperamos:

```powershell
$tenantId = "<directory-tenant-id>"
$apiClientId = "<mcp-server-client-id>"
$appClientId = "<mcp-app-client-id>"
$secret = "<client-secret-value>"

$token = (curl.exe -s -X POST "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
  -d "grant_type=client_credentials" `
  -d "client_id=$appClientId" `
  --data-urlencode "client_secret=$secret" `
  -d "scope=api://$apiClientId/.default" | ConvertFrom-Json).access_token
```

El secreto va con `--data-urlencode` porque los secretos de Entra ID pueden contener caracteres, como `+`, que se interpretan mal en un formulario.

Lo decodificamos sin enviarlo a ningún servicio externo:

```powershell
$p = $token.Split('.')[1].Replace('-','+').Replace('_','/')
switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

Comprueba:

* `ver`: `2.0`
* `iss`: `https://login.microsoftonline.com/<tenant-id>/v2.0`
* `aud`: el client ID de `mcp-server`
* `roles`: `["Mcp.Access"]`
* `azp`: el client ID de `mcp-app`

Compáralo con el token de Keycloak: aquí no ha hecho falta ningún mapper para la audiencia, y los roles llegan en un claim plano.

## 4. Un código para los dos proveedores

En el laboratorio de Keycloak, el código daba por hecho algunos nombres propios de ese proveedor. Entre Keycloak y Entra ID cambian tres cosas:

* El claim de scopes: `scope` frente a `scp`.
* El claim de roles: el que creamos al traducir `resource_access` frente al claim `roles`.
* El formato del scope que se anuncia a los clientes (específico de MCP): `mcp.tools` frente a `api://<client-id>/mcp.tools`.

Las convertimos en configuración. Esta es la parte de autenticación del `Program.cs` del MCP Server, con los cambios incorporados. El resto (el `HttpClient`, el registro del servidor MCP y las tools) no cambia:

```csharp
var resourceUrl = builder.Configuration["Mcp:ResourceUrl"]
    ?? throw new InvalidOperationException("Mcp:ResourceUrl is not configured");
var issuer = builder.Configuration["Auth:Issuer"]
    ?? throw new InvalidOperationException("Auth:Issuer is not configured");
var metadataAddress = builder.Configuration["Auth:MetadataAddress"]
    ?? throw new InvalidOperationException("Auth:MetadataAddress is not configured");
var audience = builder.Configuration["Auth:Audience"]
    ?? throw new InvalidOperationException("Auth:Audience is not configured");

// Claim names differ between identity providers
var scopeClaimType = builder.Configuration["Auth:ScopeClaimType"] ?? "scope";
var roleClaimType = builder.Configuration["Auth:RoleClaimType"] ?? ClaimTypes.Role;
var requiredScope = builder.Configuration["Auth:RequiredScope"] ?? "mcp.tools";

// Scope format announced to clients (Entra ID expects the full api:// form)
var scopesSupported = builder.Configuration.GetSection("Mcp:ScopesSupported").Get<string[]>()
    ?? [requiredScope];

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.MetadataAddress = metadataAddress;
    options.RequireHttpsMetadata = false;        // lab only: Keycloak over HTTP
    options.MapInboundClaims = false;
    options.TokenValidationParameters.ValidIssuer = issuer;
    options.TokenValidationParameters.ValidAudience = audience;
    options.TokenValidationParameters.NameClaimType = "preferred_username";
    options.TokenValidationParameters.RoleClaimType = roleClaimType;

    options.Events = new JwtBearerEvents
    {
        // Keycloak nests client roles in resource_access.<client>.roles.
        // With Entra ID this does nothing: there is no resource_access claim.
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
                        identity.AddClaim(new Claim(roleClaimType, role.GetString()!));
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
        ScopesSupported = [.. scopesSupported],
    };
});

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("McpAccess", policy => policy.RequireAssertion(context =>
        context.User.IsInRole("Mcp.Access") ||
        (context.User.FindFirst(scopeClaimType)?.Value.Split(' ').Contains(requiredScope) ?? false)));
});
```

La política sigue comparando con `mcp.tools` también en Entra ID: aunque el cliente pide `api://<client-id>/mcp.tools`, el claim `scp` del token solo lleva el nombre corto.

Los valores por defecto reproducen la configuración de Keycloak, así que su `appsettings.json` sigue sirviendo sin cambios. Reconstruimos y desplegamos:

```powershell
cd src
docker build -t brent-mcp:latest -f BrentMcp/Dockerfile .
kubectl rollout restart deployment brent-mcp-deployment
```

Antes de seguir, conviene comprobar que un token de Keycloak sigue entrando con `200`: el cambio no debe romper nada.

## 5. Cambiar de proveedor con variables de entorno

La imagen no cambia. Sobrescribimos la configuración directamente en el Deployment:

```powershell
kubectl set env deployment/brent-mcp-deployment `
  "Auth__Issuer=https://login.microsoftonline.com/$tenantId/v2.0" `
  "Auth__MetadataAddress=https://login.microsoftonline.com/$tenantId/v2.0/.well-known/openid-configuration" `
  "Auth__Audience=$apiClientId" `
  "Auth__ScopeClaimType=scp" `
  "Auth__RoleClaimType=roles" `
  "Mcp__ScopesSupported__0=api://$apiClientId/mcp.tools"
```

* En ASP.NET Core, las **variables de entorno tienen prioridad** sobre `appsettings.json`, y el doble guion bajo sustituye a los dos puntos de las claves.
* `kubectl set env` modifica el Deployment y lanza un despliegue nuevo.
* Para volver a Keycloak, se eliminan las variables con un guion final: `Auth__Issuer-`, `Auth__MetadataAddress-`, etc.

Con Entra ID **desaparece el problema de las dos URLs** que tuvimos con Keycloak: hay una única dirección pública, que el pod usa tanto para validar el issuer como para descargar las claves. A cambio, el pod necesita salida a internet.

Como el parche de `imagePullPolicy` del laboratorio de Kubernetes, este cambio se pierde con un `helm upgrade`. Cómo gestionar bien esta configuración por entorno es justo el tema del próximo post.

## 6. Verificación con `curl`

Las mismas pruebas que con Keycloak, con el `init.json` de aquel laboratorio:

**Sin token**, `401` con `resource_metadata`:

```powershell
curl.exe -i -X POST http://127.0.0.1/mcp
```

**Los metadatos del recurso**, en `http://127.0.0.1/.well-known/oauth-protected-resource/mcp`, ahora anuncian Entra ID:

* `authorization_servers`: `https://login.microsoftonline.com/<tenant-id>/v2.0`
* `scopes_supported`: `api://<client-id>/mcp.tools`

**Con el token de `mcp-app`**, `200`:

```powershell
curl.exe -i -X POST http://127.0.0.1/mcp -H "Authorization: Bearer $token" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "@init.json"
```

**Con un token de Keycloak**, `401`. Es un token válido y firmado, pero por otro emisor: ni sus claves de firma son las que publica Entra ID ni su issuer coincide. En el log aparece como un fallo de validación de la firma, que es la primera comprobación que hace .NET. Es exactamente lo que debe ocurrir.

## 7. Verificación con un usuario desde Visual Studio Code

### `mcp.json`

Sin `clientId`: VS Code detecta que el authorization server es Entra ID y usa su propio proveedor de autenticación de Microsoft.

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

Si vienes del laboratorio de Keycloak, quita el `oauth.clientId` y cierra la sesión anterior desde el menú **Accounts** de VS Code.

### Un usuario del tenant

VS Code suele tener abierta una sesión con la cuenta corporativa de Microsoft, por ejemplo para GitHub Copilot. Esa cuenta pertenece a otro tenant y no puede iniciar sesión en el nuestro. Creamos un usuario de prueba:

**Entra ID** → **Users** → **New user** → **Create new user**, con `test.user@<tu-dominio>.onmicrosoft.com` y una contraseña inicial que Entra ID pedirá cambiar en el primer login. Con los *security defaults* activos, en ese mismo login pedirá también registrar Microsoft Authenticator.

### Conectar

Al iniciar el servidor desde VS Code:

1. VS Code recibe el `401`, lee los metadatos y descubre que el authorization server es Entra ID.
2. Pide iniciar sesión con Microsoft. En el selector, elegimos **otra cuenta** y entramos con `test.user`.
3. No aparece pantalla de consentimiento: VS Code está autorizado para el scope `mcp.tools`.
4. El servidor pasa a **Running** y descubre la tool.

## Restringir quién puede entrar

Tal como está configurado, **cualquier usuario del tenant** puede usar el servicio. Hay dos niveles para restringirlo:

**En el proveedor**: **Entra ID** → **Enterprise apps** → `mcp-server` → **Properties** → **Assignment required?** = *Yes*, y en **Users and groups** se asignan los usuarios autorizados. A los demás, Entra ID no les emite token. Dos detalles: la aplicación `mcp-app` no se ve afectada, porque el consentimiento de administrador ya le asignó su app role; y la restricción **no se aplica a los administradores globales**, así que pruébala con `test.user` y no con tu cuenta de administrador. En Keycloak no hay un ajuste equivalente tan directo: se consigue con un flujo de autenticación personalizado que deniega el acceso a quien no tenga un rol.

**En la API**: un app role para usuarios (*Allowed member types* = *Users/Groups*) que la política del servicio exija. Funciona igual con los dos proveedores, y la API debería aplicarlo siempre, sin depender de que el proveedor haya filtrado antes. Es también la base para algo más fino: decidir qué tools puede usar cada usuario, que dejamos para un próximo artículo.

## ¿Y si no es un MCP Server?

Para cualquier otra API del clúster, el lado de Entra ID es el mismo: un app registration por servicio, con tokens v2, sus app roles para aplicaciones y usuarios, y sus scopes si la llaman clientes en nombre de un usuario. En el código desaparecen las piezas de MCP, igual que vimos con Keycloak:

* Sin `AddMcp`, sin metadatos de recurso protegido y con JWT Bearer como esquema por defecto para todo.
* Sin `scopes_supported`: cada cliente se configura con el scope que necesita, `api://<client-id>/<scope>` para un usuario o `api://<client-id>/.default` en client credentials.
* Sin la autorización previa de VS Code: los clientes con usuario necesitan su propio app registration, con el permiso delegado concedido.

Y la configuración de `AddJwtBearer` no cambia: el mismo `issuer`, `MetadataAddress`, audiencia y tipos de claim de este laboratorio.

## Errores habituales

En este laboratorio no tuvimos tropiezos, en buena parte porque los pasos ya los prevén. Estos son los errores más habituales y cómo reconocerlos:

| Error | Causa |
| --- | --- |
| `AADSTS7000215` al pedir el token | Se copió el *Secret ID* en lugar del *Value* del secreto |
| `AADSTS500011` | No se encuentra la API: revisa el scope y que el *Application ID URI* esté definido |
| `AADSTS1002012` | Scope no válido en client credentials: falta `/.default` |
| Token sin claim `roles` | No se concedió el consentimiento de administrador |
| Issuer `sts.windows.net` o audiencia `api://...` | El token es v1: falta `requestedAccessTokenVersion: 2` |
| `IDX20803` en el log del servicio | El pod no llega a `login.microsoftonline.com`: proxy o restricciones de salida |
| `AADSTS50020` en VS Code | Se eligió una cuenta de otro tenant |
| `AADSTS65001` en VS Code | VS Code no está en *Authorized client applications* o falta marcar el scope |
| `AADSTS700016` en VS Code | Quedó en `mcp.json` el `clientId` de otro proveedor |
| `AADSTS50105` | *Assignment required* activado y el usuario no está asignado |

## Conclusiones

El mismo servicio, con el mismo código, funciona con dos proveedores de identidad muy distintos. Comparando los dos laboratorios:

* **Entra ID simplifica la parte técnica**: una sola URL, audiencia y roles sin configuración extra, y VS Code autorizado sin registrar un client propio.
* **A cambio, introduce conceptos propios**: versiones de token, consentimiento de administrador y la separación entre app registration y enterprise application.
* **Keycloak da más control** y se ejecuta donde tú decides, también sin conexión a internet, pero cada detalle (audiencia, roles, redirect URIs) hay que configurarlo a mano.

Y el cambio de proveedor ha sido solo una cuestión de **configuración**, aplicada aquí con variables de entorno a mano. En el próximo artículo veremos cómo gestionarla bien en UAT y producción: variables, secretos y vault.

## Referencias

* [Crear un tenant en Microsoft Entra ID](https://learn.microsoft.com/entra/fundamentals/create-new-tenant)
* [Valores predeterminados de seguridad en Microsoft Entra ID](https://learn.microsoft.com/entra/fundamentals/security-defaults)
* [Registrar una aplicación en Microsoft Entra ID](https://learn.microsoft.com/entra/identity-platform/quickstart-register-app)
* [Exponer una API web](https://learn.microsoft.com/entra/identity-platform/quickstart-configure-app-expose-web-apis)
* [Access tokens en Microsoft identity platform](https://learn.microsoft.com/entra/identity-platform/access-tokens)
* [Flujo client credentials](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
* [Añadir app roles a una aplicación](https://learn.microsoft.com/entra/identity-platform/howto-add-app-roles-in-apps)
* [Restringir una aplicación a un conjunto de usuarios](https://learn.microsoft.com/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users)
* [MCP en App Service con autenticación de Entra ID desde VS Code](https://learn.microsoft.com/azure/app-service/configure-authentication-mcp-server-vscode)
