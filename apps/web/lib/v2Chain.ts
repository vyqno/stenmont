import { createPublicClient, defineChain, http, zeroAddress, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { fromUnits, toUnits, whitechainSepolia } from "@stenmont/shared";
import { paymentRouterV2Abi } from "../../../packages/shared/src/abis/v2/paymentRouterV2";
import { trustedInvoiceRouter, type PaymentInvoice } from "./v2Payment";

type State = { payout: Address; payerLock: Address; amount: bigint; paid: bigint; status: number; discountBps: number; discountUntil: bigint; hook: Address; dueDate: bigint };
const paymentChain = defineChain({ id: whitechainSepolia.id, name: whitechainSepolia.name, nativeCurrency: whitechainSepolia.nativeCurrency, rpcUrls: whitechainSepolia.rpcUrls, testnet: true });
const reader = createPublicClient({ chain: paymentChain, transport: http(whitechainSepolia.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 1 }) });
const names = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 10_000, retryCount: 0 }) });
const read = (router: Address, id: Hex): Promise<State> => reader.readContract({ address: router, abi: paymentRouterV2Abi, functionName: "invoices", args: [id] });
const resolveName = (name: string) => names.getEnsAddress({ name }).catch(() => null);
/** Trusted RPC/config is independent of the merchant API. This validates invoice terms, not the merchant's legal identity. */
export async function verifyFreshInvoice<T extends PaymentInvoice & { dueDate?: string | null; payeeName?: string | null }>(invoice: T, dependencies: { read?: (router: Address, id: Hex) => Promise<State>; resolveName?: (name: string) => Promise<Address | null> } = {}, host = typeof location === "undefined" ? "localhost" : location.hostname) {
  const router = trustedInvoiceRouter(invoice, host);
  if (invoice.contractVersion !== "v2") return { invoice, reviewRequired: false, ensCompared: false };
  const state = await (dependencies.read ?? read)(router, invoice.id as Hex);
  const equal = (a: string | null | undefined, b: string) => (a ?? zeroAddress).toLowerCase() === b.toLowerCase();
  const due = invoice.dueDate ? BigInt(Math.floor(Date.parse(invoice.dueDate) / 1000)) : 0n;
  if (!equal(invoice.payout, state.payout) || !equal(invoice.payerLock, state.payerLock) || toUnits(invoice.amount) !== state.amount || due !== state.dueDate || (invoice.discountBps ?? 0) !== state.discountBps || BigInt(invoice.discountUntil ?? 0) !== state.discountUntil) throw new Error("invalid_authorization");
  if (state.status !== 1) throw new Error("invoice_not_payable");
  let ensCompared = false;
  if (invoice.payeeName) {
    const resolved = await (dependencies.resolveName ?? resolveName)(invoice.payeeName);
    if (resolved && resolved.toLowerCase() !== state.payout.toLowerCase()) throw new Error("invalid_authorization");
    ensCompared = !!resolved;
  }
  const fresh = { ...invoice, routerAddress: router, payout: state.payout, payerLock: state.payerLock, hook: state.hook, amountPaid: fromUnits(state.paid), remaining: fromUnits(state.amount - state.paid), discountBps: state.discountBps, discountUntil: Number(state.discountUntil) };
  return { invoice: fresh, reviewRequired: !equal(invoice.hook, state.hook) || toUnits(invoice.amountPaid) !== state.paid, ensCompared };
}
