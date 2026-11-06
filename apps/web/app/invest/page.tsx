import type { Metadata } from "next";
import Market from "./Market";

export const metadata: Metadata = { title: "Invoices for sale · Stenmont" };

export default function InvestPage() {
  return <Market />;
}
