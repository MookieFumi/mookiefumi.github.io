import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../site';
import { getPublishedPosts, postHtml } from '../lib/posts';
import { summary } from '../lib/text';

// Los 20 posts más recientes. La descripción es el subtítulo (si lo hay)
// seguido de las primeras 50 palabras del post, como el feed de Jekyll.
export async function GET(context: APIContext) {
  const posts = (await getPublishedPosts()).slice(0, 20);
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml" />`,
    trailingSlash: false,
    items: posts.map((post) => ({
      title: post.data.title,
      description: `${post.data.subtitle ? `${post.data.subtitle} - ` : ''}${summary(postHtml(post), 50)}`,
      pubDate: post.data.date,
      link: `/${post.id}`,
    })),
  });
}
