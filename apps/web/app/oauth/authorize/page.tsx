import { pageMetadata } from "../../../lib/seo";
import Consent from "./Consent";


export const metadata = pageMetadata("/oauth/authorize");

export default function Page() {
  return (
    <main className="auth-sheet consent-sheet">
      <Consent />
    </main>
  );
}
