/**
 * Blog listesi, yazı detayı ve etiket sayfaları.
 *
 * Dinamik segment `:slug` olarak yazılır ve controller'a `ctx.params.slug`
 * olarak gelir. Veri yoksa `notFound()` fırlatılır: framework bunu yakalar,
 * `hooks.notFound()` sayfasını 404 durumuyla render eder ve **önbelleğe
 * almaz** çünkü status 404.
 */
import { getPost, getPosts, getPostsByTag, getTags } from "../lib/posts.js";

export default function register(app, { route, notFound }) {
  app.get(
    "/blog",
    route(async () => ({
      view: "pages/blog-list",
      metadata: {
        title: "Blog",
        canonical: "/blog",
        description: "Mimari, cache ve performans üzerine yazılar.",
      },
      data: { posts: getPosts(), tags: getTags() },
    })),
  );

  app.get(
    "/blog/:slug",
    route(
      async ({ params }) => {
        const post = getPost(params.slug);
        if (!post) notFound();

        return {
          view: "pages/blog-post",
          metadata: {
            title: post.title,
            description: post.excerpt,
            canonical: `/blog/${post.slug}`,
            openGraph: { type: "article" },
          },
          data: { post, related: relatedTo(post) },
          // Bu sayfa `lightweight-charts` gibi ağır bir modül kullanmıyor
          // ama kullansa, sayfaya özel entry'yi burada bildirirdi:
          //   entries: ["chart.js"]
        };
      },
      { revalidate: 300 },
    ),
  );

  app.get(
    "/etiket/:tag",
    route(async ({ params }) => {
      const posts = getPostsByTag(params.tag);
      if (!posts.length) notFound();

      return {
        view: "pages/blog-list",
        metadata: {
          title: `${params.tag} etiketli yazılar`,
          canonical: `/etiket/${params.tag}`,
        },
        data: { posts, tags: getTags(), activeTag: params.tag },
      };
    }),
  );
}

/**
 * @param {import('../lib/posts.js').Post} post
 * @returns {import('../lib/posts.js').Post[]}
 */
function relatedTo(post) {
  return getPosts()
    .filter(
      (candidate) =>
        candidate.slug !== post.slug &&
        candidate.tags.some((tag) => post.tags.includes(tag)),
    )
    .slice(0, 2);
}
