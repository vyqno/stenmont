import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ options: null as any, size: 2 }));
vi.mock("node:https", () => ({ request: (_url: URL, options: unknown, response: (r: unknown) => void) => {
  state.options = options;
  const req = new EventEmitter() as EventEmitter & Record<string, any>;
  req.setTimeout = vi.fn(); req.write = vi.fn();
  req.destroy = (err: Error) => { req.emit("error", err); req.emit("close"); };
  req.end = () => queueMicrotask(() => {
    const res = new EventEmitter() as EventEmitter & Record<string, any>;
    res.statusCode = 200; res.headers = { "content-type": "application/json" }; res.destroy = vi.fn();
    response(res); res.emit("data", Buffer.alloc(state.size)); res.emit("end"); req.emit("close");
  });
  return req;
} }));
import { pinnedHttpsRequest } from "../src/a2a";
describe("pinned HTTPS socket transport", () => {
  it("pins the socket lookup, original-host TLS and IPv4 without pooling", async () => {
    state.size = 2;
    await pinnedHttpsRequest(new URL("https://agents.example/card"), { addresses: ["93.184.216.34"] });
    expect(state.options).toMatchObject({ agent: false, family: 4, servername: "agents.example", rejectUnauthorized: true });
    const callback = vi.fn(); state.options.lookup("attacker-rebound.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });
  it("refuses unsafe supplied addresses and stops an oversized streaming body", async () => {
    await expect(pinnedHttpsRequest(new URL("https://agents.example/card"), { addresses: ["127.0.0.1"] })).rejects.toThrow("DNS");
    state.size = 65537;
    await expect(pinnedHttpsRequest(new URL("https://agents.example/card"), { addresses: ["93.184.216.34"] })).rejects.toThrow("oversize");
  });
});
