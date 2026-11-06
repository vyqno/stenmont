import { describe, expect, it } from "vitest";
import { seal, unseal } from "../../src/lib/seal";

const SECRET = "fixture-client-secret-0123456789";
const TOKEN = ["shpat", "0123456789abcdef0123456789abcdef"].join("_");

describe("seal / unseal", () => {
  it("round-trips and never contains the plaintext", async () => {
    const s = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain("shpat");
    expect(await unseal(SECRET, s, ["m_1", "a.myshopify.com"])).toBe(TOKEN);
  });

  it("uses a fresh nonce every time", async () => {
    const a = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    const b = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    expect(a).not.toBe(b);
  });

  it("opens only with the same merchant and the same shop", async () => {
    const s = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    expect(await unseal(SECRET, s, ["m_2", "a.myshopify.com"])).toBeNull();
    expect(await unseal(SECRET, s, ["m_1", "b.myshopify.com"])).toBeNull();
    expect(await unseal(SECRET, s, ["m_1a.myshopify.com", ""])).toBeNull(); // parts cannot be shifted across the separator
  });

  it("opens only with the same secret", async () => {
    const s = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    expect(await unseal(`${SECRET}x`, s, ["m_1", "a.myshopify.com"])).toBeNull();
  });

  it("refuses tampered, truncated and garbage input without throwing", async () => {
    const s = await seal(SECRET, TOKEN, ["m_1", "a.myshopify.com"]);
    const flipped = s.slice(0, -2) + (s.endsWith("A") ? "B" : "A") + s.slice(-1);
    for (const bad of [flipped, s.slice(0, 10), "", "!!!", "A".repeat(40)]) expect(await unseal(SECRET, bad, ["m_1", "a.myshopify.com"])).toBeNull();
  });
});
