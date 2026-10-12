---
title: "Spec-driven development con OpenSpec, parte 2: implementar y archivar"
subtitle: El perfil ampliado, la CLI completa y cómo llevar OpenSpec a un equipo
date: 2026-09-01
topic: ia
series: openspec
published: true
---

En el [primer post](/2026-09-01-openspec-1-del-init-al-change) instalamos OpenSpec, recorrimos la anatomía del proyecto y la CLI de solo lectura, y dejamos el change `add-transactions-pagination` propuesto, revisado y validado, con el máximo de página en 100. Todavía no se ha escrito ninguna línea de código de producción.

Ahora toca cerrar el ciclo: implementar, archivar y ver cómo queda la spec. Después repaso el perfil ampliado, el mantenimiento y el resto de la CLI, y termino con una chuleta de comandos y con cómo llevar OpenSpec a un equipo.

<figure class="diagram">
  <img class="diagram-light" width="510" height="690" src="/img/diagrams/07-openspec-ciclo-light.svg" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
  <img class="diagram-dark" width="510" height="690" src="/img/diagrams/07-openspec-ciclo-dark.svg" alt="Ciclo de un change en OpenSpec: explore, propose, apply y archive en secuencia, con update y sync como pasos opcionales; al archivar, los deltas pasan a openspec/specs.">
</figure>

Ya hemos explorado y propuesto, así que quedan implementar y archivar. Las cajas con borde discontinuo son pasos opcionales.

## /opsx-apply: implementar las tareas

`/opsx-apply` lee `tasks.md`, trabaja las tareas pendientes una a una (escribe código, crea ficheros, ejecuta tests) y las marca con `[x]` conforme las completa.

```text
/opsx-apply [nombre-del-change]
```

- Con un solo change activo lo infiere; con varios, indícale el nombre: `/opsx-apply add-transactions-pagination`.
- Puede retomarse donde se quedó, porque el estado vive en las casillas de `tasks.md` y no en el chat.
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

El código resultante sería parecido a esto, a modo de ejemplo:

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

Cada escenario de la spec acaba siendo un test, y cada valor del código (50, 100, `Deprecation`) sale de un requisito que se escribió y se revisó antes.

### Si el comportamiento cambia a mitad de camino

A veces, mientras implementas, negocio cambia de opinión o aparece un caso que nadie vio. Mi regla es corregir primero la spec y después el código: ajusta el plan con `/opsx-update`, o edita el delta a mano, y vuelve a ejecutar `/opsx-apply` para que el código siga el plan revisado. Si no, la spec miente en cuanto terminas, que es la forma más habitual de que una spec pierda valor.

## El perfil ampliado: new, continue, ff, verify, bulk-archive y onboard

Hasta aquí hemos usado solo el perfil core, que a muchos equipos les basta. El perfil ampliado añade seis comandos para quien quiera más control sobre cada paso.

Se activa en dos pasos: eliges los workflows en el asistente (es configuración global de tu máquina) y después aplicas la selección en cada proyecto.

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

Crea un artefacto por invocación, el primero que esté listo según el grafo de dependencias. Antes de crearlo te enseña qué está listo y qué bloqueado.

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

Lo usaría en cambios complejos, donde quieres revisar y editar cada artefacto antes de pasar al siguiente.

### /opsx-ff

*Fast-forward*: crea de golpe todos los artefactos de planificación en orden de dependencias y para cuando ya se puede implementar. Viene a ser `/opsx-propose` partiendo de un change que ya existe.

| Situación | Comando |
| --- | --- |
| Requisitos claros, quiero avanzar | `/opsx-ff` |
| Hay prisa y el cambio es pequeño o mediano | `/opsx-ff` |
| Estoy explorando y quiero revisar cada paso | `/opsx-continue` |
| Quiero iterar la propuesta antes de escribir las specs | `/opsx-continue` |
| Cambio complejo y quiero control | `/opsx-continue` |

### /opsx-verify

Comprueba que la implementación coincide con los artefactos en tres dimensiones: *completeness* (tareas hechas, requisitos implementados, escenarios cubiertos), *correctness* (la implementación respeta la intención de la spec) y *coherence* (el diseño se refleja en el código). Clasifica lo que encuentra como CRITICAL, WARNING o SUGGESTION. No bloquea el archive, pero lo señala.

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

Aquí es donde verify se gana el sueldo: la tarea 4.1 estaba marcada, pero a un escenario le falta su test. Conviene corregirlo antes de archivar.

### /opsx-bulk-archive

Archiva de una vez varios changes ya completados. Valida cada uno, detecta conflictos de spec entre ellos, los resuelve comprobando qué está realmente implementado en el código y archiva en orden cronológico. Viene bien cuando hay varios flujos en paralelo tocando las mismas capabilities.

### /opsx-onboard

