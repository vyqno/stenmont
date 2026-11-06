import type { Metadata } from "next";
import CartClient from "./CartClient";

export const metadata: Metadata = { title: "Cart · Stenmont", robots: { index: false } };

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CartClient slug={slug} />;
}
