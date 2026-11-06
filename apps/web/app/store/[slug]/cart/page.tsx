import { pageMetadata } from "../../../../lib/seo";
import CartClient from "./CartClient";


export const metadata = pageMetadata("/store/[slug]/cart");

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CartClient slug={slug} />;
}
