import rss from '@astrojs/rss';
import { getEntry } from 'astro:content';
import type { APIContext } from 'astro';
import { SITE } from '../site';
import { getPublishedPosts, postHtml } from '../lib/posts';
import { summary } from '../lib/text';

// Los 20 posts más recientes. La descripción es el subtítulo (si lo hay)
// seguido de las primeras 50 palabras del post, y cada uno lleva su tema como
// categoría.
export async function GET(context: APIContext) {
  const posts = (await getPublishedPosts()).slice(0, 20);
  const topics = await Promise.all(posts.map((post) => getEntry(post.data.topic)));
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<language>es</language><atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml" />`,
    trailingSlash: false,
    items: posts.map((post, index) => ({
      title: post.data.title,
      description: `${post.data.subtitle ? `${post.data.subtitle} - ` : ''}${summary(postHtml(post), 50)}`,
      pubDate: post.data.date,
      link: `/${post.id}`,
      categories: topics[index] ? [topics[index].data.name] : [],
    })),
  });
}
