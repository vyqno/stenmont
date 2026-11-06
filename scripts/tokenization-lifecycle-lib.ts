// Pure helpers for tokenization-lifecycle.ts: no network, no keys, so they can be unit-tested.
import { CLAIM_LIMITS, formatUSDT, quoteClaim, toUnits } from "@stenmont/shared";

export const STAGING_CHAIN_ID = 1874;
export const DEFAULT_API = "https://api-staging.stenmont.com";
/** Test money only: a lifecycle run may not move more than this much USDT. */
export const MAX_FACE_UNITS = 5_000_000n;
const EXPLORER = "https://explorer.testnet.whitechain.io";
const STAGING_API_HOSTS = new Set(["api-staging.stenmont.com", "api-testnet.stenmont.com", "localhost", "127.0.0.1"]);

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) => `${EXPLORER}/address/${address}`;

/** The script refuses to run on any other chain, or against any API that is not a staging host. Returns the parsed API URL. */
export function assertStaging(x: { chainId: number; apiUrl: string }): URL {
  if (x.chainId !== STAGING_CHAIN_ID) throw new Error(`Refusing to run: chain id is ${x.chainId}, this script only runs on Whitechain Sepolia (${STAGING_CHAIN_ID}).`);
  let url: URL;
  try {
    url = new URL(x.apiUrl);
  } catch {
    throw new Error(`Refusing to run: "${x.apiUrl}" is not a valid API URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || !STAGING_API_HOSTS.has(url.hostname) || (!local && url.protocol !== "https:")) {
    throw new Error(`Refusing to run: ${url.host} is not a staging API host (need https and one of ${[...STAGING_API_HOSTS].join(", ")}).`);
  }
  return url;
}

export type Options = { dryRun: boolean; apiUrl: string; face: bigint; discountBps: number; reserveBps: number; dueHours: number; defaultPath: boolean; help: boolean };
type Raw = Record<string, string | boolean | undefined>;

const intIn = (raw: string | boolean | undefined, fallback: number, min: number, max: number, name: string) => {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(`--${name} must be a whole number from ${min} to ${max}`);
  return Number(raw);
};

/** Flags (from node:util parseArgs) -> validated options, with limits the API and the contract would enforce anyway. */
export function resolveOptions(raw: Raw): Options {
  let face = 1_000_000n;
  if (raw.face !== undefined) {
    if (typeof raw.face !== "string" || !/^\d{1,3}(\.\d{1,6})?$/.test(raw.face)) throw new Error("--face must be a positive USDT amount such as 1 or 2.5");
    face = toUnits(raw.face);
    if (face <= 0n) throw new Error("--face must be greater than zero");
    if (face > MAX_FACE_UNITS) throw new Error(`--face may be at most ${formatUSDT(MAX_FACE_UNITS)} (test money only)`);
  }
  return {
    dryRun: raw["dry-run"] === true,
    apiUrl: typeof raw.api === "string" ? raw.api : DEFAULT_API,
    face,
    discountBps: intIn(raw["discount-bps"], 500, 1, CLAIM_LIMITS.maxDiscountBps, "discount-bps (discount)"),
    reserveBps: intIn(raw["reserve-bps"], 1000, 0, CLAIM_LIMITS.maxReserveBps, "reserve-bps (reserve)"),
    dueHours: intIn(raw["due-hours"], 24, 2, 24 * 6, "due-hours"),
    defaultPath: raw["default-path"] === true,
    help: raw.help === true,
  };
}

export type Quote = { face: bigint; price: bigint; reserve: bigint; advance: bigint; discount: bigint };
/** The same rounding as InvoiceClaim.quote. */
export function lifecycleMath(o: Pick<Options, "face" | "discountBps" | "reserveBps">): Quote {
  const { price, reserve } = quoteClaim(o.face, o.discountBps, o.reserveBps);
  return { face: o.face, price, reserve, advance: price - reserve, discount: o.face - price };
}

export type Balances = { investor: bigint; payout: bigint; buyer: bigint; claim: bigint; router: bigint };
/**
 * After a full lifecycle: the investor paid `price` and was repaid `face` (net +discount); the merchant's payout wallet got
 * the advance and then the reserve back (net +price); the buyer paid `face`; neither contract keeps anything.
 */
export function checkOutcome(before: Balances, after: Balances, m: Quote): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const expect = (name: string, b: bigint, a: bigint, delta: bigint) => {
    if (a - b !== delta) problems.push(`${name}: expected ${delta >= 0n ? "+" : "-"}${formatUSDT(delta < 0n ? -delta : delta)}, got ${a - b >= 0n ? "+" : "-"}${formatUSDT(a - b < 0n ? b - a : a - b)}`);
  };
  expect("investor", before.investor, after.investor, m.discount);
  expect("merchant payout wallet", before.payout, after.payout, m.price);
  expect("buyer", before.buyer, after.buyer, -m.face);
  if (after.claim !== 0n) problems.push(`claim contract still holds ${formatUSDT(after.claim)}`);
  if (after.router !== 0n) problems.push(`router still holds ${formatUSDT(after.router)}`);
  return { ok: problems.length === 0, problems };
}

/** What a dry run prints: every step, who signs, who pays the gas. */
export function planLines(o: Options, m: Quote): string[] {
  return [
    `Tokenization lifecycle on Whitechain Sepolia (${STAGING_CHAIN_ID}), API ${o.apiUrl}`,
    `Invoice ${formatUSDT(m.face)} due in ${o.dueHours} hours, sold at a ${o.discountBps / 100}% discount with ${o.reserveBps / 100}% held back:`,
    `  investor pays ${formatUSDT(m.price)}, merchant gets ${formatUSDT(m.advance)} today, ${formatUSDT(m.reserve)} is held until the buyer pays.`,
    "",
    "Roles (test wallets from .env; keys are never printed): merchant = a fresh throwaway key signing only; payout wallet = the attester test wallet;",
    "investor = the deployer test wallet; buyer = the demo payer test wallet. The relayer pays the gas for every transaction.",
    "",
    "Steps:",
    "  1. setCreator            merchant signs, relayer sends: lets the relayer create invoices for the merchant (delegation)",
    "  2. createInvoiceAsCreator relayer sends: the invoice exists on the router",
    "  3. list                  merchant signs the claim terms and the router SetHook, relayer sends: the invoice is offered for sale",
    "  4. allow                 the attester key signs an AllowInvestor attestation directly, relayer sends (see warning below)",
    "  5. fund                  investor signs a USDT authorization bound to this invoice, relayer sends: investor holds the claim token, merchant is paid",
    "  6. pay                   buyer signs a USDT authorization bound to this invoice, relayer sends: the router pays the claim, the claim repays the investor and settles",
    "  7. confirm               read the claim, the token owner, the balances and the buyer's payment record; then ask the staging API for the public certificate",
    "",
    "WARNING (step 4): this is a TEST SHORTCUT. It uses the attester key directly and bypasses the World proof of personhood that the real",
    "investor flow requires (POST /invest/allow). It is for staging only and proves the contracts, not the identity check.",
    "",
    o.dryRun ? "Dry run: nothing is sent, no keys are read, no network is used." : "Live run: transactions will be sent on staging.",
  ];
}

export type Row = { step: string; actor: string; result: string; url?: string };
/** A plain, aligned table for the end of the run. */
export function summaryTable(rows: Row[]): string {
  const head = { step: "Step", actor: "Actor", result: "Result", url: "Link" };
  const all = [head, ...rows.map((r) => ({ ...r, url: r.url ?? "" }))];
  const w = (k: "step" | "actor" | "result") => maxLen(all.map((r) => r[k].length));
  const widths = { step: w("step"), actor: w("actor"), result: w("result") };
  const line = (r: { step: string; actor: string; result: string; url: string }) =>
    `${r.step.padEnd(widths.step)}  ${r.actor.padEnd(widths.actor)}  ${r.result.padEnd(widths.result)}  ${r.url}`.trimEnd();
  const [h, ...body] = all.map(line);
  return [h!, "-".repeat(h!.length), ...body].join("\n");
}
const maxLen = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), 0);

/** The default path is documented, not run live: it needs 7 days of grace after the due date. */
export function defaultPathNotes(): string[] {
  return [
    "The default path is not run by this script. The contract only lets anyone call markDefault(invoiceId) once 7 days have passed after the due date",
    "(InvoiceClaim.GRACE) and the claim is still Funded, so it cannot be exercised on a live chain in one sitting.",
    "What happens: the held-back reserve goes to the claim's holder (never more than the face value is owed), the claim becomes Defaulted, a second default is refused,",
    "and a payment that arrives later still tops the holder up to the face value, with the rest going to the merchant.",
    "",
    "To exercise it against the real USDT, with time moved forward by the test harness:",
    "  cd contracts && forge test --profile fork --match-test test_fork_defaultPaysReserveToInvestor -vv",
    "Its unit tests (contracts/test/InvoiceClaim.t.sol, test_markDefault_*) cover grace, double default, partial payment and late payment.",
    "On staging, the API's hourly job calls markDefault for a funded claim once the grace period is over (services/api/src/claims.ts, runDefaults).",
  ];
}
