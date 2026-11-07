/** Agents get a character: a name and a little pixel face drawn from their ENS label, so the same agent always looks the same.
 *  Purely decorative; the real name stays next to it. */
const FIRST = ["Penny", "Ledger", "Marlow", "Juno", "Atlas", "Pixel", "Quill", "Nova", "Bolt", "Echo", "Sprout", "Tally"];
const LAST = ["the Bookkeeper", "the Closer", "the Collector", "the Scout", "the Auditor", "the Courier", "the Clerk", "the Watcher"];

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function agentCharacter(seed: string) {
  const h = hash(seed || "agent");
  return { name: `${FIRST[h % FIRST.length]} ${LAST[(h >> 7) % LAST.length]}`, bits: h };
}

export function AgentAvatar({ seed, size = 44 }: { seed: string; size?: number }) {
  const { bits } = agentCharacter(seed);
  const N = 8, cells: [number, number][] = [];
  let b = bits;
  for (let y = 1; y < 7; y++) for (let x = 0; x < 4; x++) { b = Math.imul(b ^ (b >>> 15), 2246822507) >>> 0; if ((b & 3) !== 0 || y === 3 && x > 0) { cells.push([x, y]); cells.push([N - 1 - x, y]); } }
  const eyes = [2, 5];
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" role="img" aria-label="Agent avatar" className="agent-avatar" shapeRendering="crispEdges">
      <rect width="8" height="8" fill="#ebf1ff" />
      {cells.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" fill="#548cff" />)}
      {eyes.map((x) => <rect key={x} x={x} y={3} width="1" height="1" fill="#050505" />)}
    </svg>
  );
}
