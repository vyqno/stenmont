import { pageMetadata } from "../../../../lib/seo";
import ProductClient from "./ProductClient";


export const metadata = pageMetadata("/store/[slug]/[handle]");

export default async function ProductPage({ params }: { params: Promise<{ slug: string; handle: string }> }) {
  const { slug, handle } = await params;
  return <ProductClient slug={slug} handle={handle} />;
}
