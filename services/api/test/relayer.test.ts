import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { MULTICALL3_ADDRESS, paymentRouterAbi } from "@stenmont/shared";
import { Rejected } from "../src/chain";
import { baseEnv, seedMerchant, setup } from "./helpers/app";
import { PASSKEY_ADDRESS, rejecting } from "./helpers/chain";
import { seedInvoice } from "./helpers/fixtures";

const PAYER = "0x3333333333333333333333333333333333333333";
const ROUTER = "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929";
const DAY = "2026-11-06";
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const sig = `0x${"22".repeat(65)}`;

type T = ReturnType<typeof setup>;
const body = (id: string, over: Record<string, unknown> = {}) => ({
  invoiceId: id,
  value: "5",
  payer: PAYER,
  validAfter: "0",
  validBefore: "9999999999",
  salt: salt(1),
  signature: sig,
  ...over,
});
const pay = (t: T, b: unknown, ip = "1.1.1.1") =>
  t.req("/relay/pay", { method: "POST", body: JSON.stringify(b), headers: { "cf-connecting-ip": ip } });
const json = async (r: Response) => (await r.json()) as Record<string, any>;

async function seedTank(t: T, o: { balance?: bigint; dailyCap?: bigint; payerCap?: bigint; merchant?: string } = {}) {
  await t.db
    .prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values (?,?,?,?,?,?,0)")
    .bind(o.merchant ?? "m_1", (o.balance ?? 10n ** 17n).toString(), (o.dailyCap ?? 5n * 10n ** 16n).toString(), "0", DAY, (o.payerCap ?? 1000n * 10n ** 6n).toString())
    .run();
}
async function world(chainOverrides = {}, envOverrides = {}, tank: Parameters<typeof seedTank>[1] | null = {}) {
  const t = setup(chainOverrides, envOverrides);
  await seedMerchant(t.db);
  const id = await seedInvoice(t.db, "INV-1", 100_000_000n);
  if (tank) await seedTank(t, tank);
  return { t, id };
}
const tank = async (t: T) => (await t.db.prepare("select * from gas_tanks where merchant_id = 'm_1'").first()) as Record<string, any>;
const usage = async (t: T) => (await t.db.prepare("select coalesce(sum(cast(usdt as integer)),0) as u from payer_usage").first()) as { u: number };

describe("POST /relay/pay: the happy path", () => {
  it("simulates, sends one payment transaction and settles the real gas cost", async () => {
    const { t, id } = await world();
    const res = await pay(t, body(id));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "success", deployedAccount: false, txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(t.chain.sent).toHaveLength(1);
    expect(t.chain.sent[0]!.to.toLowerCase()).toBe(ROUTER.toLowerCase());
    const decoded = decodeFunctionData({ abi: paymentRouterAbi, data: t.chain.sent[0]!.data });
    expect(decoded.functionName).toBe("pay");
    expect(decoded.args![0]).toBe(id);
    expect(decoded.args![1]).toBe(5_000_000n);

    const actual = 150_000n * 5_000_000_000n; // gasUsed * effectiveGasPrice from the receipt
    const row = await tank(t);
    expect(BigInt(row.spent_today_wbt)).toBe(actual);
    expect(BigInt(row.wbt_balance)).toBe(10n ** 17n - actual); // the 25% reservation margin was refunded
    expect((await usage(t)).u).toBe(5_000_000);
    const tx = (await t.db.prepare("select * from relayer_txs").first()) as Record<string, any>;
    expect(tx).toMatchObject({ kind: "pay", status: "success", gas_used: "150000", wbt_cost: actual.toString(), merchant_id: "m_1" });
  });
});

