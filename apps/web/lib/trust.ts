/** What the public pay data says about a business (see services/api `publicTrust`). */
export type Trust = { domain: boolean; world: boolean; ensName: string | null; tier: number };
export type TrustView = { verified: boolean; headline: string; proofs: string[]; level: string | null; note: string | null };

const NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * The wording of the "Verified business" badge. It says only what the proofs show:
 *  - "Verified business" needs a proof of control (the website's domain, or a real person registered through World ID).
 *    A public name alone is something anyone can register, so it is listed but never makes a business "verified".
 *  - World ID shows that one real person is registered for the business; it does not say that person owns it.
 *  - No claim about documents, safety or quality is made at any level.
 * Returns null when the data is missing or malformed (for example from an older server): show nothing rather than guess.
 */
export function describeTrust(trust: Trust | null | undefined): TrustView | null {
  if (!trust || typeof trust.domain !== "boolean" || typeof trust.world !== "boolean" || !Number.isFinite(trust.tier)) return null;
  const name = trust.ensName;
  if (name !== null && (typeof name !== "string" || name.length > 253 || !NAME.test(name))) return null;

  const proofs: string[] = [];
  if (trust.domain) proofs.push("Proved it controls its website");
  if (trust.world) proofs.push("A real person is registered for it (World ID)");
  if (name) proofs.push(`Has the public name ${name}`);

  const verified = trust.domain || trust.world;
  const level = verified && Number.isInteger(trust.tier) && trust.tier >= 1 && trust.tier <= 4 ? `Verification level ${trust.tier} of 4` : null;
  return {
    verified,
    headline: verified ? "Verified business" : "Not yet verified",
    proofs,
    level,
    note: verified ? null : "This business has not completed any verification yet.",
  };
}
