import Link from "next/link";
import { Logo } from "../../components/Logo";

export default function InvestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-record-page">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/"><Logo className="text-2xl" /></Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/invest" className="hover:underline">Invoices for sale</Link>
          <Link href="/invest/portfolio" className="hover:underline">Your portfolio</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