describe("POST /relay/pay: duplicates and replays", () => {
  it("the same authorization twice sends nothing the second time (409 duplicate)", async () => {
    const { t, id } = await world();
    expect((await pay(t, body(id))).status).toBe(200);
    const again = await pay(t, body(id));
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("duplicate");
    expect(t.chain.sent).toHaveLength(1);
  });
  it("a different salt is a different authorization", async () => {
    const { t, id } = await world();
    expect((await pay(t, body(id, { value: "5" }))).status).toBe(200);
    expect((await pay(t, body(id, { salt: salt(2), value: "5" }))).status).toBe(200);
    expect(t.chain.sent).toHaveLength(2);
  });
});

describe("POST /relay/pay: rate limits", () => {
  it("the 101st request from one payer in a minute is refused before any work", async () => {
    const { t, id } = await world(rejecting("execution reverted"));
    let last = 0;
    for (let i = 1; i <= 100; i++) last = (await pay(t, body(id, { salt: salt(i) }), `9.9.${i % 200}.1`)).status;
    expect(last).toBe(422);
    const estimates = t.chain.counts.estimate;
    const res = await pay(t, body(id, { salt: salt(101) }), "9.9.250.1");
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("rate_limited");
    expect(t.chain.counts.estimate).toBe(estimates); // refused before simulating
  });
  it("the 101st request from one IP in a minute is refused, whoever the payer is", async () => {
    const { t, id } = await world(rejecting("execution reverted"));
    for (let i = 1; i <= 100; i++) await pay(t, body(id, { salt: salt(i), payer: `0x${i.toString(16).padStart(40, "0")}` }), "5.5.5.5");
    const res = await pay(t, body(id, { salt: salt(101), payer: `0x${"f".repeat(40)}` }), "5.5.5.5");
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("rate_limited");
  });
  it("the limit is per minute: it clears when the minute passes", async () => {
    const { t, id } = await world(rejecting("execution reverted"));
    for (let i = 1; i <= 101; i++) await pay(t, body(id, { salt: salt(i) }), "6.6.6.6");
    expect((await pay(t, body(id, { salt: salt(500) }), "6.6.6.6")).status).toBe(429);
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect((await pay(t, body(id, { salt: salt(501) }), "6.6.6.6")).status).toBe(422);
  });
});

describe("POST /relay/pay: caps", () => {
  it("a payer cannot exceed the daily USDT cap across requests, and other payers are unaffected", async () => {
    const { t, id } = await world({}, {}, { payerCap: 10_000_000n });
    expect((await pay(t, body(id, { value: "6" }))).status).toBe(200);
    const over = await pay(t, body(id, { value: "6", salt: salt(2) }));
    expect(over.status).toBe(429);
    expect((await json(over)).error.code).toBe("payer_cap");
    expect((await pay(t, body(id, { value: "6", salt: salt(3), payer: `0x${"4".repeat(40)}` }))).status).toBe(200);
    expect((await pay(t, body(id, { value: "4", salt: salt(4) }))).status).toBe(200); // exactly at the cap
  });
  it("the payer cap resets on the next UTC day", async () => {
    const { t, id } = await world({}, {}, { payerCap: 5_000_000n });
    expect((await pay(t, body(id, { value: "5" }))).status).toBe(200);
    expect((await pay(t, body(id, { value: "1", salt: salt(2) }))).status).toBe(429);
    t.clock.now = new Date("2026-11-07T00:00:01Z");
    expect((await pay(t, body(id, { value: "1", salt: salt(3) }))).status).toBe(200);
  });
  it("an empty gas tank is refused before simulating or sending anything", async () => {
    const { t, id } = await world({}, {}, { balance: 0n });
    const res = await pay(t, body(id));
    expect(res.status).toBe(402);
    expect((await json(res)).error.code).toBe("gas_tank_empty");
    expect(t.chain.counts.estimate).toBe(0);
    expect(t.chain.sent).toHaveLength(0);
  });
  it("a merchant without a tank is treated as an empty tank", async () => {
    const { t, id } = await world({}, {}, null);
    expect((await json(await pay(t, body(id)))).error.code).toBe("gas_tank_empty");
  });
  it("the merchant's daily gas cap stops the relayer", async () => {
    const { t, id } = await world({}, {}, { dailyCap: 10n ** 15n }); // smaller than one reservation (1.25e15)
    const res = await pay(t, body(id));
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("gas_cap_reached");
    expect(t.chain.sent).toHaveLength(0);
  });
  it("a nearly empty relayer wallet returns 503 instead of failing mid-way", async () => {
    const { t, id } = await world({ async relayerBalance() { return 10n ** 15n; } });
    const res = await pay(t, body(id));
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("relayer_low");
    expect(t.chain.sent).toHaveLength(0);
  });
});

