import { describe, expect, it } from "vitest";
import { describeTrust, type Trust } from "../lib/trust";

const BANNED = /\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;
const NAME = "acme.stenmont.eth";
const t = (domain: boolean, world: boolean, ens: boolean, tier = 0): Trust => ({ domain, world, ensName: ens ? NAME : null, tier });

describe("describeTrust", () => {
  // domain, world, ens -> verified?, proof lines in order
  const cases: [boolean, boolean, boolean, boolean, string[]][] = [
    [false, false, false, false, []],
    [false, false, true, false, [`Has the public name ${NAME}`]],
    [true, false, false, true, ["Proved it controls its website"]],
    [true, false, true, true, ["Proved it controls its website", `Has the public name ${NAME}`]],
    [false, true, false, true, ["A real person is registered for it (World ID)"]],
    [false, true, true, true, ["A real person is registered for it (World ID)", `Has the public name ${NAME}`]],
    [true, true, false, true, ["Proved it controls its website", "A real person is registered for it (World ID)"]],
    [true, true, true, true, ["Proved it controls its website", "A real person is registered for it (World ID)", `Has the public name ${NAME}`]],
  ];
  for (const [domain, world, ens, verified, proofs] of cases) {
    it(`domain=${domain} world=${world} name=${ens}`, () => {
      const d = describeTrust(t(domain, world, ens, 3))!;
      expect(d.verified).toBe(verified);
      expect(d.proofs).toEqual(proofs);
      expect(d.headline).toBe(verified ? "Verified business" : "Not yet verified");
    });
  }

  it("never calls a business verified on a name alone, however high the stored tier", () => {
    expect(describeTrust(t(false, false, true, 4))!.verified).toBe(false);
    expect(describeTrust(t(false, false, false, 4))!.verified).toBe(false);
  });
  it("only says what the proofs show: no claim about documents, ownership of the person, or safety", () => {
    for (const [d, w, e] of [[true, true, true], [true, false, false], [false, true, false]] as const) {
      const text = JSON.stringify(describeTrust(t(d, w, e, 4)));
      expect(text).not.toMatch(/document|passport|identity check|KYC|safe|guarantee|trusted|licen[sc]ed|insured/i);
    }
  });
  it("shows the level only for a verified business, and keeps it within 1 to 4", () => {
    expect(describeTrust(t(true, false, false, 2))!.level).toBe("Verification level 2 of 4");
    expect(describeTrust(t(false, true, false, 3))!.level).toBe("Verification level 3 of 4");
    expect(describeTrust(t(false, false, true, 0))!.level).toBeNull();
    expect(describeTrust(t(true, false, false, 0))!.level).toBeNull(); // a stale tier of 0 with a proof: show no number rather than a wrong one
    expect(describeTrust(t(true, false, false, 9))!.level).toBeNull();
    expect(describeTrust(t(true, false, false, 2.5))!.level).toBeNull();
  });
  it("explains a business that has not verified, without alarm", () => {
    expect(describeTrust(t(false, false, false))!.note).toBe("This business has not completed any verification yet.");
  });
  it("gives a business with only a public name the same note", () => {
    expect(describeTrust(t(false, false, true))!.note).toBe("This business has not completed any verification yet.");
  });
  it("has no note for a verified business", () => {
    expect(describeTrust(t(true, false, false, 2))!.note).toBeNull();
  });
  it("treats a missing or malformed trust block (an older server) as nothing to show", () => {
    for (const bad of [undefined, null, {}, { domain: "yes" }] as unknown[]) expect(describeTrust(bad as Trust)).toBeNull();
  });
  it("uses no crypto vocabulary a customer should not meet", () => {
    for (const [d, w, e] of [[true, true, true], [false, false, true], [false, false, false]] as const) {
      const x = describeTrust(t(d, w, e, 3))!;
      expect([x.headline, x.level, x.note, ...x.proofs].filter(Boolean).join(" ")).not.toMatch(BANNED);
    }
  });
  it("shows only a plain ENS-looking name, never markup", () => {
    expect(describeTrust({ domain: false, world: false, ensName: "<script>x</script>", tier: 0 })).toBeNull();
    expect(describeTrust({ domain: false, world: false, ensName: "a b.eth", tier: 0 })).toBeNull();
  });
});
