# ~/mookie

Blog de Miguel Ángel Martín Hernández sobre .NET, IA, despliegues y equipos. Está hecho con [Astro](https://astro.build) y se publica en [mookiefumi.com](https://mookiefumi.com) con GitHub Pages.

## Trabajar en local

Necesitas Node.js 22.12 o superior y pnpm. Si no tienes pnpm, actívalo con `corepack enable`: la versión exacta está fijada en `packageManager` de `package.json`.

```bash
pnpm install    # instala las dependencias
pnpm dev        # servidor de desarrollo en http://localhost:4321, recarga al guardar
pnpm build      # genera el sitio estático en dist/
pnpm preview    # sirve dist/ para revisarlo tal como se publicará
pnpm check      # valida los tipos y el front matter de todos los posts
```

Antes de subir cambios, ejecuta `pnpm check` y `pnpm build`. Es lo mismo que hace el workflow en cada pull request.

## Cómo funciona Astro en este repo

Astro genera HTML estático en el build y no envía JavaScript al navegador salvo que un componente lo pida. Las piezas que importan:

- **Rutas.** Cada fichero de `src/pages/` es una URL. `[slug].astro` genera una página por post a partir de la colección, y `page[num]/index.astro` genera la paginación (`/page2/`, `/page3/`…). Con `build.format: 'preserve'` los posts salen como `slug.html`, así que se sirven en `/aaaa-mm-dd-slug`, sin barra final.
- **Colecciones de contenido.** `src/content.config.ts` define tres colecciones: `posts` (los ficheros de `src/content/posts/`), `topics` y `recursos` (los YAML de `src/data/`). Cada una tiene un esquema: si un post tiene un campo mal o un `topic` que no existe, `pnpm check` y `pnpm build` fallan y dicen qué fichero es.
- **Componentes y layouts.** Los ficheros `.astro` tienen una parte de código entre `---` (se ejecuta solo en el build) y una plantilla HTML con expresiones `{...}`. Los layouts de `src/layouts/` envuelven las páginas y los componentes de `src/components/` se reutilizan entre ellas.
- **Ficheros estáticos.** Lo que hay en `public/` se copia tal cual a la raíz del sitio: `public/images/foo.png` se sirve en `/images/foo.png`.
- **Código.** Los bloques de código se resaltan en el build con Shiki y el tema de `src/lib/shiki.mjs`. No hace falta ningún CSS ni script extra.
- **Configuración.** `astro.config.mjs` para Astro (URL del sitio, formato de salida, Markdown, redirecciones) y `src/site.ts` para los datos del blog (título, autor, enlaces de la barra, analítica, posts por página).

Documentación de referencia: [Astro](https://docs.astro.build/en/getting-started/), [colecciones de contenido](https://docs.astro.build/en/guides/content-collections/), [Markdown](https://docs.astro.build/en/guides/markdown-content/) y [MDX](https://docs.astro.build/en/guides/integrations-guide/mdx/).

## Escribir un post

Cada post es un fichero en `src/content/posts/` llamado `aaaa-mm-dd-slug.md` (o `.mdx`), todo en minúsculas y sin espacios. El nombre sin extensión es la URL del post: `2026-10-10-mi-post.md` se publica en `/2026-10-10-mi-post`. No cambies el nombre de un post ya publicado, porque cambiaría su URL.

Todos los posts empiezan con el mismo front matter:

```yaml
---
title: Título del post
subtitle: Una línea que lo resume (opcional)
date: 2026-10-10
topic: ia
published: true
---
```

| Campo | Para qué sirve |
| --- | --- |
| `title` | Título del post. No repitas el título como `# Título` al principio del cuerpo: el layout ya lo pinta. |
| `subtitle` | Opcional. Se usa como extracto en la portada y como descripción para buscadores y redes. Sin él, el extracto son las primeras palabras del post. |
| `date` | Fecha de publicación. Ordena los posts y se muestra en español. |
| `topic` | Id de un tema de `src/data/topics.yml`. Decide el color y la sección de `/temas`. |
| `published` | Con `false`, el post existe en el repo pero no se publica ni aparece en ningún listado. |

Mientras escribes, deja `pnpm dev` abierto y entra en `http://localhost:4321/aaaa-mm-dd-slug` para ver el post según guardas.

### Post en Markdown (`.md`)

Es la opción por defecto: Markdown con GitHub Flavored Markdown (tablas, listas de tareas, URLs que se convierten en enlaces) y comillas tipográficas.

````markdown
---
title: Primary constructors en C# 12
date: 2026-10-10
topic: desarrollo
published: true
---

Un párrafo de introducción.

## Una sección

```csharp
public class Service(ILogger<Service> logger) { }
```

![Captura del resultado](/images/2026-10-10-resultado.png)
````

- **Bloques de código:** indica siempre el lenguaje (`csharp`, `bash`, `powershell`, `json`, `yaml`…). Aparece en la barra de la ventana y activa el resaltado.
- **Imágenes:** guárdalas en `public/images/` y enlázalas con ruta absoluta (`/images/...`).
- **HTML:** puedes escribir HTML dentro del Markdown, como hacen los diagramas.

### Post en MDX (`.mdx`)

MDX es Markdown que además puede importar y usar componentes. Úsalo solo cuando un post necesite algo interactivo o un componente reutilizable; para todo lo demás, `.md`. El front matter es el mismo.

```mdx
---
title: Un post con un componente
date: 2026-10-10
topic: desarrollo
published: true
---

import Lanyard from '../../components/Lanyard/Lanyard';

Texto normal en Markdown.

<Lanyard client:visible style={{ height: '520px' }} />

## El resto funciona igual

Bloques de código, imágenes y enlaces se escriben igual que en un `.md`.
```

- **Imports:** van después del front matter, con rutas relativas al post (`../../components/...`).
- **Componentes `.astro`:** se renderizan en el build y no añaden JavaScript.
- **Componentes de React:** necesitan una directiva `client:*` para ser interactivos. `client:visible` carga el JavaScript solo cuando el componente entra en pantalla, y es la opción recomendada. Sin directiva, React solo genera el HTML.
- **Sintaxis:** en MDX, `{`, `}` y `<` tienen significado. Si los necesitas como texto fuera de un bloque de código, escápalos (`\{`, `&lt;`).
- **Extracto y RSS:** el extracto, el tiempo de lectura y el RSS de un post `.mdx` se calculan a partir de sus párrafos de texto, sin los imports, los componentes ni el código.

### Temas

`topic` tiene que ser uno de los temas de `src/data/topics.yml`. Para añadir uno nuevo:

1. Añádelo a `src/data/topics.yml` con su `id` y su `name`.
2. Define `--topic-<id>-fill` y `--topic-<id>-text` en `public/css/tokens.css`, también en los dos bloques del modo oscuro.
3. Añade la clase `.topic-<id>` en `public/css/site.css`, junto a las demás.

## Diagramas

Los diagramas se escriben en Mermaid pero se publican como SVG, en versión clara y oscura, para no cargar ninguna librería en el navegador.

1. Escribe el diagrama en `diagrams/src/<nombre>.mmd`.
2. Ejecuta `./diagrams/render.sh <nombre>` (necesita Node.js). Genera `public/img/diagrams/<nombre>-light.svg` y `public/img/diagrams/<nombre>-dark.svg`.
3. Inclúyelo en el post:

```html
<figure class="diagram">
  <img class="diagram-light" src="/img/diagrams/<nombre>-light.svg" alt="Descripción del diagrama">
  <img class="diagram-dark" src="/img/diagrams/<nombre>-dark.svg" alt="Descripción del diagrama">
</figure>
```

Si un diagrama merece movimiento, se dibuja a mano como SVG con animación (SMIL y CSS) y se genera con un script de `diagrams/animated/`, como `07-openspec-ciclo.py`. Respeta `prefers-reduced-motion` y se incluye en el post igual que los demás.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/content/posts/` | Los artículos |
| `src/content.config.ts` | Esquema de los posts, temas y recursos |
| `src/data/` | Temas (`topics.yml`) y enlaces de `/recursos` (`recursos.yml`) |
| `src/pages/` | Rutas del sitio: portada, paginación, posts, temas, recursos, sobre mí, 404 y RSS |
| `src/layouts/`, `src/components/` | Plantillas del sitio |
| `src/lib/` | Fechas, tiempo de lectura, extractos y resaltado de código (Shiki) |
| `src/site.ts` | Título, autor, enlaces de la barra y analítica |
| `public/` | Ficheros que se publican tal cual: CSS, JS, imágenes, favicons y `CNAME` |
| `public/css/tokens.css` | Colores y tipografías (modo claro y oscuro) |
| `public/js/site.js` | Modo oscuro y botón de copiar código |
| `diagrams/` | Fuentes Mermaid, temas de color y scripts de renderizado |

## Publicar

Cada push a `master` construye el sitio y lo publica en GitHub Pages con `.github/workflows/deploy.yml`. En las pull requests el workflow solo construye, así que un error en un post se ve antes de fusionar.

Para actualizar Astro y sus paquetes, usa `pnpm up --latest` y luego `pnpm check` y `pnpm build`. Antes de subir de versión mayor, lee la guía de actualización de [Astro](https://docs.astro.build/en/upgrade-astro/).

Si `pnpm dev` muestra datos antiguos de un post o de los YAML, borra la caché con `rm -rf .astro node_modules/.astro` y vuelve a arrancarlo.