describe("POST /relay/pay: rejections cost nothing", () => {
  it.each([
    ["InvoiceNotOpen", 409, "invoice_not_payable"],
    ["Overpay", 422, "overpay"],
    ["BelowMinimum", 422, "below_minimum"],
    ["WrongPayer", 422, "wrong_payer"],
    ["execution reverted", 422, "invalid_authorization"],
  ])("a simulation that reverts with %s becomes %i %s, with no gas spent and no usage recorded", async (reason, status, code) => {
    const { t, id } = await world(rejecting(reason));
    const res = await pay(t, body(id));
    expect(res.status).toBe(status);
    expect((await json(res)).error.code).toBe(code);
    expect(t.chain.sent).toHaveLength(0);
    const row = await tank(t);
    expect(BigInt(row.spent_today_wbt)).toBe(0n);
    expect(BigInt(row.wbt_balance)).toBe(10n ** 17n);
    expect((await usage(t)).u).toBe(0);
  });
  it("a rejected authorization can be retried (its reservation was released)", async () => {
    let reject = true;
    const { t, id } = await world({
      async estimateGas() {
        if (reject) throw new Rejected("execution reverted");
        return 200_000n;
      },
    });
    expect((await pay(t, body(id))).status).toBe(422);
    reject = false;
    expect((await pay(t, body(id))).status).toBe(200);
  });
  it("unknown, paid and cancelled invoices are refused without simulating", async () => {
    const { t } = await world();
    expect((await pay(t, body(`0x${"9".repeat(64)}`))).status).toBe(404);
    const paid = await seedInvoice(t.db, "INV-PAID");
    await t.db.prepare("update invoices set status = 'paid' where id = ?").bind(paid).run();
    const cancelled = await seedInvoice(t.db, "INV-CAN");
    await t.db.prepare("update invoices set status = 'cancelled' where id = ?").bind(cancelled).run();
    for (const id of [paid, cancelled]) {
      const res = await pay(t, body(id));
      expect(res.status).toBe(409);
      expect((await json(res)).error.code).toBe("invoice_not_payable");
    }
    expect(t.chain.counts.estimate).toBe(0);
  });
  it("validates the request body", async () => {
    const { t, id } = await world();
    for (const bad of [
      { ...body(id), payer: "nope" },
      { ...body(id), value: "-1" },
      { ...body(id), value: "0" },
      { ...body(id), salt: "0x12" },
      { ...body(id), signature: "abc" },
      { ...body(id), invoiceId: "0x12" },
      { ...body(id), extra: 1 },
    ]) {
      expect((await pay(t, bad)).status).toBe(400);
    }
    expect(t.chain.sent).toHaveLength(0);
  });
});

