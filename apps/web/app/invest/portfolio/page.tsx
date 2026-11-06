import type { Metadata } from "next";
import Portfolio from "./Portfolio";

export const metadata: Metadata = { title: "Your portfolio · Stenmont" };

export default function PortfolioPage() {
  return <Portfolio />;
}
