import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentView } from "../app/oauth/authorize/ConsentView";
import { parseAuthorizeQuery, safeNext, safeReturn, scopeWords, signInHref } from "../lib/oauth";

describe("authorization query", () => {
  it("keeps only the OAuth parameters, as plain strings", () => {
    const p = parseAuthorizeQuery("?response_type=code&client_id=mcp_1&redirect_uri=https%3A%2F%2Fa.example%2Fcb&code_challenge=abc&code_challenge_method=S256&scope=read+draft&state=s&evil=1&state=second");
    expect(p).toEqual({ response_type: "code", client_id: "mcp_1", redirect_uri: "https://a.example/cb", code_challenge: "abc", code_challenge_method: "S256", scope: "read draft", state: "s" });
  });
  it("drops absurdly long values", () => {
    expect(parseAuthorizeQuery(`?state=${"x".repeat(3000)}&client_id=a`)).toEqual({ client_id: "a" });
  });
});

describe("scopes in plain words", () => {
  it("explains each permission, and says refunds are only prepared", () => {
    const words = scopeWords(["read", "draft", "write"]);
    expect(words).toHaveLength(3);
    expect(words[0]).toMatch(/see/i);
    expect(words[1]).toMatch(/prepare/i);
    expect(words[1]).toMatch(/passkey/i);
  });
  it("shows an unknown permission as unknown rather than hiding it", () => {
    expect(scopeWords(["admin"])[0]).toMatch(/unknown/i);
  });
});

describe("coming back after sign-in", () => {
  it("builds a sign-in link that returns to the same request", () => {
    const href = signInHref("/oauth/authorize?client_id=a&state=b");
    expect(href).toBe("/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Da%26state%3Db");
    expect(safeNext(href.slice(href.indexOf("?")))).toBe("/oauth/authorize?client_id=a&state=b");
  });
  it("only ever returns to a path on this site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil"]) {
      expect(safeNext(`?next=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
    expect(safeNext("")).toBeNull();
  });
  it("sends the visitor on to the app only by web address", () => {
    expect(safeReturn("https://agent.example/cb?code=1")).toBe("https://agent.example/cb?code=1");
    expect(safeReturn("http://localhost:8123/cb?code=1")).toBe("http://localhost:8123/cb?code=1");
    expect(safeReturn("javascript:alert(1)")).toBeNull();
    expect(safeReturn("data:text/html,x")).toBeNull();
    expect(safeReturn("nonsense")).toBeNull();
  });
});

describe("consent screen", () => {
  const props = { client: { name: "Cool Agent" }, redirectHost: "agent.example", scopes: ["read", "draft"], business: "Acme", busy: false, onDecide: () => {} };
  it("names the app, where it returns, the business and what it may do", () => {
    const html = renderToStaticMarkup(<ConsentView {...props} />);
    expect(html).toContain("Cool Agent");
    expect(html).toContain("agent.example");
    expect(html).toContain("Acme");
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
    expect(html).toMatch(/prepare/i);
  });
  it("shows an app name as text, never as markup", () => {
    const html = renderToStaticMarkup(<ConsentView {...props} client={{ name: "<img src=x onerror=alert(1)>" }} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("disables both buttons while a decision is being sent", () => {
    const html = renderToStaticMarkup(<ConsentView {...props} busy />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