describe("POST /relay/pay: accounting under pressure", () => {
  it("a transaction that reverts onchain still charges the gas it used and releases the payer's usage", async () => {
    const { t, id } = await world({ async waitForReceipt() { return { status: "reverted", gasUsed: 100_000n, effectiveGasPrice: 5_000_000_000n }; } });
    const res = await pay(t, body(id));
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe("tx_reverted");
    const row = await tank(t);
    expect(BigInt(row.spent_today_wbt)).toBe(100_000n * 5_000_000_000n);
    expect((await usage(t)).u).toBe(0);
    expect(((await t.db.prepare("select status from relayer_txs").first()) as { status: string }).status).toBe("reverted");
  });
  it("ten concurrent payments never overspend the cap and the books balance exactly", async () => {
    const cap = 5n * 10n ** 15n;
    const { t, id } = await world(
      { async waitForReceipt() { await new Promise((r) => setTimeout(r, 5)); return { status: "success", gasUsed: 150_000n, effectiveGasPrice: 5_000_000_000n }; } },
      {},
      { dailyCap: cap },
    );
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => pay(t, body(id, { salt: salt(i + 1), value: "1" }), `7.7.7.${i}`)));
    const codes = await Promise.all(results.map(async (r) => (r.status === 200 ? "ok" : (await json(r)).error.code)));
    expect(codes.every((c) => c === "ok" || c === "gas_cap_reached" || c === "busy" || c === "duplicate")).toBe(true);
    const ok = codes.filter((c) => c === "ok").length;
    expect(ok).toBeGreaterThan(0);
    const row = await tank(t);
    const spent = BigInt(row.spent_today_wbt);
    expect(spent).toBeLessThanOrEqual(cap);
    expect(spent).toBe(BigInt(ok) * 150_000n * 5_000_000_000n);
    expect(BigInt(row.wbt_balance) + spent).toBe(10n ** 17n); // nothing created or lost
    expect(t.chain.sent).toHaveLength(ok);
  });
});


describe("POST /relay/pay: in-flight reservations are not the cap", () => {
  it("a cap that is full only because other payments are still in flight is reported as busy, then works once they settle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let slow = true;
    const { t, id } = await world(
      {
        async waitForReceipt() {
          if (slow) await gate; // the first payment's receipt is slow, so its reservation stays held
          return { status: "success", gasUsed: 150_000n, effectiveGasPrice: 5_000_000_000n };
        },
      },
      {},
      { dailyCap: 2n * 10n ** 15n }, // room for one 1.25e15 reservation plus one 7.5e14 settled payment
    );
    const first = pay(t, body(id, { salt: salt(1) }), "1.1.1.1");
    await new Promise((r) => setTimeout(r, 20)); // let the first one reserve and send
    const second = await pay(t, body(id, { salt: salt(2) }), "2.2.2.2");
    expect(second.status).toBe(503);
    expect((await json(second)).error.code).toBe("busy"); // not "gas_cap_reached": the cap is not exhausted

    slow = false;
    release();
    expect((await first).status).toBe(200);
    const third = await pay(t, body(id, { salt: salt(3) }), "3.3.3.3");
    expect(third.status).toBe(200);
    const fourth = await pay(t, body(id, { salt: salt(4) }), "4.4.4.4"); // now the cap really is full
    expect((await json(fourth)).error.code).toBe("gas_cap_reached");
  });
});

describe("POST /relay/pay: passkey accounts are deployed on first use", () => {
  const account = { qx: salt(0xaa), qy: salt(0xbb), salt: salt(0) };
  it("an undeployed account is created and paid in one Multicall3 transaction", async () => {
    const { t, id } = await world({ async hasCode() { return false; } });
    const res = await pay(t, body(id, { payer: PASSKEY_ADDRESS, account }));
    expect(res.status).toBe(200);
    expect((await json(res)).deployedAccount).toBe(true);
    expect(t.chain.sent).toHaveLength(1);
    expect(t.chain.sent[0]!.to).toBe(MULTICALL3_ADDRESS);
    expect(t.chain.sent[0]!.data.startsWith("0x82ad56cb")).toBe(true); // aggregate3
    expect(((await t.db.prepare("select kind from relayer_txs").first()) as { kind: string }).kind).toBe("deploy_pay");
  });
  it("an account that already exists is paid directly", async () => {
    const { t, id } = await world({ async hasCode() { return true; } });
    await pay(t, body(id, { payer: PASSKEY_ADDRESS, account }));
    expect(t.chain.sent[0]!.to.toLowerCase()).toBe(ROUTER.toLowerCase());
  });
  it("refuses an account whose key does not produce the payer address, before sending anything", async () => {
    const { t, id } = await world({ async hasCode() { return false; } });
    const res = await pay(t, body(id, { payer: PAYER, account })); // PAYER is not the address of `account`
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe("account_mismatch");
    expect(t.chain.sent).toHaveLength(0);
  });
  it("an undeployed payer with no account details is just a failed simulation", async () => {
    const { t, id } = await world({ async hasCode() { return false; }, ...rejecting("execution reverted") });
    const res = await pay(t, body(id));
    expect(res.status).toBe(422);
  });
});

