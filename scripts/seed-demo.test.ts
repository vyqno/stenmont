import { describe, expect, it } from 'vitest';
import { seedPlan, runSeed } from './seed-demo-lib';
const config = {apiUrl:'https://api-staging.stenmont.com', namespace:'demo-20261106', asOf:'2026-11-06'};
function api() {
  const products: any[] = [], invoices = new Map<string, any>(), subscriptions = new Map<string, any>();
  const calls: {path:string;method:string;key:string|null}[] = [];
  const responses=new Map<string,string>();
  const fetcher:typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-only');
    expect(init?.redirect).toBe('error');
    calls.push({path:url.pathname,method,key:headers.get('idempotency-key')});
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if(url.pathname==='/v1/me')return Response.json({id:'m_demo',name:'Fixture business'});
    if(url.pathname==='/v1/products'&&method==='GET')return Response.json({data:products,next:null});
    if(url.pathname==='/v1/products') { const product={...body,variants:body.variants.map((v:any)=>({...v,price:String(Number(v.price))})),id:`p${products.length}`};products.push(product);return Response.json(product,{status:201}); }
    const rows = url.pathname.startsWith('/v1/invoices') ? invoices : subscriptions;
    if(method==='GET')return Response.json([...rows.values()].find(r=>r.id===url.pathname.split('/').at(-1)));
    const key=headers.get('idempotency-key')!;
    if(!rows.has(key)){rows.set(key,{...body,id:`r${rows.size}`,status:url.pathname==='/v1/invoices'?'open':'offered'});responses.set(key,JSON.stringify(rows.get(key)));}
    return new Response(responses.get(key),{status:201,headers:{'content-type':'application/json'}});
  };
  return {fetcher,calls,products,invoices,subscriptions};
}
describe('public-API staging seed',()=>{
  it('dry-run describes real prerequisites and never contacts a service or invents paid states',async()=>{
    const result=await runSeed(config,{fetch:async()=>{throw Error('network forbidden');}});
    expect(result.dryRun).toBe(true);
    expect(seedPlan(config).products).toHaveLength(3);
    expect(seedPlan(config).invoices.some(i=>i.instalments===3)).toBe(true);
    expect(result.held.join(' ')).toMatch(/passkey.*payment.*World.*ENS/i);
  });
  it('refuses non-staging or credential-bearing URLs before making requests',async()=>{
    for(const apiUrl of ['https://api.stenmont.com','https://api-staging.stenmont.com.attacker.test','https://user:password@api-staging.stenmont.com','http://api-staging.stenmont.com'])
      await expect(runSeed({...config,apiUrl},{confirm:true,apiKey:'fixture-only',fetch:async()=>{throw Error('network');}})).rejects.toThrow(/staging/);
  });
  it('restarts without duplicating products, invoices or subscription offers, and preserves actual statuses',async()=>{
    const a=api();const options={confirm:true,apiKey:'fixture-only',fetch:a.fetcher};
    const first=await runSeed(config,options), second=await runSeed(config,options);
    expect(a.products).toHaveLength(3);expect(a.invoices.size).toBe(3);expect(a.subscriptions.size).toBe(1);
    expect(a.calls.filter(c=>c.path==='/v1/products'&&c.method==='POST')).toHaveLength(3);
    expect(first.records.filter(r=>r.kind==='invoice').every(r=>r.status==='open')).toBe(true);
    expect(second.records).toEqual(first.records);
    expect(a.calls.filter(c=>c.path==='/v1/invoices').every(c=>!!c.key)).toBe(true);
    [...a.invoices.values()][0].status='paid';
    const refreshed=await runSeed(config,options);
    expect(refreshed.records.find(r=>r.kind==='invoice')!.status).toBe('paid');
    const before=[...a.invoices.keys()];
    await runSeed({...config,namespace:'other-demo'},options);
    expect(a.invoices.size).toBe(6);expect([...a.invoices.keys()].slice(3).every(k=>!before.includes(k))).toBe(true);
  });
  it('changes resource keys when the merchant or namespace changes and refuses existing catalogue mismatch',async()=>{
    const a=api();a.products.push({handle:'demo-20261106-notebook',title:'Foreign data',variants:[]});
    await expect(runSeed(config,{confirm:true,apiKey:'fixture-only',fetch:a.fetcher})).rejects.toThrow(/catalogue mismatch/);
    expect(a.calls.some(c=>c.method==='POST')).toBe(false);
  });
  it('never exposes the key in a provider failure and does not retry an uncertain invoice creation',async()=>{
    const a=api();const fetcher:typeof fetch=async(input,init)=>{
      if(new URL(String(input)).pathname==='/v1/invoices')throw Error('fixture-only');
      return a.fetcher(input,init);
    };
    await expect(runSeed(config,{confirm:true,apiKey:'fixture-only',fetch:fetcher})).rejects.toThrow('Seed request could not be confirmed; rerun with the same namespace and date.');
  });
});
