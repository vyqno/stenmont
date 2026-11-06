import { verifyWebhook } from "@stenmont/sdk";
import { describe, expect, it } from "vitest";
import { signWebhook } from "../src/lib/signature";

describe("SDK and server agree on webhook signatures", () => {
  it("the SDK verifies what the server signs, and rejects a tampered body", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, data: {}, livemode: false });
    const header = await signWebhook("whsec_x", body, 1_790_000_000);
    expect(await verifyWebhook(body, header, "whsec_x", { now: 1_790_000_010 })).toMatchObject({ id: "evt_1" });
    await expect(verifyWebhook(body + " ", header, "whsec_x", { now: 1_790_000_010 })).rejects.toThrow();
  });
});
