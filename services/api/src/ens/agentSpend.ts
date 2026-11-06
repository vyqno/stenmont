type BlockPoint = { number: bigint; timestamp: bigint };

/**
 * The first block of a window of `windowSeconds` ending at `latest`, from the block time measured between `sample` and `latest`.
 * Approximate by design (it rounds the window up, so it can include a few blocks too many, never too few). When the block time
 * cannot be measured it looks back `maxBlocks`. Never below block 0 and never further back than `maxBlocks`.
 */
export function windowStartBlock(a: { latest: BlockPoint; sample: BlockPoint; windowSeconds: number; maxBlocks: bigint }): bigint {
  const blocks = a.latest.number - a.sample.number;
  const seconds = a.latest.timestamp - a.sample.timestamp;
  let back = a.maxBlocks;
  if (blocks > 0n && seconds > 0n) {
    const needed = (BigInt(a.windowSeconds) * blocks + seconds - 1n) / seconds; // ceil(window / blockTime)
    if (needed < back) back = needed;
  }
  return a.latest.number > back ? a.latest.number - back : 0n;
}
