import { pageMetadata } from "../../../lib/seo";
import SubscribeClient from "./SubscribeClient";


export const metadata = pageMetadata("/subscribe/[id]");

export default async function SubscribePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubscribeClient id={id} />;
}
