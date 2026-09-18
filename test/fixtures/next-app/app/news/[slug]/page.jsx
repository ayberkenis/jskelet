import { notFound } from "next/navigation";
import Image from "next/image";
import { getArticle } from "@/lib/api";

export const revalidate = 300;

export async function generateMetadata({ params }) {
  const article = await getArticle(params.slug);
  return {
    title: article?.title,
    description: article?.summary,
    alternates: { canonical: `/news/${params.slug}` },
  };
}

export default async function Page({ params }) {
  const article = await getArticle(params.slug);
  if (!article) notFound();

  return (
    <article className="wrapper">
      <h1 className="text-3xl font-bold">{article.title}</h1>
      <Image src={article.cover} alt={article.title} priority width={1200} height={630} />
      <div dangerouslySetInnerHTML={{ __html: article.body }} />
    </article>
  );
}
