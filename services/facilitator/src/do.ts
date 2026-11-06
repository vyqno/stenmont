import type { Address, Hex } from "viem";
import { SerialSender } from "./sender";
// ---- Worker wiring: the one place the facilitator key signs ----
import { DurableObject } from "cloudflare:workers";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "@stenmont/shared";

/** One instance (named "main") serialises every settlement so concurrent ones get consecutive nonces. */
export class Sender extends DurableObject<{ FACILITATOR_PRIVATE_KEY: string; WHITECHAIN_RPC: string }> {
  private s?: SerialSender;
  async submit(call: { to: Address; data: Hex; gas?: string }): Promise<Hex> {
    this.s ??= this.build();
    return this.s.submit({ to: call.to, data: call.data, gas: call.gas ? BigInt(call.gas) : undefined });
  }
  private build() {
    const account = privateKeyToAccount(this.env.FACILITATOR_PRIVATE_KEY as Hex);
    const transport = http(this.env.WHITECHAIN_RPC);
    const pub = createPublicClient({ chain: whitechainSepolia, transport });
    const wallet = createWalletClient({ account, chain: whitechainSepolia, transport });
    return new SerialSender({
      getNonce: () => pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
      send: (call, nonce) => wallet.sendTransaction({ to: call.to, data: call.data, nonce, gas: call.gas }),
    });
  }
}
