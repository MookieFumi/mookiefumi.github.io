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
  return post.rendered?.html ?? mdxParagraphs(post.body ?? '');
}

// Los posts en MDX no guardan el HTML renderizado en la colección. Para el
// extracto, el tiempo de lectura y el RSS basta con sus párrafos de texto: se
// quitan los imports, los componentes, los títulos y los bloques de código.
function mdxParagraphs(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block && !/^(import|export)\s|^[<#{]/.test(block))
    .map((block) => `<p>${block.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '')}</p>`)
    .join('\n');
}
