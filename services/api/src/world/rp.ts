import { bytesToHex, concat, hexToBytes, keccak256, numberToBytes, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** What IDKit's `rp_context` expects. */
export type RpContext = { rp_id: string; nonce: Hex; created_at: number; expires_at: number; signature: Hex };

/** World's "hash to field": keccak256, shifted right 8 bits, so the value fits the proof system's field. */
const hashToField = (bytes: Uint8Array): Hex => {
  const h = hexToBytes(keccak256(bytes));
  return bytesToHex(concat([new Uint8Array(1), h.slice(0, 31)]));
};

/**
 * Signs one IDKit request. The private key is a parameter (the caller reads it from the Worker secret), never from env here.
 * Layout (World's RP signature spec): 0x01 | nonce(32) | created_at u64be | expires_at u64be | hashToField(action)(32),
 * EIP-191 signed. Written from the spec as remembered, NOT yet checked against World's verifier: see the report.
 * `randomBytes` and `now` are injected so tests are deterministic.
 */
export async function createRpContext(opts: {
  rpId: string;
  action: string;
  signingKey: Hex;
  ttlSeconds?: number;
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
}): Promise<RpContext> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(opts.signingKey)) throw new Error("rp signing key must be a 32-byte hex private key");
  const createdAt = Math.floor((opts.now ?? (() => new Date()))().getTime() / 1000);
  const expiresAt = createdAt + (opts.ttlSeconds ?? 300);
  const nonce = hashToField((opts.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n))))(32));
  const message = concat([
    new Uint8Array([1]),
    hexToBytes(nonce),
    numberToBytes(createdAt, { size: 8 }),
    numberToBytes(expiresAt, { size: 8 }),
    hexToBytes(hashToField(stringToBytes(opts.action))),
  ]);
  const signature = await privateKeyToAccount(opts.signingKey).signMessage({ message: { raw: message } });
  return { rp_id: opts.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature };
}
