import { getCollection } from 'astro:content';

// Posts publicados, del más reciente al más antiguo. Los que tienen
// `published: false` se quedan fuera, igual que en Jekyll.
export async function getPublishedPosts() {
  const posts = await getCollection('posts', ({ data }) => data.published);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || b.id.localeCompare(a.id));
}
