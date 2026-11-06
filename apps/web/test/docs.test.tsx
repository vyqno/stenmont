import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as sdk from "@stenmont/sdk";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as agent from "../../../packages/agent/src";
import * as react from "../../../packages/react/src";
import * as x402 from "../../../packages/x402/src";
import { renderToStaticMarkup } from "react-dom/server";
import Api from "../app/docs/api/page";
import Mcp from "../app/docs/mcp/page";
import Quickstart from "../app/docs/page";
import Sdk from "../app/docs/sdk/page";
import Webhooks from "../app/docs/webhooks/page";
import X402 from "../app/docs/x402/page";
import Faq from "../app/docs/faq/page";
import { API_URL, APP_URL, MCP_URL, SAMPLES, X402_URL } from "../lib/docSamples";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "../../..");
const web = join(import.meta.dirname, "..");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
const secret = "whsec_docs_test";
const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", created: 1, data: { invoice: { id: "invoice-right", status: "paid", amount: "25", amountPaid: "25", metadata: { order: "1042" } } }, livemode: false });
const now = 1_793_960_000;

describe("webhook verification samples agree with the signer", () => {
  it("the Node sample accepts a good signature and refuses a wrong one, a changed body and an old timestamp", async () => {
    const verify = new Function("require", `${SAMPLES.verifyNode.code}\nreturn verifyStenmont;`)(require) as (b: string, h: string, s: string, n?: number) => unknown;
    const good = await sdk.signWebhook(secret, body, now);
    expect(verify(body, good, secret, now + 10)).toMatchObject({ type: "invoice.paid" });
    expect(() => verify(body, good, "whsec_other", now)).toThrow(/invalid signature/);
    expect(() => verify(body + " ", good, secret, now)).toThrow(/invalid signature/);
    expect(() => verify(body, good, secret, now + 301)).toThrow(/window/);
    expect(() => verify(body, "nonsense", secret, now)).toThrow(/malformed/);
  });
  it("the Node sample accepts either signature while a secret is being rotated", async () => {
    const verify = new Function("require", `${SAMPLES.verifyNode.code}\nreturn verifyStenmont;`)(require) as (b: string, h: string, s: string, n?: number) => unknown;
    const good = await sdk.signWebhook(secret, body, now);
    const rotated = `t=${now},v1=${"0".repeat(64)},${good.split(",")[1]}`;
    expect(verify(body, rotated, secret, now)).toBeTruthy();
  });
  it("the SDK verifies what the Node sample's rules describe", async () => {
    const good = await sdk.signWebhook(secret, body, now);
    await expect(sdk.verifyWebhook(body, good, secret, { now })).resolves.toMatchObject({ id: "evt_1" });
  });
  const python = spawnSync("python3", ["-I", "-c", "print(1)"]).status === 0;
  it.skipIf(!python)("the Python sample gives the same verdicts", async () => {
    const good = await sdk.signWebhook(secret, body, now);
    const run = (b: string, h: string, n: number) =>
      spawnSync("python3", ["-I", "-c", `${SAMPLES.verifyPython.code}\nimport sys\nprint(verify_stenmont(sys.argv[1].encode(), sys.argv[2], sys.argv[3], float(sys.argv[4]))["type"])`, b, h, secret, String(n)], { encoding: "utf8" });
    expect(run(body, good, now + 5).stdout.trim()).toBe("invoice.paid");
    expect(run(body + " ", good, now).status).not.toBe(0);
    expect(run(body, good, now + 301).status).not.toBe(0);
  });
});

/** The sample as running code: types removed, imports dropped (the test supplies those names), `export` removed. */
const runnable = (code: string) =>
  ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .*$/gm, "").replaceAll("export ", "");

describe("integration sample safety", () => {
  it("reuses a persisted checkout key rather than generating one per attempt", () => {
    for (const name of ["createInvoiceFetch", "sdkCheckout"] as const) {
      expect(SAMPLES[name].code).toContain("order.checkoutKey");
      expect(SAMPLES[name].code).not.toContain("crypto.randomUUID()");
      expect(SAMPLES[name].code).toContain("saveInvoice");
    }
  });
  it("binds signed paid events to the stored invoice and amount before fulfilment", async () => {
    const paid: string[] = [];
    const make = new AsyncFunction("verifyWebhook", "process", `${runnable(SAMPLES.sdkWebhook.code)}\nreturn handleWebhook;`);
    const handle = await make(sdk.verifyWebhook, { env: { STENMONT_WEBHOOK_SECRET: secret } }) as (...args: unknown[]) => Promise<unknown>;
    const orders = { get: async () => ({ invoiceId: "invoice-right", total: "25" }), markPaidOnce: async (id: string) => paid.push(id) };
    for (const invoice of [{ id: "invoice-wrong", amount: "25", amountPaid: "25" }, { id: "invoice-right", amount: "250", amountPaid: "250" }, { id: "invoice-right", amount: "25", amountPaid: "2" }]) {
      const raw = JSON.stringify({ id: "event", type: "invoice.paid", data: { invoice: { ...invoice, status: "paid", metadata: { order: "1042" } } } });
      await expect(handle(raw, await sdk.signWebhook(secret, raw), orders)).rejects.toThrow(/mismatch/);
    }
    expect(paid).toEqual([]);
  });
});

