import type { MiddlewareHandler } from "hono";
import { isAddress } from "viem";
import { USDT_ADDRESS, toUnits } from "@stenmont/shared";

export const NETWORK = "eip155:1874";

export type PaywallOptions = {
  /** Decimal USDT, e.g. "0.01". */
  amount: string;
  /** 0x address, or an ENS name that `resolveName` turns into one. */
  payTo: string;
  facilitatorUrl: string;
  resolveName?: (name: string) => Promise<string>;
  fetch?: typeof fetch;
  description?: string;
};

const b64 = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))));
const unb64 = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));

/**
 * x402 v2 paywall (exact scheme, USDT on Whitechain). Requirements come only from server config; the client's
 * `accepted` block is just passed to the facilitator, which refuses anything that differs.
 *
 * Order: verify -> run the handler -> settle -> release the body. If settle fails the handler's response is
 * discarded (402, or 502 when the facilitator is unreachable), so paid content never leaves without payment.
 * Handler errors (status >= 400) are not charged. A concurrent replay can make the handler run twice but only
 * one settlement succeeds and the loser gets no content.
 */
export function stenmontPaywall(opts: PaywallOptions): MiddlewareHandler {
  const doFetch = opts.fetch ?? fetch;
  const amount = toUnits(opts.amount).toString(); // throws at startup on a bad price
  let payTo: Promise<string> | undefined;
  const resolvePayTo = () =>
    (payTo ??= (async () => {
      if (isAddress(opts.payTo)) return opts.payTo;
      if (!opts.resolveName) throw new Error("payTo is a name but no resolveName was given");
      const a = await opts.resolveName(opts.payTo);
      if (!isAddress(a)) throw new Error("resolveName did not return an address");
      return a;
    })().catch((e) => { payTo = undefined; throw e; }));

  const call = async (path: "/verify" | "/settle", body: unknown) => {
    const r = await doFetch(opts.facilitatorUrl.replace(/\/$/, "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`facilitator ${r.status}`);
    return (await r.json()) as any;
  };

  return async (c, next) => {
    let to: string;
    try {
      to = await resolvePayTo();
    } catch {
      return c.json({ error: "paywall_misconfigured" }, 500);
    }
    const requirements = { scheme: "exact", network: NETWORK, asset: USDT_ADDRESS, amount, payTo: to, maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" } };
    const challenge = (error: string, status: 402 | 502 = 402) => {
      const body = { x402Version: 2, error, resource: { url: c.req.url, description: opts.description }, accepts: [requirements] };
      c.header("PAYMENT-REQUIRED", b64(body));
      return c.json(body, status);
    };

    const raw = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("X-PAYMENT");
    if (!raw) return challenge("payment_required");
    let paymentPayload: unknown;
    try {
      paymentPayload = unb64(raw);
    } catch {
      return challenge("invalid_payment_header");
    }
    const body = { x402Version: 2, paymentPayload, paymentRequirements: requirements };

    try {
      const v = await call("/verify", body);
      if (!v.isValid) return challenge(v.invalidReason ?? "invalid_payment");
    } catch {
      return challenge("facilitator_unavailable", 502);
    }

    await next();
    if (c.res.status >= 400) return; // the handler failed: do not charge

    try {
      const s = await call("/settle", body);
      if (!s.success) {
        c.res = challenge(s.errorReason ?? "settlement_failed");
        return;
      }
      c.res.headers.set("PAYMENT-RESPONSE", b64({ success: true, transaction: s.transaction, network: s.network, payer: s.payer }));
    } catch {
      c.res = challenge("facilitator_unavailable", 502);
    }
  };
}
