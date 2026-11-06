import { expect, it } from "vitest";
import { setup } from "./helpers/app";

// The web app renders its 404 pages from these statuses, so an unknown id must never come back as 200.
const hex = `0x${"ab".repeat(32)}`;
const paths = [
  "/pay/nope", `/pay/${hex}`, "/l/nope",
  "/pay/subscription/nope", "/pay/subscription/sub_unknown00000000", `/pay/subscription/${hex}`,
  "/public/claims/nope", `/public/claims/${hex}`,
  "/invest/claims/nope", `/invest/claims/${hex}`,
  "/store/nope/products", "/store/nope/products/mug",
];

it.each(paths)("%s answers 404 with a JSON error", async path => {
  const t = setup();
  const r = await t.req(path);
  expect(r.status).toBe(404);
  expect(r.headers.get("content-type")).toContain("application/json");
  const body = (await r.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("not_found");
  expect(body.error.message).toBeTruthy();
});

it("an unknown route also answers a JSON 404", async () => {
  const r = await setup().req("/store/nope/unknown/deep");
  expect(r.status).toBe(404);
  expect(((await r.json()) as any).error.code).toBe("not_found");
});
