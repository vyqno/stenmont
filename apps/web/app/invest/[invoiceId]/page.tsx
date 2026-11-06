import { pageMetadata } from "../../../lib/seo";
import ClaimClient from "./ClaimClient";


export const metadata = pageMetadata("/invest/[invoiceId]");

export default async function ClaimPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <ClaimClient invoiceId={invoiceId} />;
}
