import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentAvatar, agentCharacter } from "../components/AgentAvatar";
import { OpProgress } from "../components/OpProgress";

describe("agent characters", () => {
  it("gives the same agent the same name and face every time, and different agents different ones", () => {
    expect(agentCharacter("billing-bot")).toEqual(agentCharacter("billing-bot"));
    const names = new Set(["billing-bot", "refund-bot", "books-bot", "scout", "clerk", "auditor"].map((s) => agentCharacter(s).name));
    expect(names.size).toBeGreaterThan(2);
    expect(renderToStaticMarkup(<AgentAvatar seed="billing-bot" />)).toBe(renderToStaticMarkup(<AgentAvatar seed="billing-bot" />));
  });
  it("draws a symmetric face with two eyes", () => {
    const html = renderToStaticMarkup(<AgentAvatar seed="x" />);
    expect(html).toContain('role="img"');
    expect((html.match(/fill="#050505"/g) ?? []).length).toBe(2);
  });
});

describe("operation progress", () => {
  it("starts at the first stage with a bar and the keep-open note, never claiming completion", () => {
    const html = renderToStaticMarkup(<OpProgress label="Creating the agent" />);
    expect(html).toContain("Creating the agent");
    expect(html).toContain("Sending your request");
    expect(html).toContain("Keep this page open");
    expect(html).toContain('style="width:0%"');
  });
});
