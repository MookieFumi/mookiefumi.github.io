---
layout: post
title: "Spec-driven development con OpenSpec: primero la spec, después el código"
subtitle: Todos sus comandos, con un cambio real en una API de .NET, de init a archive
topic: ia
published: true
---

## Por qué OpenSpec

OpenSpec añade una capa ligera de especificaciones al repositorio para que tú y tu agente de IA acordéis *qué* construir antes de escribir una sola línea de código.

El problema que resuelve es conocido: los requisitos viven en el historial del chat, el agente improvisa lo que no está escrito y a las dos semanas nadie sabe por qué el sistema se comporta así. OpenSpec saca esa conversación a ficheros Markdown versionados junto al código.

Su modelo mental cabe en tres ideas:

- **Spec**: describe el comportamiento *actual* del sistema. Vive en `openspec/specs/<capability>/spec.md` y es la fuente de verdad.
- **Change**: una propuesta de modificación. Vive en `openspec/changes/<change-id>/` y agrupa `proposal.md`, `design.md`, `tasks.md` y los deltas.
- **Delta**: la diferencia entre la spec actual y la deseada, escrita como requisitos `ADDED`, `MODIFIED` o `REMOVED`. Al archivar el change, los deltas se fusionan en la spec.

Esto lo hace muy adecuado para código existente (*brownfield*): no hay que documentar el sistema entero para empezar, basta con describir lo que cambia. El propio proyecto lo resume en cuatro principios: fluido y no rígido, iterativo y no waterfall, sencillo y no complejo, pensado para brownfield y no solo para proyectos nuevos.

Si vienes del mundo .NET, la analogía con EF Core ayuda: la spec es el *model snapshot*, cada change es una migración que describe solo la diferencia, y archivar es aplicarla.

<figure class="diagram">
  <img class="diagram-light" width="928" height="196" src="{{ '/img/diagrams/07-openspec-ciclo-light.svg' | prepend: site.baseurl }}" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
  <img class="diagram-dark" width="928" height="196" src="{{ '/img/diagrams/07-openspec-ciclo-dark.svg' | prepend: site.baseurl }}" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
</figure>

Un change se piensa (opcional), se propone, se implementa y se archiva; al archivar, sus deltas se fusionan en la spec viva. Las cajas con borde discontinuo son pasos opcionales.

En este post vamos a recorrer **todos los comandos** de OpenSpec con un caso real: una API de transacciones a la que hay que añadir paginación. Iremos de `openspec init` hasta el change archivado.

Si prefieres aprender haciendo, hay un atajo: `/opsx-onboard`, un tutorial guiado sobre tu propio código al que dedico una sección entera justo después de la instalación.

## El proyecto base: una API que devuelve todas las transacciones

Partimos de `Transactions.Api`, una Minimal API en .NET con un único endpoint de lectura que devuelve **todas** las transacciones de una vez.

```text
Transactions.sln
├── src/Transactions.Api/
│   ├── Program.cs
│   ├── Domain/Transaction.cs
│   └── Data/ITransactionRepository.cs
└── tests/Transactions.Api.Tests/
```

```csharp
public record Transaction(Guid Id, DateTime Date, decimal Amount, string Currency, string Description);

app.MapGet("/api/v1/transactions", async (ITransactionRepository repository) =>
    Results.Ok(await repository.GetAll()));
```

Con cientos de filas nadie se quejó. Con cientos de miles, la respuesta pesa muchos MB, tarda segundos y obliga al cliente a cargarla entera en memoria.

La mejora que queremos es poder **consumir el endpoint de forma paginada**. Parece trivial, pero esconde decisiones de producto y de contrato que el código por sí solo no deja ver:

- ¿Paginación por número de página (`page` y `pageSize`) o por cursor?
- ¿Qué pasa con los clientes actuales, que esperan un array y no un sobre con metadatos?
- ¿Qué tamaño de página por defecto y máximo? ¿Qué orden evita que se repitan o se salten filas entre páginas?

Son justo las preguntas que OpenSpec te obliga a contestar *antes* de que el agente escriba código. Y como el proyecto ya existe y no tiene ninguna spec, es un caso *brownfield* de manual.

## Instalación y `openspec init`

OpenSpec son dos piezas que se usan en sitios distintos, y confundirlas es el error nº 1 al empezar.

|  | Se escribe en | Ejemplos |
| --- | --- | --- |
| CLI `openspec` | La terminal | `openspec init`, `openspec list`, `openspec validate` |
| Comandos slash | El chat del asistente (Copilot) | `/opsx-propose`, `/opsx-apply`, `/opsx-archive` |

La CLI gestiona el proyecto y comprueba cosas. Los comandos slash son los que hacen trabajar al agente. En GitHub Copilot se escriben con guion (`/opsx-propose`); en otras herramientas, como Claude Code, con dos puntos (`/opsx:propose`).

### Instalar la CLI

```bash
npm install -g @fission-ai/openspec@latest
openspec --version
```

Necesita Node.js 20.19 o superior. También funciona con pnpm, yarn, bun y nix. Hay tres opciones globales que valen para cualquier comando: `--version` (`-V`), `--help` (`-h`) y `--no-color`.

### Inicializar el proyecto

```bash
cd Transactions.Api
openspec init
```

En modo interactivo te pregunta qué herramientas de IA usas. Para saltarte las preguntas, por ejemplo en una plantilla de repo o en un script:

```bash
openspec init --tools github-copilot
```

| Opción | Qué hace |
| --- | --- |
| `[path]` | Directorio donde inicializar (por defecto, el actual) |
| `--tools <lista>` | Herramientas a configurar sin preguntar: `all`, `none` o una lista separada por comas |
| `--profile <perfil>` | Sobrescribe el perfil global solo para este init (`core` o `custom`) |
| `--force` | Limpia ficheros legacy de versiones antiguas sin pedir confirmación |

Sin más opciones, el init usa el perfil **core**, entrega **both** (skills y comandos) y los workflows `propose`, `explore`, `apply`, `sync` y `archive`.

Un detalle importante si trabajáis con Copilot: los comandos se generan como *prompt files* en `.github/prompts/` y solo funcionan en las extensiones de IDE (VS Code, JetBrains y Visual Studio). Copilot CLI no admite por ahora prompt files personalizados.

Haz commit de todo lo generado. Forma parte del repositorio igual que el código.

## Anatomía del proyecto tras el init

El init crea una carpeta `openspec/` con tres elementos y deja los ficheros del agente fuera de ella.

