import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { expect, it } from "vitest";
import { ROUTES, baseMetadata } from "../lib/seo";

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? pages(join(dir, e.name)) : e.name === "page.tsx" ? [join(dir, e.name)] : []);
}
it("accounts for every current page, including private client pages, without a home canonical inherited by children", () => {
  const app = join(import.meta.dirname, "../app");
  const inventory = pages(app).map(file => ({ file, path: "/" + relative(app, dirname(file)).replaceAll("\\", "/") }));
  expect(inventory.map(p => p.path).sort()).toEqual(Object.keys(ROUTES).sort());
  for (const { file, path } of inventory) {
    const source = readFileSync(file, "utf8");
    const layout = join(dirname(file), "layout.tsx");
    let boundary = source;
    if (source.startsWith('"use client"')) boundary = readFileSync(layout, "utf8");
    expect(boundary, path).toContain(`pageMetadata("${path}")`);
  }
  expect(baseMetadata().alternates).toBeUndefined();
  expect(baseMetadata().openGraph).not.toHaveProperty("url");
});
