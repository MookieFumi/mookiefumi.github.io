---
title: "Detectar en la CI los cambios que rompen el contrato de la API"
subtitle: Renombrar un campo parece inofensivo hasta que la app de alguien deja de pintar la planta de la sala
description: "Detectar cambios incompatibles del contrato OpenAPI en la CI con oasdiff y GitHub Actions: qué rompe a los clientes, el resumen de cambios en cada PR y la marca ! de Conventional Commits."
date: 2026-10-01
topic: aspnet
series: minimal-apis-dotnet
published: false
---

En [entry-hub](https://github.com/MookieFumi/entry-hub) el contrato OpenAPI vive en el repositorio. La CI comprueba que está al día con el código, como vimos en el [post de OpenAPI](/2026-09-25-openapi-scalar-minimal-apis), y un test comprueba que las respuestas reales lo cumplen, como vimos en el [post de contract testing](/2026-09-30-contract-testing-openapi-dotnet). Falta una pregunta: cuando un PR cambia el contrato, ¿rompe a los clientes que ya lo usan?

El diff del PR lo enseña todo, pero no distingue. Añadir un campo a una respuesta y renombrar otro se ven igual de inocentes en un JSON de casi 900 líneas. En esta píldora la CI hace esa distinción por nosotros.

## Qué rompe a un cliente

Un cambio es incompatible cuando un cliente que funcionaba ayer deja de funcionar hoy sin haber tocado nada. Los casos típicos:

- Quitar o renombrar un campo de una respuesta. El cliente lo sigue leyendo y ya no está.
- Añadir un campo obligatorio a una petición. El cliente no lo manda y recibe un `400`.
- Quitar un endpoint, o cambiar el tipo de un campo.

Y casi todo lo demás es compatible: añadir un endpoint, añadir un campo a una respuesta, añadir un campo opcional a una petición o documentar una respuesta de error nueva.

Si de verdad hace falta un cambio incompatible, lo normal es sacar una versión nueva de la API y mantener la anterior mientras los clientes migran, como contamos en la [píldora de versionado](/2026-09-28-versionado-mapgroup-asp-versioning). El problema es el cambio incompatible que se cuela en la versión actual sin que nadie lo decida.

## oasdiff

[oasdiff](https://github.com/oasdiff/oasdiff) compara dos documentos OpenAPI y clasifica cada diferencia. Es un binario de Go, sin dependencias, y sabe leer un fichero directamente de una rama de git, así que no hace falta sacar el contrato de `main` a mano.

Para probarlo, renombramos `floor` a `level` en el contrato, que es justo el cambio inocente del que hablábamos:

```bash
oasdiff breaking HEAD:contracts/EntryHub.Api.json contracts/EntryHub.Api.json --fail-on ERR
```

```text
5 changes: 4 error, 1 warning, 0 info
error	[response-required-property-removed] at contracts/EntryHub.Api.json
	in API GET /api/v1/rooms
		removed the required property `items/items/floor` from the response with the `200` status

error	[new-required-request-property] at contracts/EntryHub.Api.json
	in API POST /api/v1/rooms
		added the new required request property `level`

error	[response-required-property-removed] at contracts/EntryHub.Api.json
	in API POST /api/v1/rooms
		removed the required property `floor` from the response with the `201` status

error	[response-required-property-removed] at contracts/EntryHub.Api.json
	in API GET /api/v1/rooms/{id}
		removed the required property `floor` from the response with the `200` status

warning	[request-property-removed] at contracts/EntryHub.Api.json
	in API POST /api/v1/rooms
		removed the request property `floor`
```

Un cambio de nombre y cuatro errores: tres respuestas pierden un campo y la petición de crear sala exige uno nuevo. `--fail-on ERR` hace que el comando termine con código `1` si hay algún error, y eso es lo que necesita la CI. Los avisos se enseñan, pero no hacen fallar nada.

Con un cambio compatible, por ejemplo un campo opcional nuevo en la respuesta de sala, el comando termina bien:

```text
No breaking changes to report, but the specs are different.
```

## En cada pull request

El workflow `contract.yml` tiene un solo job. Descarga oasdiff, comprueba su checksum y compara el contrato del PR con el de la rama base:

```yaml
- name: No breaking changes
  # A change that breaks existing clients fails unless the title marks it as breaking with "!", which also makes
  # GitVersion bump the major version when the pull request is merged.
  env:
    BASE_REF: ${{ github.base_ref }}
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: |
    fail_on="--fail-on ERR"
    if [[ "$PR_TITLE" =~ ^[a-z]+(\([a-z0-9-]+\))?!: ]]; then
      echo "The title marks this change as breaking: incompatible changes are reported but allowed."
      fail_on=""
    fi
    "$RUNNER_TEMP/oasdiff" breaking "origin/${BASE_REF}:${CONTRACT}" "$CONTRACT" --format githubactions $fail_on
```

Tres detalles:

- `actions/checkout` va con `fetch-depth: 0`, porque oasdiff lee `origin/main:contracts/EntryHub.Api.json` del historial y con un clon superficial esa rama no está.
- `--format githubactions` saca cada error como una anotación del check, así que se lee en el propio PR sin abrir el log.
- El título del PR entra por una variable de entorno y no directamente en el script. Lo escribe cualquiera que abra un PR, y meterlo con `${{ }}` dentro de `run` permitiría inyectar comandos.

No hace falta compilar nada: la CI de siempre ya garantiza que el contrato del PR coincide con el código, así que aquí basta con leer dos ficheros. El job tarda segundos.

## El resumen de cambios

Los cambios compatibles también conviene verlos. Otro paso del job escribe todos los cambios, compatibles o no, en el resumen del job:

```bash
oasdiff changelog "origin/${BASE_REF}:${CONTRACT}" "$CONTRACT" --format markdown >> "$GITHUB_STEP_SUMMARY"
```

Para el PR del post de contract testing, el que declaraba los errores en el contrato, el resumen queda así:

```markdown
### POST /api/v1/bookings
-  added the non-success response with the status `409`
-  added the non-success response with the status `422`

### GET /api/v1/bookings/{id}
-  added the non-success response with the status `403`

### POST /api/v1/bookings/{id}/cancel
-  added the non-success response with the status `403`
-  added the non-success response with the status `422`

### POST /api/v1/rooms
-  added the non-success response with the status `409`
```

Seis cambios, ninguno incompatible. Quien revisa el PR ve en diez líneas qué cambia para los clientes, sin leerse el JSON.

## Cuando el cambio incompatible es a propósito

A veces el cambio es intencionado: la API todavía no tiene clientes fuera del equipo, o ya habéis acordado la migración con todos. Bloquearlo sin salida sería un estorbo.

La salida está en el título del PR. En Conventional Commits, una `!` antes de los dos puntos marca un cambio incompatible:

```text
feat(rooms)!: rename floor to level
```

Con esa marca el job sigue enseñando los errores, pero no falla. Elegí esa marca porque ya tiene efecto en la versión: con squash merge, el título del PR es el commit que llega a `main`, y GitVersion sube la versión mayor cuando ve la `!`, como vimos en el [post de GitVersion](/2026-09-21-gitversion-versionado-semantico-dotnet). Así el cambio incompatible queda registrado en el número de versión.

Por eso el workflow también se lanza cuando se edita el PR (`types: [opened, edited, synchronize, reopened]`). Si el check falla, añadir la `!` al título lo vuelve a ejecutar sin hacer otro push.

## Quitar un endpoint

oasdiff tiene una regla más que encaja con la versión obsoleta de la `v1`. Si quitas un endpoint de golpe, falla con `api-path-removed-without-deprecation`. Si antes lo has marcado como `deprecated` en un PR, el changelog lo apunta (`endpoint deprecated`), y en un PR posterior quitarlo ya no cuenta como error.

## Lo que queda fuera

El check no es obligatorio todavía en las reglas de la rama `main`, así que un PR rojo se puede mergear igual. Para que bloquee de verdad hay que añadirlo como check requerido en el ruleset del repositorio.

Y oasdiff solo sabe lo que dice el contrato. Si un endpoint cambia lo que hace sin cambiar su forma, por ejemplo una regla de negocio más estricta, el contrato no se entera y oasdiff tampoco.

## Resumiendo

- Un cambio es incompatible cuando rompe a un cliente que no ha cambiado nada. `oasdiff breaking --fail-on ERR` lo detecta comparando el contrato del PR con el de `main`.
- El resumen del job enseña todos los cambios, y la `!` del título deja pasar los incompatibles a propósito y sube la versión mayor.

El código está en [entry-hub](https://github.com/MookieFumi/entry-hub). En la siguiente píldora añadimos un manejador global de errores con `IExceptionHandler`, para que ninguna excepción llegue al cliente con su traza.
