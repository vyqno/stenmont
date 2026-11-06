import { describe, expect, it, beforeEach } from "vitest";
import { verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, buildTransferAuth } from "@stenmont/shared";
import { createApp } from "../src/index";
import { MemoryStore } from "../src/store";
import type { Chain } from "../src/chain";

const NOW = 1_800_000_000;
const NETWORK = "eip155:1874";
const payTo: Address = "0x00000000000000000000000000000000000000aa";
const payer = privateKeyToAccount(generatePrivateKey());

class FakeChain implements Chain {
  sent: { to: Address; data: Hex }[] = [];
  balance = 10_000_000n;
  wbt = 10n ** 18n;
  used = new Set<string>();
  simError: string | null = null;
  receipt: "success" | "reverted" | "timeout" = "success";
  async verifySignature(a: { address: Address; typedData: any; signature: Hex }) {
    return verifyTypedData({ address: a.address, ...a.typedData, signature: a.signature });
  }
  async usdtBalance() { return this.balance; }
  async authorizationUsed(from: Address, nonce: Hex) { return this.used.has(`${from}:${nonce}`); }
  async simulateTransfer() { if (this.simError) throw new Error(this.simError); }
  async facilitatorBalance() { return this.wbt; }
  async estimateCost() { return 10n ** 15n; }
  async send(call: { to: Address; data: Hex }) { this.sent.push(call); return ("0x" + String(this.sent.length).padStart(64, "0")) as Hex; }
  async waitForReceipt() { if (this.receipt === "timeout") throw new Error("timeout"); return { status: this.receipt }; }
}