```text
openspec/
├── specs/          # fuente de verdad: comportamiento actual (vacía al empezar)
├── changes/        # propuestas en curso
│   └── archive/    # aparece al archivar el primer change
└── config.yaml     # configuración del proyecto
.github/prompts/    # comandos /opsx-* para Copilot en el IDE
```

Además se instalan las skills de tu asistente. La ruta exacta depende de la herramienta y está en la guía *Supported Tools* de la documentación oficial.

### config.yaml: el contexto del proyecto

`config.yaml` fija el esquema de trabajo y un bloque `context` que se inyecta en las instrucciones de cada artefacto. Es el sitio para el idioma, el stack y las convenciones del equipo.

```yaml
schema: spec-driven
context: |
  Idioma: Español. Todos los artefactos deben escribirse en español,
  salvo código, rutas, identificadores y términos técnicos (API, endpoint, DTO).
  Mantén en inglés las cabeceras estructurales (## ADDED Requirements,
  ### Requirement:, #### Scenario:) y las palabras clave SHALL, WHEN y THEN.
  Stack: .NET, C#, Minimal APIs, EF Core, xUnit.
  Convenciones: rutas bajo /api/v1; métodos sin sufijo Async.
```

Las cabeceras y palabras clave en inglés son decisión mía: el formato de los deltas depende de ellas, así que no me arriesgo a traducirlas. Compruébalo con `openspec validate` en tu primer change.

### El esquema spec-driven

El esquema por defecto define cuatro artefactos con dependencias entre sí, en este orden: proposal → specs → design → tasks.

| Artefacto | Fichero | Para qué sirve |
| --- | --- | --- |
| proposal | `proposal.md` | Por qué se hace y qué cambia: intención y alcance |
| specs | `specs/<capability>/spec.md` | Los deltas: requisitos `ADDED`, `MODIFIED` o `REMOVED` con sus escenarios |
| design | `design.md` | Decisiones técnicas y alternativas descartadas |
| tasks | `tasks.md` | Checklist de implementación que el agente irá marcando |

Cada change lleva además un pequeño `.openspec.yaml` con sus metadatos (esquema y fecha de creación). Si tu equipo necesita otro flujo, el esquema se puede forkear y personalizar; lo vemos en la sección de la CLI.

## Atajo: /opsx-onboard, tu primer change guiado sobre tu propio código

Si prefieres aprender haciendo, `/opsx-onboard` te lleva de la mano por un ciclo completo de OpenSpec sobre tu propio repositorio, sin ejemplos de juguete.

Es un tutorial interactivo de entre 15 y 30 minutos. El agente escanea tu código, te propone mejoras pequeñas y seguras y, con la que elijas, crea un change de verdad, lo implementa, lo verifica y lo archiva, narrando cada paso. Es la versión guiada de lo que la documentación oficial recomienda para código existente: no documentar todo el sistema de golpe, sino empezar por un primer change pequeño y real, que deja la primera spec del área que tocas.

### Cómo activarlo

`onboard` no está en el perfil core, así que primero hay que activar el perfil ampliado y regenerar los ficheros del repo:

```bash
openspec config profile   # marca el workflow onboard
openspec update           # lo instala en este repo
```

Reinicia el IDE para que aparezca el comando y, en el chat de Copilot, escribe `/opsx-onboard`. Más adelante, en la sección del perfil ampliado, verás cómo funcionan los perfiles.

### Qué hace, fase a fase

1. Bienvenida y análisis de tu código.
2. Búsqueda de una oportunidad de mejora.
3. Creación del change (`/opsx-new`).
4. Redacción de la propuesta.
5. Creación de las specs.
6. Redacción del diseño.
7. Creación de las tareas.
8. Implementación (`/opsx-apply`).
9. Verificación.
10. Archivo del change.
11. Resumen y siguientes pasos.

Es decir, recorre todo lo que veremos comando a comando en el resto del post, pero con el agente explicando por qué hace cada cosa.

### Cómo empieza con nuestra API

La conversación es representativa; el texto exacto varía.

```text
Tú:  /opsx-onboard

IA:  Welcome to OpenSpec! Voy a guiarte por un ciclo completo con tu
     código real. Déjame escanear el repositorio en busca de una mejora
     pequeña...

     He encontrado tres candidatas:
     1. Añadir validación de entrada a GET /api/v1/transactions
     2. Unificar los mensajes de error con ProblemDetails
     3. Paginar GET /api/v1/transactions

     ¿Cuál te interesa? (o propón otra)
```

Si eliges la tercera, acabarás en el mismo punto que el resto de este post, pero con el agente explicando cada artefacto según lo va creando.

### Qué tener en cuenta

- **Modifica tu repositorio.** Crea un change real, escribe código y lo archiva. Hazlo en una rama: el resultado es un change auténtico que puedes quedarte o descartar.
- **Elige algo pequeño de verdad.** Los primeros changes sirven para aprender el ritmo del flujo con poco riesgo.
- **Con Copilot, solo en el IDE.** Los comandos se generan como prompt files, que funcionan en las extensiones de VS Code, JetBrains y Visual Studio, pero no en Copilot CLI.
- **Conserva lo aprendido.** Lo explorado vive en el chat. Pide que lo relevante quede recogido en `design.md` antes de archivar.

### Para equipos

Es la forma más barata de incorporar a alguien: cada persona hace su primer change acompañado, en una rama, y después se comenta el resultado entre todos. Una buena práctica es activar el perfil ampliado solo durante la adopción y dejar el core como configuración estable de la plantilla de repo.

## Primer contacto con la CLI: list, view, schemas y templates

Antes de crear nada, cuatro comandos de solo lectura te dejan ver en qué estado está el proyecto. Los que necesitan un change (`status`, `show`, `validate` e `instructions`) aparecen más adelante, cuando ya exista uno.

### openspec list

Lista los changes activos o las specs del proyecto.

```bash
openspec list              # changes activos (por defecto)
openspec list --specs      # specs en lugar de changes
openspec list --sort name  # ordenar por nombre (por defecto, por recientes)
openspec list --json       # salida para scripts y agentes
```

En un proyecto recién iniciado no hay nada que mostrar: ni changes ni specs.

### openspec view

```bash
openspec view
```

Abre un panel interactivo en la terminal para navegar por specs y changes. Es solo para humanos: no tiene salida JSON.

### openspec schemas

```bash
openspec schemas
```

```text
Available schemas:
spec-driven (package)
  The default spec-driven development workflow
  Flow: proposal → specs → design → tasks
```

Muestra los esquemas de trabajo disponibles y su flujo de artefactos. Si defines uno propio, aparecerá aquí marcado como `project`.

