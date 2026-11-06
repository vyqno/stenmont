# Demo shop response headers

The demo shop (`demo-shop-staging.stenmont.com`) lives in its own repository, `vyqno/stenmont-demo-shop`, not in this one. The QA sweep (2026-11-06, D11) found it sends no CSP, no frame protection, no `nosniff` and no HSTS. Make this change there, in the Worker that serves every response (a Hono `app.use("*")` after `next()`, or a wrapper around `fetch`).

## Headers to add on every response

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS hosts only) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | see below |

## Baseline CSP

The shop sends visitors to Stenmont's hosted pay page by navigation, so it needs no third-party script, frame or connect origin beyond its own API.

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; form-action 'self' https://app-staging.stenmont.com https://app.stenmont.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

- Roll it out as `Content-Security-Policy-Report-Only` first, load every page once (home, product, cart, orders, about), and switch to enforcing when nothing is reported. Drop `'unsafe-inline'` from `script-src` only if the shop's framework supports nonces.
- If the shop loads webfonts or analytics from a CDN, add exactly that origin to `font-src` / `script-src` / `connect-src`.
- Redirects to the pay page are navigations, so `form-action` only matters if the cart posts a form straight to Stenmont.

## Sketch

```ts
const SECURITY = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": CSP,
};
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(SECURITY)) c.res.headers.set(k, v);
  if (new URL(c.req.url).protocol === "https:") c.res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
});
```

Also fix in that repo (QA D20): the `/api/session` rate limit is hit after about six page loads from one IP, which breaks repeated recording takes.