const requirements = { scheme: "exact", network: NETWORK, asset: USDT_ADDRESS, amount: "1000000", payTo, maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" } };

async function payload(over: Partial<{ value: bigint; to: Address; validAfter: bigint; validBefore: bigint; nonce: Hex; asset: string; signer: typeof payer }> = {}) {
  const nonce = over.nonce ?? (("0x" + crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")) as Hex);
  const auth = { from: payer.address, to: over.to ?? payTo, value: over.value ?? 1_000_000n, validAfter: over.validAfter ?? BigInt(NOW - 10), validBefore: over.validBefore ?? BigInt(NOW + 60), nonce };
  const signature = await (over.signer ?? payer).signTypedData(buildTransferAuth(auth));
  return {
    x402Version: 2,
    accepted: { ...requirements, asset: over.asset ?? USDT_ADDRESS },
    payload: { signature, authorization: { ...auth, value: auth.value.toString(), validAfter: auth.validAfter.toString(), validBefore: auth.validBefore.toString() } },
  };
}

let chain: FakeChain;
let store: MemoryStore;
let app: ReturnType<typeof createApp>;
const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const verify = async (p: any, r: any = requirements) => (await post("/verify", { x402Version: 2, paymentPayload: p, paymentRequirements: r })).json() as Promise<any>;
const settle = async (p: any, r: any = requirements) => (await post("/settle", { x402Version: 2, paymentPayload: p, paymentRequirements: r })).json() as Promise<any>;

beforeEach(() => {
  chain = new FakeChain();
  store = new MemoryStore();
  app = createApp({ chain, store, now: () => NOW, minWbtWei: 10n ** 16n });
});

describe("GET /supported", () => {
  it("advertises exact on eip155:1874", async () => {
    const j = (await (await app.request("/supported")).json()) as any;
    expect(j.kinds).toEqual([{ x402Version: 2, scheme: "exact", network: NETWORK }]);
  });
});

describe("POST /verify", () => {
  it("accepts a valid payload", async () => {
    expect(await verify(await payload())).toEqual({ isValid: true, payer: payer.address });
  });
  it("accepts a smart-account style signature when the chain says it is valid", async () => {
    chain.verifySignature = async () => true;
    const p = await payload();
    p.payload.signature = "0x1234";
    expect((await verify(p)).isValid).toBe(true);
  });
  it.each([
    ["wrong amount", { value: 999n }, undefined, "invalid_exact_evm_payload_authorization_value"],
    ["wrong payTo", { to: "0x00000000000000000000000000000000000000bb" as Address }, undefined, "invalid_exact_evm_payload_recipient_mismatch"],
    ["expired", { validBefore: BigInt(NOW + 2) }, undefined, "invalid_exact_evm_payload_authorization_valid_before"],
    ["not yet valid", { validAfter: BigInt(NOW + 5) }, undefined, "invalid_exact_evm_payload_authorization_valid_after"],
    ["wrong asset in payload", { asset: "0x00000000000000000000000000000000000000cc" }, undefined, "invalid_exact_evm_payload_asset"],
    ["wrong signer", { signer: privateKeyToAccount(generatePrivateKey()) }, undefined, "invalid_exact_evm_payload_signature"],
  ])("rejects %s", async (_n, over, _r, reason) => {
    const r = await verify(await payload(over as any));
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe(reason);
  });
  it("rejects requirements that name another asset", async () => {
    const p = await payload();
    const r = await verify(p, { ...requirements, asset: "0x00000000000000000000000000000000000000cc" });
    expect(r).toMatchObject({ isValid: false, invalidReason: "invalid_exact_evm_payload_asset" });
  });
  it("rejects another network", async () => {
    const r = await verify(await payload(), { ...requirements, network: "eip155:1" });
    expect(r).toMatchObject({ isValid: false, invalidReason: "invalid_network" });
  });
  it("rejects insufficient balance, used nonce and a failed simulation", async () => {
    chain.balance = 1n;
    expect((await verify(await payload())).invalidReason).toBe("insufficient_funds");
    chain.balance = 10n ** 9n;
    const p = await payload();
    chain.used.add(`${payer.address}:${p.payload.authorization.nonce}`);
    expect((await verify(p)).invalidReason).toBe("invalid_exact_evm_payload_authorization_nonce_used");
    chain.used.clear();
    chain.simError = "execution reverted: boom";
    expect((await verify(await payload())).invalidReason).toBe("invalid_transaction_state");
  });
  it("answers 400 on a malformed body", async () => {
    expect((await post("/verify", { nope: 1 })).status).toBe(400);
  });
});

describe("POST /settle", () => {
  it("settles once and returns the transaction", async () => {
    const r = await settle(await payload());
    expect(r).toMatchObject({ success: true, network: NETWORK, payer: payer.address });
    expect(r.transaction).toMatch(/^0x/);
    expect(chain.sent).toHaveLength(1);
    expect(chain.sent[0]!.to).toBe(USDT_ADDRESS);
  });
  it("a replayed payload errors and sends exactly one transaction", async () => {
    const p = await payload();
    expect((await settle(p)).success).toBe(true);
    const second = await settle(p);
    expect(second).toMatchObject({ success: false, errorReason: "duplicate_settlement" });
    expect(chain.sent).toHaveLength(1);
  });
  it("15 concurrent settles of one payload send one transaction", async () => {
    const p = await payload();
    const rs = await Promise.all(Array.from({ length: 15 }, () => settle(p)));
    expect(rs.filter((r) => r.success)).toHaveLength(1);
    expect(chain.sent).toHaveLength(1);
  });
  it("invalid payload is not sent", async () => {
    const r = await settle(await payload({ value: 5n }));
    expect(r).toMatchObject({ success: false, errorReason: "invalid_exact_evm_payload_authorization_value" });
    expect(chain.sent).toHaveLength(0);
  });
  it("low WBT fails before sending and leaves no state, so a retry works after refuel", async () => {
    chain.wbt = 1n;
    const p = await payload();
    expect(await settle(p)).toMatchObject({ success: false, errorReason: "facilitator_low_funds" });
    expect(chain.sent).toHaveLength(0);
    expect(await store.get(`${payer.address}:${p.payload.authorization.nonce}`)).toBeNull();
    chain.wbt = 10n ** 18n;
    expect((await settle(p)).success).toBe(true);
  });
  it("a reverted transaction frees the authorization", async () => {
    chain.receipt = "reverted";
    const p = await payload();
    expect(await settle(p)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    chain.receipt = "success";
    expect((await settle(p)).success).toBe(true);
  });
  it("a receipt timeout keeps the claim (it may still land) and reports the hash", async () => {
    chain.receipt = "timeout";
    const p = await payload();
    const r = await settle(p);
    expect(r).toMatchObject({ success: false, errorReason: "settlement_pending" });
    expect(r.transaction).toMatch(/^0x/);
    expect(await settle(p)).toMatchObject({ success: false, errorReason: "duplicate_settlement" });
    expect(chain.sent).toHaveLength(1);
  });
  it("does not leak secrets or raw errors", async () => {
    chain.simError = "rpc https://secret.example/key=abc failed";
    const r = JSON.stringify(await verify(await payload()));
    expect(r).not.toContain("secret.example");
  });
});