### openspec templates

```bash
openspec templates                    # esquema por defecto (spec-driven)
openspec templates --schema my-flow   # otro esquema
```

Imprime la ruta de la plantilla que se usa para cada artefacto. Es útil cuando quieres saber *exactamente* qué estructura va a seguir el agente al generar `proposal.md` o `design.md`.

Todos estos comandos aceptan `--json` salvo `view`. Es la puerta de entrada para que agentes, hooks o pipelines de CI consuman la información sin parsear texto.

## /opsx-explore: pensar antes de comprometerse

`/opsx-explore` es la fase de pensamiento: una conversación sin estructura en la que el agente lee tu código, compara opciones y afina una idea difusa antes de que exista ningún change. No crea ficheros.

```text
/opsx-explore [tema]
```

Qué hace:

- Abre una conversación libre, sin estructura obligatoria.
- Investiga el código para responder a tus preguntas.
- Compara enfoques y puede dibujar diagramas para aclarar ideas.
- Cuando la idea cristaliza, propone pasar a `/opsx-propose` (o a `/opsx-new` si usas el perfil ampliado).

Las conversaciones de este post son representativas: el texto exacto cambia entre ejecuciones, pero el patrón es el que ves.

```text
Tú:  /opsx-explore Quiero poder consumir GET /api/v1/transactions
     paginado. ¿Qué opciones hay y qué impacto tiene en los clientes?

IA:  He revisado Program.cs y ITransactionRepository. Hoy GetAll()
     devuelve la lista completa y la respuesta es un array JSON.
     Veo tres caminos:

     1. Offset (page + pageSize): simple y permite saltar a una página,
        pero es inestable si se insertan filas mientras se pagina.
     2. Cursor (keyset por fecha + id): estable y rápido en tablas
        grandes, pero no permite saltar a la página N.
     3. Cabeceras (X-Total-Count, Link) manteniendo el array: no rompe
        el contrato, pero esconde los metadatos en las cabeceras.

     Dos preguntas antes de decidir: ¿hay clientes que dependan del
     array completo? ¿Alguien necesita saltar a una página concreta?

Tú:  Sí: hay informes internos que descargan todo, y la UI necesita
     saltar de página. Vamos con page/pageSize y un sobre con
     totalCount. El modo antiguo debe seguir funcionando, deprecado.

IA:  Entendido. Propongo 50 elementos por defecto, máximo 200, orden por
     fecha descendente y desempate por id. Cuando quieras:
     /opsx-propose add-transactions-pagination
```

Tres cosas que conviene saber:

- **Lo pensado vive en el chat, y el chat se pierde.** Lo que importa pasa a `proposal.md` y `design.md` cuando propones. Pide que las alternativas descartadas queden en `design.md`: es lo que dentro de seis meses explica por qué se hizo así.
- **Es opcional.** Si ya sabes qué quieres, salta directamente a `/opsx-propose`.
- **No toca nada.** Ni `openspec/` ni `src/`, así que puedes usarlo sin miedo en cualquier momento, incluso con un change a medias.

## /opsx-propose: de la idea al change completo

`/opsx-propose` crea el change y genera de una sola vez todos los artefactos de planificación; se detiene cuando el change está listo para implementarse.

```text
/opsx-propose [nombre-del-change-o-descripción]
```

El nombre del change es el de su carpeta: minúsculas, kebab-case y empezando por una letra (si incluye un ticket, antepón una palabra: `ticket-123-add-notifications`, no `123-add-notifications`). Si le das solo una descripción, el agente elige un nombre. Nosotros lo fijamos:

```text
Tú:  /opsx-propose add-transactions-pagination

IA:  Created openspec/changes/add-transactions-pagination/
     ✓ proposal.md
     ✓ specs/transactions/spec.md
     ✓ design.md
     ✓ tasks.md
     Ready for implementation. Run /opsx-apply.
```

```text
openspec/changes/add-transactions-pagination/
├── .openspec.yaml
├── proposal.md
├── design.md
├── tasks.md
└── specs/
    └── transactions/
        └── spec.md
```

Veamos qué contiene cada artefacto. El texto que genera el agente varía; esto es lo representativo para nuestro caso.

### proposal.md: el porqué y el alcance

```markdown
# Paginar el endpoint de transacciones

## Why
`GET /api/v1/transactions` devuelve todas las transacciones en una sola
respuesta. Con volúmenes grandes el payload es excesivo para clientes y API.

## What Changes
- Aceptar `page` y `pageSize` en `GET /api/v1/transactions`.
- Devolver un sobre con `items`, `page`, `pageSize` y `totalCount`.
- Mantener la respuesta completa (array) cuando no se envían parámetros,
  marcada como obsoleta con la cabecera `Deprecation`.

## Impact
- Código afectado: endpoint de transacciones e `ITransactionRepository`.
- Los clientes actuales siguen funcionando; los nuevos deben paginar.
```

### specs/transactions/spec.md: el delta

Como el proyecto no tenía ninguna spec, todo el delta es `ADDED`. La carpeta `transactions` es la *capability*: al archivar, este fichero creará `openspec/specs/transactions/spec.md`.

```markdown
## ADDED Requirements

### Requirement: Legacy listing without paging parameters
El sistema SHALL devolver todas las transacciones como array JSON cuando no
se envíe `page` ni `pageSize`, e incluir la cabecera `Deprecation: true`.

#### Scenario: Call without paging parameters
- **WHEN** un cliente llama a `GET /api/v1/transactions` sin parámetros de paginación
- **THEN** el sistema responde 200 con un array JSON de todas las transacciones
- **AND** la respuesta incluye la cabecera `Deprecation: true`

### Requirement: Paginated listing
El sistema SHALL devolver una página de transacciones cuando se envíe `page` o
`pageSize`, ordenadas por fecha descendente y desempatadas por id descendente.
La respuesta SHALL ser un sobre con `items`, `page`, `pageSize` y `totalCount`.
El tamaño de página por defecto SHALL ser 50 y el máximo 200.

#### Scenario: First page with default size
- **WHEN** un cliente llama a `GET /api/v1/transactions?page=1`
- **THEN** el sistema responde 200 con el sobre de paginación
- **AND** `pageSize` es 50 y `items` contiene como máximo 50 transacciones

#### Scenario: Page beyond the last one
- **WHEN** un cliente pide una página mayor que la última
- **THEN** el sistema responde 200 con `items` vacío y el `totalCount` real

### Requirement: Invalid paging parameters are rejected
El sistema SHALL responder 400 con un `ProblemDetails` cuando `page` sea menor
que 1, o `pageSize` sea menor que 1 o mayor que el máximo permitido.

#### Scenario: Page size above the maximum
- **WHEN** un cliente llama a `GET /api/v1/transactions?page=1&pageSize=500`
- **THEN** el sistema responde 400 indicando que el máximo es 200

#### Scenario: Page number below one
- **WHEN** un cliente llama a `GET /api/v1/transactions?page=0`
- **THEN** el sistema responde 400 con un `ProblemDetails`
```

