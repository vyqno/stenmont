import { pageMetadata } from "../../lib/seo";
import Market from "./Market";


export const metadata = pageMetadata("/invest");

export default function InvestPage() {
  return <Market />;
}