Es el tutorial guiado sobre tu código real que conté en la sección «Atajo: /opsx-onboard» del [primer post](/2026-09-01-openspec-1-del-init-al-change). Necesita el perfil ampliado y modifica el repositorio, así que hazlo en una rama.

## /opsx-sync y /opsx-archive: cerrar el change

Con el código verificado queda fusionar el delta en la spec principal y archivar el change. En ese momento la spec deja de describir una propuesta y pasa a describir el sistema.

### /opsx-sync (opcional)

Fusiona los deltas del change en `openspec/specs/` sin archivar, así que el change sigue activo. Lee las secciones `ADDED`, `MODIFIED`, `REMOVED` y `RENAMED`, respeta el contenido que el delta no menciona y puede añadir escenarios a un requisito existente sin duplicarlo.

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

Normalmente no hace falta invocarlo, porque archive ofrece sincronizar si no se ha hecho. Yo lo lanzaría a mano cuando un change dura mucho y quiero la spec en main antes de archivar, cuando varios changes en paralelo necesitan la base actualizada o cuando quiero revisar la fusión por separado.

### /opsx-archive

Cierra el change. Comprueba el estado de los artefactos y de las tareas (avisa si hay pendientes, pero no bloquea), ofrece sincronizar los deltas si aún no se hizo y mueve la carpeta a `openspec/changes/archive/YYYY-MM-DD-<nombre>/`, de modo que todo queda como rastro de auditoría.

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

Por orden, valida el change (salvo `--no-validate`), pide confirmación (salvo `--yes`), fusiona los deltas en `openspec/specs/` y mueve la carpeta al archivo.

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

Ya se puede consultar con `openspec list --specs`, `openspec show transactions --type spec` y `openspec validate --specs`. La spec recoge el comportamiento real del endpoint: 50 elementos por defecto, máximo 100, orden estable, errores 400 y modo antiguo deprecado.

### El siguiente change: por fin un MODIFIED

Tres semanas después, producto pide bajar el tamaño por defecto de 50 a 25. Como la spec ya existe, el delta usa `MODIFIED` y reproduce el requisito completo tal como debe quedar:

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

El requisito se identifica por su cabecera, así que el archive sabe cuál sustituir. Para retirar algo existe `REMOVED`, y para renombrar un requisito, `RENAMED`.

## Mantenimiento: openspec update, config y versiones

Actualizar OpenSpec son dos pasos separados: la CLI de tu máquina y los ficheros que generó en cada repo.

### openspec update

Regenera los ficheros de instrucciones del agente (skills y comandos) con tu perfil global, los workflows seleccionados y el modo de entrega actuales. Se ejecuta después de actualizar la CLI o de cambiar de perfil.

```bash
npm install -g @fission-ai/openspec@latest   # o fija una versión: @x.y.z
openspec update                              # en cada repo
openspec update --force                      # regenera aunque parezca al día
openspec update ./otro-proyecto              # sobre otro directorio
```

Las specs y los changes no se tocan, porque `update` solo regenera los ficheros del agente. Por eso no edito a mano lo que genera OpenSpec: el siguiente `update` lo pisaría. Mis reglas van en `config.yaml` (contexto y reglas por artefacto) y en tus propias instrucciones de repo, como `.github/copilot-instructions.md`.

En un equipo con muchos repos, conviene que un workflow programado ejecute `openspec update` con la versión fijada y abra un PR, para revisar la actualización como cualquier otro cambio.

### openspec config

Sirve para ver y modificar la configuración global de OpenSpec, la de tu máquina y no la del proyecto.

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

En un entorno corporativo puedes desactivar la telemetría con `OPENSPEC_TELEMETRY=0`, con la señal estándar `DO_NOT_TRACK=1` o con `openspec config set telemetry.enabled false`. Otras variables útiles: `OPENSPEC_CONCURRENCY` (paralelismo de `validate`), `EDITOR` o `VISUAL` (para `config edit`) y `NO_COLOR`.

## El resto de la CLI: schema, stores, doctor, context, workset, feedback y completion

Estos comandos no hacen falta el primer día, pero completan el mapa de la herramienta.

### openspec schema: flujos propios

Si el esquema `spec-driven` se te queda corto o largo, puedes definir el tuyo. Por ejemplo, con un artefacto de revisión de seguridad antes de `tasks`, o reducido a `proposal` y `tasks` para equipos pequeños.

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

Estos comandos están en beta, así que los nombres, las opciones y los formatos pueden cambiar entre versiones.

Un *store* es un repositorio OpenSpec independiente (por ejemplo, uno de planificación o uno de contratos entre servicios) que registras en tu máquina. Una vez registrado, los comandos normales (`list`, `show`, `status`, `validate`, `new change`, `archive`...) pueden actuar sobre él desde cualquier sitio con `--store <id>`.

