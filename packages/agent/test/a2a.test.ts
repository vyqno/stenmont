import { describe, expect, it, vi } from "vitest";
import { callSkill, discoverAgent, isPublicIPv4, type DiscoveryOptions } from "../src/a2a";
const card = { name: "Acme", description: "Drafts only", version: "1", capabilities: { streaming: false }, defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], supportedInterfaces: [{ url: "https://agents.example/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], skills: [{ id: "quote", name: "Quote", description: "Quote", tags: ["billing"] }] };
const opts = (overrides: Partial<DiscoveryOptions> = {}): DiscoveryOptions => ({ read: async () => "https://agents.example/card", resolve: async () => ["93.184.216.34"], request: async () => ({ status: 200, contentType: "application/json", body: JSON.stringify(card) }), ...overrides });
describe("bounded A2A discovery", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "192.168.1.2", "0.0.0.0", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1"])("refuses non-public %s", ip => expect(isPublicIPv4(ip)).toBe(false));
  it("reads only stenmont.a2a and pins validated DNS addresses", async () => {
    const read = vi.fn(async () => "https://agents.example/card");
    const request = vi.fn(opts().request!);
    const a = await discoverAgent("acme.stenmont.eth", opts({ read, request }));
    expect(read).toHaveBeenCalledWith("acme.stenmont.eth", "stenmont.a2a");
    expect(request.mock.calls[0]?.[1].addresses).toEqual(["93.184.216.34"]);
    expect(a.endpoint).toBe("https://agents.example/rpc");
  });
  it.each(["https://127.1/card", "https://2130706433/card", "https://0x7f000001/card", "http://agents.example/card", "https://agents.example:8443/card", "https://a:b@agents.example/card"])("refuses unsafe URL %s", async url => {
    const request = vi.fn();
    await expect(discoverAgent("acme.eth", opts({ read: async () => url, request }))).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects a mixed public/private answer before transport", async () => {
    const request = vi.fn();
    await expect(discoverAgent("acme.eth", opts({ resolve: async () => ["93.184.216.34", "127.0.0.1"], request }))).rejects.toThrow("DNS");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([302, 307, 308])("refuses every redirect, including private redirects (%s)", async status => {
    await expect(discoverAgent("acme.eth", opts({ request: async () => ({ status, contentType: "application/json", body: "", location: "https://127.0.0.1/" }) }))).rejects.toThrow("redirect");
  });
  it("rejects oversize and malformed cards", async () => {
    for (const body of ["x".repeat(65537), "{}", JSON.stringify({ ...card, supportedInterfaces: [{ url: "https://evil.example/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] }), JSON.stringify({ ...card, skills: [{ id: "pay" }] })]) {
      await expect(discoverAgent("acme.eth", opts({ request: async () => ({ status: 200, contentType: "application/json", body }) }))).rejects.toThrow();
    }
  });
  it("rechecks DNS and fails closed on rebinding before sending credentials", async () => {
    const request = vi.fn(opts().request!);
    const resolve = vi.fn().mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["127.0.0.1"]);
    const o = opts({ resolve, request });
    const a = await discoverAgent("acme.eth", o);
    await expect(callSkill(a, "quote", {}, "test-credential", o)).rejects.toThrow("DNS");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends current protocol method and rejects unadvertised skills", async () => {
    const a = await discoverAgent("acme.eth", opts());
    const request = vi.fn(async (_url, init) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(init.body!).id, result: { task: { id: "t", status: { state: "TASK_STATE_COMPLETED" } } } }) }));
    await callSkill(a, "quote", {}, "test-credential", opts({ request }));
    expect(JSON.parse(request.mock.calls[0]![1].body!).method).toBe("SendMessage");
    await expect(callSkill(a, "get_pay_link", {}, "test-credential", opts({ request }))).rejects.toThrow("skill");
  });
});
