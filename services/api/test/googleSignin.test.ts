import { beforeAll, expect, it } from "vitest";
import { sha256Hex } from "../src/lib/crypto";
import { seedMerchant, setup } from "./helpers/app";
import { rsaKey, signJwt } from "./world/helpers";
let key: Awaited<ReturnType<typeof rsaKey>>;
beforeAll(async()=>{key=await rsaKey();});
it("uses PKCE/state/nonce, accepts both Google issuers without auth_time and refuses replay",async()=>{
  for(const issuer of ["https://accounts.google.com","accounts.google.com"]) {
    let nonce="",verifierSent=false;
    const t=setup({}, {GOOGLE_CLIENT_ID:"fixture-client",GOOGLE_CLIENT_SECRET:"fixture-only"},{fetch:(async(input,init)=>{
      if(String(input).includes("/token")) {
        verifierSent=new URLSearchParams(init?.body as URLSearchParams).has("code_verifier");
        return Response.json({id_token:await signJwt(key.priv,{iss:issuer,sub:"google-sub",aud:"fixture-client",exp:Math.floor(t.clock.now.getTime()/1000)+300,nonce,email:"same@example.invalid",email_verified:true,hd:"workspace.example.invalid"})});
      }
      return Response.json(key.jwks);
    }) as typeof fetch});
    await t.db.prepare("INSERT INTO identity_subjects(id,provider,subject,email,merchant_id,created_at) VALUES(?,?,?,?,?,?)").bind("email-owner","email","same@example.invalid","same@example.invalid","existing-business",t.clock.now.toISOString()).run();
    const start=await t.req("/auth/google/start"); expect(start.status).toBe(302);
    const url=new URL(start.headers.get("location")!); nonce=url.searchParams.get("nonce")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    const cookie=start.headers.get("set-cookie")!.split(";")[0]!;
    const callback=`/auth/google/callback?state=${url.searchParams.get("state")}&code=fixture-code`;
    expect((await t.req(callback,{headers:{cookie:"wrong=browser"}})).status).toBe(401);
    const signed=await t.req(callback,{headers:{cookie}});
    expect(signed.status).toBe(302);
    expect(verifierSent).toBe(true);
    expect((await t.req(callback,{headers:{cookie}})).status).toBe(401);
    const identity=await t.db.prepare("SELECT provider,subject,merchant_id FROM identity_subjects WHERE provider='google'").first();
    expect(identity).toEqual({provider:"google",subject:"google-sub",merchant_id:null});
    await seedMerchant(t.db);
    const session="c".repeat(64);
    await t.db.prepare("INSERT INTO sessions(token_hash,merchant_id,passkey_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(await sha256Hex(session),"m_1","fixture-passkey","2027-01-01T00:00:00Z",t.clock.now.toISOString()).run();
    const identityCookie=signed.headers.get("set-cookie")!.match(/__Secure-stenmont_identity_test=([a-f0-9]{64})/)![0];
    const headers={origin:t.env.APP_URL,cookie:`${identityCookie}; __Secure-stenmont_test=${session}`};
    expect((await t.req("/auth/identity/link",{method:"POST",headers})).status).toBe(200);
    expect((await t.req("/auth/identity/link",{method:"POST",headers})).status).toBe(200);
    const domain=await t.db.prepare("SELECT method,decision,expires_at FROM verification_records WHERE merchant_id='m_1' AND method='domain'").first();
    expect(domain).toMatchObject({method:"domain",decision:"approved",expires_at:new Date(t.clock.now.getTime()+86400_000).toISOString()});
  }
});
it("refuses unverified Google email",async()=>{
  let nonce="";
  const t=setup({}, {GOOGLE_CLIENT_ID:"fixture-client",GOOGLE_CLIENT_SECRET:"fixture-only"},{fetch:(async(input)=>String(input).includes("/token") ? Response.json({id_token:await signJwt(key.priv,{iss:"accounts.google.com",sub:"g",aud:"fixture-client",exp:Math.floor(t.clock.now.getTime()/1000)+300,nonce,email:"owner@example.invalid",email_verified:false})}) : Response.json(key.jwks)) as typeof fetch});
  const start=await t.req("/auth/google/start"); const url=new URL(start.headers.get("location")!); nonce=url.searchParams.get("nonce")!;
  expect((await t.req(`/auth/google/callback?state=${url.searchParams.get("state")}&code=fixture-code`,{headers:{cookie:start.headers.get("set-cookie")!.split(";")[0]!}})).status).toBe(401);
});
