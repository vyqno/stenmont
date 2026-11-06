import { beforeEach, describe, expect, it } from "vitest";
import { verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, buildTransferAuth } from "@stenmont/shared";
import { createApp } from "../src/index";
import { MemoryStore } from "../src/store";
import { MemoryCounters, MemoryPayees, limitsFromEnv } from "../src/guard";
import type { Chain } from "../src/chain";

const NOW = 1_800_000_000;
const payTo: Address = "0x00000000000000000000000000000000000000aa";
const other: Address = "0x00000000000000000000000000000000000000bb";

class SpyChain implements Chain {
  calls = 0;
  sent = 0;
  async verifySignature(a: { address: Address; typedData: any; signature: Hex }) { this.calls++; return verifyTypedData({ address: a.address, ...a.typedData, signature: a.signature }); }
  async usdtBalance() { this.calls++; return 10n ** 9n; }
  async authorizationUsed() { this.calls++; return false; }
  async simulateTransfer() { this.calls++; }
  async facilitatorBalance() { this.calls++; return 10n ** 18n; }
  async estimateCost() { return 10n ** 15n; }
  async send() { this.calls++; this.sent++; return ("0x" + String(this.sent).padStart(64, "0")) as Hex; }
  async waitForReceipt() { return { status: "success" as const }; }
}

class CountingStore extends MemoryStore {
  claims = 0;
  override async claim(k: string) { this.claims++; return super.claim(k); }
}

async function body(to: Address, signer = privateKeyToAccount(generatePrivateKey())) {
  const nonce = ("0x" + crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")) as Hex;
  const auth = { from: signer.address, to, value: 1_000_000n, validAfter: BigInt(NOW - 10), validBefore: BigInt(NOW + 60), nonce };
  const requirements = { scheme: "exact", network: "eip155:1874", asset: USDT_ADDRESS, amount: "1000000", payTo: to };
  return {
    x402Version: 2,
    paymentRequirements: requirements,
    paymentPayload: {
      accepted: requirements,
      payload: { signature: await signer.signTypedData(buildTransferAuth(auth)), authorization: { ...auth, value: "1000000", validAfter: String(NOW - 10), validBefore: String(NOW + 60) } },
    },
  };
}

let chain: SpyChain, store: CountingStore, counters: MemoryCounters, payees: MemoryPayees;
const make = (limits = { perPayeeDay: 100, globalDay: 100, perPayerMinute: 100 }) =>
  createApp({ chain, store, now: () => NOW, minWbtWei: 10n ** 16n, payees, counters, limits });
const post = async (app: ReturnType<typeof createApp>, path: string, b: unknown): Promise<any> =>
  (await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();

beforeEach(() => {
  chain = new SpyChain();
  store = new CountingStore();
  counters = new MemoryCounters();
  payees = new MemoryPayees([payTo]);
});

describe("payee allowlist", () => {
  it("settles for a registered payee", async () => {
    expect((await post(make(), "/settle", await body(payTo))).success).toBe(true);
  });
  it("refuses an unknown payTo before any chain call or claim", async () => {
    const r = await post(make(), "/settle", await body(other));
    expect(r).toMatchObject({ success: false, errorReason: "payee_not_allowed" });
    expect(chain.calls).toBe(0);
    expect(store.claims).toBe(0);
  });
  it("verify also refuses an unknown payTo", async () => {
    expect(await post(make(), "/verify", await body(other))).toMatchObject({ isValid: false, invalidReason: "payee_not_allowed" });
    expect(chain.calls).toBe(0);
  });
  it("is case-insensitive", async () => {
    payees = new MemoryPayees([payTo.toUpperCase().replace("0X", "0x")]);
    expect((await post(make(), "/settle", await body(payTo))).success).toBe(true);
  });
});

describe("caps", () => {
  it("per-payee daily cap", async () => {
    const app = make({ perPayeeDay: 2, globalDay: 100, perPayerMinute: 100 });
    expect((await post(app, "/settle", await body(payTo))).success).toBe(true);
    expect((await post(app, "/settle", await body(payTo))).success).toBe(true);
    const sent = chain.sent, claims = store.claims;
    expect(await post(app, "/settle", await body(payTo))).toMatchObject({ success: false, errorReason: "payee_daily_cap_reached" });
    expect(chain.sent).toBe(sent);
    expect(store.claims).toBe(claims);
  });
  it("global daily cap across payees", async () => {
    payees.add(other);
    const app = make({ perPayeeDay: 100, globalDay: 2, perPayerMinute: 100 });
    await post(app, "/settle", await body(payTo));
    await post(app, "/settle", await body(other));
    const r = await post(app, "/settle", await body(other));
    expect(r.errorReason).toBe("global_daily_cap_reached");
    expect(chain.sent).toBe(2);
  });
  it("per-payer rate limit does not affect other payers", async () => {
    const app = make({ perPayeeDay: 100, globalDay: 100, perPayerMinute: 1 });
    const greedy = privateKeyToAccount(generatePrivateKey());
    expect((await post(app, "/settle", await body(payTo, greedy))).success).toBe(true);
    expect((await post(app, "/settle", await body(payTo, greedy))).errorReason).toBe("payer_rate_limited");
    expect((await post(app, "/settle", await body(payTo))).success).toBe(true);
  });
  it("a refused request does not burn the other windows", async () => {
    const app = make({ perPayeeDay: 100, globalDay: 100, perPayerMinute: 1 });
    const p = privateKeyToAccount(generatePrivateKey());
    await post(app, "/settle", await body(payTo, p));
    await post(app, "/settle", await body(payTo, p)); // refused by payer window
    expect(await counters.hit(`payee:${payTo}:${Math.floor(NOW / 86400)}`, 2)).toBe(true); // only 1 used so far
    expect(await counters.hit(`payee:${payTo}:${Math.floor(NOW / 86400)}`, 2)).toBe(false);
  });
  it("a failed send gives the allowance back", async () => {
    const app = make({ perPayeeDay: 1, globalDay: 100, perPayerMinute: 100 });
    chain.send = async () => { throw new Error("rpc down"); };
    expect((await post(app, "/settle", await body(payTo))).errorReason).toBe("settlement_failed");
    chain.send = SpyChain.prototype.send;
    expect((await post(app, "/settle", await body(payTo))).success).toBe(true);
  });
  it("reads limits from env with safe defaults", () => {
    expect(limitsFromEnv({ SETTLE_MAX_PER_PAYER_MINUTE: "3", SETTLE_MAX_GLOBAL_DAY: "x" })).toEqual({ perPayeeDay: 1000, globalDay: 5000, perPayerMinute: 3 });
  });
});
