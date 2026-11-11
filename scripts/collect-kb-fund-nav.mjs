import {pathToFileURL} from 'node:url';
import {supportsPublishedFundNavGasVersion} from './issue860-fund-nav-release-compat.mjs';
import {classifyFundError} from './diagnose-backfill-status.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export const sourceUrl='https://www.funetf.co.kr/api/public/product/view/fundnav';
export function parseNav(data,from,to) {
  if(!Array.isArray(data)||!data.length)throw Error('NAV_SOURCE_EMPTY');
  const seen=new Map();
  for(const row of data){
    const raw=String(row.gijunYmd??'');
    if(!/^\d{8}$/.test(raw)||typeof row.gijunGa!=='number'||!Number.isFinite(row.gijunGa)||row.gijunGa<=0)throw Error('NAV_SOURCE_SCHEMA');
    const date=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
    if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('NAV_SOURCE_DATE');
    // Published endpoints can return boundary rows beyond the requested window.
    // Validate every row first, then ignore out-of-window dates without aborting
    // the entire in-range NAV import.
    if(date<from||date>to)continue;
    if(seen.has(date)&&seen.get(date)!==row.gijunGa)throw Error('NAV_SOURCE_CONFLICT');
    seen.set(date,row.gijunGa);
  }
  if(!seen.size)throw Error('NAV_SOURCE_NO_RANGE_ROWS');
  return [...seen].sort().map(([date,nav])=>({date,nav}));
}
// Public class NAV does not require the private GAS session. Persisting this
// source independently lets a stalled writer catch up after the gate reopens.
export async function readPublishedKbNav({from,to,fetchImpl=fetch}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||from>to)
    throw Error('NAV_SOURCE_RANGE');
  const source=new URL(sourceUrl);
  source.search=new URLSearchParams({fundCd:'KR5223AQ0185',gijunYmd:to.replaceAll('-',''),schNavMode:'',schNavStDt:from.replaceAll('-',''),schNavEdDt:to.replaceAll('-','')});
  let r;
  try{
    r=await fetchImpl(source,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.funetf.co.kr/product/fund/view/KR5223AQ0185'},signal:AbortSignal.timeout(60000)});
  }catch{
    throw Error('NAV_SOURCE_NETWORK_UNVERIFIED');
  }
  if(!r.ok)throw Error('NAV_SOURCE_HTTP_'+(Number.isInteger(r.status)?r.status:'UNKNOWN'));
  let data;
  try{data=await r.json();}
  catch{throw Error('NAV_SOURCE_JSON_UNVERIFIED');}
  const rows=parseNav(data,from,to);
  return {rows,sourceHref:source.href};
}

