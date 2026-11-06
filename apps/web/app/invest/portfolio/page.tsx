import { pageMetadata } from "../../../lib/seo";
import Portfolio from "./Portfolio";


export const metadata = pageMetadata("/invest/portfolio");

export default function PortfolioPage() {
  return <Portfolio />;
}
