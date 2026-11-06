import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../app";
import type { Env } from "../env";
import { isAppOrigin, sessionContext } from "../auth";
import { fail } from "../errors";
import { clientIp } from "../lib/request";
import { randomHex, sha256Hex, hmacSha256Hex, timingSafeEqual } from "../lib/crypto";
import { hitRateLimit } from "../relayer/caps";
import { deliverEmail, renderEmail } from "../email/transactional";
import { recordIdentityFacts } from "../identity/verification";
import { establishIdentity, openIdentity } from "../identity/sessions";
import { createOidcVerifier } from "../world/oidc";
export const identitySigninRoutes = new Hono<AppEnv>();
const TEN_MIN = 600_000;
/** Codes only count as "on" when something can deliver them: live mode with the Email binding (test/local use the sink). */
export const emailCodesAvailable = (e: Env) => !!e.EMAIL_CODE_SECRET && (["test", "local"].includes(e.ENVIRONMENT) || (e.EMAIL_MODE === "live" && !!e.EMAIL));
export const googleAvailable = (e: Env) => !!e.GOOGLE_CLIENT_ID && !!e.GOOGLE_CLIENT_SECRET;
// Public and secret-free: the sign-in pages use it to hide buttons that would lead nowhere.
identitySigninRoutes.get("/methods", c => c.json({ passkey: true, emailCode: emailCodesAvailable(c.env), google: googleAvailable(c.env), wallet: true }, 200, { "cache-control": "public, max-age=60" }));
identitySigninRoutes.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/auth/email/") && c.req.path !== "/auth/identity/link") return next();
  if(c.req.method === "POST" && !isAppOrigin(c.req.header("origin"),c.env)) return fail(c,403,"csrf","Use the Stenmont app.");
  return next();
});
identitySigninRoutes.post("/email/start", async(c) => {
  const body = z.object({ email: z.email().max(254) }).safeParse(await c.req.json().catch(()=>null));
  if(!body.success) return fail(c,400,"invalid_email","Enter a valid email address.");
  if(!emailCodesAvailable(c.env)) return fail(c,501,"email_codes_unavailable","Email codes are not switched on yet.");
  const email=body.data.email.trim().toLowerCase(), now=c.var.now();
  const allowed=await Promise.all([hitRateLimit(c.var.db,`email:ip:${clientIp(c)??"unknown"}`,10,600,now), hitRateLimit(c.var.db,`email:address:${await sha256Hex(email)}`,3,600,now)]);
  if(allowed.some(v=>!v)) return fail(c,429,"rate_limited","Try again later.");
  const id=randomHex(16);
  // Rejection sampling avoids modulo bias for the eight-digit code.
  let n: number; do { n=crypto.getRandomValues(new Uint32Array(1))[0]!; } while(n>=4_200_000_000);
  const code=String(n%100_000_000).padStart(8,"0");
  const hash=await hmacSha256Hex(c.env.EMAIL_CODE_SECRET,`${id}:${code}`);
  await c.env.DB.prepare("INSERT INTO identity_email_codes(id,email,code_hash,expires_at) VALUES(?,?,?,?)").bind(id,email,hash,new Date(now.getTime()+TEN_MIN).toISOString()).run();
  try { await deliverEmail(c.env,email,renderEmail("email-code",{ business:"Stenmont",reference:"Sign-in",amount:"",actionUrl:`${c.env.APP_URL}/login`,code })); }
  catch { await c.env.DB.prepare("DELETE FROM identity_email_codes WHERE id=?").bind(id).run(); return fail(c,503,"email_unavailable","Email could not be sent. Try again later."); }
  return c.json({id,message:"If delivery is available, a code will arrive shortly."});
});
identitySigninRoutes.post("/email/verify",async(c)=>{
  if(!c.env.EMAIL_CODE_SECRET) return fail(c,503,"unavailable","Email sign-in is not configured.");
  const b=await c.req.json().catch(()=>null) as {id?:string;code?:string}|null;
  if(!b || !/^[a-f0-9]{32}$/.test(b.id??"") || typeof b.code!=="string" || b.code.length>32) return fail(c,401,"invalid_code","The code is incorrect or expired.");
  if(!await hitRateLimit(c.var.db,`email:verify:${clientIp(c)??"unknown"}`,30,600,c.var.now())) return fail(c,429,"rate_limited","Try again later.");
  const row=await c.env.DB.prepare("UPDATE identity_email_codes SET attempts=attempts+1 WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5 RETURNING *").bind(b.id,c.var.now().toISOString()).first<{email:string;code_hash:string}>();
  const hash=await hmacSha256Hex(c.env.EMAIL_CODE_SECRET,`${b.id}:${b.code}`);
  if(!row || !timingSafeEqual(row.code_hash,hash)) return fail(c,401,"invalid_code","The code is incorrect or expired.");
  const used=await c.env.DB.prepare("UPDATE identity_email_codes SET used_at=? WHERE id=? AND used_at IS NULL RETURNING id").bind(c.var.now().toISOString(),b.id).first();
  if(!used) return fail(c,401,"invalid_code","The code is incorrect or expired.");
  const identity=await establishIdentity(c,"email",row.email,row.email);
  await recordIdentityFacts(c,identity);
  return c.json({verified:true,linked:!!identity.merchant_id});
});
identitySigninRoutes.get("/identity",async(c)=>{
  const identity=await openIdentity(c);
  return identity ? c.json({provider:identity.provider,email:identity.email,linked:!!identity.merchant_id}) : fail(c,401,"unauthorized","Sign in first.");
});
identitySigninRoutes.post("/identity/link",async(c)=>{
  const ctx=await sessionContext(c), identity=await openIdentity(c);
  if(!ctx?.passkeyId || !identity) return fail(c,403,"passkey_required","Sign in with your business passkey before linking this verified identity.");
  if(identity.merchant_id && identity.merchant_id!==ctx.merchant.id) return fail(c,409,"already_linked","This identity belongs to another business.");
  const linked=await c.env.DB.prepare("UPDATE identity_subjects SET merchant_id=? WHERE id=? AND (merchant_id IS NULL OR merchant_id=?) RETURNING id").bind(ctx.merchant.id,identity.id,ctx.merchant.id).first();
  if(!linked) return fail(c,409,"already_linked","This identity belongs to another business.");
  await recordIdentityFacts(c,{...identity,merchant_id:ctx.merchant.id});
  return c.json({linked:true});
});
const flowCookie="stenmont_google_flow";
identitySigninRoutes.get("/google/start",async(c)=>{
  if(!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return fail(c,501,"google_not_configured","Google sign-in is not switched on.");
  if(!await hitRateLimit(c.var.db,`google:${clientIp(c)??"unknown"}`,10,600,c.var.now())) return fail(c,429,"rate_limited","Try again later.");
  const state=randomHex(32), browser=randomHex(32),nonce=randomHex(32),verifier=randomHex(32);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  await c.env.DB.prepare("INSERT INTO identity_google_flows(state_hash,browser_hash,nonce,verifier,expires_at) VALUES(?,?,?,?,?)").bind(await sha256Hex(state),await sha256Hex(browser),nonce,verifier,new Date(c.var.now().getTime()+TEN_MIN).toISOString()).run();
  setCookie(c,flowCookie,browser,{httpOnly:true,secure:true,sameSite:"Lax",path:"/auth/google",maxAge:600,prefix:"secure"});
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search=new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID,redirect_uri:`${c.env.API_URL}/auth/google/callback`,response_type:"code",scope:"openid email",state,nonce,code_challenge:challenge,code_challenge_method:"S256"}).toString();
  return c.redirect(url.href);
});
identitySigninRoutes.get("/google/callback",async(c)=>{
  const state=c.req.query("state"), code=c.req.query("code"), browser=getCookie(c,flowCookie,"secure");
  if(!state || !code || !browser || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return fail(c,401,"invalid_login","Google sign-in could not be verified.");
  const flow=await c.env.DB.prepare("UPDATE identity_google_flows SET used_at=? WHERE state_hash=? AND browser_hash=? AND used_at IS NULL AND expires_at>? RETURNING nonce,verifier").bind(c.var.now().toISOString(),await sha256Hex(state),await sha256Hex(browser),c.var.now().toISOString()).first<{nonce:string;verifier:string}>();
  deleteCookie(c,flowCookie,{path:"/auth/google",prefix:"secure"});
  if(!flow) return fail(c,401,"invalid_login","Google sign-in could not be verified.");
  try {
    const response=await c.var.fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({client_id:c.env.GOOGLE_CLIENT_ID,client_secret:c.env.GOOGLE_CLIENT_SECRET,code,code_verifier:flow.verifier,grant_type:"authorization_code",redirect_uri:`${c.env.API_URL}/auth/google/callback`}),signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw Error();
    const tokens=await response.json() as {id_token?:string};
    const verify=createOidcVerifier({issuer:["https://accounts.google.com","accounts.google.com"],audience:c.env.GOOGLE_CLIENT_ID,jwksUrl:"https://www.googleapis.com/oauth2/v3/certs",fetch:(i,o)=>c.var.fetch(i,{...o,signal:AbortSignal.timeout(8000)}),now:c.var.now,requireAuthTime:false,requireAuthorizedParty:true});
    const result=await verify(tokens.id_token??"",{nonce:flow.nonce});
    if(!result.ok || result.claims.email_verified!==true || typeof result.claims.email!=="string" || !z.email().safeParse(result.claims.email).success) throw Error();
    // Provider + sub is the identity key. Matching email never links two accounts.
    const identity=await establishIdentity(c,"google",result.claims.sub,result.claims.email);
    const hd=result.claims.hd;
    if(typeof hd === "string" && hd.length <= 253 && hd.includes(".") && hd.split(".").every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
      await c.env.DB.prepare("INSERT INTO identity_google_domains(identity_id,domain,verified_at) VALUES(?,?,?) ON CONFLICT(identity_id) DO UPDATE SET domain=excluded.domain,verified_at=excluded.verified_at").bind(identity.id,hd.toLowerCase(),c.var.now().toISOString()).run();
    } else await c.env.DB.prepare("DELETE FROM identity_google_domains WHERE identity_id=?").bind(identity.id).run();
    await recordIdentityFacts(c,identity);
    return c.redirect(`${c.env.APP_URL}/login?identity=verified`);
  } catch { return fail(c,401,"invalid_login","Google sign-in could not be verified."); }
});
