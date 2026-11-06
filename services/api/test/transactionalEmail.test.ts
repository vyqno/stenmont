import { describe, expect, it } from "vitest";
import { deliverEmail, renderEmail, type MailKind } from "../src/email/transactional";
const kinds: MailKind[] = ["receipt", "invoice", "reminder", "refund", "payout", "large-refund-approval", "email-code"];
const input = { business: "Acme <script>", reference: "INV-104", amount: "12.50 USDT", actionUrl: "https://app-staging.stenmont.com/dashboard", code: "12345678" };
describe("transactional email", () => {
  it.each(kinds)("renders accessible HTML and plain text for %s", (kind) => {
    const mail = renderEmail(kind, input);
    expect(mail.html).toContain('lang="en"');
    expect(mail.html).toContain('<h1');
    expect(mail.html).toContain('#548CFF');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain(kind === "email-code" ? input.code : input.reference);
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
  it("rejects unsafe action links and header injection", () => {
    expect(() => renderEmail("receipt", { ...input, actionUrl: "javascript:alert(1)" })).toThrow();
    expect(() => renderEmail("receipt", { ...input, reference: "bad\r\nbcc: x" })).toThrow();
  });
  it("sends only to an injected sink by default, never to the real binding", async () => {
    const sink: unknown[] = []; let sent = 0;
    const result = await deliverEmail({ ENVIRONMENT: "staging", EMAIL: { send: async () => { sent++; } } }, "person@example.invalid", renderEmail("receipt", input), async (mail) => { sink.push(mail); });
    expect(result).toEqual({ status: "sink" }); expect(sent).toBe(0); expect(sink).toHaveLength(1);
  });
  it("requires explicit live mode and validates the recipient before using the binding", async () => {
    const sent: unknown[] = [];
    const env = { ENVIRONMENT: "staging", EMAIL_MODE: "live", EMAIL: { send: async (m: unknown) => { sent.push(m); } } };
    await deliverEmail(env, "person@example.invalid", renderEmail("refund", input));
    expect(sent).toHaveLength(1);
    await expect(deliverEmail(env, "bad\r\nbcc:x", renderEmail("refund", input))).rejects.toThrow();
  });
});
