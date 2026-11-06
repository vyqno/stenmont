// No dotenv dependency: configure the existing merchant API key only in the process environment.
import { parseArgs } from 'node:util';
import { runSeed } from './seed-demo-lib';
async function main(){
 const {values}=parseArgs({options:{confirm:{type:'boolean'},namespace:{type:'string'},'as-of':{type:'string'},api:{type:'string'}}});
 const result=await runSeed({apiUrl:values.api??'https://api-staging.stenmont.com',namespace:values.namespace??'demo-20261106',asOf:values['as-of']??'2026-11-06'},{confirm:values.confirm,apiKey:process.env.STENMONT_API_KEY});
 console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error instanceof Error&&/^Seed |^Use |^STENMONT_|^Authenticated |^Unexpected |^Catalogue /.test(error.message)?error.message:'Seed configuration failed; no credential values are printed.');process.exitCode=1;});
