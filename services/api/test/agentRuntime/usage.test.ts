import { expect, it } from "vitest";
import { newD1 } from "../helpers/d1";
import { reserve, settle, usage, LIMITS } from "../../src/agentRuntime/usage";
it("atomically reserves daily and conversation caps across concurrent requests and settles once", async () => {
 const db = newD1();
 const now = new Date("2026-11-06T12:00:00Z");
 const holds = await Promise.all(Array.from({length:20}, (_,i)=>reserve(db,"m",`c${i}`,"gemini",8000,now)));
 expect(holds.filter(Boolean)).toHaveLength(Math.floor(LIMITS.daily/8000));
 const id=holds.find(Boolean)!;
 await Promise.all([settle(db,id,1000),settle(db,id,1000)]);
 expect((await usage(db,"m",now)).daily).toBe(41000);
 expect((await usage(db,"m",now)).estimatedMonthlyUsd).toBeCloseTo(0.1025);
 expect(await reserve(db,"m","huge","gemini",LIMITS.conversation+1,now)).toBeNull();
});
it("enforces monthly and fixed minute limits and isolates merchants",async()=>{
 const db=newD1(); const now=new Date("2026-11-06T12:00:00Z");
 for(let i=0;i<LIMITS.rate;i++){const id=await reserve(db,"m",`c${i}`,"gemini",1,now);expect(id).toBeTruthy();await settle(db,id!,0);}
 expect(await reserve(db,"m","extra","gemini",1,now)).toBeNull();
 expect(await reserve(db,"other","extra","gemini",1,now)).toBeTruthy();
 for(let i=1;i<=6;i++){const day=new Date(`2026-11-${String(i).padStart(2,"0")}T12:00:00Z`);for(let j=0;j<5;j++){const id=await reserve(db,"monthly",`c${i}-${j}`,"gemini",10000,day); if(id)await settle(db,id,10000);}}
 expect(await reserve(db,"monthly","excess","gemini",1,new Date("2026-11-07T12:00:00Z"))).toBeNull();
});
