import { pageMetadata } from "../../../lib/seo";
import StoreClient from "./StoreClient";


export const metadata = pageMetadata("/store/[slug]");

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StoreClient slug={slug} />;
}
