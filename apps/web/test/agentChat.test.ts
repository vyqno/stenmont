import { expect,it } from "vitest";
import { readAgentEvents } from "../lib/agentChat";
it("handles SSE frames split across transport chunks and UTF-8 boundaries",async()=>{
 const bytes=new TextEncoder().encode('event: message\ndata: {"text":"₹ hello"}\n\nevent: done\ndata: {"usage":{}}\n\n');let i=0;
 const stream=new ReadableStream<Uint8Array>({pull(c){if(i>=bytes.length)c.close();else c.enqueue(bytes.slice(i,i+=3));}});const events:unknown[]=[];
 await readAgentEvents(new Response(stream),e=>events.push(e));expect(events).toEqual([{event:"message",data:{text:"₹ hello"}},{event:"done",data:{usage:{}}}]);
});
it("reports limits from JSON HTTP errors",async()=>{
 await expect(readAgentEvents(Response.json({error:{code:"usage_limit_reached",message:"Daily limit reached"}},{status:429}),()=>{})).rejects.toThrow("Daily limit reached");
});
