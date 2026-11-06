import { pageMetadata } from "../../../lib/seo";
import Consent from "./Consent";


export const metadata = pageMetadata("/oauth/authorize");

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Consent />
    </main>
  );
}
