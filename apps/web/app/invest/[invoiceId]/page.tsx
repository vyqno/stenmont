import { pageMetadata } from "../../../lib/seo";
import { notFoundIfMissing } from "../../../lib/serverLookup";
import ClaimClient from "./ClaimClient";


export const metadata = pageMetadata("/invest/[invoiceId]");

export default async function ClaimPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  await notFoundIfMissing(`/invest/claims/${encodeURIComponent(invoiceId)}`);
  return <ClaimClient invoiceId={invoiceId} />;
}
