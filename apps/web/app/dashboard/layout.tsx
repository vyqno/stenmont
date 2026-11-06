import { pageMetadata } from "../../lib/seo";
import DashboardShell from "./DashboardShell";

export const metadata = pageMetadata("/dashboard");

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
