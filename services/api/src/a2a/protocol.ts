export const SKILLS = ["quote", "create_invoice_draft", "check_invoice_status", "get_pay_link", "list_catalogue"] as const;
export type Skill = typeof SKILLS[number];
export const scopeFor = (s: Skill) => s === "create_invoice_draft" ? "draft" : "read";
export function agentCard(apiUrl: string, name: string, merchantId: string, skills: readonly string[]) {
  return { name, description: "Business billing discovery, quotes and drafts. A person confirms invoices. No money execution.", version: "1.0.0",
    supportedInterfaces: [{ url: `${apiUrl}/v1/a2a/${encodeURIComponent(merchantId)}`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: "Merchant API key or scoped Stenmont OAuth access token" } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }], defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    skills: SKILLS.filter(s => skills.includes(s)).map(id => ({ id, name: id.replaceAll("_", " "), description: id === "create_invoice_draft" ? "Return an invoice draft for human review; never creates a payable invoice." : `Read-only ${id.replaceAll("_", " ")}.`, tags: ["billing", scopeFor(id)] })),
  };
}
