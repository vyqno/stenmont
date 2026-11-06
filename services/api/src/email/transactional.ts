export type MailKind = "receipt" | "invoice" | "reminder" | "refund" | "payout" | "large-refund-approval" | "email-code";
export type MailInput = { business: string; reference: string; amount: string; actionUrl: string; code?: string };
export type MailContent = { subject: string; html: string; text: string };
export type MailMessage = MailContent & { to: string; from: string };
export type MailEnv = { ENVIRONMENT: string; EMAIL_MODE?: string; EMAIL?: { send(message: MailMessage): Promise<unknown> } };
const titles: Record<MailKind, string> = { receipt: "Payment confirmed", invoice: "Your invoice is ready", reminder: "Invoice reminder", refund: "Refund confirmed", payout: "Payout notice", "large-refund-approval": "Review a refund request", "email-code": "Your sign-in code" };
const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function renderEmail(kind: MailKind, input: MailInput): MailContent {
  if (Object.values(input).some((v) => v && /[\r\n]/.test(v))) throw new Error("Invalid email content");
  const url = new URL(input.actionUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Unsafe email link");
  const title = titles[kind];
  const detail = kind === "email-code" ? `Your code is ${input.code ?? ""}. It expires in 10 minutes. Do not share it.` : `${input.business}: ${input.reference} · ${input.amount}`;
  const action = kind === "large-refund-approval" ? "Review refund request" : kind === "email-code" ? "Return to sign-in" : "View transaction record";
  const notice = kind === "large-refund-approval" ? "Opening this link does not approve or execute the refund. Review the exact terms and confirm with your required credential." : "If you did not expect this message, you can ignore it. Never share a sign-in code or passkey.";
  // The sender label is live text, not a replacement for the founder's custom logo.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#E8E9EC;color:#050505;font-family:Helvetica,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escape(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-top:4px solid #548CFF"><tr><td style="padding:32px"><p style="font-size:14px;margin:0 0 32px">Stenmont</p><h1 style="font-size:28px;line-height:1.2;font-weight:500">${escape(title)}</h1><p style="font-size:16px;line-height:1.5;overflow-wrap:anywhere">${escape(detail)}</p><p style="margin:28px 0"><a href="${escape(url.href)}" style="display:inline-block;background:#050505;color:#FFFFFF;padding:14px 20px;border-radius:4px;text-decoration:underline">${action}</a></p><p style="font-size:14px;line-height:1.5">${escape(notice)}</p><hr style="border:0;border-top:1px solid #E8E9EC;margin:28px 0"><p style="font-size:14px;line-height:1.5">Stenmont · Transactional notification<br>Keep this message for your records.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: title, html, text: `${title}\n\n${detail}\n\n${action}: ${url.href}\n\n${notice}\n\nStenmont · Transactional notification` };
}
/** Default is a local sink. Real delivery requires explicit configuration and separate owner authorization. */
export async function deliverEmail(env: MailEnv, to: string, content: MailContent, sink?: (message: MailMessage) => Promise<void>) {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error("Invalid recipient");
  const message = { ...content, to, from: "Stenmont <notifications@stenmont.com>" };
  if (env.EMAIL_MODE !== "live") { await sink?.(message); return { status: "sink" as const }; }
  if (!env.EMAIL) throw new Error("Email Sending binding is unavailable");
  await env.EMAIL.send(message);
  return { status: "sent" as const };
}
