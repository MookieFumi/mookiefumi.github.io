import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { postOgImage } from '../../lib/og';
import { getPublishedPosts, type Post } from '../../lib/posts';

// Una imagen de compartir por post, en `/og/<id del post>.png`.
export async function getStaticPaths() {
  return (await getPublishedPosts()).map((post) => ({ params: { id: post.id }, props: { post } }));
}

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as { post: Post };
  const topic = await getEntry(post.data.topic);
  const png = await postOgImage(post.data.title, post.data.topic.id, topic?.data.name ?? '');
  return new Response(Buffer.from(png), { headers: { 'Content-Type': 'image/png' } });
};
