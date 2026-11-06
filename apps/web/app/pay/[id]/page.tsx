import { pageMetadata } from "../../../lib/seo";
import { notFoundIfMissing } from "../../../lib/serverLookup";
import PayClient from "./PayClient";


export const metadata = pageMetadata("/pay/[id]");

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await notFoundIfMissing(`/pay/${encodeURIComponent(id)}`);
  return <PayClient id={id} />;
}
