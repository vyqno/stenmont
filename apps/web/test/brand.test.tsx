import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../app/page";

const css = () => readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const token = (name: string) => {
  const value = css().match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing colour token: ${name}`);
  return value;
};
const luminance = (hex: string) => hex.slice(1).match(/../g)!.map((h) => parseInt(h, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
};
describe("brand accessibility", () => {
  it("uses the approved palette and a readable on-brand foreground", () => {
    expect(token("bg")).toBe("#ffffff");
    expect(token("text")).toBe("#050505");
    expect(token("blue")).toBe("#548cff");
    expect(token("grey")).toBe("#e8e9ec");
    expect(contrast(token("on-brand"), token("blue"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", token("blue"))).toBeLessThan(4.5);
    expect(css()).toContain("--color-on-brand: var(--on-brand)");
  });
  it("keeps muted copy and required control boundaries readable", () => {
    expect(contrast(token("text-2"), token("bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("control"), token("bg"))).toBeGreaterThanOrEqual(3);
    expect(css()).toContain(":focus-visible");
    expect(css()).toContain("prefers-reduced-motion");
  });
  it("explains financing conditions and the test network beside the platform headline", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Connect your store in one click. Get paid in USDT. Tokenize what you");
    expect(html).toContain("eligibility, human approval and investor funding apply");
    expect(html).toContain("test network");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/docs"');
  });
});
