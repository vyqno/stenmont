import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../../src/catalog/sanitize";

describe("sanitizeHtml", () => {
  it("keeps a small safe set of tags", () => {
    expect(sanitizeHtml("<p>Hello <strong>world</strong></p><ul><li>a</li></ul>")).toBe("<p>Hello <strong>world</strong></p><ul><li>a</li></ul>");
  });
  it("removes scripts and styles together with their content", () => {
    expect(sanitizeHtml("<p>ok</p><script>alert(1)</script><style>p{}</style>")).toBe("<p>ok</p>");
    expect(sanitizeHtml("<SCRIPT >alert(1)</SCRIPT>x")).toBe("x");
  });
  it("drops event handlers and unknown attributes", () => {
    expect(sanitizeHtml('<p onclick="x()" style="color:red" class="a">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe("");
  });
  it("only allows http, https and mailto links, and adds rel", () => {
    expect(sanitizeHtml('<a href="https://shop.example/a?b=1&c=2">x</a>')).toBe('<a href="https://shop.example/a?b=1&amp;c=2" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="  JaVa\nScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="data:text/html;base64,AAAA">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="//evil.example">x</a>')).toBe("<a>x</a>");
  });
  it("escapes stray angle brackets and bare ampersands, keeps entities", () => {
    expect(sanitizeHtml("1 < 2 & 3 &amp; 4 > 0")).toBe("1 &lt; 2 &amp; 3 &amp; 4 &gt; 0");
    expect(sanitizeHtml("<<script>alert(1)//<</script>")).not.toMatch(/<script/i);
  });
  it("closes unclosed tags and ignores stray closers", () => {
    expect(sanitizeHtml("<p><b>bold")).toBe("<p><b>bold</b></p>");
    expect(sanitizeHtml("</div>text</p>")).toBe("text");
  });
  it("drops comments, iframes and svg", () => {
    expect(sanitizeHtml("a<!-- <script>x</script> -->b")).toBe("ab");
    expect(sanitizeHtml('<iframe src="https://x"></iframe>c<svg onload=alert(1)></svg>')).toBe("c");
  });
  it("limits length", () => {
    expect(sanitizeHtml("a".repeat(100_000)).length).toBeLessThanOrEqual(50_000);
  });
});
