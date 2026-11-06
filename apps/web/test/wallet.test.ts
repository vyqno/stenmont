import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashTypedData, recoverTypedDataAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { deployments } from "@stenmont/shared";
import { FRIENDLY, payChallenge, ZERO_SALT } from "../lib/pay";
import { cancelDigest } from "../lib/subscribe";
import { WALLET_COPY, WALLET_NETWORK, WalletError, injectedProvider, signWalletCancel, signWalletPayment, toTypedDataV4, walletBalance, type Eip1193 } from "../lib/wallet";

const ROUTER = deployments.environments.staging.PaymentRouter.address;
const INVOICE = `0x${"ab".repeat(32)}` as Hex;
const SALT = `0x${"01".repeat(32)}` as Hex;
const BANNED = /\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;

const withoutDomain = (t: Record<string, unknown>) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== "EIP712Domain"));

/** What a wallet extension does with eth_signTypedData_v4: parse the JSON and sign it. */
function fakeWallet(opts: { chainId?: string; balance?: bigint; reject?: boolean; noSwitch?: boolean } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const calls: { method: string; params?: unknown[] }[] = [];
  let chainId = opts.chainId ?? "0x752";
  const provider: Eip1193 = {
    async request({ method, params }) {
      calls.push({ method, ...(params ? { params } : {}) });
      if (opts.reject && method === "eth_requestAccounts") throw Object.assign(new Error("User rejected"), { code: 4001 });
      switch (method) {
        case "eth_requestAccounts":
          return [account.address];
        case "eth_chainId":
          return chainId;
        case "wallet_switchEthereumChain":
          if (opts.noSwitch) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
          chainId = (params![0] as { chainId: string }).chainId;
          return null;
        case "wallet_addEthereumChain":
          chainId = (params![0] as { chainId: string }).chainId;
          return null;
        case "eth_call":
          return `0x${(opts.balance ?? 0n).toString(16).padStart(64, "0")}`;
        case "eth_signTypedData_v4": {
          const typed = JSON.parse(params![1] as string);
          const types = withoutDomain(typed.types);
          return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
        }
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
  return { account, provider, calls };
}

describe("finding the wallet", () => {
  it("uses window.ethereum only when it can answer requests", () => {
    expect(injectedProvider({})).toBeNull();
    expect(injectedProvider({ ethereum: {} })).toBeNull();
    expect(injectedProvider({ ethereum: "yes" })).toBeNull();
    const p = { request: async () => null };
    expect(injectedProvider({ ethereum: p })).toBe(p);
  });
});

describe("what the wallet is asked to sign", () => {
  const typedArgs = { account: "0x2222222222222222222222222222222222222222", router: ROUTER, value: 5_000_000n, validBefore: 9_999_999_999n, invoiceId: INVOICE, salt: SALT } as const;

  it("is the same authorization the passkey signs, as JSON a wallet accepts", async () => {
    const w = fakeWallet({ balance: 10_000_000n });
    const out = await signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 5_000_000n, validBefore: 9_999_999_999n, salt: SALT });
    expect(out.payer.toLowerCase()).toBe(w.account.address.toLowerCase());
    const typed = JSON.parse(toTypedDataV4({ ...typedArgs, account: out.payer }));
    expect(typed.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual(["name", "version", "chainId", "verifyingContract"]);
    // the digest a wallet computes equals the one the passkey path signs for the same payment
    const types = withoutDomain(typed.types);
    expect(hashTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message })).toBe(payChallenge({ account: out.payer, router: ROUTER, value: 5_000_000n, validBefore: 9_999_999_999n, invoiceId: INVOICE, salt: SALT }));
    // and the signature recovers to the account that is paying
    const recovered = await recoverTypedDataAddress({ domain: typed.domain, types, primaryType: typed.primaryType, message: { ...typed.message, value: BigInt(typed.message.value), validAfter: 0n, validBefore: BigInt(typed.message.validBefore) }, signature: out.signature });
    expect(recovered.toLowerCase()).toBe(w.account.address.toLowerCase());
  });

  it("carries no number as a JSON number (large values would lose digits)", () => {
    const json = toTypedDataV4(typedArgs);
    expect(json).toContain('"value":"5000000"');
    expect(json).not.toMatch(/"value":\d/);
  });

  it("is bound to the invoice: another invoice, another digest", () => {
    const a = payChallenge({ ...typedArgs, invoiceId: INVOICE });
    const b = payChallenge({ ...typedArgs, invoiceId: `0x${"cd".repeat(32)}` });
    expect(a).not.toBe(b);
    expect(ZERO_SALT).toBeTruthy();
  });
});

