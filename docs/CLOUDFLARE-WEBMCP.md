# The `/.webmcp/bridge.js` console warning

Every page on the web app and the demo shop logs `[webmcp-interceptor] document.modelContext is not available` and requests `https://<host>/.webmcp/bridge.js` (QA D9).

## Where it comes from

Not from this repository: no source file, config or build step mentions `webmcp`. It is Cloudflare's WebMCP developer-preview feature, which injects a script tag into HTML at the edge and serves the bridge from the site's own origin. The warning appears because the browser does not provide `document.modelContext` (the WebMCP browser API).

## How to turn it off (not done; an account setting)

1. Cloudflare dashboard, choose the `stenmont.com` zone.
2. Open **Agent Readiness** (shown under Labs in some accounts) and find **WebMCP**.
3. Switch it off, or deselect the tool packs (`c2pa`, `mcp-server-client`).
4. Check: `curl -s https://app-staging.stenmont.com/ | grep -c webmcp` should print `0` after the edge cache is purged.

The exact label may differ by dashboard version; the Cloudflare WebMCP blog post describes the feature. Leaving it on is harmless: the warning is a console message only. Our own agent interface is the MCP server at `mcp-staging.stenmont.com` and `llms.txt`, which do not depend on it.
