import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { zeroAddress } from "viem";

const fixture = vi.hoisted(() => ({ payerLock: undefined as string | null | undefined }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (initial && typeof initial === "object" && "kind" in initial && initial.kind === "loading") {
        return [{ kind: "ready", invoice: {
          id: `0x${"ab".repeat(32)}`, number: "INV-1", status: "open",
          amount: "1", amountPaid: "0", remaining: "1", merchantName: "Sample merchant",
          successUrl: null, cancelUrl: null, payerLock: fixture.payerLock,
        } }, vi.fn()];
      }
      return react.useState(initial);
    },
  };
});
import PayClient from "../app/pay/[id]/PayClient";

beforeEach(() => vi.stubGlobal("location", { hostname: "app-staging.stenmont.com" }));
afterEach(() => vi.unstubAllGlobals());

it.each([undefined, null, zeroAddress])("does not reserve an unrestricted invoice for buyer %s", (payerLock) => {
  fixture.payerLock = payerLock;
  const html = renderToStaticMarkup(<PayClient id={`0x${"ab".repeat(32)}`} />);
  expect(html).toContain("Sample merchant");
  expect(html).not.toContain("Reserved for buyer");
});

it("shows the actual named buyer for a restricted invoice", () => {
  const buyer = `0x${"12".repeat(20)}`;
  fixture.payerLock = buyer;
  const html = renderToStaticMarkup(<PayClient id={`0x${"ab".repeat(32)}`} />);
  expect(html).toContain(`Reserved for buyer ${buyer}.`);
});
