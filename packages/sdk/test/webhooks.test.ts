import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "../src";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1_790_000_000, data: { invoice: { id: "0x1" } }, livemode: false });
const now = 1_790_000_100;

describe("verifyWebhook", () => {
  it("accepts a valid signature and returns the event", async () => {
    const header = await signWebhook(secret, body, now);
    expect(await verifyWebhook(body, header, secret, { now })).toMatchObject({ id: "evt_1", type: "invoice.paid" });
  });
  it("rejects a tampered body", async () => {
    const header = await signWebhook(secret, body, now);
    await expect(verifyWebhook(body.replace("0x1", "0x2"), header, secret, { now })).rejects.toThrow(/signature/i);
  });
  it("rejects the wrong secret", async () => {
    await expect(verifyWebhook(body, await signWebhook("other", body, now), secret, { now })).rejects.toThrow(/signature/i);
  });
  it("rejects a timestamp older than 5 minutes, or from the future (replay)", async () => {
    await expect(verifyWebhook(body, await signWebhook(secret, body, now - 301), secret, { now })).rejects.toThrow(/timestamp/i);
    await expect(verifyWebhook(body, await signWebhook(secret, body, now + 301), secret, { now })).rejects.toThrow(/timestamp/i);
    expect(await verifyWebhook(body, await signWebhook(secret, body, now - 299), secret, { now })).toBeTruthy();
  });
  it("rejects missing or malformed headers", async () => {
    for (const h of ["", "garbage", "t=abc,v1=00", `t=${now}`, `v1=${"0".repeat(64)}`]) await expect(verifyWebhook(body, h, secret, { now })).rejects.toThrow();
  });
  it("accepts either of two signatures while a secret is being rotated", async () => {
    const good = await signWebhook(secret, body, now);
    const header = `${good},v1=${"0".repeat(64)}`;
    expect(await verifyWebhook(body, header, secret, { now })).toBeTruthy();
  });
});
