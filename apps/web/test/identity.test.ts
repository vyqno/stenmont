import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/auth";
import { agentApprovalParams, canClaimLabel, parseAgentInput } from "../lib/identity";

const address = "0x7777777777777777777777777777777777777777";
const input = { label: "billing-bot", agentAddress: address, dailyLimit: "50", perTxLimit: "10", expiresInDays: "30", scopes: ["invoice.read", "refund.draft"], context: "Drafts refunds", endpoint: "" };

afterEach(() => vi.unstubAllGlobals());

it("revokes using the signed-in session and a DELETE request", async () => {
  vi.stubGlobal("location", { hostname: "app-staging.stenmont.com" });
  let sent: RequestInit | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = init;
    return Response.json({ status: "revoked" });
  });
  expect(await api.delete("/v1/ens/agents/billing-bot")).toEqual({ status: "revoked" });
  expect(sent).toMatchObject({ method: "DELETE", credentials: "include" });
});

describe("claim availability", () => {
  it("refuses a stale response for a previous label or a taken name", () => {
    expect(canClaimLabel("acme", { label: "acme", available: true })).toBe(true);
    expect(canClaimLabel("other", { label: "acme", available: true })).toBe(false);
    expect(canClaimLabel("acme", { label: "acme", available: false })).toBe(false);
    expect(canClaimLabel("acme", null)).toBe(false);
  });
});

describe("agent policy input", () => {
  it("keeps decimal limits exact and excludes an empty optional endpoint", () => {
    const r = parseAgentInput({ ...input, dailyLimit: "100.000001" });
    expect(r).toEqual({ ...input, dailyLimit: "100.000001", expiresInDays: 30, endpoint: undefined });
    expect(agentApprovalParams(r!)).toEqual({ label: "billing-bot", agentAddress: address, dailyLimit: "100.000001", perTxLimit: "10" });
  });
  it("rejects invalid limits, address, expiry, scope and endpoint before submitting", () => {
    for (const patch of [{ dailyLimit: "-1" }, { dailyLimit: "1e4" }, { dailyLimit: "1.0000001" }, { perTxLimit: "51" }, { perTxLimit: "0" }, { agentAddress: "nope" }, { expiresInDays: "366" }, { expiresInDays: "1.5" }, { scopes: [] }, { scopes: ["admin"] }, { endpoint: "http://example.com" }, { label: "Bad Name" }]) {
      expect(parseAgentInput({ ...input, ...patch }), JSON.stringify(patch)).toBeNull();
    }
  });
});
