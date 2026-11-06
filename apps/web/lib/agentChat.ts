export type AgentEvent={event:string;data:Record<string,unknown>};
/** What the person reads when the assistant fails. Server codes are never shown; the data is never touched by a failed reply. */
export function assistantErrorText(code?:string){
 if(code==="usage_limit_reached")return "You have used today's assistant allowance. It resets tomorrow.";
 return "The assistant is unavailable right now. Your data is unchanged.";
}
export class AssistantError extends Error{constructor(readonly code:string,message=assistantErrorText(code)){super(message);}}
export async function readAgentEvents(response:Response,onEvent:(event:AgentEvent)=>void){
 if(!response.ok){const j=await response.json().catch(()=>null);throw new AssistantError(j?.error?.code??"unavailable");}
 if(!response.body)throw new Error("The assistant returned no response.");
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending="";
 try{for(;;){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});
  if(pending.length>100000)throw new Error("Assistant response is too large.");
  let end:number;while((end=pending.indexOf("\n\n"))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const event=frame.split("\n").find(s=>s.startsWith("event:"))?.slice(6).trim();const data=frame.split("\n").filter(s=>s.startsWith("data:")).map(s=>s.slice(5).trim()).join("\n");if(event&&data)onEvent({event,data:JSON.parse(data)});}
  if(done)break;
 }}finally{reader.releaseLock();}
}
