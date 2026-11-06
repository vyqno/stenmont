import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentAccessControls } from "../app/dashboard/agent-access/page";
it("renders bounded skills, scope labels, pending ENS and revoke controls", () => {
  const html = renderToStaticMarkup(<AgentAccessControls data={{ enabled: true, skills: ["quote"], availableSkills: [{ id: "quote", scope: "read" }, { id: "create_invoice_draft", scope: "draft" }], cardUrl: "https://api.example/a2a/m1/agent-card.json", ens: { name: null, record: "stenmont.a2a", status: "publication_pending", txHash: null } }} reload={() => {}} />);
  expect(html).toContain("read permission"); expect(html).toContain("draft permission");
  expect(html).toContain("Publication pending"); expect(html).toContain("Revoke all agent access");
  expect(html).toContain("text-on-brand"); expect(html).toContain("You review a draft");
});
