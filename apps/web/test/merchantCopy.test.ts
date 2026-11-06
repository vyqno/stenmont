import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Words a business owner should not meet on a merchant page (developer docs may use them). */
const BANNED = /\b(wbt|blockchain|seed phrase|gas)\b/i;
const root = join(__dirname, "..");
const CODE_ATTRS = new Set(["data-testid", "className", "href", "id", "key", "type", "name", "htmlFor", "role", "autoComplete", "inputMode", "pattern", "src"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Words people read: JSX text and sentences in strings. Identifiers, class names, test ids and paths are skipped. */
export function visibleCopy(source: string): string[] {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isJsxAttribute(n) && CODE_ATTRS.has(n.name.getText())) return;
    if (ts.isJsxText(n)) out.push(n.text);
    else if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = n.text;
      if (/\s/.test(t.trim()) && !t.startsWith("/") && !t.startsWith("http")) out.push(t);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("merchant copy", () => {
  it("finds the words it is meant to ban", () => {
    expect(visibleCopy('const a = <p>Set aside 0.01 WBT</p>').join(" ")).toMatch(BANNED);
    expect(visibleCopy('const a = <p data-testid="gas tank" className="gas x">Fee credit</p>').join(" ")).not.toMatch(BANNED);
  });

  const targets = [
    ...files(join(root, "app/dashboard")),
    ...["WebhookEndpoints", "WorldVerify", "SellButton", "RefundButton", "ConnectedApps", "IdentitySignIn", "AgentAllowance", "RouterDelegation"].map((n) => join(root, `components/${n}.tsx`)),
    join(root, "lib/financingTimeline.ts"),
    join(root, "lib/webhooks.ts"),
    join(root, "app/claim/[id]/CertificateClient.tsx"),
    join(root, "lib/certificate.ts"),
  ];
  it.each(targets.map((t) => [t.slice(root.length + 1), t]))("%s has no jargon", (_name, path) => {
    const bad = visibleCopy(readFileSync(path, "utf8")).filter((t) => BANNED.test(t));
    expect(bad).toEqual([]);
  });
});

describe("primary buttons", () => {
  it("are ink, never the bright accent blue (shared primaryButton token)", () => {
    const bad = [...files(join(root, "app")), ...files(join(root, "components"))]
      .filter((f) => !/app\/(docs|page\.tsx)/.test(f) && !f.includes("components/brand"))
      .filter((f) => /<button[^>]*bg-brand/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
