import type { Address, Hex } from "viem";

export type Call = { to: Address; data: Hex; gas?: bigint };

export type SenderDeps = {
  /** The chain's pending transaction count for the relayer account. */
  getNonce(): Promise<number>;
  /** Signs and broadcasts one transaction with an explicit nonce; resolves with the hash (not the receipt). */
  send(call: Call, nonce: number): Promise<Hex>;
};

/**
 * Sends the relayer's transactions strictly one at a time with consecutive nonces. Receipts are NOT awaited here, so
 * throughput is not limited by block time, but two submissions can never read the same nonce.
 * Lives inside a Durable Object (single instance), which is what makes "one at a time" true across requests.
 */
export class SerialSender {
  private chain: Promise<unknown> = Promise.resolve();
  private next: number | null = null;

  constructor(private readonly deps: SenderDeps) {}

  submit(call: Call): Promise<Hex> {
    const run = this.chain.then(() => this.sendOnce(call));
    this.chain = run.catch(() => undefined); // a failure must not wedge later submissions
    return run;
  }

  private async nonce(): Promise<number> {
    const onChain = await this.deps.getNonce();
    return this.next === null ? onChain : Math.max(this.next, onChain);
  }

  private async sendOnce(call: Call): Promise<Hex> {
    let nonce = await this.nonce();
    try {
      return await this.broadcast(call, nonce);
    } catch (e) {
      this.next = null; // unknown state: re-read the chain next time
      // Only "nonce too low" is retried. "already known" means the node HAS this transaction: sending it again would risk paying twice.
      if (!/nonce too low/i.test(String(e))) throw e;
      nonce = await this.nonce(); // exactly one retry with a fresh nonce
      return await this.broadcast(call, nonce).catch((e2) => {
        this.next = null;
        throw e2;
      });
    }
  }

  private async broadcast(call: Call, nonce: number): Promise<Hex> {
    const hash = await this.deps.send(call, nonce);
    this.next = nonce + 1;
    return hash;
  }
}
