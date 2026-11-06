// F00001 / Hanwha C-RPe: bounded class-exact append-only NAV import.
// This is separate from F00002's KB-specific GAS collector. A stalled or
// uncertain import must not be retried blindly or overwrite existing NAV.
import {pathToFileURL} from 'node:url';
import {runPublicHanwhaSource} from './collect-hanwha-public-nav.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const CODE='F00001', PROVIDER='HANWHA_2045_CRPE', CLASS='C-RPe';
const STATE_OK=new Set(['EXISTING_CONFIRMED','NON_PUBLICATION_CARRY']);
const WRONG_STATES=new Set(['WRITE_REQUIRED','NOT_CREATED']);
const ISO=/^\d{4}-\d{2}-\d{2}$/;
function shiftDate(day,offset){
  return new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
}
function safeDay(s){return typeof s==='string'&&ISO.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function sameRows(received,expected){
  return Array.isArray(received)&&received.length===expected.length&&
    expected.every(e=>received.some(r=>r.date===e.date&&
      Number(r.existingNav)===e.nav&&Number(r.uploadedNav)===e.nav));
}
export async function run({url,token,now=new Date(),fetchImpl=fetch,apply=false}={}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('HANWHA_AUTH_MISSING');
  const today=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(now);
  if(!safeDay(today))throw Error('HANWHA_DATE_UNVERIFIED');
  const from=shiftDate(today,-7);
  const phaseOf=action=>({getAutomationStatus:'STATUS',previewFundNavImport:'PREVIEW',
    importFundNav:'IMPORT',getFundValuationStatus:'VALUATION'})[action]||'UNKNOWN';
  // Uniform conservative error enums. Do not log response, NAV, account or tokens.
  const request=async(action,args={},credential=token)=>{
    const phase=phaseOf(action);
    let response;
    try{
      response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
        headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:new URLSearchParams({action,...args,accessToken:credential}),
        signal:AbortSignal.timeout(300000)});
    }catch(e){
      throw Error('HANWHA_'+phase+'_'
        +(['AbortError','TimeoutError'].includes(e?.name)?'TIMEOUT':'NETWORK')+'_UNVERIFIED');
    }
    if(!response?.ok)throw Error('HANWHA_'+phase+'_HTTP_UNVERIFIED');
    try{return await response.json();}
    catch{throw Error('HANWHA_'+phase+'_JSON_UNVERIFIED');}
  };
  const probe=await request('getAutomationStatus',{},'HANWHA_AUTH_PROBE');
  if(probe.status!=='error'||probe.message!=='인증 실패')
    throw Error('HANWHA_AUTH_GUARD');
  const state=await request('getAutomationStatus');
  if(state.status!=='ok'||!['9.282','9.283'].includes(state.gasVersion))
    throw Error('HANWHA_VERSION_UNVERIFIED');
  const a=state.automation;
  if(!a||a.closeRun?.state==='RUNNING'||a.tradeSnapshotWorkerLastResult?.status==='RUNNING'
    ||a.tradeLedgerWriteUnverified||a.pendingTradeSnapshotRebuildFrom
    ||a.tradeSnapshotDeferredCount>0)throw Error('HANWHA_WRITER_BUSY');
  if(['RUNNING','IN_PROGRESS'].includes(a.fundAttempt?.state))
    return {mode:'DEFERRED',reason:'HANWHA_WRITER_BUSY',imported:0};
  const closeDate=a.closeRun?.runDate;
  if(!safeDay(closeDate)||closeDate<from||closeDate>today)
    throw Error('HANWHA_CLOSE_DATE_UNVERIFIED');
  const publicSource=await runPublicHanwhaSource({now,fetchImpl});
  const rows=publicSource.rows.filter(row=>row.date>=from&&row.date<today&&
    row.date<=closeDate);
  if(!rows.length||rows.length>8)throw Error('HANWHA_SOURCE_RANGE_UNVERIFIED');
  const data={code:CODE,provider:PROVIDER,classCode:CLASS,
    appendOnly:true,ackWarnings:true,sourceText:'008942 HANWHA C-RPe',
    rows};
  const preview=await request('previewFundNavImport',{data:JSON.stringify(data)});
  if(preview.status!=='ok'||preview.code!==CODE||!Array.isArray(preview.candidates)
    ||preview.errors?.length||preview.updates?.length||preview.duplicates?.length
    ||preview.warnings?.length||preview.zeroUnits?.length)
    throw Error('HANWHA_PREVIEW_BLOCKED');
  const candidates=preview.candidates.map(r=>({date:r.date,nav:r.nav}));
  if(candidates.length>8||new Set(candidates.map(r=>r.date)).size!==candidates.length
    ||candidates.some(c=>!rows.some(r=>r.date===c.date&&r.nav===c.nav)))
    throw Error('HANWHA_PREVIEW_MISMATCH');
  if(!apply)return {mode:'DRY_RUN',sourceRows:rows.length,
    candidates:candidates.length,imported:0,writerInvoked:false};
  let lostAck=false;
  if(candidates.length){
    const payload=JSON.stringify({...data,rows:candidates});
    // Never retry this WRITE, even when HTTP fails: it may have committed.
    try{
      const result=await request('importFundNav',{data:payload});
      if(result.status!=='ok'||result.saveState!=='success'
        ||result.evaluation?.missingHoldings?.length)throw Error('HANWHA_IMPORT_UNVERIFIED');
    }catch(e){
      if(!/^HANWHA_IMPORT_(?:HTTP|NETWORK|TIMEOUT|JSON)_UNVERIFIED$/
        .test(String(e?.message||'')))throw e;
      lostAck=true;
    }
    let after;
    try{after=await request('previewFundNavImport',{data:payload});}
    catch{throw Error('HANWHA_IMPORT_READBACK_UNVERIFIED');}
    if(after.status!=='ok'||after.candidates?.length||after.updates?.length
      ||after.errors?.length||!sameRows(after.identical,candidates))
      throw Error('HANWHA_IMPORT_READBACK_UNVERIFIED');
  }
  const valuation=await request('getFundValuationStatus',{from,to:closeDate,code:CODE});
  const dates=valuation?.fundResults?.[CODE]?.dates,seen=new Set();
  if(valuation.status!=='ok'||!Array.isArray(dates)||dates.length>8
    ||dates.some(d=>{
      if(d?.code!==CODE||!safeDay(d.date)||d.date<from||d.date>closeDate
        ||seen.has(d.date)||typeof d.valuationRequired!=='boolean'
        ||typeof d.unitsApplied!=='boolean'||typeof d.reconciled!=='boolean')
        return true;
      seen.add(d.date);return false;
    }))throw Error('HANWHA_VALUATION_SCHEMA_UNVERIFIED');
  const pending=dates.filter(d=>d.valuationRequired&&(
    WRONG_STATES.has(d.evaluationState)||WRONG_STATES.has(d.snapshotState)));
  if(pending.some(d=>!STATE_OK.has(d.navState)||!d.unitsApplied||!d.reconciled))
    throw Error('HANWHA_DERIVED_SOURCE_UNVERIFIED');
  if(pending.length)throw Error('HANWHA_DERIVED_PENDING');
  return {mode:'APPLY',sourceRows:rows.length,candidates:candidates.length,
    imported:candidates.length,importAckRecovered:lostAck,derivedPending:0};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{console.log(JSON.stringify(await run({
    url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
    apply:process.argv.includes('--apply')})));}
  catch(e){
    console.error(/^HANWHA_[A-Z_]+$/.test(e?.message||'')?e.message:'HANWHA_COLLECTOR_UNVERIFIED');
    process.exitCode=1;
  }
}
