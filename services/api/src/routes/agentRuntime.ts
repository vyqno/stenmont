import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppEnv } from "../app";
import { fail } from "../errors";
import { createTools, type Api } from "../../../mcp/src/capabilities";
import { complete, type Provider } from "../agentRuntime/providers";
import { reserve,settle,usage } from "../agentRuntime/usage";
import { SYSTEM_PREFIX,byteTokens,context,tainted } from "../agentRuntime/context";
import { seal,unseal } from "../lib/seal";
const provider=z.enum(["gemini","anthropic","openai"]);
const toolNames=z.enum(["list_invoices","get_invoice","export_payments","draft_refund"]);
const conversationSchema=z.strictObject({tools:z.array(toolNames).max(4).default(["list_invoices","get_invoice"])});
export const agentRuntimeRoutes=new Hono<AppEnv>();
agentRuntimeRoutes.use("*",async(c,next)=>{
 if(c.env.AGENT_ENABLED!=="yes")return fail(c,503,"agent_disabled","The finance assistant is currently unavailable.");
 await next();
});
agentRuntimeRoutes.get("/usage",async c=>c.json(await usage(c.env.DB,c.var.merchantId,c.var.now())));
agentRuntimeRoutes.get("/conversations",async c=>c.json({items:(await c.env.DB.prepare("SELECT id,created_at,tools FROM agent_conversations WHERE merchant_id=? ORDER BY created_at DESC LIMIT 50").bind(c.var.merchantId).all()).results}));
agentRuntimeRoutes.post("/conversations",async c=>{
 const p=conversationSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return fail(c,400,"invalid_input","Choose supported read or draft tools.");
 const id=crypto.randomUUID();await c.env.DB.prepare("INSERT INTO agent_conversations(id,merchant_id,created_at,tools) VALUES(?,?,?,?)").bind(id,c.var.merchantId,c.var.now().toISOString(),JSON.stringify(p.data.tools)).run();return c.json({id,tools:p.data.tools},201);
});
agentRuntimeRoutes.get("/conversations/:id",async c=>{
 const row=await c.env.DB.prepare("SELECT id,tools FROM agent_conversations WHERE id=? AND merchant_id=?").bind(c.req.param("id"),c.var.merchantId).first();if(!row)return fail(c,404,"not_found","Conversation not found");
 return c.json({...row,messages:(await c.env.DB.prepare("SELECT role,content FROM agent_messages WHERE conversation_id=? ORDER BY created_at,id LIMIT 100").bind(c.req.param("id")).all()).results});
});
agentRuntimeRoutes.get("/conversations/:id/results/:reference",async c=>{
 const offset=Number(c.req.query("offset")??0);if(!Number.isSafeInteger(offset)||offset<0)return fail(c,400,"invalid_input","Invalid result offset");
 const row=await c.env.DB.prepare("SELECT r.content FROM agent_results r JOIN agent_conversations c ON c.id=r.conversation_id WHERE r.id=? AND c.id=? AND c.merchant_id=?").bind(c.req.param("reference"),c.req.param("id"),c.var.merchantId).first<{content:string}>();
 if(!row)return fail(c,404,"not_found","Result not found");return c.json({tainted:true,reference:c.req.param("reference"),data:row.content.slice(offset,offset+1200),nextOffset:offset+1200<row.content.length?offset+1200:null});
});
agentRuntimeRoutes.post("/keys",async c=>{
 const p=z.strictObject({provider,key:z.string().min(8).max(512).regex(/^[^\s]+$/)}).safeParse(await c.req.json().catch(()=>null));
 if(!p.success)return fail(c,400,"invalid_input","Choose a provider and supply its key.");
 if(!c.env.AGENT_KEY_SECRET||c.env.AGENT_KEY_SECRET.length<32)return fail(c,503,"agent_unconfigured","Key storage is not configured.");
 const hold=await reserve(c.env.DB,c.var.merchantId,"key-validation",p.data.provider,1024,c.var.now());if(!hold)return fail(c,429,"usage_limit_reached","Assistant usage limit reached.");
 try{
  const result=await complete(p.data.provider,p.data.key,"Reply with JSON only.",'Return {"text":"ok"}',c.var.fetch,32);
  await settle(c.env.DB,hold,Math.min(1024,result.tokens??1024));
  const sealed=await seal(c.env.AGENT_KEY_SECRET,p.data.key,["agent-key/v1",c.var.merchantId,p.data.provider]);
  await c.env.DB.prepare("INSERT INTO agent_provider_keys(merchant_id,provider,sealed) VALUES(?,?,?) ON CONFLICT(merchant_id,provider) DO UPDATE SET sealed=excluded.sealed").bind(c.var.merchantId,p.data.provider,sealed).run();return c.json({provider:p.data.provider,configured:true});
 }catch{await settle(c.env.DB,hold,1024);return fail(c,502,"provider_failed","The provider could not validate that key.");}
});
agentRuntimeRoutes.delete("/keys/:provider",async c=>{
 const p=provider.safeParse(c.req.param("provider"));if(!p.success)return fail(c,400,"invalid_input","Unknown provider");
 await c.env.DB.prepare("DELETE FROM agent_provider_keys WHERE merchant_id=? AND provider=?").bind(c.var.merchantId,p.data).run();return c.json({removed:true});
});
agentRuntimeRoutes.post("/conversations/:id/messages",async c=>{
 const p=z.strictObject({message:z.string().trim().min(1).max(1200),provider:provider.default("gemini")}).safeParse(await c.req.json().catch(()=>null));
 if(!p.success)return fail(c,400,"invalid_input","Enter a message of at most 1,200 characters.");
 const id=c.req.param("id"),db=c.env.DB,merchant=c.var.merchantId;
 const row=await db.prepare("SELECT tools FROM agent_conversations WHERE id=? AND merchant_id=?").bind(id,merchant).first<{tools:string}>();if(!row)return fail(c,404,"not_found","Conversation not found");
 let key:string|null=p.data.provider==="gemini"?c.env.GEMINI_API_KEY??null:null;
 const stored=await db.prepare("SELECT sealed FROM agent_provider_keys WHERE merchant_id=? AND provider=?").bind(merchant,p.data.provider).first<{sealed:string}>();
 if(stored&&c.env.AGENT_KEY_SECRET)key=await unseal(c.env.AGENT_KEY_SECRET,stored.sealed,["agent-key/v1",merchant,p.data.provider]);
 if(!key)return fail(c,503,"provider_unconfigured","This provider has no configured key.");
 const locked=await db.prepare("UPDATE agent_conversations SET busy=1 WHERE id=? AND merchant_id=? AND busy=0 RETURNING id").bind(id,merchant).all();if(!locked.results.length)return fail(c,409,"conversation_busy","Wait for the current reply.");
 return streamSSE(c,async stream=>{
  const write=async(event:string,data:unknown)=>{await stream.writeSSE({event,data:JSON.stringify(data)});};
  let hold:string|null=null;let heldTokens=0;
  try{
   const history=(await db.prepare("SELECT role,content FROM agent_messages WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT 40").bind(id).all<{role:string;content:string}>()).results.reverse();
   let prompt=context(history,p.data.message);
   const tools=createTools({apiUrl:c.env.API_URL,appUrl:c.env.APP_URL,fetch:c.var.fetch}).filter(t=>(JSON.parse(row.tools) as string[]).includes(t.name));
   const resultSchema=z.strictObject({reference:z.string().uuid(),offset:z.number().int().nonnegative().default(0)});
   const system=SYSTEM_PREFIX+"\nAvailable tools: "+JSON.stringify(tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema})).concat([{name:"get_result",description:"Read a bounded page from a previous tainted result reference",inputSchema:{type:"object",properties:{reference:{type:"string"},offset:{type:"integer"}},required:["reference"]}}]));

   // Internal requests preserve the original auth; the model supplies neither headers nor routes.
   const api:Api=(path,init)=>{
    const headers=new Headers(init?.headers);for(const h of ["authorization","cookie","origin"]){const v=c.req.header(h);if(v)headers.set(h,v);}
    return c.var.internalFetch(new Request(new URL(path,c.req.url),{...init,headers}));
   };
   for(let turn=0;turn<3;turn++){
    if(c.env.AGENT_ENABLED!=="yes")throw new Error("agent_disabled");
    const budget=byteTokens(system)+byteTokens(prompt)+1024;
    heldTokens=budget;hold=await reserve(db,merchant,id,p.data.provider,budget,c.var.now());if(!hold)throw new Error("usage_limit_reached");
    const result=await complete(p.data.provider,key!,system,prompt,c.var.fetch);
    await settle(db,hold,result.tokens!==null&&result.tokens<=budget?result.tokens:budget);hold=null;
    let answer:any;try{answer=JSON.parse(result.text);}catch{throw new Error("invalid_provider_response");}
    if(typeof answer.text==="string"){
     const text=answer.text.slice(0,8000);const now=c.var.now().toISOString();
     await db.batch([db.prepare("INSERT INTO agent_messages VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),id,"user",p.data.message,now),db.prepare("INSERT INTO agent_messages VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),id,"assistant",text,new Date(c.var.now().getTime()+1).toISOString())]);
     await write("message",{text});await write("done",{usage:await usage(db,merchant,c.var.now())});return;
    }
    if(answer.tool==="get_result"){
     const args=resultSchema.safeParse(answer.arguments);if(!args.success)throw new Error("invalid_tool_input");
     const r=await db.prepare("SELECT content FROM agent_results WHERE id=? AND conversation_id=?").bind(args.data.reference,id).first<{content:string}>();if(!r)throw new Error("invalid_tool_input");
     prompt+="\n"+JSON.stringify(tainted({data:r.content.slice(args.data.offset,args.data.offset+1200),nextOffset:args.data.offset+1200<r.content.length?args.data.offset+1200:null},args.data.reference));continue;
    }
    const tool=tools.find(t=>t.name===answer.tool);if(!tool)throw new Error("tool_not_allowed");
    const args=tool.schema.safeParse(answer.arguments);if(!args.success)throw new Error("invalid_tool_input");
    if(tool.name==="draft_refund"){
     await write("draft",{tool:tool.name,arguments:args.data,requiresConfirmation:true,url:`${c.env.APP_URL}/dashboard/invoices`});
     prompt+="\n"+JSON.stringify(tainted({draft:args.data,status:"proposed only; merchant must open invoices and prepare/confirm the refund"},"draft"));continue;
    }
    const output=await tool.run(args.data,api),ref=crypto.randomUUID();
    const serialized=JSON.stringify(output);if(serialized.length>200000)throw new Error("tool_result_too_large");
    await db.prepare("INSERT INTO agent_results(id,conversation_id,content) VALUES(?,?,?)").bind(ref,id,serialized).run();
    await write("tool",{name:tool.name,result:tainted(output,ref)});
    prompt+="\n"+JSON.stringify(tainted(output,ref));
   }
   throw new Error("tool_turn_limit");
  }catch(e){
   // Unknown provider failures charge their entire reservation: an upstream may already have billed it.
   if(hold)await settle(db,hold,heldTokens);
   await write("error",{code:e instanceof Error&&/^(usage_limit_reached|tool_not_allowed|invalid_tool_input|tool_turn_limit|agent_disabled|invalid_provider_response)$/.test(e.message)?e.message:"provider_failed",message:"The assistant stopped. No draft was executed."});
  }finally{await db.prepare("UPDATE agent_conversations SET busy=0 WHERE id=? AND merchant_id=?").bind(id,merchant).run();}
 });
});
