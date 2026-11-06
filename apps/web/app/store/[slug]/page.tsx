import type { Metadata } from "next";
import StoreClient from "./StoreClient";

export const metadata: Metadata = { title: "Shop · Stenmont" };

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StoreClient slug={slug} />;
}
