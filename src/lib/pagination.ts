import { SITE } from '../site';
import { getPublishedPosts } from './posts';

// Reparte los posts en páginas de `SITE.postsPerPage`.
export async function getPostPages() {
  const posts = await getPublishedPosts();
  const totalPages = Math.max(1, Math.ceil(posts.length / SITE.postsPerPage));
  return Array.from({ length: totalPages }, (_, i) => ({
    page: i + 1,
    totalPages,
    posts: posts.slice(i * SITE.postsPerPage, (i + 1) * SITE.postsPerPage),
  }));
}
