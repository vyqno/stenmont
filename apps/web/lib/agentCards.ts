import { fromUnits, toUnits } from "@stenmont/shared";
import type { Agent } from "./identity";

export type AllowanceState = "ok" | "near" | "over" | "unknown" | "expired";
export type AllowanceCard = { label: string; name: string; limit: string; spent: string | null; percent: number | null; state: AllowanceState; summary: string };

const NEAR_PERCENT = 80n;

/** An agent's spend (USDT, decimal text, or null when it could not be read) against its daily limit. Exact: no floating point. */
export function allowanceCard(agent: Agent, spent: string | null): AllowanceCard {
  const base = { label: agent.label, name: agent.name, limit: agent.dailyLimit };
  if (agent.status === "expired") return { ...base, spent, percent: null, state: "expired", summary: "Expired" };
  const unknown: AllowanceCard = { ...base, spent: null, percent: null, state: "unknown", summary: "Spend could not be read right now" };
  if (spent === null) return unknown;
  let s: bigint;
  let l: bigint;
  try {
    s = toUnits(spent);
    l = toUnits(agent.dailyLimit);
  } catch {
    return unknown;
  }
  const raw = l === 0n ? (s === 0n ? 0n : 100n) : (s * 100n) / l;
  const percent = Number(raw > 100n ? 100n : raw);
  const over = s > l;
  const state: AllowanceState = over ? "over" : s * 100n >= l * NEAR_PERCENT && l > 0n ? "near" : "ok";
  const text = `${fromUnits(s)} of ${fromUnits(l)} USDT in about the last 24 hours`;
  return { ...base, spent: fromUnits(s), percent, state, summary: over ? `Over its daily limit: ${text}` : text };
}

/** The agents "Pause all" must revoke: everything not already revoked (an expired agent may still hold its permission). */
export const planPauseAll = (agents: Agent[]): string[] => agents.filter((a) => a.status !== "revoked").map((a) => a.label);

export function pauseOutcome(results: { label: string; ok: boolean }[]): { done: boolean; message: string } {
  if (results.length === 0) return { done: true, message: "There are no agents to pause." };
  const failed = results.filter((r) => !r.ok).map((r) => r.label);
  if (failed.length === 0) {
    const n = results.length;
    return { done: true, message: `All ${n} ${n === 1 ? "agent is" : "agents are"} paused. Their names and permissions are removed; create an agent again to resume.` };
  }
  return { done: false, message: `Paused ${results.length - failed.length} of ${results.length} agents. Not paused: ${failed.join(", ")}. Try again.` };
}
