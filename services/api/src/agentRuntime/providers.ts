export type Provider="gemini"|"anthropic"|"openai";
export const MODELS={gemini:"gemini-3.5-flash-lite",anthropic:"claude-haiku-5-5",openai:"gpt-5.4-mini-2026-03-17"} as const;
export const OUTPUT_TOKENS=1024;
/** `provider_unavailable` = billing, credit or quota trouble on the provider side; `provider_failed` = anything else. */
export class ProviderError extends Error {
 constructor(readonly code:"provider_unavailable"|"provider_failed"){super("Provider request failed. Check the key or try again.");}
}
// Billing and quota wording from Gemini (RESOURCE_EXHAUSTED, "prepayment credits are depleted"), Anthropic and OpenAI.
const BILLING=/RESOURCE_EXHAUSTED|credits? (?:are|is) (?:depleted|exhausted)|prepayment|insufficient[_ ](?:quota|funds)|billing|quota|credit balance/i;
async function classify(r:Response):Promise<ProviderError>{
 if(r.status===402||r.status===429)return new ProviderError("provider_unavailable");
 // The body is only inspected, never returned or logged: it can echo credentials.
 const body=await r.text().then(t=>t.slice(0,4000),()=>"");
 return new ProviderError(BILLING.test(body)?"provider_unavailable":"provider_failed");
}
/** Text JSON protocol keeps the executor independent of vendor function-call signatures. No dynamic URLs. */
export async function complete(provider:Provider,key:string,system:string,prompt:string,send:typeof fetch,maxTokens=OUTPUT_TOKENS,geminiBackend:string|undefined=undefined):Promise<{text:string;tokens:number|null}>{
 let url:string,body:unknown,headers:Record<string,string>={"content-type":"application/json"};
 if(provider==="gemini"){
  const backend=geminiBackend??"developer";
  if(backend!=="developer"&&backend!=="vertex_express")throw new Error("Provider request failed. Check the key or try again.");
  url=backend==="vertex_express"
   ?`https://aiplatform.googleapis.com/v1/publishers/google/models/${MODELS.gemini}:generateContent`
   :`https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`;
  headers["x-goog-api-key"]=key;
  body={systemInstruction:{parts:[{text:system}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,responseMimeType:"application/json"}};
 }else if(provider==="anthropic"){
  url="https://api.anthropic.com/v1/messages";headers["x-api-key"]=key;headers["anthropic-version"]="2023-06-01";
  body={model:MODELS.anthropic,max_tokens:maxTokens,system,messages:[{role:"user",content:prompt}]};
 }else{
  url="https://api.openai.com/v1/chat/completions";headers.authorization=`Bearer ${key}`;
  body={model:MODELS.openai,max_completion_tokens:maxTokens,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:prompt}]};
 }
 try{
  const r=await send(url,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:"manual"});
  // Workers supports manual redirect handling; never forward credentials to a Location target.
  if(r.status>=300&&r.status<400)throw new Error("redirect");
  if(!r.ok)throw await classify(r);
  const raw=await r.text();if(raw.length>100000)throw new Error("oversize");
  const j=JSON.parse(raw);
  const text=provider==="gemini"?j.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join(""):provider==="anthropic"?j.content?.filter((p:any)=>p.type==="text").map((p:any)=>p.text).join(""):j.choices?.[0]?.message?.content;
  const tokens=provider==="gemini"?j.usageMetadata?.totalTokenCount:provider==="anthropic"?j.usage?.input_tokens+j.usage?.output_tokens:j.usage?.total_tokens;
  if(typeof text!=="string"||text.length>16000)throw new Error("schema");
  return {text,tokens:Number.isSafeInteger(tokens)&&tokens>=0?tokens:null};
 }catch(e){throw e instanceof ProviderError?e:new ProviderError("provider_failed");}
}
