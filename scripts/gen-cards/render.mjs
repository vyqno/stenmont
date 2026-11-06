// Renders the Stenmont story cards: node scripts/gen-cards/render.mjs [--slide 03]
// One Chromium at a time. Serves the folder on localhost so the Adobe Fonts kit (domain list includes localhost) loads.
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "brand-guidelines/assets/cards");
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const only = process.argv.includes("--slide") ? process.argv[process.argv.indexOf("--slide") + 1] : null;
const KIT = "https://use.typekit.net/szp4mzp.css";
const tokens = readFileSync(join(here, "tokens.css"), "utf8");
const slides = readdirSync(join(here, "slides")).filter((f) => f.endsWith(".html")).sort();
const ICONS = {
  "{{ok}}": '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#17643B"/><path d="M6.6 12.4l3.6 3.6 7-7.2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  "{{tick}}": '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#548CFF"/><path d="M6.6 12.4l3.6 3.6 7-7.2" fill="none" stroke="#050505" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const partial = (h) => h.replace(/\{\{>(\w+)\}\}/g, (_, n) => readFileSync(join(here, "partials", n + ".html"), "utf8"));
const frag = (f) => Object.entries(ICONS).reduce((h, [k, v]) => h.replaceAll(k, v), partial(readFileSync(join(here, "slides", f), "utf8")));
const page = (body, w, h) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${KIT}"><style>${tokens}\n@page{size:${w}px ${h}px;margin:0}</style></head><body>${body}</body></html>`;
const size = (f) => (f.startsWith("wide") ? [1920, 1080] : [1080, 1350]);

mkdirSync(out, { recursive: true });
if (!only) for (const f of readdirSync(out)) if (f.endsWith(".png") || f.endsWith(".pdf")) unlinkSync(join(out, f)); // drop stale slides
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p.startsWith("/out/")) { try { const b = readFileSync(join(out, p.slice(5))); res.setHeader("content-type", "image/png"); return res.end(b); } catch { res.statusCode = 404; return res.end(); } }
  res.setHeader("content-type", "text/html"); res.end(globalThis.__html ?? "");
}).listen(0);
const port = server.address().port;
const origin = `http://localhost:${port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const pg = await ctx.newPage();
async function load(html, w, h) {
  globalThis.__html = html;
  await pg.setViewportSize({ width: w, height: h });
  await pg.goto(origin + "/", { waitUntil: "networkidle" });
  await pg.evaluate(() => document.fonts.ready);
  // the real kit must have rendered: check that loaded FontFace entries exist (document.fonts.check is true for unknown families)
  const ok = await pg.evaluate(async () => {
    await Promise.all(["700 40px neue-haas-grotesk-display", "400 20px neue-haas-grotesk-text", "700 20px neue-haas-grotesk-text", "400 20px all-round-gothic"].map((f) => document.fonts.load(f)));
    const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "") + f.weight);
    return ["neue-haas-grotesk-display700", "neue-haas-grotesk-text400", "neue-haas-grotesk-text700", "all-round-gothic400"].map((k) => loaded.includes(k));
  });
  if (ok.some((v) => !v)) throw new Error("Adobe Fonts kit did not load: " + ok);
}

const done = [];
for (const f of slides) {
  const id = f.replace(".html", "");
  if (only && !id.startsWith(only)) continue;
  const [w, h] = size(f);
  await load(page(frag(f), w, h), w, h);
  const overflow = await pg.evaluate(() => { const bad = []; document.querySelectorAll(".slide *").forEach((e) => { if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === "visible" && e.children.length === 0 && e.clientWidth > 0) bad.push(e.className + ":" + e.textContent.slice(0, 30)); }); return bad; });
  if (overflow.length) console.warn(id, "possible text overflow:", overflow.join(" | "));
  await pg.screenshot({ path: join(out, id + ".png"), clip: { x: 0, y: 0, width: w, height: h } });
  done.push(id); console.log("rendered", id);
}

if (!only) {
  // contact sheet (8 portrait slides) and the combined PDF
  const portrait = done.filter((d) => !d.startsWith("wide"));
  const cs = `<style>${tokens}</style><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:20px;background:#E8E9EC;width:2400px">${portrait.map((d) => `<img src="${origin}/out/${d}.png" style="width:100%;border-radius:10px;display:block">`).join("")}</div>`;
  globalThis.__html = `<!doctype html><body style="margin:0">${cs}`;
  await pg.setViewportSize({ width: 2400, height: 1600 });
  await pg.goto(origin + "/", { waitUntil: "networkidle" });
  await pg.screenshot({ path: join(out, "contact-sheet.png"), fullPage: true });
  const body = portrait.map((d) => frag(d + ".html")).join('<div style="break-after:page"></div>');
  await load(page(body, 1080, 1350), 1080, 1350);
  await pg.addStyleTag({ content: ".slide{break-after:page;page-break-after:always}" });
  await pg.pdf({ path: join(out, "stenmont-story.pdf"), width: "1080px", height: "1350px", printBackground: true, pageRanges: "1-8" });
  console.log("contact sheet + pdf written");
}
await browser.close(); server.close();
