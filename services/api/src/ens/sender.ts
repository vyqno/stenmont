import { DurableObject } from "cloudflare:workers";
import { createPublicClient, createWalletClient, fallback, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { Env } from "../env";
import { SerialSender, type Call } from "../relayer/sender";

const DEFAULT_SEND_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

/** The one place the ENS registrar key signs (one instance, so its transactions get consecutive nonces). */
export class EnsSender extends DurableObject<Env> {
  private sender?: SerialSender;

  async submit(call: Call): Promise<Hex> {
    this.sender ??= this.build();
    return this.sender.submit(call);
  }

  private build(): SerialSender {
    const account = privateKeyToAccount(this.env.ENS_REGISTRAR_PRIVATE_KEY as Hex);
    const sendRpc = this.env.ENS_SEND_RPC || DEFAULT_SEND_RPC;
    const reader = createPublicClient({ chain: sepolia, transport: fallback([http(this.env.SEPOLIA_RPC), http(sendRpc)], { retryCount: 2 }) });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(sendRpc) });
    return new SerialSender({
      getNonce: () => reader.getTransactionCount({ address: account.address, blockTag: "pending" }),
      send: (call, nonce) => wallet.sendTransaction({ to: call.to, data: call.data, nonce, gas: call.gas }),
    });
  }
}
