// The facilitator source is imported by the e2e test; its Worker-only types are not needed here.
declare type D1Database = { prepare(q: string): { bind(...a: unknown[]): { run(): Promise<{ meta: { changes: number } }>; first<T = unknown>(): Promise<T | null> } } };
declare type DurableObjectNamespace = any;
