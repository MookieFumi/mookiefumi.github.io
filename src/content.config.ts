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
    date: z.coerce.date(),
    topic: reference('topics'),
    published: z.boolean().default(true),
  }),
});

// Temas del blog: el id se usa en `topic:` de cada post, en las clases
// `.topic-<id>` y como ancla en /temas. `order` guarda la posición en el
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

// Enlaces de /recursos, agrupados por sección.
const recursos = defineCollection({
  loader: file('./src/data/recursos.yml', {
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

export const collections = { posts, topics, recursos };
