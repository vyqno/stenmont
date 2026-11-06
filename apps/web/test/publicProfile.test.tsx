import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileView } from "../app/dashboard/profile/ProfileView";
import {
  displayValue, formProblems, hasUnsavedEdits, keeper, pendingChanges, publishBody, publishErrorText, recordRows, refundProblem, urlProblem,
  type DirectoryView,
} from "../lib/publicProfile";

const TOKEN = "eip155:1874/erc20:0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
// Sample values for tests only.
const view: DirectoryView = {
  inputs: { payUrl: "https://pay.acme.example/checkout", x402Url: null, refund: "Refunds within 14 days" },
  records: { "stenmont.pay": "https://pay.acme.example/checkout", "stenmont.token": TOKEN, "stenmont.refund": "Refunds within 30 days", "stenmont.limits": '{"perInvoice":"2000","unit":"USDT"}' },
  omitted: [{ key: "stenmont.x402", reason: "host_not_verified" }],
  published: { "stenmont.pay": "https://pay.acme.example/checkout", "stenmont.token": TOKEN, "stenmont.refund": "Refunds within 14 days", "stenmont.limits": '{"perInvoice":"500","unit":"USDT"}' },
  publishedAt: "2026-11-06T10:00:00.000Z",
  txHash: "0xabc",
};

describe("validation", () => {
  it("accepts empty and https addresses, refuses everything else with a plain reason", () => {
    expect(urlProblem("")).toBeNull();
    expect(urlProblem("https://pay.example.com/x")).toBeNull();
    expect(urlProblem("http://pay.example.com")).toMatch(/https/);
    expect(urlProblem("https://user:pw@pay.example.com")).toMatch(/user name/);
    expect(urlProblem("pay.example.com")).toMatch(/full web address/);
  });
  it("refund text: length, line breaks, unsafe schemes, http links", () => {
    expect(refundProblem("")).toBeNull();
    expect(refundProblem("Refunds within 14 days")).toBeNull();
    expect(refundProblem("x".repeat(281))).toMatch(/280/);
    expect(refundProblem("a\nb")).toMatch(/one line/);
    expect(refundProblem("javascript:alert(1)")).toMatch(/https/);
    expect(refundProblem("http://a.example/refunds")).toMatch(/https/);
    expect(refundProblem("https://a.example/refunds")).toBeNull();
  });
  it("collects problems per box and sends empty boxes as null", () => {
    expect(formProblems({ payUrl: "nope", x402Url: "", refund: "" })).toEqual({ payUrl: expect.any(String) });
    expect(publishBody({ payUrl: " https://a.example ", x402Url: "", refund: "  " })).toEqual({ payUrl: "https://a.example", x402Url: null, refund: null });
  });
});

describe("record rows", () => {
  const rows = recordRows(view);
  const by = (k: string) => rows.find((r) => r.key === k)!;
  it("compares what is published with what would be", () => {
    expect(by("stenmont.pay").state).toBe("same");
    expect(by("stenmont.refund").state).toBe("changed");
    expect(by("stenmont.limits").state).toBe("changed");
    expect(by("stenmont.x402").state).toBe("left_out");
    expect(by("stenmont.x402").note).toMatch(/confirmed/);
    expect(pendingChanges(rows)).toBe(2);
  });
  it("shows a first-time profile as nothing published", () => {
    const r = recordRows(null);
    expect(r.every((x) => x.state === "none")).toBe(true);
    expect(pendingChanges(r)).toBe(0);
  });
  it("marks a published record as removed when it is cleared or left out", () => {
    const r = recordRows({ records: {}, omitted: [{ key: "stenmont.pay", reason: "not_https" }], published: { "stenmont.pay": "https://a.example", "stenmont.refund": "x" } });
    expect(r.find((x) => x.key === "stenmont.pay")!.state).toBe("removed");
    expect(r.find((x) => x.key === "stenmont.refund")!.state).toBe("removed");
  });
  it("spells the derived records in plain words", () => {
    expect(displayValue("stenmont.limits", '{"perInvoice":"2000","unit":"USDT"}')).toBe("Up to $2,000 per invoice");
    expect(displayValue("stenmont.token", TOKEN)).toBe("Dollar-pegged USDT");
    expect(displayValue("stenmont.pay", null)).toBe("Nothing");
  });
  it("detects edits not yet saved", () => {
    expect(hasUnsavedEdits({ payUrl: "https://pay.acme.example/checkout", x402Url: "", refund: "Refunds within 14 days" }, view)).toBe(false);
    expect(hasUnsavedEdits({ payUrl: "https://other.example", x402Url: "", refund: "Refunds within 14 days" }, view)).toBe(true);
  });
});

describe("idempotency and errors", () => {
  it("reuses a key for the same boxes and makes a new one when they change", () => {
    let n = 0;
    const k = keeper(() => `k${++n}`);
    expect(k.keyFor({ a: 1 })).toBe("k1");
    expect(k.keyFor({ a: 1 })).toBe("k1");
    expect(k.keyFor({ a: 2 })).toBe("k2");
  });
  it("explains a locked payout when the chain write fails", () => {
    expect(publishErrorText("chain_error", true)).toMatch(/locked/);
    expect(publishErrorText("chain_error", false)).not.toMatch(/locked/);
    expect(publishErrorText("no_name", false)).toMatch(/name/);
  });
});

const base = {
  name: "acme.stenmont.eth", payoutLocked: false, rows: recordRows(view), elsewhere: [{ label: "Agent card", value: null, status: "Off", href: "/dashboard/agent-access", linkText: "Manage on Agent access" }],
  form: { payUrl: "https://pay.acme.example/checkout", x402Url: "", refund: "Refunds within 30 days" }, problems: {}, unsaved: false, everPublished: true,
  publishedAt: view.publishedAt, changes: 2, busy: false, error: "", success: null, onChange: () => {}, onSubmit: () => {},
};

describe("ProfileView", () => {
  it("lists every record with its state and the reason for anything left out", () => {
    const html = renderToStaticMarkup(<ProfileView {...base} />);
    for (const k of ["stenmont.pay", "stenmont.x402", "stenmont.token", "stenmont.refund", "stenmont.limits"]) expect(html).toContain(`row-${k}`);
    expect(html).toContain("Will change");
    expect(html).toContain("Left out");
    expect(html).toContain("2 records will change");
    expect(html).toContain("Agent card");
  });
  it("shows the lock note and a transaction link on success; errors are alerts", () => {
    const html = renderToStaticMarkup(<ProfileView {...base} payoutLocked success={{ txHash: "0xabc", unchanged: false }} error="Nope" />);
    expect(html).toContain("locked-note");
    expect(html).toContain("https://explorer.testnet.whitechain.io/tx/0xabc");
    expect(html).toContain('role="alert"');
  });
  it("disables publishing while a box has a problem or a publish is running", () => {
    expect(renderToStaticMarkup(<ProfileView {...base} problems={{ payUrl: "bad" }} />)).toMatch(/<button[^>]*disabled/);
    expect(renderToStaticMarkup(<ProfileView {...base} busy />)).toContain("Publishing…");
  });
  it("tells a new business nothing is published yet", () => {
    const html = renderToStaticMarkup(<ProfileView {...base} rows={recordRows(null)} everPublished={false} publishedAt={null} changes={0} />);
    expect(html).toContain("Nothing has been published yet");
  });
});
