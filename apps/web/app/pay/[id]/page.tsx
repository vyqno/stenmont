import { pageMetadata } from "../../../lib/seo";
import PayClient from "./PayClient";


export const metadata = pageMetadata("/pay/[id]");

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayClient id={id} />;
}
