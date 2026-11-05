import { describe, expect, it } from "vitest";
import { SerialSender } from "../src/relayer/sender";

const call = (n: number) => ({ to: "0x0000000000000000000000000000000000000001" as const, data: `0x${n.toString(16).padStart(2, "0")}` as `0x${string}` });
const tick = () => new Promise((r) => setTimeout(r, 1));

describe("SerialSender", () => {
  it("gives concurrent submissions distinct, consecutive nonces in arrival order", async () => {
    const used: number[] = [];
    const s = new SerialSender({
      getNonce: async () => 5,
      send: async (_c, nonce) => {
        await tick(); // a slow RPC: without serialisation two sends would read the same nonce
        used.push(nonce);
        return `0x${nonce.toString(16).padStart(64, "0")}` as `0x${string}`;
      },
    });
    const hashes = await Promise.all(Array.from({ length: 10 }, (_, i) => s.submit(call(i))));
    expect(used).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(new Set(hashes).size).toBe(10);
  });

  it("never runs two sends at the same time", async () => {
    let running = 0;
    let max = 0;
    const s = new SerialSender({
      getNonce: async () => 0,
      send: async (_c, n) => {
        running++;
        max = Math.max(max, running);
        await tick();
        running--;
        return `0x${n}` as `0x${string}`;
      },
    });
    await Promise.all(Array.from({ length: 8 }, (_, i) => s.submit(call(i))));
    expect(max).toBe(1);
  });

  it("a failed send does not wedge the queue and the next send re-reads the chain nonce", async () => {
    let chainNonce = 10;
    const sent: number[] = [];
    const s = new SerialSender({
      getNonce: async () => chainNonce,
      send: async (c, nonce) => {
        if (c.data === "0x01") throw new Error("insufficient funds");
        sent.push(nonce);
        chainNonce = nonce + 1;
        return `0x${nonce}` as `0x${string}`;
      },
    });
    await expect(s.submit(call(1))).rejects.toThrow("insufficient funds");
    await s.submit(call(2));
    await s.submit(call(3));
    expect(sent).toEqual([10, 11]);
  });

  it("retries once with a fresh chain nonce when the node says the nonce is too low", async () => {
    let chainNonce = 3;
    let first = true;
    const attempts: number[] = [];
    const s = new SerialSender({
      getNonce: async () => chainNonce,
      send: async (_c, nonce) => {
        attempts.push(nonce);
        if (first) {
          first = false;
          chainNonce = 7; // someone else used nonces meanwhile
          throw new Error("nonce too low: next nonce 7, tx nonce 3");
        }
        return `0x${nonce}` as `0x${string}`;
      },
    });
    await s.submit(call(1));
    expect(attempts).toEqual([3, 7]);
  });

  it("uses the chain's pending nonce when it is ahead of the local counter", async () => {
    let chainNonce = 0;
    const used: number[] = [];
    const s = new SerialSender({
      getNonce: async () => chainNonce,
      send: async (_c, n) => {
        used.push(n);
        return `0x${n}` as `0x${string}`;
      },
    });
    await s.submit(call(1)); // 0
    chainNonce = 20; // an out-of-band transaction
    await s.submit(call(2));
    expect(used).toEqual([0, 20]);
  });

  it("gives up after one retry so a stuck node cannot loop forever", async () => {
    let n = 0;
    const s = new SerialSender({
      getNonce: async () => 1,
      send: async () => {
        n++;
        throw new Error("nonce too low");
      },
    });
    await expect(s.submit(call(1))).rejects.toThrow("nonce too low");
    expect(n).toBe(2);
  });
});
