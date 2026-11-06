import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EVENT_TYPES } from "../../../services/api/src/events";
import { createTools } from "../../../services/mcp/src/index";
import { publicPaths } from "../lib/seo";

it("keeps every public docs page, current webhook event and MCP capability in the agent references", () => {
  const short = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
  const full = readFileSync(new URL("../public/llms-full.txt", import.meta.url), "utf8");
  for (const path of publicPaths.filter(p => p.startsWith("/docs"))) expect(short).toContain(`https://app-staging.stenmont.com${path}`);
  for (const event of EVENT_TYPES) expect(full).toContain(event);
  for (const tool of createTools({ apiUrl: "https://api.example", appUrl: "https://app.example", fetch })) expect(full).toContain(tool.name);
  expect(full).toContain("A2A-Version: 1.0");
  expect(full).toContain("/v1/books/");
  expect(full).toContain("already-funded");
  expect(full).not.toContain("An agent cannot pay on their behalf");
});
