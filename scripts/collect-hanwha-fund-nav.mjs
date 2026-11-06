// F00001 Hanwha C-RPe: class-exact READ-ONLY NAV reconciliation preview.
// The current GAS importFundNav lacks the shared FUND/backfill lease, so live
// imports are disabled until a reviewed leased GAS endpoint is deployed.
import {pathToFileURL} from 'node:url';
import {runPublicHanwhaSource} from './collect-hanwha-public-nav.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const CODE='F00001',PROVIDER='HANWHA_2045_CRPE',CLASS='C-RPe';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDay=d=>typeof d==='string'&&DATE.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export async function run({url,token,now=new Date(),fetchImpl=fetch,apply=false}={}){
 // Refuse an accidental --apply even when credentials are otherwise valid.
 if(apply)throw Error('HANWHA_LEASED_WRITER_UNAVAILABLE');
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('HANWHA_AUTH_MISSING');
 const today=new Intl.DateTimeFormat('en-CA',{
   timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
 }).format(now);
 if(!validDay(today))throw Error('HANWHA_DATE_UNVERIFIED');
 const from=shift(today,-7);
 const request=async(action,args={},credential=token)=>{
   const phase=action==='getAutomationStatus'?'STATUS'
     :action==='previewFundNavImport'?'PREVIEW'
     :action==='getFundValuationStatus'?'VALUATION':'UNKNOWN';
   let response;
   try{
     response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
       headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
       body:new URLSearchParams({action,...args,accessToken:credential}),
       signal:AbortSignal.timeout(180000)});
   }catch(e){
     throw Error('HANWHA_'+phase+'_'
       +(['TimeoutError','AbortError'].includes(e?.name)?'TIMEOUT':'NETWORK')+'_UNVERIFIED');
   }
   if(!response?.ok)throw Error('HANWHA_'+phase+'_HTTP_UNVERIFIED');
   try{return await response.json();}
   catch{throw Error('HANWHA_'+phase+'_JSON_UNVERIFIED');}
 };
 const probe=await request('getAutomationStatus',{},'HANWHA_AUTH_PROBE');
 if(probe.status!=='error'||probe.message!=='인증 실패')throw Error('HANWHA_AUTH_GUARD');
 const state=await request('getAutomationStatus');
 if(state.status!=='ok'||!['9.282','9.283'].includes(state.gasVersion))
   throw Error('HANWHA_VERSION_UNVERIFIED');
 const a=state.automation;
 if(!a||a.closeRun?.state==='RUNNING'||a.tradeSnapshotWorkerLastResult?.status==='RUNNING'
   ||a.tradeLedgerWriteUnverified||a.pendingTradeSnapshotRebuildFrom
   ||a.tradeSnapshotDeferredCount>0||['RUNNING','IN_PROGRESS'].includes(a.fundAttempt?.state))
   throw Error('HANWHA_WRITER_BUSY');
 const closeDate=a.closeRun?.runDate;
 if(!validDay(closeDate)||closeDate<from||closeDate>today)
   throw Error('HANWHA_CLOSE_DATE_UNVERIFIED');
 const source=await runPublicHanwhaSource({now,fetchImpl});
 const rows=source.rows.filter(r=>r.date>=from&&r.date<today&&r.date<=closeDate);
 if(!rows.length||rows.length>8)throw Error('HANWHA_SOURCE_RANGE_UNVERIFIED');
 const data={code:CODE,provider:PROVIDER,classCode:CLASS,appendOnly:true,
   ackWarnings:true,sourceText:'008942 HANWHA C-RPe',rows};
 const preview=await request('previewFundNavImport',{data:JSON.stringify(data)});
 if(preview.status!=='ok'||preview.code!==CODE
   ||!['candidates','updates','warnings','errors','identical','duplicates','zeroUnits']
     .every(k=>Array.isArray(preview[k]))
   ||preview.errors.length||preview.updates.length||preview.warnings.length
   ||preview.duplicates.length||preview.zeroUnits.length)
   throw Error('HANWHA_PREVIEW_BLOCKED');
 const candidates=preview.candidates.map(r=>({date:r.date,nav:r.nav}));
 if(candidates.length>8||new Set(candidates.map(r=>r.date)).size!==candidates.length
   ||candidates.some(c=>!validDay(c.date)||!Number.isFinite(c.nav)||c.nav<=0
     ||!rows.some(r=>r.date===c.date&&r.nav===c.nav)))
   throw Error('HANWHA_PREVIEW_MISMATCH');
 const proof=await request('getFundValuationStatus',{from,to:closeDate,code:CODE});
 const dates=proof?.fundResults?.[CODE]?.dates,seen=new Set();
 if(proof.status!=='ok'||!Array.isArray(dates)||dates.length>8
   ||dates.some(d=>{
     if(d?.code!==CODE||!validDay(d.date)||d.date<from||d.date>closeDate
       ||seen.has(d.date)||typeof d.valuationRequired!=='boolean'
       ||typeof d.unitsApplied!=='boolean'||typeof d.reconciled!=='boolean')
       return true;
     seen.add(d.date);return false;
   }))throw Error('HANWHA_VALUATION_SCHEMA_UNVERIFIED');
 const pending=dates.filter(d=>d.valuationRequired&&
   (['WRITE_REQUIRED','NOT_CREATED'].includes(d.evaluationState)
     ||['WRITE_REQUIRED','NOT_CREATED'].includes(d.snapshotState)));
 return {mode:'DRY_RUN',code:CODE,sourceRows:rows.length,
   candidates:candidates.length,writerInvoked:false,
   pendingDates:pending.map(d=>d.date).sort(),
   missingNavDates:dates.filter(d=>d.navState==='NAV_MISSING').map(d=>d.date).sort()};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{console.log(JSON.stringify(await run({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   apply:process.argv.includes('--apply')})));}
 catch(e){
   console.error(/^HANWHA_[A-Z_]+$/.test(e?.message||'')?e.message:'HANWHA_PREVIEW_UNVERIFIED');
   process.exitCode=1;
 }
}
