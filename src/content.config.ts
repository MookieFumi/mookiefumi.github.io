import { defineCollection, reference } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

// Los posts conservan el nombre `AAAA-MM-DD-slug.md` de Jekyll: el id que
// genera `glob()` es ese nombre sin extensión, y coincide con la URL pública.
const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '*.md' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    date: z.coerce.date(),
    topic: reference('topics'),
    published: z.boolean().default(true),
  }),
});

// Temas del blog: el id se usa en `topic:` de cada post, en las clases
// `.topic-<id>` y como ancla en /temas.
const topics = defineCollection({
  loader: file('./src/data/topics.yml'),
  schema: z.object({
    name: z.string(),
  }),
});

// Enlaces de /recursos, agrupados por sección.
const recursos = defineCollection({
  loader: file('./src/data/recursos.yml'),
  schema: z.object({
    title: z.string(),
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
