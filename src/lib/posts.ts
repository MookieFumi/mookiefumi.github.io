import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

// Posts publicados, del más reciente al más antiguo. Los que tienen
// `published: false` se quedan fuera, igual que en Jekyll. Con la misma fecha,
// Jekyll ordena por nombre de fichero.
export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => data.published);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || b.id.localeCompare(a.id));
}

// Slug sin la fecha: `2026-09-01-openspec-1` → `openspec-1`.
export function postSlug(post: Post): string {
  return post.id.slice(11);
}

export function postHtml(post: Post): string {
  return post.rendered?.html ?? '';
}
