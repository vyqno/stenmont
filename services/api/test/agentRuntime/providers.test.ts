import { expect, it } from "vitest";
import { complete, MODELS } from "../../src/agentRuntime/providers";
import { seal, unseal } from "../../src/lib/seal";
it.each(["gemini","anthropic","openai"] as const)("%s sends fixed vendor endpoint, bounded output and no key in URL/errors",async(provider)=>{
 let url="",request:any;
 const fixture=(async(u,init)=>{url=String(u); request=JSON.parse(String(init?.body));return Response.json(provider==="gemini"?{candidates:[{content:{parts:[{text:'{"text":"hello"}'}]}}],usageMetadata:{totalTokenCount:12}}:provider==="anthropic"?{content:[{type:"text",text:'{"text":"hello"}'}],usage:{input_tokens:4,output_tokens:8}}:{choices:[{message:{content:'{"text":"hello"}'}}],usage:{total_tokens:12}});}) as typeof fetch;
 expect(await complete(provider,"fixture-only", "system","user",fixture)).toMatchObject({text:'{"text":"hello"}',tokens:12});
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