| Comando | Qué hace |
| --- | --- |
| `store setup [id]` | Crea y registra un store local (`--path`, `--remote`, `--init-git` o `--no-init-git`, `--json`) |
| `store register [path]` | Registra un store que ya existe (`--id`, `--yes`, `--json`) |
| `store unregister <id>` | Olvida el registro sin borrar ficheros |
| `store remove <id>` | Olvida el registro y borra la carpeta (`--yes` en modo no interactivo) |
| `store list` (`ls`) | Lista los stores registrados |
| `store doctor [id]` | Diagnostica el registro, los metadatos y la presencia de Git |

Un proyecto puede declarar de qué stores depende en su `config.yaml`:

```yaml
schema: spec-driven
references:
  - team-context
```

Con eso, `openspec instructions` incluye un índice de las specs de cada store referenciado, como contexto de solo lectura, y no cambia dónde se escribe.

Hay tres comandos más:

- `openspec doctor [--store <id>] [--json]`: informa de la salud de la raíz OpenSpec y de las referencias. Es solo diagnóstico: nunca clona, sincroniza ni repara.
- `openspec context [--store <id>] [--json] [--code-workspace <ruta>]`: ensambla el conjunto de trabajo (la raíz más los stores referenciados). Con `--code-workspace` genera un fichero de workspace de VS Code que los incluye.
- `openspec workset create | list | open | remove`: vistas personales y locales de las carpetas con las que trabajas a la vez. `open` abre tu editor, o tu agente de CLI, con todas ellas adjuntas.

Interesan sobre todo si varios servicios comparten contratos y quieres una única fuente de verdad para ellos.

### openspec feedback y openspec completion

```bash
openspec feedback "Soporte para artefactos propios" --body "Detalle..."
openspec completion install zsh
```

`feedback` crea una issue en GitHub y requiere tener `gh` instalado y autenticado. `completion` instala (`install`), genera (`generate`) o quita (`uninstall`) el autocompletado para bash, zsh, fish y PowerShell.

## Chuleta: todos los comandos de un vistazo

Dos tablas: una con lo que escribes en el chat del asistente y otra con lo que escribes en la terminal.

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

OpenSpec no hace mejor al agente. Lo que cambia es cuándo se toman las decisiones: antes de programar, por escrito y de forma revisable.

En el ejemplo, las preguntas incómodas de la paginación (offset o cursor, compatibilidad con los clientes actuales, tamaño máximo de página) se contestaron en artefactos que una persona pudo leer y corregir antes de que existiera una línea de código. Al terminar, la spec recoge el comportamiento real del endpoint, cada escenario tiene su test y el archivo guarda el porqué.

Lo que me quedo:

- Un flujo mínimo: tres comandos (`propose`, `apply`, `archive`), con `explore` delante y `update` o `sync` cuando hacen falta.
- Specs que crecen solo donde trabajas, sin documentar el legacy entero para empezar.
- Revisión de intención, porque el delta es mucho más corto que el diff de código y dice qué cambia y por qué.

Los límites:

- Nada obliga. `validate` solo comprueba estructura y `verify` no bloquea el archive, así que que el flujo se cumpla depende de la disciplina del equipo y de lo que automatices.
- La spec puede desviarse. Si alguien cambia el código sin tocar el delta, deja de reflejar la realidad.
- No todo merece un change. Para un bug trivial el ciclo completo sobra, y los cambios de infraestructura o documentación pueden archivarse con `--skip-specs`.

Si lo vas a llevar a un equipo, un buen punto de partida es este:

1. Una plantilla de repo con `openspec init` ya hecho y un `config.yaml` con el idioma, el stack y las convenciones.
2. El change se revisa en un PR propio, solo con `openspec/`, antes de ejecutar `apply`.
3. `openspec validate --all --strict` en el pipeline de CI.
4. `openspec update` periódico con la versión de la CLI fijada.
5. Para arrancar, `/opsx-onboard` en una rama, con el perfil ampliado activado solo durante la adopción.

Todo esto se reproduce con un repositorio mínimo: una API con un endpoint y un `openspec init`.

## Fuentes

Documentación oficial consultada para este post (septiembre de 2026):

- [CLI Reference](https://openspec.dev/docs/reference/cli): comandos de terminal, opciones y salidas.
- [Commands](https://openspec.dev/docs/reference/slash-commands): comandos slash y perfiles core y ampliado.
- [The workflow](https://openspec.dev/docs/the-workflow): combinaciones de comandos y cuándo usar cada una.
- [Multi-language guide](https://openspec.dev/docs/multi-language): idioma de los artefactos.
- [Repositorio de OpenSpec](https://github.com/Fission-AI/openspec): README, filosofía y herramientas soportadas.

Para arrancar en un repositorio existente, la guía oficial es [Using OpenSpec in an Existing Project](https://openspec.dev/docs/existing-projects).

Las conversaciones con el agente y el código de ejemplo son representativos, no capturas literales. Contrasta los detalles con la versión que tengas instalada (`openspec --version`).
