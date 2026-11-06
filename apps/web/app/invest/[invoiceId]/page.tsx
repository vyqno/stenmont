import type { Metadata } from "next";
import ClaimClient from "./ClaimClient";

export const metadata: Metadata = { title: "Invoice for sale · Stenmont" };

export default async function ClaimPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <ClaimClient invoiceId={invoiceId} />;
}
