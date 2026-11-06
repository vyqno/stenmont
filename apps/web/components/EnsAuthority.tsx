"use client";
import { useState } from "react";
import { api } from "../lib/auth";
import { Card } from "./ui";
type Report={blockNumber:string;owner:string;expiry:string;directPayout:string;roleBitmaps:Record<string,string>;authority:{registered:boolean;transferPermission:boolean;recordAliasingAvailable:boolean;financeCanEditProfile:boolean;collectionsCanEditContext:boolean;warning:string}};
export function EnsAuthority(){
 const [member,setMember]=useState(""),[report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function inspect(){setBusy(true);setError("");setReport(null);try{setReport(await api.get<Report>(`/v1/ens/authority${member?`?member=${encodeURIComponent(member)}`:""}`));}catch(e){setError(e instanceof Error?e.message:"Authority could not be read.");}finally{setBusy(false);}}
 return <Card title="Deployed ENS authority"><p className="text-sm text-muted">Read the actual registry and resolver at one Sepolia block. Owning a name does not grant permission to change its payout.</p>
 <label className="mt-3 block text-sm">Member address to inspect (optional)<input value={member} onChange={e=>setMember(e.target.value)} className="mt-1 block w-full rounded border border-line p-2 font-mono text-sm" placeholder="Defaults to your business account" /></label>
 <button disabled={busy} onClick={()=>void inspect()} className="mt-3 rounded border border-line px-4 py-2 disabled:opacity-50">{busy?"Reading Sepolia…":"Inspect onchain authority"}</button>
 {error&&<p role="alert" className="mt-3 text-danger">{error}</p>}
 {report&&<div className="mt-4 space-y-2 text-sm" role="status"><p>Observed at Sepolia block {report.blockNumber}. Name {report.authority.registered?"registered":"not currently registered"}.</p><p className="break-all">Recorded owner: {report.owner}</p><p className="break-all">Direct resolver payout: {report.directPayout}</p><ul className="list-disc pl-5"><li>Owner transfer permission: {report.authority.transferPermission?"present; other checks still apply":"absent — current name cannot be transferred by its owner"}</li><li>Finance profile write: {report.authority.financeCanEditProfile?"present":"absent"}</li><li>Agent context write on this resolver: {report.authority.collectionsCanEditContext?"present":"absent"}</li><li>Registrar record-bundle linking: {report.authority.recordAliasingAvailable?"present":"absent"}</li><li>Auditor: public records are readable without a write grant. Private books require separate business authorization.</li></ul><p>{report.authority.warning}</p><p>Invoice names resolving to a current claim holder are not configured. A new cross-chain resolver design needs separate review.</p></div>}
 </Card>;
}
