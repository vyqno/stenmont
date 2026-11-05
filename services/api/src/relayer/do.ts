import { DurableObject } from "cloudflare:workers";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "@stenmont/shared";
import type { Env } from "../env";
import { SerialSender, type Call } from "./sender";

/**
 * The single place the relayer key signs. One instance (named "main") serialises every transaction, so concurrent
 * payments get consecutive nonces instead of colliding. Everything else asks it through `submit`.
 */
export class Relayer extends DurableObject<Env> {
  private sender?: SerialSender;

  async submit(call: Call): Promise<Hex> {
    this.sender ??= this.build();
    return this.sender.submit(call);
  }

  private build(): SerialSender {
    const account = privateKeyToAccount(this.env.RELAYER_PRIVATE_KEY as Hex);
    const transport = http(this.env.WHITECHAIN_RPC);
    const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
    const wallet = createWalletClient({ account, chain: whitechainSepolia, transport });
    return new SerialSender({
      getNonce: () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
      send: (call, nonce) => wallet.sendTransaction({ to: call.to, data: call.data, nonce, gas: call.gas }),
    });
  }
}
