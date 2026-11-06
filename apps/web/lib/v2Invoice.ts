import { hashTypedData, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { encodeWebAuthnSignature, parseDerSignature, setCreatorTypes, toUnits } from "@stenmont/shared";
import { invoiceAckDomain, invoiceAckTypes, routerV2Domain } from "../../../packages/shared/src/v2/payment";
import { b64urlDecode, b64urlEncode } from "./pay";
import { signChallenge } from "./auth";

export function invoiceTerms(buyer: string, discount: string, until: string, now = Date.now()) {
  if (buyer && (!isAddress(buyer) || buyer.toLowerCase() === zeroAddress)) throw new Error("Enter the buyer’s account address.");
  if (!discount) return buyer ? { buyerAddress: buyer } : {};
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(discount) || Number(discount) <= 0 || Number(discount) > 30) throw new Error("Enter a discount above 0 and at most 30%.");
  if (!buyer) throw new Error("A discount requires a named buyer account.");
  const expiry = new Date(until).getTime();
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error("Choose a future discount expiry.");
  return { buyerAddress: buyer, discountBps: Math.round(Number(discount) * 100), discountUntil: new Date(expiry).toISOString() };
}
export type CreatorDelegation = { routerAddress: Address; merchant: Address; creator: Address; nonce: string; deadline: number };
export function creatorDelegationDigest(a: CreatorDelegation): Hex {
  return hashTypedData({ domain: routerV2Domain(a.routerAddress), types: setCreatorTypes, primaryType: "SetCreator", message: { merchant: a.merchant, creator: a.creator, allowed: true, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) } });
}
/** Reuse the business's actual passkey, not the unrelated customer account saved by checkout. */
export async function signContractDigest(digest: Hex, credentialId?: string): Promise<Hex> {
  const assertion = await signChallenge(b64urlEncode(Uint8Array.from(digest.slice(2).match(/../g)!.map(x => parseInt(x, 16)))), credentialId);
  const { r, s } = parseDerSignature(b64urlDecode(assertion.signature));
  return encodeWebAuthnSignature({ r, s, authenticatorData: b64urlDecode(assertion.authenticatorData), clientDataJSON: new TextDecoder().decode(b64urlDecode(assertion.clientDataJSON)) });
}
export function acknowledgementDigest(a: { invoiceId: Hex; ackAddress: Address; buyer: Address; amount: string; dueDate: string; nonce: string; deadline: number }): Hex {
  return hashTypedData({ domain: invoiceAckDomain(a.ackAddress), types: invoiceAckTypes, primaryType: "InvoiceAck", message: { invoiceId: a.invoiceId, amount: toUnits(a.amount), dueDate: BigInt(Math.floor(Date.parse(a.dueDate) / 1000)), buyer: a.buyer, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) } });
}

export function challengeDeadline(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("The challenge deadline could not be verified.");
  return value;
}
