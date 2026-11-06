const MAX = 50_000;
const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "a", "span", "hr", "sub", "sup", "code", "pre"]);
const VOID = new Set(["br", "hr"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript", "textarea", "title"]);

const escText = (s: string) => s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#x[0-9a-fA-F]{1,6};)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Only absolute http(s) and mailto links survive. Browsers ignore tabs, newlines and controls inside a scheme, so strip them first. */
function safeHref(raw: string): string | null {
  const v = raw.replace(/&#(x?)([0-9a-f]+);?/gi, (_m, hex, n) => String.fromCodePoint(Math.min(parseInt(n, hex ? 16 : 10) || 0, 0x10ffff))).replace(/[\u0000- \u007f-\u009f]/g, "");
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(v) ? v : null;
}

/** An allow-list sanitiser for product descriptions: everything not listed is dropped, nothing is ever passed through raw. */
export function sanitizeHtml(input: string): string {
  const html = input.slice(0, MAX); // cut the input, never the output: a cut output could end inside a tag
  const tagRe = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>?/g;
  let out = "";
  const stack: string[] = [];
  let last = 0;
  let skipUntil: string | null = null;
  for (const m of html.matchAll(tagRe)) {
    const index = m.index!;
    const [whole, name, attrs = ""] = m;
    if (skipUntil === null) out += escText(html.slice(last, index));
    last = index + whole.length;
    if (!name) continue; // comment
    const tag = name.toLowerCase();
    const closing = whole.startsWith("</");
    if (skipUntil !== null) {
      if (closing && tag === skipUntil) skipUntil = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !whole.endsWith("/>")) skipUntil = tag;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    if (tag === "a") {
      const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(` ${attrs}`);
      const safe = href ? safeHref(href[1] ?? href[2] ?? href[3] ?? "") : null;
      out += safe ? `<a href="${escAttr(safe)}" rel="noopener noreferrer nofollow">` : "<a>";
    } else out += `<${tag}>`;
    if (!VOID.has(tag)) stack.push(tag);
  }
  if (skipUntil === null) out += escText(html.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}