describe("SDK samples run against the real SDK", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createCheckout (SDK) calls POST /v1/invoices with the key and returns the pay page", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: "0xabc", payUrl: `${APP_URL}/pay/0xabc` }, { status: 201 });
    });
    const make = new AsyncFunction("Stenmont", "process", `${runnable(SAMPLES.sdkCheckout.code)}\nreturn createCheckout;`);
    const createCheckout = (await make(sdk.Stenmont, { env: { STENMONT_API_KEY: "sk_test_x", STENMONT_API_URL: API_URL } })) as (o: object, saveInvoice: (...args: unknown[]) => Promise<void>) => Promise<string>;
    expect(await createCheckout({ id: "1042", total: "25.00", checkoutKey: "persisted-checkout-key" }, async () => {})).toBe(`${APP_URL}/pay/0xabc`);
    expect(calls[0]!.url).toBe(`${API_URL}/v1/invoices`);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_x");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ amount: "25.00", metadata: { order: "1042" } });
  });

  it("the webhook handler (SDK) accepts a signed event and refuses a forged one", async () => {
    const paid: unknown[] = [];
    const make = new AsyncFunction("verifyWebhook", "process", "markOrderPaid", `${runnable(SAMPLES.sdkWebhook.code)}\nreturn handleWebhook;`);
    const handler = await make(sdk.verifyWebhook, { env: { STENMONT_WEBHOOK_SECRET: secret } }, async () => {}) as (...args: unknown[]) => Promise<unknown>;
    const handle = (b: string, h: string) => handler(b, h, { get: async () => ({ invoiceId: "invoice-right", total: "25.00" }), markPaidOnce: async (id: string) => paid.push(id) });
    const signed = await sdk.signWebhook(secret, body);
    await handle(body, signed);
    expect(paid).toEqual(["1042"]);
    await expect(handle(body, await sdk.signWebhook("whsec_wrong", body))).rejects.toThrow();
    expect(paid).toHaveLength(1);
  });

  it("createCheckout (plain fetch) sends the headers the API needs", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ payUrl: "https://pay.example/x" }, { status: 201 });
    };
    const make = new AsyncFunction("fetch", "process", `${SAMPLES.createInvoiceFetch.code}\nreturn createCheckout;`);
    const createCheckout = (await make(fakeFetch, { env: { STENMONT_API_KEY: "sk_test_x", STENMONT_API_URL: API_URL } })) as (o: object, saveInvoice: (...args: unknown[]) => Promise<void>) => Promise<string>;
    expect(await createCheckout({ id: "7", total: "3.50", checkoutKey: "persisted-checkout-key" }, async () => {})).toBe("https://pay.example/x");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer sk_test_x");
    expect(h["idempotency-key"]).toBe("persisted-checkout-key");
    expect(Object.keys(JSON.parse(calls[0]!.init.body as string))).toEqual(["amount", "successUrl", "cancelUrl", "metadata"]);
  });

  it("every code sample is syntactically valid", () => {
    for (const [name, s] of Object.entries(SAMPLES)) {
      if (s.lang === "json") expect(() => JSON.parse(s.code.replaceAll("…", "x").replace("${STENMONT_API_KEY}", "k")), name).not.toThrow();
      if (s.lang === "js" || s.lang === "ts" || s.lang === "tsx") {
        const out = ts.transpileModule(s.code, { reportDiagnostics: true, fileName: `${name}.${s.lang}`, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
        expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), name).toEqual([]);
      }
    }
  });

  it("every call in the SDK samples exists on the client", () => {
    const client = new sdk.Stenmont({ apiKey: "k" }) as unknown as Record<string, unknown>;
    const code = SAMPLES.sdkCheckout.code + SAMPLES.sdkMore.code + SAMPLES.sdkWebhook.code;
    const paths = [...code.matchAll(/stenmont\.([a-zA-Z]+(?:\.[a-zA-Z]+)*)\(/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(6);
    for (const p of paths) {
      const target = p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], client);
      expect(typeof target, p).toBe("function");
    }
  });

  it("every name imported from a Stenmont package exists", () => {
    const modules: Record<string, object> = { "@stenmont/sdk": sdk, "@stenmont/react": react, "@stenmont/x402": x402, "@stenmont/agent": agent };
    let imports = 0;
    for (const { code } of Object.values(SAMPLES)) {
      for (const m of code.matchAll(/import \{([^}]+)\} from "(@stenmont\/[a-z0-9]+)"/g)) {
        for (const name of m[1]!.split(",").map((n) => n.trim())) {
          imports++;
          expect(Object.keys(modules[m[2]!]!), `${name} from ${m[2]}`).toContain(name);
        }
      }
    }
    expect(imports).toBeGreaterThanOrEqual(5);
  });
});

