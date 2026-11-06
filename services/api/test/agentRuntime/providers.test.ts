import { expect, it } from "vitest";
import { complete, MODELS } from "../../src/agentRuntime/providers";
import { seal, unseal } from "../../src/lib/seal";
it.each(["gemini","anthropic","openai"] as const)("%s sends fixed vendor endpoint, bounded output and no key in URL/errors",async(provider)=>{
 let url="",request:any,redirectMode:RequestRedirect|undefined;
 const fixture=(async(u,init)=>{url=String(u); redirectMode=init?.redirect; request=JSON.parse(String(init?.body));return Response.json(provider==="gemini"?{candidates:[{content:{parts:[{text:'{"text":"hello"}'}]}}],usageMetadata:{totalTokenCount:12}}:provider==="anthropic"?{content:[{type:"text",text:'{"text":"hello"}'}],usage:{input_tokens:4,output_tokens:8}}:{choices:[{message:{content:'{"text":"hello"}'}}],usage:{total_tokens:12}});}) as typeof fetch;
 expect(await complete(provider,"fixture-only", "system","user",fixture)).toMatchObject({text:'{"text":"hello"}',tokens:12});
 expect(redirectMode).toBe("manual");
 expect(request.generationConfig?.maxOutputTokens??request.max_tokens??request.max_completion_tokens).toBe(1024);
 expect(url).not.toContain("fixture-only"); expect(url+JSON.stringify(request)).toContain(MODELS[provider]);
 const bad=(async()=>new Response("credential echoed here",{status:401})) as typeof fetch;
 await expect(complete(provider,"fixture-only","s","u",bad)).rejects.toThrow("Provider request failed");
});
it("seals keys to merchant and provider authenticated data",async()=>{
 const key=await seal("fixture sealing secret has sufficient entropy", "fixture-only",["agent-key/v1","m1","openai"]);
 expect(key).not.toContain("fixture-only");
 expect(await unseal("fixture sealing secret has sufficient entropy",key,["agent-key/v1","m1","openai"])).toBe("fixture-only");
 expect(await unseal("fixture sealing secret has sufficient entropy",key,["agent-key/v1","m2","openai"])).toBeNull();
 expect(await unseal("fixture sealing secret has sufficient entropy",key,["agent-key/v1","m1","anthropic"])).toBeNull();
});

it.each(["gemini","anthropic","openai"] as const)("%s refuses redirect responses without forwarding credentials or reading their body",async(provider)=>{
 const calls:string[]=[];let reads=0;
 const redirected=(async(url)=>{
  calls.push(String(url));
  const response=new Response("untrusted redirect body",{status:307,headers:{location:"https://untrusted.example/collect"}});
  response.text=async()=>{reads++;throw Error("Redirect body must not be read");};
  return response;
 }) as typeof fetch;
 await expect(complete(provider,"fixture-only","system","prompt",redirected)).rejects.toThrow("Provider request failed. Check the key or try again.");
 expect(calls).toHaveLength(1);expect(calls[0]).not.toContain("untrusted.example");expect(reads).toBe(0);
});

it.each([undefined,"developer","vertex_express"])("Gemini backend %s selects exactly one fixed endpoint",async backend=>{
 const calls:{url:string;init?:RequestInit}[]=[];
 const send=(async(url,init)=>{calls.push({url:String(url),init});return Response.json({candidates:[{content:{parts:[{text:'{"text":"ok"}'}]}}],usageMetadata:{totalTokenCount:7}});}) as typeof fetch;
 expect(await complete("gemini","fixture-only","system","prompt",send,32,backend)).toEqual({text:'{"text":"ok"}',tokens:7});
 expect(calls).toHaveLength(1);
 expect(calls[0]!.url).toBe(backend==="vertex_express"?`https://aiplatform.googleapis.com/v1/publishers/google/models/${MODELS.gemini}:generateContent`:`https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`);
 expect(calls[0]!.init?.headers).toMatchObject({"x-goog-api-key":"fixture-only"});
 expect(calls[0]!.init?.redirect).toBe("manual");
 expect(JSON.parse(String(calls[0]!.init?.body)).generationConfig).toEqual({maxOutputTokens:32,responseMimeType:"application/json"});
});
it.each(["", "vertex", "https://untrusted.example"])("invalid Gemini backend %s fails before fetch",async backend=>{
 let calls=0;const send=(async()=>{calls++;return Response.json({});}) as typeof fetch;
 await expect(complete("gemini","fixture-only","system","prompt",send,32,backend)).rejects.toThrow("Provider request failed");
 expect(calls).toBe(0);
});
it.each([302,403,429,500])("Vertex Express failure %s never retries another billing backend",async status=>{
 const calls:string[]=[];const send=(async url=>{calls.push(String(url));return new Response("private vendor detail",{status});}) as typeof fetch;
 await expect(complete("gemini","fixture-only","system","prompt",send,32,"vertex_express")).rejects.toThrow("Provider request failed");
 expect(calls).toEqual([`https://aiplatform.googleapis.com/v1/publishers/google/models/${MODELS.gemini}:generateContent`]);
});
