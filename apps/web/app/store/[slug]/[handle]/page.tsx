import type { Metadata } from "next";
import ProductClient from "./ProductClient";

export const metadata: Metadata = { title: "Product · Stenmont" };

export default async function ProductPage({ params }: { params: Promise<{ slug: string; handle: string }> }) {
  const { slug, handle } = await params;
  return <ProductClient slug={slug} handle={handle} />;
}
