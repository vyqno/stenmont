import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terms } from "../lib/subscribe";

const harness = vi.hoisted(() => ({ callbacks: [] as ((...args: any[]) => any)[], view: vi.fn(), sign: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, harness.view], useEffect: () => {}, useCallback: (fn: (...args: any[]) => any) => { harness.callbacks.push(fn); return fn; } }));
vi.mock("../lib/passkey", () => ({ loadPasskey: () => ({ credentialId: "fixture", qx: `0x${"11".repeat(32)}`, qy: `0x${"22".repeat(32)}` }), createPasskey: vi.fn(), signDigest: harness.sign }));
import { fund } from "../lib/investor";
import SubscribeClient from "../app/subscribe/[id]/SubscribeClient";
const id = `0x${"ab".repeat(32)}` as const;
const account = `0x${"33".repeat(20)}` as const;
const terms: Terms = { id, status: "offered", merchantName: "Sample", merchantAddress: account, payout: account, amount: "0.333333", periodSeconds: 86400, maxCharges: 3, startAt: 1790000000, manager: account, kind: "instalment", total: "1", segments: [{ id, amount: "0.333334", maxCharges: 1, startAt: 1790000000 }, { id: `0x${"cd".repeat(32)}`, amount: "0.333333", maxCharges: 2, startAt: 1790086400 }] };
let paths: string[];
function api(balance: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path.endsWith("/fund-request")) return Response.json({ price: "1", challenge: "YQ", authorization: { validBefore: "1800000000", salt: id } });
    if (path === "/relay/account") return Response.json({ address: account, balance, permitNonce: "0", subscriptionAllowance: "0" });
    if (path === "/relay/faucet") return Response.json({ error: { code: "faucet_limit" } }, { status: 429 });
    return Response.json({ status: "active", txHash: id });
  }));
}
beforeEach(() => { paths = []; harness.callbacks = []; harness.view.mockClear(); harness.sign.mockReset().mockResolvedValue("0x1234"); vi.stubGlobal("location", { hostname: "app-staging.stenmont.com" }); });
describe("payers supply their own USDT", () => {
  it("an unfunded investor stops before signing, faucet or fund submission", async () => {
    api("0");
    await expect(fund(id, { credentialId: "fixture", qx: id, qy: id }, { address: account, balance: "0" }, vi.fn())).rejects.toMatchObject({ code: "insufficient" });
    expect(paths).toEqual([`/invest/claims/${id}/fund-request`]);
    expect(harness.sign).not.toHaveBeenCalled();
  });
  it("an unfunded subscription stops before signatures, faucet or subscribe submission", async () => {
    api("0"); SubscribeClient({ id }); await harness.callbacks[0]!(terms);
    expect(paths).toEqual(["/relay/account"]);
    expect(harness.sign).not.toHaveBeenCalled();
    expect(harness.view).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "ready", notice: expect.stringContaining("first payment") }));
  });
  it("a remainder-first plan checks only its exact first payment, not its total", async () => {
    api("0.333333"); SubscribeClient({ id }); await harness.callbacks[0]!(terms);
    expect(paths).toEqual(["/relay/account"]);
    expect(harness.sign).not.toHaveBeenCalled();
    paths = []; harness.callbacks = []; harness.sign.mockClear(); api("0.333334");
    SubscribeClient({ id }); await harness.callbacks[0]!(terms);
    expect(paths).toEqual(["/relay/account", "/relay/subscribe"]);
    expect(harness.sign).toHaveBeenCalledTimes(3);
  });
});
