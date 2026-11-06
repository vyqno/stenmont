import { expect, test } from "@playwright/test";
const APP="https://app-staging.stenmont.com", API="https://api-staging.stenmont.com";
test.use({trace:"off",screenshot:"off"});
test("staging signup and activation pass Turnstile with a virtual authenticator",async({page,request})=>{
  test.setTimeout(180_000);
  expect((await request.post(`${API}/auth/register/options`,{data:{businessName:"Denied fixture"}})).status()).toBe(403);
  expect((await request.post(`${API}/auth/activate`,{data:{}})).status()).toBe(403);
  expect((await request.get(`${API}/auth/google/start`,{maxRedirects:0})).status()).toBe(503);
  const started=await request.post(`${API}/auth/email/start`,{headers:{origin:APP},data:{email:"sink@example.invalid"}});
  expect(started.status()).toBe(200);
  const {id}=await started.json();
  expect((await request.post(`${API}/auth/email/verify`,{headers:{origin:APP},data:{id,code:"wrong"}})).status()).toBe(401);
  await page.route("**/relay/faucet**",route=>route.abort());
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const name=`Auth acceptance ${Date.now()}`;
  console.log(`Requested isolated business: ${name}`);
  page.on("response", async r=>{
    if(r.url()===`${API}/auth/activate` && r.request().method()==="POST") {
      const b=await r.json().catch(()=>({}));
      console.log(`Activation outcome: ${JSON.stringify({status:r.status(),code:b.error?.code,fields:b.error?.details?.map((d:{path:string})=>d.path),merchant:b.merchant})}`);
    }
  });
  const statuses: number[]=[];
  page.on("response",response=>{if(response.url()===`${API}/auth/register/options`||response.url()===`${API}/auth/activate`)statuses.push(response.status());});
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name",{exact:true}).fill(name);
  const activation=page.waitForResponse(r=>r.url()===`${API}/auth/activate`&&r.request().method()==="POST" && !!r.request().postDataJSON()?.challengeId,{timeout:150_000});
  await page.getByRole("button",{name:"Continue",exact:true}).click();
  const response=await activation;
  expect(response.status()).toBe(200);
  const body=await response.json();
  console.log(`Created isolated staging business: ${JSON.stringify(body.merchant)}`);
  await expect(page.getByTestId("api-key")).toBeVisible();
  await page.getByTestId("api-key").evaluate(node=>{node.textContent="[hidden]";});
  expect(statuses).toEqual([200,200]);
});
