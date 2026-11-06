import { z } from "zod";
import { anchorMonth, anchorIntent, registryAdapter } from "../books/anchor";
import { Hono } from "hono";
import { booksJson, buildTree, ledgerLineHash, proofFor, type MonthBundle } from "@stenmont/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { AppEnv } from "../app";
import { createBundle } from "../books/close";
import { loadBooks } from "../books/load";
import { ledgerCsv, type BooksFormat } from "../books/csv";
import { periodBounds, reconcile, type Result } from "../books/reconcile";

export const booksRoutes=new Hono<AppEnv>();
booksRoutes.use("/:period/*",async(c,next)=>{
  try {periodBounds(c.req.param("period")!);} catch {return c.json({error:"invalid_period"},400);}
  c.header("Cache-Control","private, no-store"); await next();
});
booksRoutes.use("/:period",async(c,next)=>{
  try {periodBounds(c.req.param("period")!);} catch {return c.json({error:"invalid_period"},400);}
  c.header("Cache-Control","private, no-store"); await next();
});
async function locked(c:Parameters<typeof loadBooks>[0],period:string) {
  const r=await c.env.DB.prepare("SELECT bundle FROM books_closes WHERE merchant_id=? AND period=?").bind(c.var.merchantId,period).first<{bundle:string}>();
  return r?JSON.parse(r.bundle) as MonthBundle:null;
}
booksRoutes.get("/:period",async c=>{
  const period=c.req.param("period"), bundle=await locked(c,period);
  const snapshot=bundle?.snapshot??JSON.parse(booksJson(reconcile(await loadBooks(c,period))));
  const confirmed=await c.env.DB.prepare("SELECT tx_hash FROM books_anchors WHERE merchant_id=? AND period=?").bind(c.var.merchantId,period).first<{tx_hash:string}>();
  const signer=c.env.BOOKS_SIGNING_KEY?privateKeyToAccount(c.env.BOOKS_SIGNING_KEY as Hex).address:null;
  return c.json({locked:!!bundle,snapshot,bundle,signer,anchor:{status:confirmed?"anchored":"not_anchored",txHash:confirmed?.tx_hash??null,configured:!!c.env.ANCHOR_REGISTRY}});
});
booksRoutes.post("/:period/close",async c=>{
  const period=c.req.param("period");
  if(periodBounds(period).end>c.var.now().toISOString()) return c.json({error:"month_not_ended"},400);
  if(await locked(c,period)) return c.json({error:"month_already_closed"},409);
  if(!c.env.BOOKS_SIGNING_KEY) return c.json({error:"books_signing_unavailable"},503);
  const result=reconcile(await loadBooks(c,period));
  const bundle=await createBundle(c.var.merchantId,result,c.var.now().toISOString(),c.env.BOOKS_SIGNING_KEY as Hex);
  const inserted=await c.env.DB.prepare("INSERT OR IGNORE INTO books_closes(merchant_id,period,closed_at,bundle) VALUES(?,?,?,?)").bind(c.var.merchantId,period,bundle.closedAt,booksJson(bundle)).run();
  if(inserted.meta.changes!==1) return c.json({error:"month_already_closed"},409);
  return c.json({bundle,anchor:{status:"not_anchored",configured:!!c.env.ANCHOR_REGISTRY}},201);
});
booksRoutes.get("/:period/bundle",async c=>{
  const bundle=await locked(c,c.req.param("period"));
  return bundle?c.json(bundle):c.json({error:"month_not_closed"},404);
});
booksRoutes.get("/:period/proof/:seq",async c=>{
  const bundle=await locked(c,c.req.param("period"));
  if(!bundle) return c.json({error:"month_not_closed"},404);
  const seq=Number(c.req.param("seq"));
  if(!Number.isSafeInteger(seq)||seq<1||seq>bundle.lineCount) return c.json({error:"line_not_found"},404);
  const line=bundle.snapshot.lines[seq-1];
  const leaf=ledgerLineHash(bundle.merchantId,bundle.period,line);
  const tree=buildTree(bundle.snapshot.lines.map(l=>ledgerLineHash(bundle.merchantId,bundle.period,l)));
  return c.json({merchantId:bundle.merchantId,period:bundle.period,line,leaf,proof:proofFor(tree,tree.leaves.indexOf(leaf)),root:bundle.root});
});
booksRoutes.get("/:period/export/:format",async c=>{
  const format=c.req.param("format");
  if(!["ledger","quickbooks","xero"].includes(format)) return c.json({error:"invalid_format"},400);
  const period=c.req.param("period"),bundle=await locked(c,period);
  // Rehydrate the fixed snapshot only; a locked export never queries live source data.
  const snapshot=bundle?bundle.snapshot:JSON.parse(booksJson(reconcile(await loadBooks(c,period))));
  const result={...snapshot,lines:snapshot.lines.map((l:any)=>({...l,amount:BigInt(l.amount),usdtValue:l.usdtValue===null?null:BigInt(l.usdtValue)}))} as Result;
  return new Response(ledgerCsv(result,format as BooksFormat),{headers:{"content-type":"text/csv; charset=utf-8","cache-control":"private, no-store"}});
});

booksRoutes.get("/:period/anchor-intent",async c=>{
  if(!c.env.ANCHOR_REGISTRY) return c.json({error:"anchor_not_configured"},503);
  const bundle=await locked(c,c.req.param("period"));
  if(!bundle) return c.json({error:"month_not_closed"},404);
  if(!bundle.lineCount) return c.json({error:"empty_month_cannot_anchor"},400);
  return c.json(await anchorIntent(c,bundle.period,bundle.root,bundle.lineCount));
});
const consentSchema=z.object({signature:z.string().regex(/^0x(?:[a-fA-F0-9]{2})+$/).max(20000),deadline:z.string().regex(/^\d{1,20}$/)});
booksRoutes.post("/:period/anchor",async c=>{
  if(!c.env.ANCHOR_REGISTRY) return c.json({error:"anchor_not_configured"},503);
  const consent=consentSchema.safeParse(await c.req.json().catch(()=>null));
  if(!consent.success) return c.json({error:"invalid_merchant_consent"},400);
  const bundle=await locked(c,c.req.param("period"));
  if(!bundle) return c.json({error:"month_not_closed"},404);
  if(!bundle.lineCount) return c.json({error:"empty_month_cannot_anchor"},400);
  const deadline=BigInt(consent.data.deadline),now=BigInt(Math.floor(c.var.now().getTime()/1000));
  if(deadline<now || deadline>now+3600n) return c.json({error:"invalid_deadline"},400);
  try {
    const receipt=await anchorMonth(bundle.root,bundle.period,bundle.lineCount,registryAdapter(c,{signature:consent.data.signature as Hex,deadline,lineCount:bundle.lineCount}));
    await c.env.DB.prepare("INSERT OR IGNORE INTO books_anchors(merchant_id,period,tx_hash,confirmed_at) VALUES(?,?,?,?)").bind(c.var.merchantId,bundle.period,receipt.txHash,c.var.now().toISOString()).run();
    return c.json({status:"anchored",txHash:receipt.txHash});
  } catch {return c.json({error:"anchor_not_confirmed"},502);}
});
