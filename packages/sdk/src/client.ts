export class StenmontError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "StenmontError";
  }
}

export type InvoiceInput = {
  amount: string;
  number?: string;
  customerEmail?: string;
  dueDate?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
};
export type Invoice = {
  id: string;
  number: string;
  status: "open" | "partially_paid" | "paid" | "cancelled" | "failed" | "expired";
  amount: string;
  amountPaid: string;
  amountRefunded: string;
  currency: string;
  customerEmail: string | null;
  dueDate: string | null;
  metadata: Record<string, string>;
  payUrl: string;
  createdAt: string;
};
export type RefundRequest = { id: string; invoiceId: string; to: string; amount: string; status: string; challenge: string; txHash: string | null };
export type SubscriptionInput = { amount: string; periodSeconds: number; maxCharges: number; customerEmail?: string };
export type Subscription = {
  id: string;
  status: "offered" | "active" | "past_due" | "cancelled" | "completed";
  amount: string;
  periodSeconds: number;
  maxCharges: number;
  charges: number;
  subscribeUrl: string;
};

type Options = { idempotencyKey?: string };

export class Stenmont {
  private readonly key: string;
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  /** `baseUrl` defaults to production. Use `https://api-staging.stenmont.com` while testing. */
  constructor(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    if (!opts.apiKey) throw new Error("Stenmont: apiKey is required");
    this.key = opts.apiKey;
    this.base = (opts.baseUrl ?? "https://api.stenmont.com").replace(/\/+$/, "");
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a));
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, o: Options & { text?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method === "POST") headers["idempotency-key"] = o.idempotencyKey ?? crypto.randomUUID();
    const res = await this.doFetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new StenmontError(res.status, j?.error?.code ?? `http_${res.status}`, j?.error?.message ?? `Request failed (${res.status})`, j?.error?.details);
    }
    return (o.text ? await res.text() : await res.json()) as T;
  }

  private static query(q: Record<string, string | number | undefined>): string {
    const p = Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return p.length ? `?${p.join("&")}` : "";
  }

  readonly invoices = {
    create: (input: InvoiceInput, o?: Options) => this.call<Invoice>("POST", "/v1/invoices", input, o),
    get: (id: string) => this.call<Invoice>("GET", `/v1/invoices/${id}`),
    list: (q: { limit?: number; status?: Invoice["status"] } = {}) => this.call<{ data: Invoice[] }>("GET", `/v1/invoices${Stenmont.query(q)}`),
  };

  /** A checkout session is an invoice plus return links: send the customer to `url`, they come back to `successUrl`. */
  readonly checkout = {
    sessions: {
      create: async (s: { amount: string; successUrl: string; cancelUrl: string; customerEmail?: string; metadata?: Record<string, string> }, o?: Options) => {
        const inv = await this.call<Invoice>("POST", "/v1/invoices", s, o);
        return { id: inv.id, url: inv.payUrl };
      },
    },
  };

  /** Starts a refund. The merchant then approves it with their passkey (dashboard); nothing moves until they do. */
  readonly refunds = {
    create: (r: { invoiceId: string; amount?: string; to?: string }, o?: Options) => this.call<RefundRequest>("POST", "/v1/refunds", r, o),
  };

  readonly subscriptions = {
    create: (s: SubscriptionInput, o?: Options) => this.call<Subscription>("POST", "/v1/subscriptions", s, o),
    get: (id: string) => this.call<Subscription>("GET", `/v1/subscriptions/${id}`),
    list: () => this.call<{ data: Subscription[] }>("GET", "/v1/subscriptions"),
    cancel: (id: string) => this.call<Subscription>("POST", `/v1/subscriptions/${id}/cancel`),
  };

  readonly exports = {
    paymentsCsv: (q: { from?: string; to?: string; format?: "generic" | "quickbooks" } = {}) =>
      this.call<string>("GET", `/v1/exports/payments.csv${Stenmont.query(q)}`, undefined, { text: true }),
  };
}
