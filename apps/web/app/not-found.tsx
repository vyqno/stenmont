import Link from "next/link";
import { Logo } from "../components/Logo";
import { actionLink } from "../components/ui";

export default function NotFound() {
  return (
    <main id="content" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
      <Link href="/" aria-label="Stenmont home"><Logo className="text-2xl" /></Link>
      <h1 className="text-3xl font-bold">We could not find that page</h1>
      <p className="text-muted">The link may be mistyped, may have expired, or the offer may already be taken. Check the address, or ask the person who sent it for a fresh link.</p>
      <Link href="/" className={actionLink}>Go to the home page</Link>
    </main>
  );
}
