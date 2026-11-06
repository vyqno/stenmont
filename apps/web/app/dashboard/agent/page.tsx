"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../lib/auth";
import { apiBase } from "../../../lib/pay";
import { AssistantError, assistantErrorText, readAgentEvents } from "../../../lib/agentChat";
import { useApi } from "../../../lib/useApi";
import { Card, primaryButton } from "../../../components/ui";
type Usage={daily:number;monthly:number;limits:{daily:number;monthly:number};costLabel:string;estimatedMonthlyUsd:number};
type Message={role:string;content:string};
const TOOLS=["list_invoices","get_invoice","export_payments","draft_refund"];
export default function Agent(){
 const {data:usage,error:usageError,reload}=useApi<Usage>("/v1/agent/usage");
 const {data:conversations,reload:reloadConversations}=useApi<{items:{id:string;created_at:string}[]}>("/v1/agent/conversations");
 const [id,setId]=useState<string|null>(null),[messages,setMessages]=useState<Message[]>([]),[input,setInput]=useState(""),[provider,setProvider]=useState("gemini"),[key,setKey]=useState("");
 const [tools,setTools]=useState(["list_invoices","get_invoice"]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("");
 async function open(value:string){setError("");try{const r=await api.get<{messages:Message[];tools:string}>(`/v1/agent/conversations/${value}`);setId(value);setMessages(r.messages);setTools(JSON.parse(r.tools));}catch(e){setError(e instanceof Error?e.message:"Could not open conversation.");}}
 async function send(e:React.FormEvent){e.preventDefault();if(!input.trim()||busy)return;setBusy(true);setError("");setStatus("Thinking…");const message=input.trim();setInput("");let failed=false;
  try{let conversation=id;if(!conversation){conversation=(await api.post<{id:string}>("/v1/agent/conversations",{tools})).id;setId(conversation);reloadConversations();}
   setMessages(m=>[...m,{role:"user",content:message}]);
   const response=await fetch(apiBase(location.hostname)+`/v1/agent/conversations/${conversation}/messages`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({message,provider})});
   await readAgentEvents(response,({event,data})=>{
    if(event==="message")setMessages(m=>[...m,{role:"assistant",content:String(data.text)}]);
    if(event==="draft"){setMessages(m=>[...m,{role:"draft",content:JSON.stringify(data.arguments,null,2)}]);setStatus("Proposal ready. Review it in Invoices.");}
    if(event==="tool")setStatus(`Reading ${String(data.name).replaceAll("_"," ")}…`);
    if(event==="error")throw new AssistantError(String(data.code));
    if(event==="done")setStatus("Reply complete.");
   });
  }catch(e){failed=true;setError(assistantErrorText(e instanceof AssistantError?e.code:undefined));setStatus("");}finally{setBusy(false);if(!failed)reload();}  // a failed reply does not refresh the usage figure
 }
 async function saveKey(){if(!key||busy)return;setBusy(true);setError("");const value=key;setKey("");try{await api.post("/v1/agent/keys",{provider,key:value});setStatus("Key validated and saved securely.");reload();}catch(e){setError(e instanceof Error?e.message:"Could not save key.");}finally{setBusy(false);}}
 return <div className="flex flex-col gap-6">
  <div><h1 className="text-3xl font-bold">Finance assistant</h1><p className="mt-2 text-muted">Ask about invoices and payments. Refund proposals need your review and passkey confirmation in <Link href="/dashboard/invoices" className="underline">Invoices</Link>.</p></div>
  {usageError&&<p role="alert" className="text-danger">{usageError}</p>}
  <Card title="Usage"><p>{usage?`${usage.daily.toLocaleString()} / ${usage.limits.daily.toLocaleString()} tokens today`:"Loading usage…"}</p>{usage&&<><meter className="w-full" min={0} max={usage.limits.daily} value={usage.daily} aria-label="Daily assistant token usage"/><p className="text-sm text-muted">{usage.monthly.toLocaleString()} / {usage.limits.monthly.toLocaleString()} this month. Tokens include active reservations. Estimated monthly cost: ${usage.estimatedMonthlyUsd.toFixed(4)}. {usage.costLabel}.</p></>}</Card>
  <Card title="Conversation settings"><div className="flex flex-col gap-3">
   <label>Provider <select value={provider} disabled={busy} onChange={e=>setProvider(e.target.value)} className="rounded border border-line bg-surface p-2"><option value="gemini">Gemini (default)</option><option value="anthropic">Anthropic (your key)</option><option value="openai">OpenAI (your key)</option></select></label>
   <div className="flex flex-wrap items-center gap-2"><label htmlFor="agent-provider-key">Your provider key</label><input id="agent-provider-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} className="rounded border border-line p-2"/><button disabled={busy||!key} onClick={saveKey} className="rounded border border-line px-3 py-2 disabled:opacity-50">Validate and save</button><button disabled={busy} onClick={async()=>{try{await api.delete(`/v1/agent/keys/${provider}`);setStatus("Saved key removed.");}catch(e){setError(e instanceof Error?e.message:"Could not remove key.");}}} className="underline">Remove saved key</button></div>
   <fieldset disabled={busy||!!id}><legend className="font-medium">Allowed tools for this conversation</legend><div className="mt-2 flex flex-wrap gap-4">{TOOLS.map(tool=><label key={tool} className="flex items-center gap-2"><input type="checkbox" checked={tools.includes(tool)} onChange={e=>setTools(t=>e.target.checked?[...t,tool]:t.filter(v=>v!==tool))}/>{tool.replaceAll("_"," ")}</label>)}</div></fieldset>
   <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>{setId(null);setMessages([]);setStatus("");setError("");}} className="underline">New conversation</button><label>Previous conversation <select aria-label="Previous conversation" value={id??""} disabled={busy} onChange={e=>{if(e.target.value)void open(e.target.value);}} className="rounded border border-line p-1"><option value="">Choose…</option>{conversations?.items.map(c=><option key={c.id} value={c.id}>{new Date(c.created_at).toLocaleString()}</option>)}</select></label></div>
  </div></Card>
  <Card title="Chat"><div className="flex flex-col gap-4" aria-live="polite">{messages.length===0&&<p className="text-muted">Try “Which invoices are still unpaid?”</p>}{messages.map((m,i)=><div key={i} className="rounded border border-line p-3"><p className="text-sm font-bold">{m.role==="user"?"You":m.role==="draft"?"Refund proposal — review required":"Assistant"}</p><p className="whitespace-pre-wrap break-words">{m.content}</p>{m.role==="draft"&&<Link href="/dashboard/invoices" className="underline">Review in Invoices</Link>}</div>)}</div>
   <form onSubmit={send} className="mt-5 flex flex-col gap-2"><label htmlFor="agent-message" className="font-medium">Message</label><textarea id="agent-message" value={input} onChange={e=>setInput(e.target.value)} maxLength={1200} rows={3} disabled={busy} className="rounded border border-line p-3"/><button disabled={busy||!input.trim()||!!usageError} className={`self-start rounded px-4 py-2 font-medium ${primaryButton}`}>{busy?"Working…":"Send message"}</button></form>
   {status&&<p role="status" className="mt-3 text-sm text-muted">{status}</p>}{error&&<p role="status" className="mt-3 rounded border border-line bg-grey p-3 text-sm">{error}</p>}
  </Card>
 </div>;
}
