import { isAddress, type Hex, type LocalAccount } from "viem";
import { USDT_ADDRESS, buildTransferAuth, toUnits } from "@stenmont/shared";

export const NETWORK = "eip155:1874";
const MAX_VALID_SECONDS = 600; // never sign an authorization that lives longer than this, whatever the server asks

export type LimitReason = "per_request" | "daily" | "host_not_allowed" | "wrong_network" | "wrong_asset" | "bad_requirements";

export class LimitExceeded extends Error {
  constructor(public reason: LimitReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "LimitExceeded";
  }
}

/** Spend per UTC day (`YYYY-MM-DD`) in USDT base units. Swap in a persistent one for a long-lived agent. */
export interface Ledger {
  spent(day: string): Promise<bigint> | bigint;
  record(day: string, amount: bigint): Promise<void> | void;
}

export class MemoryLedger implements Ledger {
  private m = new Map<string, bigint>();
  spent(day: string) { return this.m.get(day) ?? 0n; }
  record(day: string, amount: bigint) { this.m.set(day, (this.m.get(day) ?? 0n) + amount); }
}

export type AgentOptions = {
  account: LocalAccount;
  /** Decimal USDT, e.g. "1.00". */
  maxPerRequest: string;
  dailyLimit: string;
  /** Hostnames the agent may pay. Omit to allow any (not recommended). */
  allowedHosts?: string[];
  fetch?: typeof fetch;
  now?: () => Date;
  ledger?: Ledger;
};

const b64 = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))));
const unb64 = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));

async function readRequirements(res: Response): Promise<any[]> {
  const h = res.headers.get("PAYMENT-REQUIRED");
  try {
    const j = h ? unb64(h) : await res.clone().json();
    return Array.isArray(j?.accepts) ? j.accepts : [];
  } catch {
    return [];
  }
}

/** A fetch that pays x402 402s on Whitechain USDT, inside hard limits checked before anything is signed. */
export function createAgentFetch(opts: AgentOptions): typeof fetch {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const ledger = opts.ledger ?? new MemoryLedger();
  const perRequest = toUnits(opts.maxPerRequest);
  const daily = toUnits(opts.dailyLimit);
  const hosts = opts.allowedHosts?.map((h) => h.toLowerCase());
  let inFlight = 0n; // reserved by payments still awaiting their answer, so parallel calls cannot overspend
  let gate: Promise<unknown> = Promise.resolve(); // makes "check the day's spend, then reserve" one step
  const reserve = (day: string, amount: bigint) => {
    const step = gate.then(async () => {
      if ((await ledger.spent(day)) + inFlight + amount > daily) throw new LimitExceeded("daily", `limit ${daily} for ${day}`);
      inFlight += amount;
    });
    gate = step.catch(() => {});
    return step;
  };

  return async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const first = await doFetch(req.clone());
    if (first.status !== 402) return first;

    const host = new URL(req.url).hostname.toLowerCase();
    if (hosts && !hosts.includes(host)) throw new LimitExceeded("host_not_allowed", host);

    const accepts = await readRequirements(first);
    const onChain = accepts.filter((a) => a?.scheme === "exact" && a.network === NETWORK);
    if (!onChain.length) throw new LimitExceeded("wrong_network", `server offers ${accepts.map((a) => a?.network).join(",") || "nothing"}`);
    const r = onChain.find((a) => typeof a.asset === "string" && a.asset.toLowerCase() === USDT_ADDRESS.toLowerCase());
    if (!r) throw new LimitExceeded("wrong_asset", "only the official USDT is paid");
    if (typeof r.amount !== "string" || !/^\d{1,30}$/.test(r.amount) || r.amount === "0" || !isAddress(r.payTo)) throw new LimitExceeded("bad_requirements", "amount or payTo");

    const amount = BigInt(r.amount);
    if (amount > perRequest) throw new LimitExceeded("per_request", `${r.amount} > ${perRequest}`);
    const t = now();
    const day = t.toISOString().slice(0, 10);
    await reserve(day, amount);

    try {
      const seconds = Math.min(Number.isInteger(r.maxTimeoutSeconds) && r.maxTimeoutSeconds > 0 ? r.maxTimeoutSeconds : 60, MAX_VALID_SECONDS);
      const nonce = ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
      const auth = { from: opts.account.address, to: r.payTo, value: amount, validAfter: 0n, validBefore: BigInt(Math.floor(t.getTime() / 1000) + seconds), nonce };
      const signature = await opts.account.signTypedData(buildTransferAuth(auth));
      const payment = {
        x402Version: 2,
        accepted: r,
        payload: { signature, authorization: { from: auth.from, to: auth.to, value: r.amount, validAfter: "0", validBefore: auth.validBefore.toString(), nonce } },
      };

      const retry = new Request(req.clone());
      retry.headers.set("PAYMENT-SIGNATURE", b64(payment));
      const res = await doFetch(retry); // exactly one retry, never a loop
      if (res.ok || res.headers.has("PAYMENT-RESPONSE")) await ledger.record(day, amount);
      return res;
    } finally {
      inFlight -= amount;
    }
  };
}
export * from "./resolve";
