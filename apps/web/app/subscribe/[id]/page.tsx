import type { Metadata } from "next";
import SubscribeClient from "./SubscribeClient";

export const metadata: Metadata = { title: "Subscribe · Stenmont", robots: { index: false } };

export default async function SubscribePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscribeClient id={id} />;
}
