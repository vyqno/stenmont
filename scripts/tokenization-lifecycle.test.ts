// Unit tests for the pure helpers of tokenization-lifecycle.ts.   pnpm --filter @stenmont/scripts test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FACE_UNITS, assertStaging, checkOutcome, defaultPathNotes, explorerAddress, explorerToken, explorerTx, lifecycleMath, planLines, resolveOptions, summaryTable,
} from "./tokenization-lifecycle-lib";

const opts = (over: Record<string, string | boolean | undefined> = {}) => resolveOptions({ ...over });

describe("assertStaging", () => {
  it("accepts chain 1874 and the staging API hosts", () => {
    assert.equal(assertStaging({ chainId: 1874, apiUrl: "https://api-staging.stenmont.com" }).hostname, "api-staging.stenmont.com");
    assert.doesNotThrow(() => assertStaging({ chainId: 1874, apiUrl: "http://localhost:8787" }));
    assert.doesNotThrow(() => assertStaging({ chainId: 1874, apiUrl: "https://api-testnet.stenmont.com/" }));
  });
  it("refuses any other chain", () => {
    assert.throws(() => assertStaging({ chainId: 1, apiUrl: "https://api-staging.stenmont.com" }), /chain id/i);
    assert.throws(() => assertStaging({ chainId: 1875, apiUrl: "https://api-staging.stenmont.com" }), /1874/);
  });
  it("refuses production and look-alike hosts", () => {
    for (const bad of ["https://api.stenmont.com", "https://app.stenmont.com", "https://api-staging.stenmont.com.evil.example", "https://evil.example/api-staging.stenmont.com", "https://user@api.stenmont.com", "http://api-staging.stenmont.com", "not a url", ""]) {
      assert.throws(() => assertStaging({ chainId: 1874, apiUrl: bad }), /staging|URL|https/i, bad);
    }
  });
});

describe("resolveOptions", () => {
  it("has safe defaults: a 1 USDT invoice, 5% discount, 10% reserve, real staging API, a real run", () => {
    const o = opts();
    assert.equal(o.dryRun, false);
    assert.equal(o.face, 1_000_000n);
    assert.equal(o.discountBps, 500);
    assert.equal(o.reserveBps, 1000);
    assert.equal(o.apiUrl, "https://api-staging.stenmont.com");
    assert.equal(o.dueHours, 24);
  });
  it("reads flags", () => {
    const o = opts({ "dry-run": true, face: "2.5", "discount-bps": "300", "reserve-bps": "0", api: "http://localhost:8787" });
    assert.deepEqual([o.dryRun, o.face, o.discountBps, o.reserveBps, o.apiUrl], [true, 2_500_000n, 300, 0, "http://localhost:8787"]);
  });
  it("rejects values the API and contract would refuse, and amounts too large for test money", () => {
    assert.throws(() => opts({ "discount-bps": "0" }), /discount/i);
    assert.throws(() => opts({ "discount-bps": "3001" }), /discount/i);
    assert.throws(() => opts({ "reserve-bps": "5001" }), /reserve/i);
    assert.throws(() => opts({ "discount-bps": "abc" }), /discount/i);
    assert.throws(() => opts({ face: "0" }), /face/i);
    assert.throws(() => opts({ face: "-1" }), /face/i);
    assert.throws(() => opts({ face: "nope" }), /face/i);
    assert.throws(() => opts({ face: String(Number(MAX_FACE_UNITS) / 1e6 + 1) }), /at most/i);
  });
});

describe("lifecycleMath", () => {
  it("matches the contract's quote (both round down)", () => {
    const m = lifecycleMath(opts());
    assert.deepEqual([m.face, m.price, m.reserve, m.advance, m.discount], [1_000_000n, 950_000n, 100_000n, 850_000n, 50_000n]);
  });
  it("price minus reserve is the cash today, face minus price is the investor's profit", () => {
    const m = lifecycleMath(opts({ face: "2.5", "discount-bps": "300", "reserve-bps": "1234" }));
    assert.equal(m.price, 2_425_000n);
    assert.equal(m.reserve, 308_500n);
    assert.equal(m.advance, m.price - m.reserve);
    assert.equal(m.discount, m.face - m.price);
  });
});

describe("checkOutcome", () => {
  const m = lifecycleMath(opts());
  const before = { investor: 5_000_000n, payout: 0n, buyer: 4_000_000n, claim: 0n, router: 0n };
  it("passes when balances moved exactly as the contract promises", () => {
    // investor: -price + face = +discount; payout: +price (advance now, reserve back after settlement); buyer: -face; contracts hold nothing
    const after = { investor: 5_050_000n, payout: 950_000n, buyer: 3_000_000n, claim: 0n, router: 0n };
    assert.deepEqual(checkOutcome(before, after, m), { ok: true, problems: [] });
  });
  it("names every balance that is off, and a contract that kept money", () => {
    const after = { investor: 5_000_000n, payout: 850_000n, buyer: 3_000_000n, claim: 100_000n, router: 1n };
    const r = checkOutcome(before, after, m);
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 4);
    assert.match(r.problems.join("\n"), /investor/);
    assert.match(r.problems.join("\n"), /payout/);
    assert.match(r.problems.join("\n"), /claim contract/);
    assert.match(r.problems.join("\n"), /router/);
  });
});

describe("planLines", () => {
  it("lists every step with who signs and who pays the gas, and says nothing is sent", () => {
    const o = opts({ "dry-run": true });
    const text = planLines(o, lifecycleMath(o)).join("\n");
    for (const step of ["setCreator", "createInvoiceAsCreator", "list", "allow", "fund", "pay"]) assert.match(text, new RegExp(step));
    assert.match(text, /relayer pays the gas/i);
    assert.match(text, /attester key directly/i);
    assert.match(text, /nothing is sent/i);
    assert.match(text, /\$0\.85|0\.85/);
  });
  it("never contains a private key", () => {
    const o = opts({ "dry-run": true });
    assert.doesNotMatch(planLines(o, lifecycleMath(o)).join("\n"), /0x[0-9a-fA-F]{64}/);
  });
});

describe("summaryTable", () => {
  it("aligns columns and includes each link", () => {
    const t = summaryTable([
      { step: "1 list", actor: "relayer", result: "Listed", url: explorerTx(`0x${"1".repeat(64)}`) },
      { step: "2 fund", actor: "relayer", result: "Funded" },
    ]);
    const lines = t.split("\n");
    assert.equal(lines.length, 4);
    assert.match(lines[0]!, /Step\s+Actor\s+Result\s+Link/);
    assert.match(t, /https:\/\/explorer\.testnet\.whitechain\.io\/tx\/0x1{64}/);
    assert.equal(lines[2]!.indexOf("relayer"), lines[3]!.indexOf("relayer"));
  });
});

describe("links and the default path", () => {
  it("builds explorer links", () => {
    assert.equal(explorerTx("0xabc"), "https://explorer.testnet.whitechain.io/tx/0xabc");
    assert.equal(explorerAddress("0xdef"), "https://explorer.testnet.whitechain.io/address/0xdef");
    assert.equal(explorerToken("0xdef", 7n), "https://explorer.testnet.whitechain.io/token/0xdef/instance/7");
  });
  it("only describes the default path, pointing at the fork test (7-day grace)", () => {
    const text = defaultPathNotes().join("\n");
    assert.match(text, /7 days/);
    assert.match(text, /test_fork_defaultPaysReserveToInvestor/);
    assert.match(text, /forge test --profile fork/);
    assert.match(text, /markDefault/);
  });
});