Fíjate en que esto describe **comportamiento observable**, no implementación. No dice cómo paginar en EF Core, sino qué ve un cliente.

### design.md: el cómo y lo descartado

```markdown
## Context
El endpoint carga todas las filas en memoria y las serializa de una vez.

## Goals / Non-Goals
- Goals: respuestas acotadas, total disponible, sin romper clientes actuales.
- Non-Goals: paginación por cursor, filtros nuevos.

## Decisions
- **Offset (`page`/`pageSize`) frente a cursor.** La UI necesita saltar a una
  página concreta. Descartado: keyset por (fecha, id), más estable pero sin salto.
- **Sobre JSON frente a cabeceras.** Los metadatos van en el cuerpo.
  Descartado: `X-Total-Count` y `Link` manteniendo el array.
- **Modo antiguo conservado y obsoleto.** Sin parámetros se devuelve el array
  con `Deprecation: true`; se retirará en una versión futura.
- **Orden estable.** `date` descendente y desempate por `id`.

## Risks / Trade-offs
- Con inserciones concurrentes, el offset puede repetir o saltar filas.
- Dos formas de respuesta complican el contrato hasta retirar la antigua.
```

### tasks.md: el plan de implementación

```markdown
## 1. Contract
- [ ] 1.1 Crear el record `PagedResult<T>` (items, page, pageSize, totalCount)
- [ ] 1.2 Definir tamaño por defecto (50) y máximo (200)

## 2. Data
- [ ] 2.1 Añadir `GetPage(page, pageSize)` a `ITransactionRepository` con orden estable
- [ ] 2.2 Añadir `Count()` a `ITransactionRepository`

## 3. Endpoint
- [ ] 3.1 Enlazar y validar `page` y `pageSize`; devolver `ProblemDetails` 400
- [ ] 3.2 Mantener el modo antiguo con la cabecera `Deprecation: true`

## 4. Tests
- [ ] 4.1 Un test por cada escenario de la spec
```

Este es el momento más barato de corregir algo. En un equipo, aquí abrirías un PR que contenga **solo** `openspec/` y lo revisaría alguien antes de que se escriba una línea de código.

## Revisar y refinar: status, show, instructions, validate y /opsx-update

Antes de implementar, inspecciona el change desde la terminal y corrige lo que haga falta. Aquí entran los cuatro comandos de la CLI que necesitan un change, más `/opsx-update` en el chat.

### openspec list y openspec status

Con el change creado, `openspec list` ya lo muestra, y `openspec status` detalla el estado de sus artefactos.

```bash
openspec list
openspec status --change add-transactions-pagination
openspec status --change add-transactions-pagination --json
```

```text
Change: add-transactions-pagination
Schema: spec-driven
Progress: 4/4 artifacts complete

[x] proposal
[x] design
[x] specs
[x] tasks
```

Cada artefacto puede estar `done`, `ready` o `blocked` (con la lista de dependencias que le faltan). Opciones: `--change <id>`, `--schema <nombre>` y `--json`. La salida JSON es la que consumen los agentes para saber cuál es el siguiente paso.

### openspec show

Muestra el contenido de un change o de una spec.

```bash
openspec show add-transactions-pagination
openspec show add-transactions-pagination --json --deltas-only
openspec show transactions --type spec      # cuando ya esté archivada
```

| Opción | Qué hace |
| --- | --- |
| `--type change` o `--type spec` | Fuerza el tipo si el nombre es ambiguo |
| `--json` | Salida estructurada |
| `--deltas-only` | Solo los deltas del change (modo JSON) |
| `--requirements`, `--no-scenarios`, `-r <n>` | Para specs: solo requisitos, sin escenarios, o un requisito concreto por su índice (modo JSON) |
| `--no-interactive` | Desactiva las preguntas |

### openspec instructions

Devuelve las instrucciones enriquecidas para crear un artefacto o para implementar. Es lo que el agente consulta por debajo cuando propones o aplicas.

```bash
openspec instructions design --change add-transactions-pagination
openspec instructions apply --change add-transactions-pagination
openspec instructions proposal --change add-transactions-pagination --json
```

La salida incluye la plantilla del artefacto, el `context` de tu `config.yaml`, el contenido de los artefactos de los que depende y las reglas por artefacto. Por eso es la forma más rápida de comprobar que tu idioma y tu stack llegan de verdad al agente. `apply` es un valor especial para pedir las instrucciones de implementación, y en modo no interactivo `--change` es obligatorio.

### openspec validate

Comprueba que los changes y las specs están bien formados.

```bash
openspec validate add-transactions-pagination
openspec validate --changes
openspec validate --specs
openspec validate --all --json
openspec validate --all --strict --concurrency 12
```

| Opción | Qué hace |
| --- | --- |
| `--all`, `--changes`, `--specs` | Valida todo, solo los changes o solo las specs |
| `--type change` o `--type spec` | Desambigua cuando el nombre existe en ambos |
| `--strict` | Validación estricta |
| `--json` | Salida para CI y scripts |
| `--concurrency <n>` | Validaciones en paralelo (6 por defecto, o la variable `OPENSPEC_CONCURRENCY`) |
| `--no-interactive` | Desactiva las preguntas |

Ejemplo de salida, tomado de la documentación oficial:

```text
Validating add-dark-mode...
✓ proposal.md valid
✓ specs/ui/spec.md valid
⚠ design.md: missing "Technical Approach" section
1 warning found
```

Ojo con lo que no hace: `validate` mira la **estructura** (formato de los deltas, escenarios, secciones). No sabe si la spec es buena ni si el código la cumple. Termina con código de salida 1 si hay errores, así que sirve tal cual en un pipeline.

### /opsx-update: corregir el plan

`/opsx-update` revisa los artefactos de planificación de un change y los mantiene coherentes entre sí. Solo toca el plan, nunca el código.

```text
/opsx-update [nombre-del-change]
```

Cómo trabaja: lee los artefactos, aplica la revisión que le pidas (o, si no le pides ninguna, busca contradicciones), propaga el cambio al resto de artefactos en la dirección que haga falta y **confirma contigo cada edición, artefacto a artefacto**, antes de escribir. Al terminar recomienda el siguiente paso.

