import { afterEach, expect, it, vi } from "vitest";
import worker from "../src/worker";
afterEach(()=>vi.unstubAllGlobals());
it("calls the Workers fetch global without rebinding it to the MCP configuration object",async()=>{
  vi.stubGlobal("fetch", function(this:unknown,_url:RequestInfo|URL,init?:RequestInit) {
    if(this!==undefined && this!==globalThis) throw new TypeError("Illegal invocation");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer smt_at_${"a".repeat(64)}`);
    return Promise.resolve(Response.json({data:[]}));
  });
  const response=await worker.fetch(new Request("https://mcp.test/mcp",{method:"POST",headers:{authorization:`Bearer smt_at_${"a".repeat(64)}`,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"list_invoices",arguments:{}}})}),{API_URL:"https://api.test",APP_URL:"https://app.test"});
  expect(await response.json()).toMatchObject({result:{content:[{type:"text",text:JSON.stringify({data:[]},null,2)}]}});
});