describe("connecting", () => {
  it("switches to the right network first when the wallet is somewhere else", async () => {
    const w = fakeWallet({ chainId: "0x1" });
    await signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 1n, validBefore: 9_999_999_999n, salt: SALT });
    const methods = w.calls.map((c) => c.method);
    expect(methods.indexOf("wallet_switchEthereumChain")).toBeGreaterThan(-1);
    expect(methods.indexOf("wallet_switchEthereumChain")).toBeLessThan(methods.indexOf("eth_signTypedData_v4"));
  });

  it("adds the network when the wallet does not know it", async () => {
    const w = fakeWallet({ chainId: "0x1", noSwitch: true });
    await signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 1n, validBefore: 9_999_999_999n, salt: SALT });
    const add = w.calls.find((c) => c.method === "wallet_addEthereumChain")!;
    expect(add.params![0]).toMatchObject({ chainId: "0x752", chainName: WALLET_NETWORK.chainName, rpcUrls: ["https://rpc.testnet.whitechain.io"] });
  });

  it("does not ask to switch when already on the right network", async () => {
    const w = fakeWallet();
    await signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 1n, validBefore: 9_999_999_999n, salt: SALT });
    expect(w.calls.map((c) => c.method)).not.toContain("wallet_switchEthereumChain");
  });

  it("reports a person saying no as a cancellation", async () => {
    const w = fakeWallet({ reject: true });
    await expect(signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 1n, validBefore: 9_999_999_999n, salt: SALT })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("stops before signing when the check says the balance is short", async () => {
    const w = fakeWallet({ balance: 1n });
    const check = async (payer: `0x${string}`) => {
      if ((await walletBalance(w.provider, payer)) < 5_000_000n) throw new WalletError("wallet_insufficient");
    };
    await expect(signWalletPayment(w.provider, { router: ROUTER, invoiceId: INVOICE, value: 5_000_000n, validBefore: 9_999_999_999n, salt: SALT }, check)).rejects.toMatchObject({ code: "wallet_insufficient" });
    expect(w.calls.map((c) => c.method)).not.toContain("eth_signTypedData_v4");
  });

  it("reads the balance of the paying account", async () => {
    const w = fakeWallet({ balance: 7_500_000n });
    expect(await walletBalance(w.provider, w.account.address)).toBe(7_500_000n);
    const call = w.calls.find((c) => c.method === "eth_call")!;
    expect(JSON.stringify(call.params)).toContain("0x70a08231"); // balanceOf
  });
});

describe("ending a subscription from a wallet", () => {
  const MANAGER = "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD" as const;
  const ID = `0x${"01".repeat(32)}` as Hex;
  it("signs the same cancellation the passkey signs, and only for the subscribing account", async () => {
    const w = fakeWallet();
    const sig = await signWalletCancel(w.provider, w.account.address, { id: ID, manager: MANAGER, deadline: 9_999_999_999n });
    const typed = JSON.parse(w.calls.find((c) => c.method === "eth_signTypedData_v4")!.params![1] as string);
    const types = withoutDomain(typed.types);
    expect(hashTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: { id: ID, deadline: 9_999_999_999n } })).toBe(cancelDigest({ id: ID, manager: MANAGER }, 9_999_999_999n));
    const recovered = await recoverTypedDataAddress({ domain: typed.domain, types, primaryType: typed.primaryType, message: { id: ID, deadline: 9_999_999_999n }, signature: sig });
    expect(recovered.toLowerCase()).toBe(w.account.address.toLowerCase());
    const other = fakeWallet();
    await expect(signWalletCancel(other.provider, w.account.address, { id: ID, manager: MANAGER, deadline: 1n })).rejects.toMatchObject({ code: "wallet_failed" });
    expect(other.calls.map((c) => c.method)).not.toContain("eth_signTypedData_v4");
  });
});

describe("what a customer reads", () => {
  it("uses no crypto words in the messages (the option's own label is the one place it names a wallet)", () => {
    for (const code of ["cancelled", "wallet_network", "wallet_failed", "wallet_insufficient"]) {
      expect(FRIENDLY[code], code).toBeTruthy();
      expect(FRIENDLY[code]).not.toMatch(BANNED);
    }
    expect(WALLET_COPY.hint).not.toMatch(BANNED);
    expect(WALLET_COPY.button).toBe("Pay with my own wallet");
  });
});