En la revisión, alguien opina que 200 elementos por página es demasiado:

```text
Tú:  /opsx-update add-transactions-pagination - el máximo de pageSize
     debe ser 100, no 200

IA:  Leyendo los artefactos de add-transactions-pagination...
     El 200 aparece en la spec (requisito y escenario) y en tasks.md
     (tarea 1.2).

     Revisiones propuestas:
     1. specs/transactions/spec.md - máximo 200 → 100
     2. tasks.md - tarea 1.2: máximo 100

     ¿Aplico la revisión 1? (specs/transactions/spec.md)
```

También puedes editar los Markdown a mano y después pedir a `/opsx-update` que reconcilie el resto. Dos reglas: no crea artefactos que falten (eso es del flujo ampliado, con `/opsx-continue`), y si tu revisión cambia la *intención* del change, es mejor empezar uno nuevo que remendar este.

Tras el cambio, vuelve a ejecutar `openspec validate add-transactions-pagination`. A partir de aquí el máximo es **100**.

## /opsx-apply: implementar las tareas

`/opsx-apply` lee `tasks.md`, trabaja las tareas pendientes una a una (escribe código, crea ficheros, ejecuta tests) y las marca con `[x]` conforme las completa.

```text
/opsx-apply [nombre-del-change]
```

- Con un solo change activo lo infiere; con varios, indícale el nombre: `/opsx-apply add-transactions-pagination`.
- Puede retomarse donde se quedó. El estado vive en las casillas de `tasks.md`, no en el chat.
- Si una tarea exige cambiar el plan, el agente puede ajustar los artefactos sobre la marcha.

```text
Tú:  /opsx-apply

IA:  Implementing add-transactions-pagination...

     Reading tasks.md: 7 pending tasks

     Working on 1.1: Crear el record PagedResult<T>...
     ✓ 1.1 Complete
     Working on 2.1: Añadir GetPage(page, pageSize)...
     ✓ 2.1 Complete
     ...
     ✓ 4.1 Complete

     All tasks complete.
```

El resultado en el código, representativo, sería parecido a esto:

```csharp
public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public static class TransactionEndpoints
{
    private const int DefaultPageSize = 50;
    private const int MaxPageSize = 100;

    public static void MapTransactions(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/transactions", async (
            int? page, int? pageSize, HttpContext http, ITransactionRepository repository) =>
        {
            if (page is null && pageSize is null)
            {
                http.Response.Headers["Deprecation"] = "true";
                return Results.Ok(await repository.GetAll());
            }

            var currentPage = page ?? 1;
            var currentSize = pageSize ?? DefaultPageSize;

            if (currentPage < 1 || currentSize < 1 || currentSize > MaxPageSize)
            {
                return Results.Problem(
                    title: "Invalid paging parameters",
                    detail: $"page must be >= 1 and pageSize must be between 1 and {MaxPageSize}.",
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var items = await repository.GetPage(currentPage, currentSize);
            var totalCount = await repository.Count();

            return Results.Ok(new PagedResult<Transaction>(items, currentPage, currentSize, totalCount));
        });
    }
}
```

Y un test por escenario de la spec, como pedía la tarea 4.1:

```csharp
[Fact]
public async Task PageSizeAboveMaximum_ReturnsBadRequest()
{
    var response = await client.GetAsync("/api/v1/transactions?page=1&pageSize=500");

    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
}
```

Fíjate en la trazabilidad: cada escenario de la spec acaba siendo un test, y cada valor del código (50, 100, `Deprecation`) sale de un requisito escrito y revisado antes.

### Si el comportamiento cambia a mitad de camino

A veces, implementando, negocio cambia de opinión o aparece un caso que nadie vio. La regla es **primero la spec, después el código**: corrige el plan con `/opsx-update`, o edita el delta a mano, y vuelve a ejecutar `/opsx-apply` para que el código se ajuste al plan revisado. Si no, la spec miente en cuanto termines, y esa es la forma más común de que una spec pierda valor.

## El perfil ampliado: new, continue, ff, verify, bulk-archive y onboard

Hasta aquí hemos usado solo el perfil core, y para muchos equipos es suficiente. El perfil ampliado añade seis comandos para quien quiera un control más fino sobre cada paso.

Se activa en dos pasos: primero eliges los workflows en el asistente (es configuración global de tu máquina) y después aplicas la selección en cada proyecto.

```bash
openspec config profile   # marca los workflows que quieras
openspec update           # regenera los ficheros del agente en este repo
```

### /opsx-new

Crea solo el andamio del change: la carpeta y su `.openspec.yaml`. No genera ningún artefacto.

```text
/opsx-new [nombre] [--schema <esquema>]
```

```text
Tú:  /opsx-new add-transactions-pagination

IA:  Created openspec/changes/add-transactions-pagination/
     Schema: spec-driven
     Ready to create: proposal
     Use /opsx-continue to create it, or /opsx-ff to create all artifacts.
```

Tiene un equivalente en la terminal, `openspec new change <nombre>`, con las opciones `--description`, `--goal`, `--schema`, `--store` y `--json`. Evita nombres genéricos como `update`, `changes` o `wip`.

### /opsx-continue

Crea **un** artefacto por invocación: el primero que esté listo según el grafo de dependencias. Antes de crearlo te enseña qué está listo y qué bloqueado.

```text
Tú:  /opsx-continue

IA:  Change: add-transactions-pagination
     Artifact status:
     ✓ proposal   (done)
     ◆ specs      (ready)
     ◆ design     (ready)
     ○ tasks      (blocked - needs: specs, design)

     Creating specs...
```

Es el comando para cambios complejos en los que quieres revisar y editar cada artefacto antes de pasar al siguiente.

### /opsx-ff

*Fast-forward*: crea de golpe todos los artefactos de planificación en orden de dependencias y se detiene cuando ya se puede implementar. Es el equivalente a `/opsx-propose` partiendo de un change que ya existe.

| Situación | Comando |
| --- | --- |
| Requisitos claros, quiero avanzar | `/opsx-ff` |
| Hay prisa y el cambio es pequeño o mediano | `/opsx-ff` |
| Estoy explorando y quiero revisar cada paso | `/opsx-continue` |
| Quiero iterar la propuesta antes de escribir las specs | `/opsx-continue` |
| Cambio complejo y quiero control | `/opsx-continue` |

### /opsx-verify

