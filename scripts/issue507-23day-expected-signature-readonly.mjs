#!/usr/bin/env node
// Issue #507 — fail-closed, read-only 23-date official GAS expected A:K signature gate.
// Trial manifest stays in protected environment secrets, never source control or logs.
// No writer, deployment, cleanup, or data mutation endpoint is reachable here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const DATES = Object.freeze([
  ...Array.from({length:17},(_,i)=>'2026-01-'+String(i+7).padStart(2,'0')),
  ...Array.from({length:6},(_,i)=>'2026-01-'+String(i+25))
]);
const SOURCE_ERRORS=new Set(['SOURCE_INCOMPLETE','PRICE_SUSPICIOUS']);
const STATUSES=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT','NO_SNAPSHOT']);
const CHUNK=5;
const HASH=/^[a-f0-9]{64}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
function fail(code){throw new Error('ISSUE507_23DAY_'+code);}
function guard(ok,code){if(!ok)fail(code);}
function iso(value){
  return typeof value==='string'&&DATE.test(value)&&
    !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&
    new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
function normCode(raw){
  const code=String(raw??'').trim().toUpperCase();
  if(/^\d+$/.test(code))return code.padStart(6,'0');
  return /^[A-Z0-9][A-Z0-9.-]{0,29}$/.test(code)?code:'';
}
function num(v){const n=Number(v);guard(typeof v==='number'&&Number.isFinite(n),'NUMBER');return n;}
function normSignature(row,day){
  guard(Array.isArray(row)&&row.length===12&&row[0]===day&&
    (row[11]===''||row[11]===null),'ROW_SHAPE');
  const code=normCode(row[1]);
  guard(code&&String(row[2]??'').trim()&&code===String(row[1]).trim().toUpperCase(),'ROW_ID');
  const numbers=row.slice(3,10).map(num);
  guard(numbers[0]>0&&numbers[1]>=0&&numbers[2]>0&&numbers[3]>0&&numbers[4]>0,'ROW_NUMBERS');
  const source=String(row[10]??'').trim().toUpperCase();
  guard(source==='KRX'||source==='FUND_NAV'||
    /^KRX_CARRY@20\d{2}-\d{2}-\d{2}$/.test(source)||
    /^FUND_NAV_CARRY(@20\d{2}-\d{2}-\d{2})?$/.test(source),'ROW_SOURCE');
  const carry=source.includes('@')?source.split('@')[1]:null;
  guard(!carry||(iso(carry)&&carry<=day),'FUTURE_CARRY');
  return {code,serial:JSON.stringify([day,code,String(row[2]).trim(),...numbers,source])};
}
export function digestRows(rows,day){
  guard(iso(day)&&Array.isArray(rows)&&rows.length===33,'ROW_COUNT');
  const p=rows.map(x=>normSignature(x,day));
  guard(new Set(p.map(x=>x.code)).size===33,'DUPLICATE_CODE');
  return createHash('sha256').update(JSON.stringify(p.map(x=>x.serial).sort())).digest('hex');
}
export function manifestFromJson(raw){
  guard(typeof raw==='string'&&raw.length<=12000&&raw.length>0,'MANIFEST_MISSING');
  let x;try{x=JSON.parse(raw)}catch{fail('MANIFEST_JSON')}
  guard(x&&typeof x==='object'&&!Array.isArray(x),'MANIFEST_SCHEMA');
  const keys=Object.keys(x);
  guard(keys.length===DATES.length&&
    keys.sort().join('|')===DATES.slice().sort().join('|')&&
    keys.every(k=>typeof x[k]==='string'&&HASH.test(x[k])),'MANIFEST_COVERAGE');
  return x;
}
function checkBatch(payload,selected,manifest,previous){
  guard(payload?.status==='ok'&&Array.isArray(payload.checkedDates)&&
    payload.checkedDates.length===selected.length&&
    payload.checkedDates.every((x,i)=>x===selected[i]),'DATE_SCOPE');
  guard(HASH.test(payload.strictSourceDigest||'')&&
    typeof payload.integritySourceRevision==='string'&&
    payload.integritySourceRevision.length>0,'SOURCE_PROOF');
  guard(!previous||previous.digest===payload.strictSourceDigest&&
    previous.revision===payload.integritySourceRevision,'SOURCE_CHANGED');
  guard(Array.isArray(payload.diagnostics)&&payload.diagnostics.length===selected.length,
    'DIAG_COUNT');
  for(let i=0;i<selected.length;i++){
    const d=payload.diagnostics[i],date=selected[i];
    guard(d?.date===date&&!SOURCE_ERRORS.has(d.status)&&STATUSES.has(d.status)&&
      Array.isArray(d.sourceDataErrors)&&d.sourceDataErrors.length===0&&
      d.expectedRowCount===33,'GAS_EXPECTED_INVALID');
    const sha=digestRows(d.expectedRows,date);
    guard(sha===manifest[date],'EXPECTED_MANIFEST_MISMATCH');
  }
  return {digest:payload.strictSourceDigest,revision:payload.integritySourceRevision,
    dates:selected.length,rows:selected.length*33};
}
async function request(url,token,action,args,fetchImpl){
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:token}),
      signal:AbortSignal.timeout(240000)});
  }catch{fail('NETWORK')}
  guard(response?.ok,'HTTP');
  try{return await response.json()}catch{fail('JSON')}
}
function inventory(payload){
  guard(payload?.status==='ok'&&payload.gasVersion==='9.244'&&
    payload.automation?.gasVersion==='9.244'&&
    Array.isArray(payload.automation.tradeSnapshotDeferredDates)&&
    payload.automation.tradeSnapshotDeferredDates.length<=60,'INVENTORY_SCHEMA');
  const dates=payload.automation.tradeSnapshotDeferredDates;
  guard(dates.every(iso)&&DATES.every(d=>dates.includes(d)),'INVENTORY_DATES');
  return dates.join('|');
}
export async function verify({url,token,manifestJson,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  guard(typeof token==='string'&&token.length>0,'TOKEN');
  const manifest=manifestFromJson(manifestJson);
  const bogus='ISSUE507_23DAY_INVALID_AUTH_PROBE';
  const denied=await request(endpoint,bogus,'getAutomationStatus',{},fetchImpl);
  guard(denied?.status==='error'&&denied?.message==='인증 실패','AUTH_GUARD');
  const before=inventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  let prior=null,validated=0;
  for(let i=0;i<DATES.length;i+=CHUNK){
    const selected=DATES.slice(i,i+CHUNK);
    const batch=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
      {dates:selected.join(','),strictReadonly:'1'},fetchImpl);
    prior=checkBatch(batch,selected,manifest,prior);
    validated+=selected.length;
  }
  // Reread first date and inventory to detect concurrent revisions while verifying.
  const check=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:DATES[0],strictReadonly:'1'},fetchImpl);
  checkBatch(check,[DATES[0]],manifest,prior);
  const after=inventory(await request(endpoint,token,'getAutomationStatus',{},fetchImpl));
  guard(before===after,'QUEUE_CHANGED');
  guard(validated===23,'DATE_TOTAL');
  return {mode:'READ_ONLY_23DAY_EXPECTED_PROOF',status:'MATCH_ALL',
    checkedDates:23,checkedRows:759,sourceStableWithinRun:true,
    trialManifestMatched:true,restoreAllowed:false,deleteAllowed:false,writes:0};
}
export async function selfTest(){
  const rows=day=>Array.from({length:33},(_,i)=>[
    day,i<30?String(i+1).padStart(6,'0'):'F'+String(i-29).padStart(5,'0'),
    'TEST'+i,1,100,100,100,100,0,0,i<30?'KRX':'FUND_NAV','']);
  const manifest=Object.fromEntries(DATES.map(day=>[day,digestRows(rows(day),day)]));
  const manifestJson=JSON.stringify(manifest);
  assert.equal(DATES.length,23);
  assert.equal(manifestFromJson(manifestJson)[DATES[0]].length,64);
  assert.throws(()=>manifestFromJson(JSON.stringify({...manifest,extra:'a'.repeat(64)})),/MANIFEST_COVERAGE/);
  assert.throws(()=>digestRows(rows(DATES[0]).map((r,i)=>i===1?[...r.slice(0,1),r[0],...r.slice(2)]:r),DATES[0]),/DUPLICATE_CODE|ROW_ID/);
  const changed=rows(DATES[0]);changed[0][6]+=1;
  assert.notEqual(digestRows(changed,DATES[0]),manifest[DATES[0]]);
  assert.throws(()=>digestRows(rows(DATES[0]).map((r,i)=>i===0?[...r.slice(0,10),'KRX_CARRY@2026-12-30','']:r),DATES[0]),/FUTURE_CARRY/);
  const status={status:'ok',gasVersion:'9.244',automation:{
    gasVersion:'9.244',tradeSnapshotDeferredDates:
      ['2025-12-31','2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05',...DATES]}};
  let calls=0;
  const stub=async(_url,opts)=>{
    calls++;
    const action=opts.body.get('action'),token=opts.body.get('accessToken');
    let payload;
    if(token!=='TEST_TOKEN')payload={status:'error',message:'인증 실패'};
    else if(action==='getAutomationStatus')payload=status;
    else{
      const dates=opts.body.get('dates').split(',');
      assert.equal(opts.body.get('strictReadonly'),'1');
      payload={status:'ok',checkedDates:dates,
        strictSourceDigest:'a'.repeat(64),integritySourceRevision:'123',
        diagnostics:dates.map(d=>({date:d,status:'NO_SNAPSHOT',expectedRowCount:33,
          expectedRows:rows(d),sourceDataErrors:[]}))};
    }
    return {ok:true,json:async()=>payload};
  };
  const ok=await verify({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',manifestJson,fetchImpl:stub});
  assert.equal(ok.status,'MATCH_ALL');
  assert.equal(ok.writes,0);
  assert.equal(calls,9);
  const badManifest={...manifest,[DATES[0]]:'b'.repeat(64)};
  await assert.rejects(()=>verify({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',manifestJson:JSON.stringify(badManifest),fetchImpl:stub}),
    /EXPECTED_MANIFEST_MISMATCH/);
  return {mode:'LOCAL_CONTRACT',status:'PASS',days:23,cases:9,writeEndpoints:0};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const data=process.argv.includes('--self-test')?await selfTest():
      await verify({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
        manifestJson:process.env.ISSUE507_TRIAL_MANIFEST_JSON});
    console.log(JSON.stringify(data));
  }catch(e){
    const msg=String(e?.message||'');
    console.error(/^ISSUE507_23DAY_[A-Z_]+$/.test(msg)?msg:'ISSUE507_23DAY_UNKNOWN');
    process.exitCode=1;
  }
}
