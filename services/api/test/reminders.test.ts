import { describe, expect, it } from "vitest";
import { invoices, webhookDeliveries } from "../src/db/schema";
import { runReminders } from "../src/reminders";
import { baseEnv, seedMerchant } from "./helpers/app";
import { newD1 } from "./helpers/d1";
import { dbOf, fakeQueue, seedEndpoint } from "./helpers/fixtures";

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T12:00:00.000Z");
const due = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

async function world(rows: { number: string; status?: string; dueDate: string | null }[]) {
  const d1 = newD1();
  await seedMerchant(d1);
  await seedEndpoint(d1);
  const db = dbOf(d1);
  const stamp = NOW.toISOString();
  for (const r of rows) {
    await db.insert(invoices).values({
      id: `0x${Buffer.from(r.number).toString("hex").padEnd(64, "0")}`,
      merchantId: "m_1",
      number: r.number,
      status: r.status ?? "open",
      amount: "10000000",
      customerEmail: "c@x.co",
      dueDate: r.dueDate,
      metaHash: `0x${"0".repeat(64)}`,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  const q = fakeQueue();
  const env = { ...baseEnv(d1), WEBHOOKS: q } as unknown as ReturnType<typeof baseEnv>;
  const run = (now = NOW) => runReminders(env, db, now);
  const events = async () => (await db.select().from(webhookDeliveries)).map((d) => ({ type: d.type, eventId: d.eventId, data: JSON.parse(d.payload).data }));
  return { run, events, db, q };
}

describe("reminders", () => {
  it("tells the merchant's system which invoices are coming due, due, or overdue", async () => {
    const t = await world([
      { number: "SOON", dueDate: due(2) },
      { number: "TODAY", dueDate: due(-0.5) },
      { number: "LATE", dueDate: due(-5) },
      { number: "FAR", dueDate: due(20) },
    ]);
    const r = await t.run();
    expect(r).toEqual({ sent: 3 });
    const by = Object.fromEntries((await t.events()).map((e) => [e.data.invoice.number, e.data]));
    expect(by.SOON).toMatchObject({ reminder: "due_soon" });
    expect(by.TODAY).toMatchObject({ reminder: "due" });
    expect(by.LATE).toMatchObject({ reminder: "overdue" });
    expect(by.FAR).toBeUndefined();
    expect((await t.events()).every((e) => e.type === "invoice.reminder")).toBe(true);
  });
  it("sends each reminder once, however often the job runs", async () => {
    const t = await world([{ number: "SOON", dueDate: due(2) }]);
    await t.run();
    expect(await t.run()).toEqual({ sent: 0 });
    await t.run(new Date(NOW.getTime() + 3_600_000));
    expect(await t.events()).toHaveLength(1);
    expect(t.q.sent).toHaveLength(1);
  });
  it("moves on to the next stage as time passes, one reminder per stage", async () => {
    const t = await world([{ number: "A", dueDate: due(2) }]);
    await t.run();
    await t.run(new Date(NOW.getTime() + 2 * DAY + 3_600_000)); // now past the due date
    await t.run(new Date(NOW.getTime() + 6 * DAY)); // more than 3 days past
    expect((await t.events()).map((e) => e.data.reminder).sort()).toEqual(["due", "due_soon", "overdue"]);
  });
  it("ignores invoices that are paid, cancelled, failed or have no due date", async () => {
    const t = await world([
      { number: "PAID", status: "paid", dueDate: due(-5) },
      { number: "CANC", status: "cancelled", dueDate: due(-5) },
      { number: "FAIL", status: "failed", dueDate: due(-5) },
      { number: "NODUE", dueDate: null },
      { number: "PART", status: "partially_paid", dueDate: due(-5) },
    ]);
    expect(await t.run()).toEqual({ sent: 1 });
    expect((await t.events())[0]!.data.invoice.number).toBe("PART");
  });
});
