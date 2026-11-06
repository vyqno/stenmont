import { createHash } from 'node:crypto';
import { toUnits } from '@stenmont/shared';
export type SeedConfig={apiUrl:string;namespace:string;asOf:string};
type Invoice={number:string;amount:string;dueDate:string;metadata:Record<string,string>;instalments?:number;b2b?:true;payerBusinessName?:string};
const held=['Create or sign in to the merchant with its passkey before applying this seed.', 'Real partial/full payment, refunds and financing need the payer/investor signatures and funds; no status is fabricated.', 'World verification, ENS claim/agent permissions and active subscription consent remain separate live actions.'];
export function seedPlan(c:SeedConfig) {
  const url=new URL(c.apiUrl);
  if(url.origin!=='https://api-staging.stenmont.com'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Seed requires the exact staging API origin.');
  if(!/^[a-z0-9][a-z0-9-]{2,29}$/.test(c.namespace))throw Error('Use a stable lowercase namespace of 3 to30 characters.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(c.asOf)||new Date(c.asOf).toISOString().slice(0,10)!==c.asOf)throw Error('Use a valid pinned YYYY-MM-DD date.');
  const date=(days:number)=>new Date(Date.parse(c.asOf+'T00:00:00.000Z')+days*86400000).toISOString();
  const products=['notebook','pen','cards'].map((name,i)=>({handle:`${c.namespace}-${name}`,title:`Demo ${name}`,status:'active',tags:['staging-demo',c.namespace],variants:[{sku:`${c.namespace}-${name}`,title:'Demo variant',price:['1.00','0.50','0.25'][i]!,inventory:20,trackInventory:true}]}));
  const invoices:Invoice[]=[{number:`${c.namespace}-OPEN`,amount:'1.00',dueDate:date(7),metadata:{seed:c.namespace,purpose:'Open invoice'}},{number:`${c.namespace}-DUE`,amount:'1.00',dueDate:date(-1),metadata:{seed:c.namespace,purpose:'Past-due open invoice; no payment implied'}},{number:`${c.namespace}-PARTS`,amount:'1.000001',dueDate:date(14),instalments:3,b2b:true,payerBusinessName:'Example Test Buyer Ltd',metadata:{seed:c.namespace,purpose:'B2B replacement offer; payer consent still required'}}];
  return {products,invoices,subscription:{amount:'0.10',periodSeconds:86400,maxCharges:3},held};
}
export async function runSeed(c:SeedConfig, options:{confirm?:boolean;apiKey?:string;fetch?:typeof fetch}={}) {
  const plan=seedPlan(c);
  const records:{kind:string;id:string;status:string}[]=[];
  if(!options.confirm)return {dryRun:true,records,held:plan.held,counts:{products:plan.products.length,invoices:plan.invoices.length,subscriptionOffers:1}};
  if(!options.apiKey)throw Error('STENMONT_API_KEY is required in the environment; never supply it as an argument.');
  const fetcher=options.fetch??fetch;
  async function request(path:string,method='GET',body?:unknown,key?:string):Promise<any> {
    let response:Response;
    try {response=await fetcher(c.apiUrl.replace(/\/$/,'')+path,{method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:`Bearer ${options.apiKey}`,...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch {throw Error('Seed request could not be confirmed; rerun with the same namespace and date.');}
    if(!response.ok)throw Error(`Seed API request refused (${response.status}); no response body or credential is printed.`);
    return response.json();
  }
  const me=await request('/v1/me');
  if(typeof me.id!=='string'||!me.id)throw Error('Authenticated merchant identity missing.');
  const key=(kind:string)=>createHash('sha256').update(JSON.stringify(['stenmont.seed.v1',me.id,c.namespace,c.asOf,kind])).digest('hex');
  const existing:any[]=[];let after:string|null=null;
  for(let page=0;page<100;page++){
    const result=await request('/v1/products?limit=50'+(after?'&after='+encodeURIComponent(after):''));
    if(!Array.isArray(result.data))throw Error('Unexpected catalogue response.');
    existing.push(...result.data);if(!result.next)break;
    if(result.next===after||page===99)throw Error('Catalogue pagination did not finish; seed stopped.');
    after=result.next;
  }
  for(const product of plan.products){
    const found=existing.find(p=>p.handle===product.handle);
    if(found&&(found.title!==product.title||found.variants?.length!==1||found.variants[0].sku!==product.variants[0]!.sku||toUnits(found.variants[0].price)!==toUnits(product.variants[0]!.price)))throw Error('Seed catalogue mismatch; existing product was not changed.');
  }
  for(const product of plan.products){
    const found=existing.find(p=>p.handle===product.handle)??await request('/v1/products','POST',product);
    records.push({kind:'product',id:found.id,status:found.status});
  }
  for(const invoice of plan.invoices){
    const row=await request('/v1/invoices','POST',invoice,key(invoice.number));
    const current=await request('/v1/invoices/'+encodeURIComponent(row.id));
    records.push({kind:'invoice',id:current.id,status:current.status});
  }
  const offer=await request('/v1/subscriptions','POST',plan.subscription,key('subscription'));
  const current=await request('/v1/subscriptions/'+encodeURIComponent(offer.id));
  records.push({kind:'subscription',id:current.id,status:current.status});
  return {dryRun:false,records,held:plan.held,counts:{products:plan.products.length,invoices:plan.invoices.length,subscriptionOffers:1}};
}