describe("addresses and routes in the docs are real", () => {
  const apiApp = readFileSync(join(root, "services/api/src/app.ts"), "utf8");
  const routes = new Set([...apiApp.matchAll(/v1\.route\("\/([a-z-]+)"/g)].map((m) => m[1]));
  const text = [...Object.values(SAMPLES).map((s) => s.code), readFileSync(join(web, "public/llms.txt"), "utf8"), readFileSync(join(web, "public/llms-full.txt"), "utf8")].join("\n");

  it("every /v1/ path starts with a route the API registers", () => {
    const used = [...text.matchAll(/\/v1\/([a-z-]+)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(5);
    for (const u of used) expect(routes.has(u), u).toBe(true);
  });
  it("every Stenmont address matches a real staging host", () => {
    const hosts = new Set([API_URL, APP_URL, MCP_URL, X402_URL, "https://shop-staging.stenmont.com"].map((u) => new URL(u).host));
    for (const m of text.matchAll(/https:\/\/([a-z0-9-]+\.stenmont\.com)/g)) expect(hosts.has(m[1]!), m[1]).toBe(true);
  });
  it("the hosts match the Workers' own config", () => {
    expect(readFileSync(join(root, "services/mcp/wrangler.jsonc"), "utf8")).toContain(new URL(MCP_URL).host);
    expect(readFileSync(join(root, "services/facilitator/wrangler.jsonc"), "utf8")).toContain(new URL(X402_URL).host);
    expect(readFileSync(join(root, "services/api/wrangler.jsonc"), "utf8")).toContain(new URL(API_URL).host);
  });
});

describe("llms.txt and the docs pages", () => {
  const llms = readFileSync(join(web, "public/llms.txt"), "utf8");
  const full = readFileSync(join(web, "public/llms-full.txt"), "utf8");
  const pages = ["", "api", "webhooks", "sdk", "mcp", "x402", "faq"];

  it("every docs page exists and is linked from llms.txt", () => {
    for (const p of pages) {
      expect(existsSync(join(web, "app/docs", p, "page.tsx")), `app/docs/${p}/page.tsx`).toBe(true);
      expect(llms).toContain(`${APP_URL}/docs${p ? "/" + p : ""}`);
    }
  });
  it("llms.txt follows the llms.txt shape and points at the full file", () => {
    expect(llms.startsWith("# Stenmont\n")).toBe(true);
    expect(llms).toMatch(/^> .+/m);
    expect(llms).toContain(`${APP_URL}/llms-full.txt`);
    for (const name of ["STENMONT_API_KEY", "STENMONT_WEBHOOK_SECRET", "Stenmont-Signature", "Idempotency-Key"]) expect(llms).toContain(name);
  });
  it("llms-full.txt carries every code sample verbatim, so the two cannot drift", () => {
    for (const [name, s] of Object.entries(SAMPLES)) expect(full, name).toContain(s.code);
  });
  it("llms files hold no key or secret", () => {
    for (const t of [llms, full]) expect(t).not.toMatch(/sk_test_[0-9a-f]{32}|whsec_[0-9a-f]{20,}/);
  });
  it("there is a docs layout and no stray page the tests do not know about", () => {
    const dirs = readdirSync(join(web, "app/docs"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(dirs.sort()).toEqual(pages.filter(Boolean).sort());
  });
});

describe("docs pages render", () => {
  const html = [Quickstart, Api, Webhooks, Sdk, Mcp, X402, Faq].map((P) => renderToStaticMarkup(<P />));
  it("every sample appears on at least one page, and no page shows a placeholder", () => {
    const all = html.join("\n");
    for (const name of Object.keys(SAMPLES)) expect(all, name).toContain(`data-sample="${name}"`);
    expect(all).not.toMatch(/undefined|\[object Object\]/);
  });
  it("pages say plainly that the test network is in use and the packages are not on npm yet", () => {
    expect(html[0]).toContain("test network");
    expect(html[3]).toContain("not on npm yet");
  });
});
