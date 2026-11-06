import type { ReactNode } from "react";

export function GreyPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`brand-panel ${className}`}>{children}</div>;
}
export function WhiteCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`brand-card ${className}`}>{children}</section>;
}
export function SampleLabel() {
  return <span className="sample-label">Sample data · test network</span>;
}
