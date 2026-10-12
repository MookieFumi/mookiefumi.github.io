import { defineCollection, reference } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';
import { parse } from 'yaml';

// Los posts se llaman `aaaa-mm-dd-slug.md`: el id que genera `glob()` es ese
// nombre sin extensión, y coincide con la URL pública.
const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    // Texto para la meta description (SEO). Si falta se usa el subtítulo y, si tampoco
    // hay, los primeros párrafos del post.
    description: z.string().optional(),
    date: z.coerce.date(),
    // Fecha de la última edición con cambios de contenido. Si falta, se usa `date`.
    // Sale como `lastmod` en el sitemap y como `dateModified` en los datos estructurados.
    updated: z.coerce.date().optional(),
    topic: reference('topics'),
    // Serie o grupo de posts que se leen juntos (`id` de src/data/series.yml).
    series: reference('series').optional(),
    // Id de otro post que es la versión principal de este (p. ej. el original en
    // español de una traducción): se usa como canonical.
    canonicalPost: z.string().optional(),
    // Idioma del post; por defecto español. Va a `<html lang>`, `og:locale` y los datos estructurados.
    lang: z.enum(['es', 'en']).default('es'),
    published: z.boolean().default(true),
  }),
});

// Temas del blog: el id se usa en `topic:` de cada post, en las clases
// `.topic-<id>` y como ancla en /topics. `order` guarda la posición en el
// fichero, porque las colecciones no garantizan el orden.
const topics = defineCollection({
  loader: file('./src/data/topics.yml', {
    parser: (text) => parse(text).map((topic: object, order: number) => ({ ...topic, order })),
  }),
  schema: z.object({
    name: z.string(),
    order: z.number(),
  }),
});

// Series de posts: el id se usa en `series:` de cada post y en /series/<id>.
// Dentro de la serie los posts van por fecha, del más antiguo al más reciente.
const series = defineCollection({
  loader: file('./src/data/series.yml', {
    parser: (text) => parse(text).map((item: object, order: number) => ({ ...item, order })),
  }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    order: z.number(),
  }),
});

// Enlaces de /resources, agrupados por sección.
const resources = defineCollection({
  loader: file('./src/data/resources.yml', {
    parser: (text) => parse(text).map((group: object, order: number) => ({ ...group, order })),
  }),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    items: z.array(
      z.object({
        title: z.string(),
        url: z.url(),
        kind: z.string(),
        date: z.coerce.date().optional(),
      }),
    ),
  }),
});

export const collections = { posts, topics, series, resources };
