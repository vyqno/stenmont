import type { Metadata } from "next";
import PayClient from "./PayClient";

export const metadata: Metadata = { title: "Pay · Stenmont", robots: { index: false } };

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayClient id={id} />;
}
