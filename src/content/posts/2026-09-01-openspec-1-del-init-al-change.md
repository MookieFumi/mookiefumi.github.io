---
title: "Spec-driven development con OpenSpec, parte 1: proponer el change"
subtitle: Instalación, anatomía del proyecto, la CLI y el plan para paginar una API de .NET
date: 2026-09-01
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
  <img class="diagram-light" width="510" height="690" src="/img/diagrams/07-openspec-ciclo-light.svg" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
  <img class="diagram-dark" width="510" height="690" src="/img/diagrams/07-openspec-ciclo-dark.svg" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
</figure>

Un change se piensa (opcional), se propone, se implementa y se archiva; al archivar, sus deltas se fusionan en la spec viva. Las cajas con borde discontinuo son pasos opcionales.

En esta serie de dos posts vamos a recorrer **todos los comandos** de OpenSpec con un caso real: una API de transacciones a la que hay que añadir paginación. Iremos de `openspec init` hasta el change archivado. Este primer post llega hasta tener el change propuesto, revisado y validado; el [segundo](/2026-09-01-openspec-2-implementar-y-archivar) lo implementa y lo archiva.

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

Cada change lleva además un pequeño `.openspec.yaml` con sus metadatos (esquema y fecha de creación). Si tu equipo necesita otro flujo, el esquema se puede forkear y personalizar; lo vemos en el [segundo post](/2026-09-01-openspec-2-implementar-y-archivar), en la sección de la CLI.

## Atajo: /opsx-onboard, tu primer change guiado sobre tu propio código

Si prefieres aprender haciendo, `/opsx-onboard` te lleva de la mano por un ciclo completo de OpenSpec sobre tu propio repositorio, sin ejemplos de juguete.

Es un tutorial interactivo de entre 15 y 30 minutos. El agente escanea tu código, te propone mejoras pequeñas y seguras y, con la que elijas, crea un change de verdad, lo implementa, lo verifica y lo archiva, narrando cada paso. Es la versión guiada de lo que la documentación oficial recomienda para código existente: no documentar todo el sistema de golpe, sino empezar por un primer change pequeño y real, que deja la primera spec del área que tocas.

### Cómo activarlo

`onboard` no está en el perfil core, así que primero hay que activar el perfil ampliado y regenerar los ficheros del repo:

```bash
openspec config profile   # marca el workflow onboard
openspec update           # lo instala en este repo
```

Reinicia el IDE para que aparezca el comando y, en el chat de Copilot, escribe `/opsx-onboard`. En el [segundo post](/2026-09-01-openspec-2-implementar-y-archivar), en la sección del perfil ampliado, verás cómo funcionan los perfiles.

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

## Dónde lo dejamos

Tenemos el change `add-transactions-pagination` completo y validado: una propuesta con su porqué, un delta con tres requisitos y sus escenarios, un diseño con lo descartado y un plan de siete tareas en el que el tamaño máximo de página ya vale 100. Ni una línea de código de producción ha cambiado todavía, y eso es justo lo que buscábamos.

En el [segundo post](/2026-09-01-openspec-2-implementar-y-archivar) toca implementarlo con `/opsx-apply`, repasar el perfil ampliado, archivar el change y ver cómo queda la spec, y terminar con el resto de la CLI, una chuleta de todos los comandos y cómo llevarlo a un equipo.

## Fuentes

Documentación oficial consultada para este post (septiembre de 2026):

- [CLI Reference](https://openspec.dev/docs/reference/cli): comandos de terminal, opciones y salidas.
- [Commands](https://openspec.dev/docs/reference/slash-commands): comandos slash y perfiles core y ampliado.
- [The workflow](https://openspec.dev/docs/the-workflow): combinaciones de comandos y cuándo usar cada una.
- [Multi-language guide](https://openspec.dev/docs/multi-language): idioma de los artefactos.
- [Repositorio de OpenSpec](https://github.com/Fission-AI/openspec): README, filosofía y herramientas soportadas.

Para arrancar en un repositorio existente, la guía oficial es [Using OpenSpec in an Existing Project](https://openspec.dev/docs/existing-projects).

Las conversaciones con el agente y el código de ejemplo son representativos, no capturas literales. Contrasta los detalles con la versión que tengas instalada (`openspec --version`).