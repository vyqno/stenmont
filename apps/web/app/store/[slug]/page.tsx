import { pageMetadata } from "../../../lib/seo";
import { notFoundIfMissing } from "../../../lib/serverLookup";
import StoreClient from "./StoreClient";


export const metadata = pageMetadata("/store/[slug]");

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await notFoundIfMissing(`/store/${encodeURIComponent(slug)}/products?limit=1`);
  return <StoreClient slug={slug} />;
}
