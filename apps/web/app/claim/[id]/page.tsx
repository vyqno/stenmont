import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../../../components/Logo";
import CertificateClient from "./CertificateClient";

export const metadata: Metadata = { title: "Receivable certificate · Stenmont" };

/** Public, no login: anyone with the link can check an invoice claim against the blockchain. */
export default async function ClaimCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/"><Logo className="text-2xl" /></Link>
        <Link href="/invest" className="text-sm hover:underline">Invoices for sale</Link>
      </header>
      <CertificateClient id={id} />
    </div>
  );
}