Comprueba que la implementación coincide con los artefactos en tres dimensiones: *completeness* (tareas hechas, requisitos implementados, escenarios cubiertos), *correctness* (la implementación respeta la intención de la spec) y *coherence* (el diseño se refleja en el código). Clasifica lo que encuentra como CRITICAL, WARNING o SUGGESTION. **No bloquea el archive**, pero lo señala.

```text
Tú:  /opsx-verify

IA:  Verifying add-transactions-pagination...

     COMPLETENESS
     ✓ All 7 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "Page beyond the last one" has no test coverage

     CORRECTNESS
     ✓ Implementation matches spec intent
     ✓ Error states match spec definitions

     COHERENCE
     ✓ Design decisions reflected in code structure

     SUMMARY
     Critical issues: 0
     Warnings: 1
     Ready to archive: Yes (with warnings)
```

Este es justo el caso en el que verify se gana el sueldo: la tarea 4.1 estaba marcada, pero a un escenario le falta su test. Corrígelo antes de archivar.

### /opsx-bulk-archive

Archiva varios changes ya completados de una vez. Valida cada uno, detecta conflictos de spec entre ellos, los resuelve comprobando qué está realmente implementado en el código y archiva en orden cronológico. Es útil cuando hay varios flujos de trabajo en paralelo tocando las mismas capabilities.

### /opsx-onboard

Es el tutorial guiado sobre tu código real que se explica en detalle en la sección «Atajo: /opsx-onboard», más arriba. Necesita el perfil ampliado y modifica el repositorio, así que hazlo en una rama.

## /opsx-sync y /opsx-archive: cerrar el change

Con el código verificado queda cerrar el ciclo: fusionar el delta en la spec principal y archivar el change. Ahí es donde la spec pasa de describir una propuesta a describir el sistema.

### /opsx-sync (opcional)

Fusiona los deltas del change en `openspec/specs/` **sin archivar**: el change sigue activo. Lee las secciones `ADDED`, `MODIFIED`, `REMOVED` y `RENAMED`, respeta el contenido que el delta no menciona y puede añadir escenarios a un requisito existente sin duplicarlo.

```text
Tú:  /opsx-sync

IA:  Syncing add-transactions-pagination delta specs...

     Reading: openspec/changes/add-transactions-pagination/specs/transactions/spec.md
     Target:  openspec/specs/transactions/spec.md

     Changes to apply:
     ✓ ADDED: Legacy listing without paging parameters (1 scenario)
     ✓ ADDED: Paginated listing (2 scenarios)
     ✓ ADDED: Invalid paging parameters are rejected (2 scenarios)

     Change remains active. Run /opsx-archive when ready to complete.
```

Normalmente no hace falta invocarlo, porque archive ofrece sincronizar si no se ha hecho. Úsalo a mano cuando un change dura mucho y quieres la spec en main antes de archivar, cuando varios changes en paralelo necesitan la base actualizada o cuando quieres revisar la fusión por separado.

### /opsx-archive

Cierra el change. Comprueba el estado de los artefactos y de las tareas (avisa si hay pendientes, pero no bloquea), ofrece sincronizar los deltas si aún no se hizo y mueve la carpeta a `openspec/changes/archive/YYYY-MM-DD-<nombre>/`, conservando todo como rastro de auditoría.

```text
Tú:  /opsx-archive

IA:  Archiving add-transactions-pagination...

     Artifact status:
     ✓ proposal.md exists
     ✓ specs/ exists
     ✓ design.md exists
     ✓ tasks.md exists (7/7 tasks complete)

     Delta specs: Not yet synced
     → Sync now? (recommended)

Tú:  Sí

IA:  ✓ Synced specs to openspec/specs/transactions/spec.md
     ✓ Moved to openspec/changes/archive/2026-10-03-add-transactions-pagination/

     Change archived successfully.
```

### openspec archive: el cierre desde la terminal

También existe como comando de la CLI, pensado para scripts y pipelines:

```bash
openspec archive add-transactions-pagination
openspec archive add-transactions-pagination --yes
openspec archive update-ci-config --skip-specs
```

| Opción | Qué hace |
| --- | --- |
| `-y`, `--yes` | Salta las confirmaciones |
| `--skip-specs` | No actualiza las specs; para cambios de infraestructura, tooling o documentación |
| `--no-validate` | Salta la validación (pide confirmación) |

Lo que hace, en orden: valida el change (salvo `--no-validate`), pide confirmación (salvo `--yes`), fusiona los deltas en `openspec/specs/` y mueve la carpeta al archivo.

### El resultado

```text
openspec/
├── specs/
│   └── transactions/
│       └── spec.md          # la nueva spec viva
└── changes/
    └── archive/
        └── 2026-10-03-add-transactions-pagination/
```

Ahora puedes consultarla con `openspec list --specs`, `openspec show transactions --type spec` y `openspec validate --specs`. La spec describe el comportamiento real del endpoint: 50 elementos por defecto, máximo 100, orden estable, errores 400 y modo antiguo deprecado.

### El siguiente change: por fin un MODIFIED

Tres semanas después, producto pide bajar el tamaño por defecto de 50 a 25. Esta vez la spec ya existe, así que el delta usa `MODIFIED` y reproduce el requisito completo tal como debe quedar:

```markdown
## MODIFIED Requirements

### Requirement: Paginated listing
El sistema SHALL devolver una página de transacciones cuando se envíe `page` o
`pageSize`, ordenadas por fecha descendente y desempatadas por id descendente.
La respuesta SHALL ser un sobre con `items`, `page`, `pageSize` y `totalCount`.
El tamaño de página por defecto SHALL ser 25 y el máximo 100.

#### Scenario: First page with default size
- **WHEN** un cliente llama a `GET /api/v1/transactions?page=1`
- **THEN** el sistema responde 200 con el sobre de paginación
- **AND** `pageSize` es 25 y `items` contiene como máximo 25 transacciones
```

El requisito se identifica por su cabecera, así que el archive sabe exactamente cuál sustituir. Para retirar algo existe `REMOVED`, y para renombrar un requisito, `RENAMED`.

## Mantenimiento: openspec update, config y versiones

Actualizar OpenSpec son siempre dos pasos separados: la CLI de tu máquina y los ficheros que generó en cada repo.

### openspec update

Regenera los ficheros de instrucciones del agente (skills y comandos) con tu perfil global, los workflows seleccionados y el modo de entrega actuales. Se ejecuta después de actualizar la CLI o de cambiar de perfil.

```bash
npm install -g @fission-ai/openspec@latest   # o fija una versión: @x.y.z
openspec update                              # en cada repo
openspec update --force                      # regenera aunque parezca al día
openspec update ./otro-proyecto              # sobre otro directorio
```

