import type { Metadata } from "next";
import AccountClient from "./AccountClient";

export const metadata: Metadata = { title: "Your receipts · Stenmont", robots: { index: false }, referrer: "no-referrer" };

export default function AccountPage() {
  return <AccountClient />;
}
