import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, usdtAbi, whitechainSepolia } from "@stenmont/shared";

export type Auth = { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex };

/** Everything the facilitator needs from the chain; tests inject a fake. */
export interface Chain {
  /** ECDSA or ERC-1271 (smart account) check of the typed-data signature. */
  verifySignature(a: { address: Address; typedData: any; signature: Hex }): Promise<boolean>;
  usdtBalance(a: Address): Promise<bigint>;
  authorizationUsed(from: Address, nonce: Hex): Promise<boolean>;
  /** eth_call of transferWithAuthorization; throws if the token would revert. */
  simulateTransfer(a: Auth): Promise<void>;
  facilitatorBalance(): Promise<bigint>;
  /** Worst-case WBT cost of one settlement at the current gas price. */
  estimateCost(): Promise<bigint>;
  /** Hands the transaction to the single serialised sender; resolves with the hash. */
  send(call: { to: Address; data: Hex; gas?: bigint }): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<{ status: "success" | "reverted" }>;
}

export const SETTLE_GAS = 200_000n; // ponytail: fixed budget; estimateGas per call if USDT cost varies a lot

export function transferCalldata(a: Auth): Hex {
  return encodeFunctionData({ abi: usdtAbi, functionName: "transferWithAuthorization", args: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, a.signature] });
}

export type ChainEnv = { WHITECHAIN_RPC: string; FACILITATOR_PRIVATE_KEY: string; SENDER: DurableObjectNamespace };

const stateAbi = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);

export function viemChain(env: ChainEnv): Chain {
  const client = createPublicClient({ chain: whitechainSepolia, transport: http(env.WHITECHAIN_RPC) });
  const me = privateKeyToAccount(env.FACILITATOR_PRIVATE_KEY as Hex).address;
  const stub = () => env.SENDER.get(env.SENDER.idFromName("main")) as unknown as { submit(c: { to: Address; data: Hex; gas?: string }): Promise<Hex> };
  return {
    verifySignature: ({ address, typedData, signature }) => client.verifyTypedData({ address, ...typedData, signature }),
    usdtBalance: (a) => client.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [a] }),
    // ponytail: if the token lacks authorizationState we report "unused" and the simulation catches a used nonce
    authorizationUsed: (from, nonce) => client.readContract({ address: USDT_ADDRESS, abi: stateAbi, functionName: "authorizationState", args: [from, nonce] }).catch(() => false),
    async simulateTransfer(a) {
      await client.call({ account: me, to: USDT_ADDRESS, data: transferCalldata(a) });
    },
    facilitatorBalance: () => client.getBalance({ address: me }),
    estimateCost: async () => (await client.getGasPrice()) * SETTLE_GAS,
    send: (call) => stub().submit({ ...call, gas: call.gas?.toString() }),
    async waitForReceipt(hash) {
      const r = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });
      return { status: r.status };
    },
  };
}
