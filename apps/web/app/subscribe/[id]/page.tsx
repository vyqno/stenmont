import { pageMetadata } from "../../../lib/seo";
import { notFoundIfMissing } from "../../../lib/serverLookup";
import SubscribeClient from "./SubscribeClient";


export const metadata = pageMetadata("/subscribe/[id]");

export default async function SubscribePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await notFoundIfMissing(`/pay/subscription/${encodeURIComponent(id)}`);
  return <SubscribeClient id={id} />;
}
