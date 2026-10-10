# ~/mookie

Blog de Miguel Ángel Martín Hernández sobre .NET, IA, despliegues y equipos. Está hecho con [Astro](https://astro.build) y se publica en [mookiefumi.com](https://mookiefumi.com) con GitHub Pages.

## Ejecutar en local

Necesitas Node.js 22.12 o superior y pnpm.

```bash
pnpm install
pnpm dev      # servidor de desarrollo en http://localhost:4321
pnpm build    # genera el sitio en dist/
pnpm check    # valida tipos y el front matter de los posts
```

Cada push a `master` publica el blog con el workflow `.github/workflows/deploy.yml`.

## Escribir un post

Crea un fichero en `src/content/posts/` con el nombre `aaaa-mm-dd-slug.md`, todo en minúsculas. El nombre sin extensión es la URL del post (`/aaaa-mm-dd-slug`).

```yaml
---
title: Título del post
subtitle: Una línea que lo resume (opcional)
date: 2026-10-10
topic: ia
published: true
---
```

El front matter se valida con el esquema de `src/content.config.ts`: si falta un campo o el `topic` no existe, el build falla.

`topic` decide el color de la portada y en qué sección de `/temas` aparece el post. Los temas disponibles están en `src/data/topics.yml`. Para añadir uno nuevo:

1. Añádelo a `src/data/topics.yml`.
2. Define `--topic-<slug>-fill` y `--topic-<slug>-text` en `public/css/tokens.css`, también en los dos bloques del modo oscuro.
3. Añade la clase `.topic-<slug>` en `public/css/site.css`, junto a las demás.

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

## Configuración

En `src/site.ts`:

- `cloudflareAnalyticsToken`: analítica con Cloudflare Web Analytics (sin cookies).
- `navbarLinks`, `author`: enlaces de la barra y del pie.
- `postsPerPage`: posts por página en la portada.

## Licencia

El diseño original partía de [beautiful-jekyll](https://github.com/daattali/beautiful-jekyll), con licencia MIT (ver `LICENSE`).
