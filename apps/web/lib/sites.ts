export type CheckKind = "reachable" | "domain" | "webhook" | "payment";
export type SiteCheck = { ok: boolean; detail: string; checkedAt: string } | null;
export type Site = {
  id: string;
  url: string;
  host: string;
  platform: string | null;
  createdAt: string;
  verification: { recordName: string; recordValue: string };
  checks: Record<CheckKind, SiteCheck>;
  ready: boolean;
};
export type Switch = { paused: boolean; mode: "test" | "live"; updatedAt: string | null };

const LABELS: Record<CheckKind, string> = {
  reachable: "Your site is reachable",
  domain: "Your domain is verified",
  webhook: "Your webhook answers",
  payment: "A test payment was paid",
};
const ORDER: CheckKind[] = ["reachable", "domain", "webhook", "payment"];

export function checkRows(site: Site) {
  return ORDER.map((kind) => {
    const c = site.checks[kind];
    return {
      kind,
      label: LABELS[kind],
      state: (c === null ? "todo" : c.ok ? "pass" : "fail") as "todo" | "pass" | "fail",
      detail: c?.detail ?? "Not checked yet.",
      checkedAt: c?.checkedAt ?? null,
    };
  });
}

export const progress = (site: Site) => `${checkRows(site).filter((r) => r.state === "pass").length} of ${ORDER.length}`;