Las specs y los changes no se tocan: `update` solo regenera los ficheros del agente. Por eso hay una regla de oro: **no edites a mano lo que genera OpenSpec**, porque el siguiente `update` lo pisará. Tus reglas van en `config.yaml` (contexto y reglas por artefacto) y en tus propias instrucciones de repo, como `.github/copilot-instructions.md`.

En un equipo con muchos repos, conviene que un workflow programado ejecute `openspec update` con la versión fijada y abra un PR. Así la actualización se revisa como cualquier otro cambio.

### openspec config

Ve y modifica la configuración **global** de OpenSpec, la de tu máquina, no la del proyecto.

| Subcomando | Qué hace |
| --- | --- |
| `path` | Muestra dónde está el fichero de configuración |
| `list` | Lista todos los ajustes |
| `get <clave>` | Lee un valor |
| `set <clave> <valor>` | Cambia un valor (`--string` fuerza que sea texto) |
| `unset <clave>` | Elimina un ajuste personalizado |
| `reset` | Restablece los valores por defecto (`--all --yes` para hacerlo sin preguntar) |
| `edit` | Abre el fichero en `$EDITOR` |
| `profile [preset]` | Configura perfil y modo de entrega |

```bash
openspec config list
openspec config get telemetry.enabled
openspec config set telemetry.enabled false
openspec config edit
openspec config profile        # asistente interactivo
openspec config profile core   # preajuste: vuelve a los workflows core
```

`openspec config profile` empieza con un resumen del estado actual y te deja elegir entre cambiar modo de entrega y workflows, solo la entrega, solo los workflows, o mantener todo como está. Nada se escribe en los repos hasta que ejecutas `openspec update` (o aceptas aplicarlo cuando el asistente te lo propone dentro de un proyecto). Si tu configuración global y los ficheros de un repo no coinciden, la CLI te avisa y sugiere `openspec update`.

### Dos niveles de configuración

|  | Proyecto | Global |
| --- | --- | --- |
| Dónde | `openspec/config.yaml` en el repo | Tu máquina, vía `openspec config` |
| Contiene | `schema`, `context`, reglas por artefacto | Perfil, modo de entrega, telemetría |
| Se comparte con el equipo | Sí, va en git | No |

### Telemetría y variables de entorno

Si trabajas en un entorno corporativo, puedes desactivar la telemetría con `OPENSPEC_TELEMETRY=0`, con la señal estándar `DO_NOT_TRACK=1` o con `openspec config set telemetry.enabled false`. Otras variables útiles: `OPENSPEC_CONCURRENCY` (paralelismo de `validate`), `EDITOR` o `VISUAL` (para `config edit`) y `NO_COLOR`.

## El resto de la CLI: schema, stores, doctor, context, workset, feedback y completion

Estos comandos no los necesitarás el primer día, pero completan el mapa de la herramienta.

### openspec schema: flujos propios

Si el esquema `spec-driven` se te queda corto o largo, puedes definir el tuyo: por ejemplo, añadir un artefacto de revisión de seguridad antes de `tasks`, o reducirlo a `proposal` y `tasks` para equipos pequeños.

```bash
openspec schema init research-first
openspec schema fork spec-driven my-workflow
openspec schema validate my-workflow
openspec schema which spec-driven
```

| Comando | Qué hace |
| --- | --- |
| `schema init <nombre>` | Crea un esquema local en `openspec/schemas/<nombre>/` con su `schema.yaml` y sus plantillas. Opciones: `--description`, `--artifacts`, `--default`, `--no-default`, `--force`, `--json` |
| `schema fork <origen> [nombre]` | Copia un esquema existente al proyecto para personalizarlo (por defecto, `<origen>-custom`) |
| `schema validate [nombre]` | Valida la estructura y las plantillas; sin nombre, las de todos los esquemas. Opciones: `--verbose`, `--json` |
| `schema which [nombre]` | Indica de dónde resuelve un esquema (`--all` los lista todos) |

La precedencia al resolver un esquema es: primero el del proyecto (`openspec/schemas/<nombre>/`), después el del usuario (`~/.local/share/openspec/schemas/<nombre>/`) y por último los integrados en el paquete.

### Stores, doctor, context y workset

Estos comandos están en **beta**: los nombres, las opciones y los formatos pueden cambiar entre versiones.

Un *store* es un repositorio OpenSpec independiente (por ejemplo, uno de planificación o uno de contratos entre servicios) que registras en tu máquina. Una vez registrado, los comandos normales (`list`, `show`, `status`, `validate`, `new change`, `archive`...) pueden actuar sobre él desde cualquier sitio con `--store <id>`.

| Comando | Qué hace |
| --- | --- |
| `store setup [id]` | Crea y registra un store local (`--path`, `--remote`, `--init-git` o `--no-init-git`, `--json`) |
| `store register [path]` | Registra un store que ya existe (`--id`, `--yes`, `--json`) |
| `store unregister <id>` | Olvida el registro sin borrar ficheros |
| `store remove <id>` | Olvida el registro **y borra** la carpeta (`--yes` en modo no interactivo) |
| `store list` (`ls`) | Lista los stores registrados |
| `store doctor [id]` | Diagnostica el registro, los metadatos y la presencia de Git |

Un proyecto puede declarar de qué stores depende en su `config.yaml`:

```yaml
schema: spec-driven
references:
  - team-context
```

Con eso, `openspec instructions` incluye un índice de las specs de cada store referenciado, como contexto de solo lectura. Nunca cambia dónde se escribe.

Tres comandos más completan este bloque:

- **`openspec doctor [--store <id>] [--json]`**: informa de la salud de la raíz OpenSpec y de las referencias. Es solo diagnóstico: nunca clona, sincroniza ni repara.
- **`openspec context [--store <id>] [--json] [--code-workspace <ruta>]`**: ensambla el conjunto de trabajo (la raíz más los stores referenciados). Con `--code-workspace` genera un fichero de workspace de VS Code que los incluye.
- **`openspec workset create | list | open | remove`**: vistas personales y locales de las carpetas con las que trabajas a la vez. `open` abre tu editor, o tu agente de CLI, con todas ellas adjuntas.

Te interesarán si varios servicios comparten contratos y quieres una única fuente de verdad para ellos.

### openspec feedback y openspec completion

```bash
openspec feedback "Soporte para artefactos propios" --body "Detalle..."
openspec completion install zsh
```

