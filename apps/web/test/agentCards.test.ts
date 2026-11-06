import { describe, expect, it } from "vitest";
import { allowanceCard, pauseOutcome, planPauseAll } from "../lib/agentCards";
import type { Agent } from "../lib/identity";

const agent = (over: Partial<Agent> = {}): Agent => ({ label: "bot", name: "bot.acme.stenmont.eth", agentAddress: "0x8888888888888888888888888888888888888888", scopes: ["pay"], dailyLimit: "50", perTxLimit: "10", expiresAt: "2026-12-01T00:00:00Z", status: "active", ...over });

describe("allowanceCard", () => {
  it("shows spend against the daily limit as a percentage", () => {
    expect(allowanceCard(agent(), "12.5")).toMatchObject({ label: "bot", spent: "12.5", limit: "50", percent: 25, state: "ok", summary: "12.5 of 50 USDT in about the last 24 hours" });
  });
  it("warns from 80 percent and flags a limit that was exceeded", () => {
    expect(allowanceCard(agent(), "40")).toMatchObject({ percent: 80, state: "near" });
    expect(allowanceCard(agent(), "49.999999")).toMatchObject({ state: "near" });
    expect(allowanceCard(agent(), "50")).toMatchObject({ percent: 100, state: "near" });
    expect(allowanceCard(agent(), "50.000001")).toMatchObject({ percent: 100, state: "over" });
    expect(allowanceCard(agent(), "50.000001").summary).toMatch(/over its daily limit/i);
  });
  it("is exact with six decimals", () => {
    expect(allowanceCard(agent({ dailyLimit: "0.000003" }), "0.000001")).toMatchObject({ percent: 33, state: "ok" });
  });
  it("says unknown, never zero, when the spend could not be read", () => {
    const c = allowanceCard(agent(), null);
    expect(c).toMatchObject({ spent: null, percent: null, state: "unknown" });
    expect(c.summary).toBe("Spend could not be read right now");
  });
  it("handles zero spend and a zero limit without dividing by zero", () => {
    expect(allowanceCard(agent(), "0")).toMatchObject({ percent: 0, state: "ok" });
    expect(allowanceCard(agent({ dailyLimit: "0" }), "0")).toMatchObject({ percent: 0, state: "ok" });
    expect(allowanceCard(agent({ dailyLimit: "0" }), "1")).toMatchObject({ percent: 100, state: "over" });
  });
  it("treats an expired agent as expired whatever it spent", () => {
    expect(allowanceCard(agent({ status: "expired" }), "10").state).toBe("expired");
  });
  it("treats unparseable amounts as unknown rather than guessing", () => {
    expect(allowanceCard(agent(), "abc").state).toBe("unknown");
    expect(allowanceCard(agent({ dailyLimit: "x" }), "1").state).toBe("unknown");
  });
});

describe("planPauseAll", () => {
  it("lists every agent that is not already revoked, in order", () => {
    const list = [agent({ label: "a" }), agent({ label: "b", status: "revoked" }), agent({ label: "c", status: "expired" }), agent({ label: "d" })];
    expect(planPauseAll(list)).toEqual(["a", "c", "d"]);
  });
  it("is empty when there is nothing to pause", () => {
    expect(planPauseAll([])).toEqual([]);
    expect(planPauseAll([agent({ status: "revoked" })])).toEqual([]);
  });
});

describe("pauseOutcome", () => {
  it("reports success, partial failure and nothing to do", () => {
    expect(pauseOutcome([{ label: "a", ok: true }, { label: "b", ok: true }])).toEqual({ done: true, message: "All 2 agents are paused. Their names and permissions are removed; create an agent again to resume." });
    expect(pauseOutcome([{ label: "a", ok: true }, { label: "b", ok: false }, { label: "c", ok: false }])).toEqual({ done: false, message: "Paused 1 of 3 agents. Not paused: b, c. Try again." });
    expect(pauseOutcome([])).toEqual({ done: true, message: "There are no agents to pause." });
    expect(pauseOutcome([{ label: "a", ok: true }]).message).toContain("All 1 agent is paused");
  });
});
