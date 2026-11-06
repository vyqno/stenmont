import { describe, expect, it } from "vitest";
import { checkRows, progress, type Site } from "../lib/sites";

const site = (checks: Site["checks"]): Site => ({
  id: "s1",
  url: "https://shop.example.com",
  host: "shop.example.com",
  platform: null,
  createdAt: "2026-11-06T10:00:00.000Z",
  verification: { recordName: "_stenmont.shop.example.com", recordValue: "stenmont-verify=abc" },
  checks,
  ready: false,
});
const none = { reachable: null, domain: null, webhook: null, payment: null };

describe("checkRows", () => {
  it("lists the four checks in a fixed order, untouched ones as not yet checked", () => {
    const rows = checkRows(site(none));
    expect(rows.map((r) => r.kind)).toEqual(["reachable", "domain", "webhook", "payment"]);
    expect(rows.every((r) => r.state === "todo" && r.checkedAt === null)).toBe(true);
  });
  it("maps pass and fail with the server's plain-words detail and the time", () => {
    const rows = checkRows(
      site({ ...none, reachable: { ok: true, detail: "ok", checkedAt: "2026-11-06T10:05:00.000Z" }, domain: { ok: false, detail: "No TXT record", checkedAt: "2026-11-06T10:05:01.000Z" } }),
    );
    expect(rows[0]).toMatchObject({ state: "pass", detail: "ok", checkedAt: "2026-11-06T10:05:00.000Z" });
    expect(rows[1]).toMatchObject({ state: "fail", detail: "No TXT record" });
  });
  it("counts what has passed", () => {
    expect(progress(site(none))).toBe("0 of 4");
    expect(progress(site({ ...none, webhook: { ok: true, detail: "", checkedAt: "x" }, payment: { ok: false, detail: "", checkedAt: "x" } }))).toBe("1 of 4");
  });
});