`feedback` crea una issue en GitHub y requiere tener `gh` instalado y autenticado. `completion` instala (`install`), genera (`generate`) o quita (`uninstall`) el autocompletado para bash, zsh, fish y PowerShell.

## Chuleta: todos los comandos de un vistazo

Dos tablas: lo que escribes en el chat del asistente y lo que escribes en la terminal.

### Comandos slash (en el chat)

| Comando | Perfil | Para qué sirve |
| --- | --- | --- |
| `/opsx-explore` | core | Pensar y comparar opciones sin crear ficheros |
| `/opsx-propose` | core | Crear el change y todos sus artefactos de una vez |
| `/opsx-update` | core | Revisar el plan y mantener los artefactos coherentes; nunca toca código |
| `/opsx-apply` | core | Implementar las tareas y marcarlas |
| `/opsx-sync` | core | Fusionar los deltas en la spec principal sin archivar |
| `/opsx-archive` | core | Cerrar el change y moverlo al archivo |
| `/opsx-new` | ampliado | Crear solo el andamio del change |
| `/opsx-continue` | ampliado | Crear el siguiente artefacto listo |
| `/opsx-ff` | ampliado | Crear todos los artefactos de planificación de golpe |
| `/opsx-verify` | ampliado | Contrastar la implementación con los artefactos |
| `/opsx-bulk-archive` | ampliado | Archivar varios changes resolviendo conflictos entre ellos |
| `/opsx-onboard` | ampliado | Tutorial guiado sobre tu código real |

En Claude Code, Cursor y otras herramientas la sintaxis cambia ligeramente (`/opsx:propose` con dos puntos en Claude Code). Si tras el init no ves `/opsx-update`, revisa los workflows seleccionados con `openspec config profile` y ejecuta `openspec update`.

### Comandos de la CLI (en la terminal)

| Comando | Para qué sirve | `--json` |
| --- | --- | --- |
| `openspec init` | Inicializar el proyecto y configurar las herramientas de IA | No |
| `openspec update` | Regenerar los ficheros del agente tras actualizar o cambiar de perfil | No |
| `openspec list` | Listar changes activos o specs | Sí |
| `openspec view` | Panel interactivo para navegar por specs y changes | No |
| `openspec show` | Ver un change o una spec | Sí |
| `openspec status` | Estado de los artefactos de un change | Sí |
| `openspec instructions` | Instrucciones que recibe el agente para un artefacto o para `apply` | Sí |
| `openspec templates` | Rutas de las plantillas de un esquema | Sí |
| `openspec schemas` | Esquemas de trabajo disponibles | Sí |
| `openspec validate` | Validar la estructura de changes y specs | Sí |
| `openspec new change` | Crear el andamio de un change desde la terminal | Sí |
| `openspec archive` | Archivar un change y fusionar sus deltas | No |
| `openspec schema init, fork, validate, which` | Crear, copiar, validar y localizar esquemas propios | Sí |
| `openspec config` | Configuración global: `path`, `list`, `get`, `set`, `unset`, `reset`, `edit`, `profile` | No |
| `openspec store` (beta) | Registrar y gestionar repos OpenSpec independientes | Sí |
| `openspec doctor` (beta) | Diagnóstico de la raíz y sus referencias | Sí |
| `openspec context` (beta) | Conjunto de trabajo: raíz más stores referenciados | Sí |
| `openspec workset` (beta) | Vistas personales de carpetas de trabajo | Sí, salvo `open` |
| `openspec feedback` | Enviar feedback como issue de GitHub | No |
| `openspec completion` | Autocompletado para tu shell | No |

## Conclusiones: qué aporta y cómo llevarlo a un equipo

OpenSpec no hace mejor al agente: cambia *cuándo* se toman las decisiones, que pasan a tomarse antes de programar, por escrito y de forma revisable.

En nuestro ejemplo, las preguntas incómodas de la paginación (offset o cursor, compatibilidad con los clientes actuales, tamaño máximo de página) se contestaron en artefactos que un humano pudo leer y corregir antes de que existiera una línea de código. Al terminar, la spec describe el comportamiento real del endpoint, cada escenario tiene su test y el archivo conserva el porqué.

Lo que te llevas:

- **Un flujo mínimo.** Tres comandos (`propose`, `apply`, `archive`), con `explore` delante y `update` o `sync` cuando hacen falta.
- **Specs que crecen solo donde trabajas.** No hay que documentar el legacy entero para empezar.
- **Revisión de intención.** El delta es mucho más corto que el diff de código y dice qué cambia y por qué.

Los límites, sin maquillaje:

- **Nada obliga.** `validate` solo comprueba estructura y `verify` no bloquea el archive. Que el flujo se cumpla depende de la disciplina del equipo y de lo que automatices.
- **La spec puede desviarse.** Si alguien cambia el código sin tocar el delta, la spec deja de reflejar la realidad.
- **No todo merece un change.** Para un bug trivial el ciclo completo sobra, y los cambios de infraestructura o documentación pueden archivarse con `--skip-specs`.

Si lo vas a llevar a un equipo, un buen punto de partida es este:

1. Una plantilla de repo con `openspec init` ya hecho y un `config.yaml` con el idioma, el stack y las convenciones.
2. El change se revisa en un PR propio, solo con `openspec/`, antes de ejecutar `apply`.
3. `openspec validate --all --strict` en el pipeline de CI.
4. `openspec update` periódico con la versión de la CLI fijada.
5. Para arrancar, `/opsx-onboard` en una rama, con el perfil ampliado activado solo durante la adopción.

Todo lo que has visto aquí se reproduce con un repositorio mínimo: una API con un endpoint, un `openspec init` y las ganas de escribir la spec antes que el código.

## Fuentes

Documentación oficial consultada para este post (octubre de 2026):

- [CLI Reference](https://openspec.dev/docs/reference/cli): comandos de terminal, opciones y salidas.
- [Commands](https://openspec.dev/docs/reference/slash-commands): comandos slash y perfiles core y ampliado.
- [The workflow](https://openspec.dev/docs/the-workflow): combinaciones de comandos y cuándo usar cada una.
- [Multi-language guide](https://openspec.dev/docs/multi-language): idioma de los artefactos.
- [Repositorio de OpenSpec](https://github.com/Fission-AI/openspec): README, filosofía y herramientas soportadas.

Para arrancar en un repositorio existente, la guía oficial es [Using OpenSpec in an Existing Project](https://openspec.dev/docs/existing-projects).

Las conversaciones con el agente y el código de ejemplo son representativos, no capturas literales. Contrasta los detalles con la versión que tengas instalada (`openspec --version`).
