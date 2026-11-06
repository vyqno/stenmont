"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, AuthError } from "../lib/auth";
import { apiBase } from "../lib/pay";
export function IdentitySignIn({ link = false }: {link?:boolean}) {
  const router=useRouter();
  const [email,setEmail]=useState("");const [code,setCode]=useState("");const [id,setId]=useState("");
  const [verified,setVerified]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  useEffect(()=>{void api.get<{linked:boolean;email:string}>("/auth/identity").then(r=>{setVerified(true);setEmail(r.email);if(r.linked&&!link)router.push("/dashboard");}).catch(()=>{});},[link,router]);
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setNotice("");
    try {
      if(!id) {const r=await api.post<{id:string}>("/auth/email/start",{email});setId(r.id);setNotice("Enter the code sent to your email. It expires in 10 minutes.");}
      else {const r=await api.post<{linked:boolean}>("/auth/email/verify",{id,code});setVerified(true);setCode("");if(r.linked&&!link)router.push("/dashboard");else setNotice("Email verified. Create or sign in with your business passkey, then link this identity in Settings.");}
    } catch(e){setNotice(e instanceof AuthError?e.message:"Sign-in could not be completed. Please retry.");}
    finally{setBusy(false);}
  }
  async function connect() {
    setBusy(true);
    try{await api.post("/auth/identity/link");setNotice("Verified identity linked. You can use it to recover read-only dashboard access. Your passkey still controls account actions.");}
    catch(e){setNotice(e instanceof AuthError?e.message:"Linking failed.");}
    finally{setBusy(false);}
  }
  return <section className="flex flex-col gap-3 border-t border-line pt-5" aria-label="Email and Google sign-in">
    <h2 className="font-medium">{link?"Verified email and recovery":"Continue with email or Google"}</h2>
    <p className="text-sm text-muted">Email and Google can restore dashboard access. A passkey is still required to activate your payout account and authorize actions.</p>
    {!verified&&<form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm">Email<input type="email" autoComplete="email" required maxLength={254} disabled={!!id||busy} value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 block w-full rounded border border-line p-3"/></label>
      {id&&<label className="text-sm">One-time code<input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{8}" value={code} onChange={e=>setCode(e.target.value)} className="mt-1 block w-full rounded border border-line p-3"/></label>}
      <button disabled={busy} className="rounded border border-line px-4 py-3">{busy?"Working…":id?"Verify code":"Send sign-in code"}</button>
      {id&&<button type="button" disabled={busy} onClick={()=>{setId("");setCode("");}}>Use another email</button>}
    </form>}
    {verified&&<p className="text-sm">Verified email: {email}</p>}
    {verified&&link&&<button disabled={busy} onClick={connect} className="rounded border border-line px-4 py-3">Link verified identity to this business</button>}
    <button className="text-left underline" onClick={()=>router.push(`${apiBase(location.hostname)}/auth/google/start`)}>Continue with Google</button>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
  </section>;
}