describe("GET /relay/account", () => {
  it("returns the counterfactual address, whether it exists, and its balance", async () => {
    const t = setup({ async usdtBalance() { return 7_500_000n; }, async hasCode() { return false; } });
    const res = await t.req("/relay/account", { method: "POST", body: JSON.stringify({ qx: salt(1), qy: salt(2), salt: salt(0) }) });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ address: PASSKEY_ADDRESS, deployed: false, balance: "7.5" });
  });
  it("validates its input", async () => {
    const t = setup();
    expect((await t.req("/relay/account", { method: "POST", body: JSON.stringify({ qx: "nope" }) })).status).toBe(400);
  });
});

describe("GET /v1/gas-tank", () => {
  it("shows the merchant their own tank and nobody else's", async () => {
    const t = setup();
    const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    await seedTank(t, { balance: 10n ** 17n, merchant: "m_1" });
    const mine = await json(await t.req("/v1/gas-tank", { key: a }));
    expect(mine).toMatchObject({ balance: "0.1", dailyCap: "0.05", spentToday: "0", perPayerDailyCapUsdt: "1000" });
    const theirs = await json(await t.req("/v1/gas-tank", { key: b }));
    expect(theirs.balance).toBe("0");
    expect((await t.req("/v1/gas-tank")).status).toBe(401);
  });
});

describe("POST /relay/faucet (non-production only)", () => {
  const claim = (t: T, address: string, ip = "8.8.8.8") =>
    t.req("/relay/faucet", { method: "POST", body: JSON.stringify({ address }), headers: { "cf-connecting-ip": ip } });
  it("sends 5 test USDT through a signed authorization, once per address per day", async () => {
    const t = setup();
    const res = await claim(t, PAYER);
    expect(res.status).toBe(200);
    expect(t.chain.sent).toHaveLength(1);
    expect(t.chain.sent[0]!.to.toLowerCase()).toBe("0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7");
    expect(t.chain.sent[0]!.data.startsWith("0xcf092995")).toBe(true); // transferWithAuthorization(bytes)
    const again = await claim(t, PAYER);
    expect(again.status).toBe(429);
    expect((await json(again)).error.code).toBe("faucet_limit");
    expect(t.chain.sent).toHaveLength(1);
    t.clock.now = new Date("2026-11-07T00:00:01Z");
    expect((await claim(t, PAYER)).status).toBe(200);
  });
  it("limits each IP to 5 claims a day", async () => {
    const t = setup();
    for (let i = 1; i <= 5; i++) expect((await claim(t, `0x${i.toString(16).padStart(40, "0")}`, "4.4.4.4")).status).toBe(200);
    expect((await claim(t, `0x${"e".repeat(40)}`, "4.4.4.4")).status).toBe(429);
  });
  it("does not exist in production and needs its key configured", async () => {
    const prod = setup({}, { ENVIRONMENT: "production" });
    expect((await claim(prod, PAYER)).status).toBe(404);
    const nokey = setup({}, { FAUCET_PRIVATE_KEY: undefined });
    expect((await claim(nokey, PAYER)).status).toBe(503);
    expect((await claim(setup(), "nope")).status).toBe(400);
  });
});

void baseEnv;
