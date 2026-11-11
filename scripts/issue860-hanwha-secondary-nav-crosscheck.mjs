#!/usr/bin/env node
// #860: compare exact Hanwha C-RPe public secondary NAVs with GAS persisted
// values via preview only. Never import, refresh or mutate a financial row.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {readHanwhaFunetf,HANWHA_CRPE_CLASS_ID} from './probe-hanwha-funetf-public.mjs';

async function request(url,token,action,args,fetchImpl) {
 let response;
 try{
  response=await fetchImpl(url,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,...args,accessToken:token}),
   signal:AbortSignal.timeout(90000)});
 }catch{throw Error('HANWHA_CROSSCHECK_GAS_NETWORK_UNVERIFIED');}
 if(response?.ok!==true)throw Error('HANWHA_CROSSCHECK_GAS_HTTP_UNVERIFIED');
 try{return await response.json();}
 catch{throw Error('HANWHA_CROSSCHECK_GAS_JSON_UNVERIFIED');}
}
function same(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&a===b;}
export async function verifyHanwhaSecondaryOverlap({
 url,token,now=new Date(),fetchImpl=fetch,sourceReader=readHanwhaFunetf
}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)throw Error('HANWHA_CROSSCHECK_AUTH_MISSING');
 const sourced=await sourceReader({now,fetchImpl});
 const today=sourced?.today,rows=sourced?.eligible;
 if(typeof today!=='string'||!/\d{4}-\d{2}-\d{2}/.test(today)||
   !Array.isArray(rows)||rows.length<1||rows.length>16||
   rows.some(r=>!r||typeof r.date!=='string'||r.date>=today||
     !Number.isFinite(r.nav)||r.nav<=0)||
   new Set(rows.map(x=>x.date)).size!==rows.length)
  throw Error('HANWHA_CROSSCHECK_SOURCE_UNVERIFIED');
 const status=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
 if(status?.status!=='ok'||status.gasVersion!=='9.289'||
   status.automation?.gasVersion!=='9.289')
  throw Error('HANWHA_CROSSCHECK_PUBLISHED_VERSION_UNVERIFIED');
 const input={code:'F00001',provider:'HANWHA_2045_CRPE',classCode:'C-RPe',
  appendOnly:true,ackWarnings:false,
  sourceText:'K55213C50702 C-RPe FunETF secondary READ_ONLY preview',
  rows};
 const payload=await request(endpoint,token,'previewFundNavImport',
  {data:JSON.stringify(input)},fetchImpl);
 const columns=['candidates','updates','warnings','errors','identical','duplicates','zeroUnits'];
 if(payload?.status!=='ok'||payload.code!=='F00001'||
   columns.some(k=>!Array.isArray(payload[k]))||
   payload.updates.length||payload.warnings.length||payload.errors.length||
   payload.duplicates.length||payload.zeroUnits.length)
  throw Error('HANWHA_CROSSCHECK_PREVIEW_BLOCKED');
 const sourceMap=new Map(rows.map(x=>[x.date,x.nav]));
 const identical=payload.identical, candidates=payload.candidates;
 const seen=new Set();
 for(const row of identical){
  if(!sourceMap.has(row.date)||seen.has(row.date)||
    !same(Number(row.existingNav),sourceMap.get(row.date))||
    !same(Number(row.uploadedNav),sourceMap.get(row.date)))
   throw Error('HANWHA_CROSSCHECK_SAVED_NAV_MISMATCH');
  seen.add(row.date);
 }
 for(const row of candidates){
  if(!sourceMap.has(row.date)||seen.has(row.date)||
    !same(Number(row.nav),sourceMap.get(row.date)))
   throw Error('HANWHA_CROSSCHECK_NEW_NAV_MISMATCH');
  seen.add(row.date);
 }
 if(seen.size!==sourceMap.size)
  throw Error('HANWHA_CROSSCHECK_UNACCOUNTED_SOURCE_ROWS');
 if(identical.length<1)
  throw Error('HANWHA_CROSSCHECK_NO_OFFICIAL_OVERLAP');
 return {
  kind:'ISSUE860_HANWHA_CRPE_SECONDARY_GAS_PREVIEW_READ_ONLY',
  status:'OVERLAP_MATCHED',gasVersion:'9.289',
  classCode:'C-RPe',fundId:HANWHA_CRPE_CLASS_ID,
  latestEligibleDate:rows.at(-1).date,
  sourceRows:rows.length,confirmedExactOverlaps:identical.length,
  sourceNewCandidates:candidates.length,
  appendOnly:true,importAuthorized:false,
  gasReads:2,gasWrites:0,financialWrites:0,deployments:0
 };
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{console.log(JSON.stringify(await verifyHanwhaSecondaryOverlap({
  url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
 })));}
 catch(e){const code=String(e?.message||'');
  console.error(/^HANWHA_CROSSCHECK_[A-Z_]+$/.test(code)
   ?code:'HANWHA_CROSSCHECK_UNVERIFIED');process.exitCode=1;}
}
