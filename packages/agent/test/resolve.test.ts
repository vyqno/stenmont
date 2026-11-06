import { describe, expect, it } from "vitest";
import { LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, USDT_ADDRESS, X402_KEY, limitsRecord, toUnits, tokenRecord } from "@stenmont/shared";
import { DirectoryError, agentOptionsFor, resolveBusiness, type TextReader } from "../src/resolve";

const good: Record<string, string> = {
  [PAY_KEY]: "https://pay.acme.example/checkout",
  [X402_KEY]: "https://api.acme.example/premium",
  [TOKEN_KEY]: tokenRecord(),
  [LIMITS_KEY]: limitsRecord(toUnits("2000")),
  [REFUND_KEY]: "Refunds within 14 days",
};
const reader = (records: Record<string, string | undefined>): TextReader => async (_name, key) => records[key] ?? null;
const reasonOf = async (records: Record<string, string | undefined>, name = "acme.stenmont.eth") => {
  try {
    await resolveBusiness(name, reader(records));
  } catch (e) {
    if (e instanceof DirectoryError) return e.reason;
    throw e;
  }
  return "resolved";
};

describe("resolveBusiness", () => {
  it("reads and validates the whole directory", async () => {
    const b = await resolveBusiness("Acme.Stenmont.ETH", reader(good));
    expect(b).toEqual({
      name: "acme.stenmont.eth",
      pay: "https://pay.acme.example/checkout",
      x402: "https://api.acme.example/premium",
      token: { chainId: 1874, address: USDT_ADDRESS },
      limits: { perInvoice: toUnits("2000") },
      refund: "Refunds within 14 days",
    });
  });
  it("accepts a directory with no x402 endpoint and no refund text", async () => {
    const b = await resolveBusiness("acme.stenmont.eth", reader({ ...good, [X402_KEY]: undefined, [REFUND_KEY]: undefined }));
    expect(b.x402).toBeNull();
    expect(b.refund).toBeNull();
  });
  it("asks only for the five directory keys", async () => {
    const asked: string[] = [];
    await resolveBusiness("acme.stenmont.eth", async (_n, k) => (asked.push(k), good[k] ?? null));
    expect(asked.sort()).toEqual([LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, X402_KEY].sort());
  });
  it("refuses a name that is not a plain ENS name", async () => {
    for (const bad of ["", "acme", "acme..eth", "ac me.eth", "https://acme.eth", "acme.stenmont.eth/x", "-a.eth"]) expect(await reasonOf(good, bad)).toBe("bad_name");
  });
  it("refuses a missing pay or token or limits record", async () => {
    expect(await reasonOf({ ...good, [PAY_KEY]: undefined })).toBe("missing_pay");
    expect(await reasonOf({ ...good, [TOKEN_KEY]: undefined })).toBe("missing_token");
    expect(await reasonOf({ ...good, [LIMITS_KEY]: undefined })).toBe("missing_limits");
  });
  it("refuses anything but https for the pay and x402 addresses", async () => {
    for (const bad of ["http://pay.acme.example/x", "https://u:p@pay.acme.example/x", "https://pay.acme.example:444/x", "javascript:alert(1)", "https://10.0.0.1/x", "https://localhost/x"]) {
      expect(await reasonOf({ ...good, [PAY_KEY]: bad })).toBe("bad_pay");
      expect(await reasonOf({ ...good, [X402_KEY]: bad })).toBe("bad_x402");
    }
  });
  it("refuses any token but the official USDT on Whitechain Testnet", async () => {
    expect(await reasonOf({ ...good, [TOKEN_KEY]: tokenRecord(1874, "0x0000000000000000000000000000000000000001") })).toBe("wrong_token");
    expect(await reasonOf({ ...good, [TOKEN_KEY]: tokenRecord(1, USDT_ADDRESS) })).toBe("wrong_token");
    expect(await reasonOf({ ...good, [TOKEN_KEY]: "USDT" })).toBe("bad_token");
    expect(await reasonOf({ ...good, [TOKEN_KEY]: tokenRecord(1874, USDT_ADDRESS.toLowerCase() as `0x${string}`) })).toBe("resolved");
  });
  it("refuses a cap that is missing, zero, absurd or not the documented shape", async () => {
    for (const bad of ["{}", "x", '{"perInvoice":"0","unit":"USDT"}', '{"perInvoice":"99999999999","unit":"USDT"}']) expect(await reasonOf({ ...good, [LIMITS_KEY]: bad })).toBe("bad_limits");
  });
  it("refuses a refund record that is not short text or an https link", async () => {
    expect(await reasonOf({ ...good, [REFUND_KEY]: "x".repeat(281) })).toBe("bad_refund");
    expect(await reasonOf({ ...good, [REFUND_KEY]: "javascript:alert(1)" })).toBe("bad_refund");
    expect(await reasonOf({ ...good, [REFUND_KEY]: "http://acme.example/r" })).toBe("bad_refund");
    expect(await reasonOf({ ...good, [REFUND_KEY]: "https://acme.example/refunds" })).toBe("resolved");
  });
  it("tells a failed lookup apart from a missing record", async () => {
    const boom: TextReader = async () => {
      throw new Error("rpc down");
    };
    await expect(resolveBusiness("acme.stenmont.eth", boom)).rejects.toMatchObject({ reason: "lookup_failed" });
  });
});

describe("agentOptionsFor", () => {
  const b = { name: "acme.stenmont.eth", pay: "https://pay.acme.example/c", x402: "https://api.acme.example/premium", token: { chainId: 1874, address: USDT_ADDRESS }, limits: { perInvoice: toUnits("5") }, refund: null } as const;
  it("lets the agent pay only the host the directory names", () => {
    expect(agentOptionsFor(b, { maxPerRequest: "1.00", dailyLimit: "10" })).toMatchObject({ allowedHosts: ["api.acme.example"] });
  });
  it("never lets the per-request limit exceed the business's own published cap", () => {
    expect(agentOptionsFor(b, { maxPerRequest: "50", dailyLimit: "100" }).maxPerRequest).toBe("5");
    expect(agentOptionsFor(b, { maxPerRequest: "0.5", dailyLimit: "100" }).maxPerRequest).toBe("0.5");
  });
  it("refuses a business that publishes no x402 endpoint", () => {
    expect(() => agentOptionsFor({ ...b, x402: null }, { maxPerRequest: "1", dailyLimit: "1" })).toThrow(DirectoryError);
  });
});
