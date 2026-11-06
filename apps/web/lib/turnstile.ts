import { apiBase } from "./pay";
type Turnstile = { render(node: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
declare global { interface Window { turnstile?: Turnstile } }
let loading: Promise<void> | undefined;
function load() {
  if(window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve,reject)=>{
    const script=document.createElement("script"); script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async=true;
    script.onload=()=>resolve(); script.onerror=()=>{loading=undefined;reject(new Error("Security check could not load. Please retry."));};
    document.head.appendChild(script);
  });
  return loading;
}
export async function turnstileToken(action: "signup" | "activate"): Promise<string | undefined> {
  const response=await fetch(`${apiBase(location.hostname)}/auth/config`,{credentials:"include"});
  if(!response.ok) throw Error("Sign-up protection is not configured. Please try later.");
  const {turnstileSiteKey}=await response.json() as {turnstileSiteKey:string|null};
  if(!turnstileSiteKey) return undefined; // Only local/unit fixture configuration permits this.
  await load();
  return new Promise<string>((resolve,reject)=>{
    const node=document.createElement("div"); node.setAttribute("aria-label","Security check");document.body.appendChild(node);
    const widget: {id?:string} = {};
    const clean=()=>{clearTimeout(timer);if(widget.id)window.turnstile?.remove(widget.id);node.remove();};
    const timer=setTimeout(()=>{clean();reject(Error("The security check timed out. Please retry."));},120_000);
    widget.id=window.turnstile!.render(node,{sitekey:turnstileSiteKey,action,theme:"auto",callback:(token:string)=>{clean();resolve(token);},"error-callback":()=>{clean();reject(Error("Security check failed. Please retry."));},"expired-callback":()=>{clean();reject(Error("Security check expired. Please retry."));}});
  });
}
