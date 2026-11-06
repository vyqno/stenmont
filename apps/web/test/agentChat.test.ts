import { expect,it } from "vitest";
import { AssistantError, assistantErrorText, readAgentEvents } from "../lib/agentChat";
it("handles SSE frames split across transport chunks and UTF-8 boundaries",async()=>{
 const bytes=new TextEncoder().encode('event: message\ndata: {"text":"₹ hello"}\n\nevent: done\ndata: {"usage":{}}\n\n');let i=0;
 const stream=new ReadableStream<Uint8Array>({pull(c){if(i>=bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=3));}});const events:unknown[]=[];
 await readAgentEvents(new Response(stream),e=>events.push(e));expect(events).toEqual([{event:"message",data:{text:"₹ hello"}},{event:"done",data:{usage:{}}}]);
});
it("reports limits from JSON HTTP errors",async()=>{
 await expect(readAgentEvents(Response.json({error:{code:"usage_limit_reached",message:"Daily limit reached"}},{status:429}),()=>{})).rejects.toMatchObject({ code: "usage_limit_reached" });
});
it("says the same calm thing for every provider failure, never a server code",()=>{
 for(const code of ["provider_failed","agent_unavailable","something_new",undefined]){const t=assistantErrorText(code);expect(t).toBe("The assistant is unavailable right now. Your data is unchanged.");expect(t).not.toMatch(/provider_failed|stopped|\(/);}
 expect(assistantErrorText("usage_limit_reached")).toContain("allowance");
 expect(new AssistantError("provider_failed").message).toBe(assistantErrorText("provider_failed"));
});
it("turns a failed HTTP reply into the calm message",async()=>{
 await expect(readAgentEvents(Response.json({error:{code:"agent_unavailable",message:"x"}},{status:503}),()=>{})).rejects.toThrow("unavailable right now");
});