export async function runPublicSourceOnly({now=new Date(),fetchImpl=fetch}={}){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const offset=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const from=offset(-31),to=today;
  const {rows:received}=await readPublishedKbNav({from,to,fetchImpl});
  // Publishing a dated quote is not proof of same-day final NAV. Keep
  // current KST calendar-day quotes out of the archive's eligible history.
  const rows=received.filter(row=>row.date<today);
  if(!rows.length)throw Error('NAV_SOURCE_NO_PRIOR_DAY_ROWS');
  return {mode:'SOURCE_ONLY',writerInvoked:false,code:'F00002',classCode:'AQ018',
    sourceRows:rows.length,sameDayExcluded:received.length-rows.length,
    historicalCutoffExclusive:today,from,to,latestDate:rows.at(-1).date,rows};
}
export async function run({url,token,now=new Date(),fetchImpl=fetch,apply=false,
  retryDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('NAV_AUTH_MISSING');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const offset=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const from=offset(-31),to=today;
  // Only predefined operation/error enums reach public Actions logs. Never
  // expose GAS response bodies, raw exceptions, credentials or fund values.
  const request=async(action,args={},credential=token)=>{
    const phase=action==='getAutomationStatus'?'STATUS'
      :action==='previewFundNavImport'?'PREVIEW'
      :action==='getFundValuationStatus'?'VALUATION'
      :action==='collectKbFundNav'?(args.mode==='import'?'IMPORT':'REFRESH')
      :'UNKNOWN';
    const startedMs=Date.now();
    const stageAudit=outcome=>{
      if(!apply)return;
      console.error('FUND_NAV_STAGE code=F00002 phase='+phase+' outcome='+outcome
        +' elapsedMs='+Math.max(0,Date.now()-startedMs));
    };
    let r;
    try {
      r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(300000)});
    } catch(error) {
      const kind=['TimeoutError','AbortError'].includes(error?.name)?'TIMEOUT':'NETWORK';
      stageAudit(kind);
      // A timed-out import/refresh may already have committed. No blind retry.
      throw Error('NAV_'+phase+'_'+kind+'_UNVERIFIED');
    }
    if(!r.ok){stageAudit('HTTP_UNVERIFIED');throw Error('NAV_'+phase+'_HTTP_UNVERIFIED');}
    try{
      const payload=await r.json();
      const saved=['success','partial','failed'].includes(payload?.saveState)
        ?payload.saveState.toUpperCase():'UNREPORTED';
      stageAudit((payload?.status==='ok'?'ACK_':'REJECTED_')+saved);
      return payload;
    }catch(error){
      const kind=['TimeoutError','AbortError'].includes(error?.name)?'TIMEOUT'
        :error?.name==='TypeError'?'NETWORK':'JSON';
      stageAudit(kind);
      throw Error('NAV_'+phase+'_'+kind+'_UNVERIFIED');
    }
  };
  const probe=await request('getAutomationStatus',{},token==='NAV_AUTH_PROBE'?'NAV_AUTH_PROBE_ALT':'NAV_AUTH_PROBE');
  if(probe.status!=='error'||probe.message!=='인증 실패')throw Error('NAV_AUTH_GUARD');
  const status=await request('getAutomationStatus');
  if(status.status!=='ok'||!supportsPublishedFundNavGasVersion('KB',status.gasVersion))throw Error('NAV_VERSION');
  const a=status.automation;
  if(!a||a.closeRun?.state==='RUNNING'||a.tradeSnapshotWorkerLastResult?.status==='RUNNING'||a.tradeLedgerWriteUnverified||a.pendingTradeSnapshotRebuildFrom||a.tradeSnapshotDeferredCount>0)throw Error('NAV_WRITER_BUSY');
  if(['RUNNING','IN_PROGRESS'].includes(a.fundAttempt?.state))return {mode:'DEFERRED',complete:false,reason:'NAV_WRITER_BUSY',imported:0,derivedRepaired:0};
  const valuationTo=a.closeRun?.runDate;
  if(typeof valuationTo!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(valuationTo)||valuationTo<from||valuationTo>to)throw Error('NAV_CLOSE_DATE');
  const {rows:received,sourceHref}=await readPublishedKbNav({from,to,fetchImpl});
  // Private import must apply the same conservative day boundary as the
  // public archive; today's quote may change before official publication.
  const rows=received.filter(row=>row.date<today);
  if(!rows.length)throw Error('NAV_SOURCE_NO_PRIOR_DAY_ROWS');
  const input={code:'F00002',provider:'KB_VALUE_ST',classCode:'AQ018',ackWarnings:true,appendOnly:true,sourceText:'KR5223AQ0185 AQ018 S-T '+sourceHref,rows};
  const preview=await request('previewFundNavImport',{data:JSON.stringify(input)});
  if(preview.status!=='ok'||preview.errors?.length||preview.updates?.length||preview.warnings?.some(w=>w.reason!=='오늘 NAV는 공식 확정값인지 확인 필요'||w.date!==today)||!Array.isArray(preview.candidates))throw Error('NAV_PREVIEW_BLOCKED');
  const candidates=preview.candidates.map(({date,nav})=>({date,nav}));
  if(candidates.some(c=>!rows.some(row=>row.date===c.date&&row.nav===c.nav)))throw Error('NAV_PREVIEW_MISMATCH');
  if(!apply)return {mode:'DRY_RUN',sourceRows:rows.length,candidates:candidates.length,imported:0};
  let importAckRecovered=false;
  if(candidates.length){
    // One bounded import uses the existing production backup/manual-value guards.
    // A failed transport response can happen AFTER the GAS write. Never retry
    // the import; verify the exact persisted NAV with the existing read-only
    // preview instead. All ambiguous/partial outcomes remain hard failures.
    try {
      const result=await request('collectKbFundNav',{mode:'import',data:JSON.stringify({...input,rows:candidates})});
      if(result.status!=='ok'||result.saveState!=='success'||result.evaluation?.missingHoldings?.length)throw Error('NAV_IMPORT_UNVERIFIED');
    } catch(error) {
      if(!/^NAV_IMPORT_(?:HTTP|TIMEOUT|NETWORK|JSON)_UNVERIFIED$/.test(String(error?.message||'')))throw error;
      importAckRecovered=true;
    }
    // After a lost import ACK, only repeat the READ-ONLY exact NAV preview.
    // GAS may still be finishing an already-committed write. Never send
    // collectKbFundNav(import) twice, even if all readbacks are unavailable.
    let check;
    for(let attempt=0;attempt<(importAckRecovered?3:1);attempt++){
      try{
        check=await request('previewFundNavImport',{
          data:JSON.stringify({...input,rows:candidates})});
        break;
      }catch(error){
        if(!importAckRecovered)throw error;
        const transient=/^NAV_PREVIEW_(?:HTTP|TIMEOUT|NETWORK|JSON)_UNVERIFIED$/
          .test(String(error?.message||''));
        if(!transient||attempt===2)throw Error('NAV_IMPORT_UNVERIFIED');
        await retryDelay(2000*(attempt+1));
      }
    }
    if(check.status!=='ok'||check.candidates?.length||check.updates?.length||check.errors?.length||check.identical?.length!==candidates.length)throw Error('NAV_READBACK_FAILED');
    if(importAckRecovered){
      // A mere row count is insufficient to certify a lost ACK. Verify every
      // requested date and NAV appears as EXACTLY the same stored value.
      const verified=Array.isArray(check.identical)&&candidates.every(row=>
        check.identical.some(item=>item.date===row.date
          && Number(item.existingNav)===row.nav
          && Number(item.uploadedNav)===row.nav));
      if(!verified)throw Error('NAV_READBACK_FAILED');
    }
  }
  const valuation=async()=>{
    const r=await request('getFundValuationStatus',{from,to:valuationTo,code:'F00002'});
    const dates=r.fundResults?.F00002?.dates,seen=new Set();
    // A duplicate or out-of-window date is not permission to refresh twice.
    if(r.status!=='ok'||!Array.isArray(dates)||dates.length>32||dates.some(d=>{
      if(typeof d?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)
          ||d.date<from||d.date>valuationTo||seen.has(d.date))return true;
      seen.add(d.date);return false;
    }))throw Error('NAV_DERIVED_SCHEMA');
    return dates;
  };
  // A missing row is a recovery target just like an outdated row, but only
  // when a holding actually requires valuation on that date.
  const needsWrite=d=>d.valuationRequired!==false&&(
    ['WRITE_REQUIRED','NOT_CREATED'].includes(d.evaluationState)
    ||['WRITE_REQUIRED','NOT_CREATED'].includes(d.snapshotState));
  const pending=(await valuation()).filter(needsWrite);
  for(const day of pending){
    // Never write an unpublished/unknown NAV or a row without reconciled units.
    // Fixed error enums reveal which admission check stopped the writer
    // without logging NAV amounts, positions, dates or private GAS responses.
    if(!['EXISTING_CONFIRMED','NON_PUBLICATION_CARRY'].includes(day.navState))
      throw Error('NAV_DERIVED_NAV_STATE_UNVERIFIED');
    if(day.unitsApplied!==true)
      throw Error('NAV_DERIVED_UNITS_UNVERIFIED');
    if(day.reconciled!==true)
      throw Error('NAV_DERIVED_RECONCILIATION_UNVERIFIED');
    const r=await request('collectKbFundNav',{mode:'refresh',date:day.date});
    if(r.status!=='ok')throw Error('NAV_DERIVED_'+classifyFundError(r.message));
  }
  const final=await valuation();
  if(final.some(d=>needsWrite(d)||(d.valuationRequired===false
     ?d.evaluationState==='WRITE_REQUIRED'||d.snapshotState==='WRITE_REQUIRED'
     :!['EXISTING_VALID','NOT_REQUIRED'].includes(d.evaluationState)
      ||!['EXISTING_VALID','NOT_REQUIRED'].includes(d.snapshotState))))
    throw Error('NAV_DERIVED_PENDING');
  return {mode:'APPLY',sourceRows:rows.length,candidates:candidates.length,imported:candidates.length,derivedRepaired:pending.length,importAckRecovered};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{console.log(JSON.stringify(process.argv.includes('--source-only')
    ?await runPublicSourceOnly():await run({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.argv.includes('--apply')})));}
  catch(error){console.error(/^NAV_[A-Z_0-9]+$/.test(error?.message||'')?error.message:'KB_NAV_COLLECTION_FAILED');process.exitCode=1;}
}
