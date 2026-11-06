// tsc writes extensionless relative imports in .d.ts files; Node-style resolution in consumers needs ".js".
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".d.ts"))) {
  const p = join(dir, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, b, c) => (/\.[cm]?js$/.test(b) ? m : `${a}${b}.js${c}`)));
}
