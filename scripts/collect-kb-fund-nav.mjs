import {pathToFileURL} from 'node:url';
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
    if(date<from||date>to)throw Error('NAV_SOURCE_RANGE');
    if(seen.has(date)&&seen.get(date)!==row.gijunGa)throw Error('NAV_SOURCE_CONFLICT');
    seen.set(date,row.gijunGa);
  }
  return [...seen].sort().map(([date,nav])=>({date,nav}));
}
export async function run({url,token,now=new Date(),fetchImpl=fetch,apply=false}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('NAV_AUTH_MISSING');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const offset=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const from=offset(-31),to=today;
  const request=async(action,args={},credential=token)=>{
    const r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(300000)});
    if(!r.ok)throw Error('NAV_GAS_HTTP');
    return r.json();
  };
  const probe=await request('getAutomationStatus',{},token==='NAV_AUTH_PROBE'?'NAV_AUTH_PROBE_ALT':'NAV_AUTH_PROBE');
  if(probe.status!=='error'||probe.message!=='인증 실패')throw Error('NAV_AUTH_GUARD');
  const status=await request('getAutomationStatus');
  if(status.status!=='ok'||status.gasVersion!=='9.280')throw Error('NAV_VERSION');
  const a=status.automation;
  if(!a||a.closeRun?.state==='RUNNING'||a.tradeSnapshotWorkerLastResult?.status==='RUNNING'||a.tradeLedgerWriteUnverified||a.pendingTradeSnapshotRebuildFrom||a.tradeSnapshotDeferredCount>0)throw Error('NAV_WRITER_BUSY');
  if(['RUNNING','IN_PROGRESS'].includes(a.fundAttempt?.state))return {mode:'DEFERRED',complete:false,reason:'NAV_WRITER_BUSY',imported:0,derivedRepaired:0};
  const valuationTo=a.closeRun?.runDate;
  if(typeof valuationTo!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(valuationTo)||valuationTo<from||valuationTo>to)throw Error('NAV_CLOSE_DATE');
  const source=new URL(sourceUrl);
  source.search=new URLSearchParams({fundCd:'KR5223AQ0185',gijunYmd:to.replaceAll('-',''),schNavMode:'',schNavStDt:from.replaceAll('-',''),schNavEdDt:to.replaceAll('-','')});
  const r=await fetchImpl(source,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.funetf.co.kr/product/fund/view/KR5223AQ0185'},signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('NAV_SOURCE_HTTP_'+(Number.isInteger(r.status)?r.status:'UNKNOWN'));
  const rows=parseNav(await r.json(),from,to);
  const input={code:'F00002',provider:'KB_VALUE_ST',classCode:'AQ018',ackWarnings:true,appendOnly:true,sourceText:'KR5223AQ0185 AQ018 S-T '+source.href,rows};
  const preview=await request('previewFundNavImport',{data:JSON.stringify(input)});
  if(preview.status!=='ok'||preview.errors?.length||preview.updates?.length||preview.warnings?.some(w=>w.reason!=='오늘 NAV는 공식 확정값인지 확인 필요'||w.date!==today)||!Array.isArray(preview.candidates))throw Error('NAV_PREVIEW_BLOCKED');
  const candidates=preview.candidates.map(({date,nav})=>({date,nav}));
  if(candidates.some(c=>!rows.some(row=>row.date===c.date&&row.nav===c.nav)))throw Error('NAV_PREVIEW_MISMATCH');
  if(!apply)return {mode:'DRY_RUN',sourceRows:rows.length,candidates:candidates.length,imported:0};
  if(candidates.length){
  // One bounded import uses the existing production backup/manual-value guards.
  // A timeout is unverified: do not blindly retry a possibly committed write.
  const result=await request('collectKbFundNav',{mode:'import',data:JSON.stringify({...input,rows:candidates})});
  if(result.status!=='ok'||result.saveState!=='success'||result.evaluation?.missingHoldings?.length)throw Error('NAV_IMPORT_UNVERIFIED');
  const check=await request('previewFundNavImport',{data:JSON.stringify({...input,rows:candidates})});
  if(check.status!=='ok'||check.candidates?.length||check.updates?.length||check.errors?.length||check.identical?.length!==candidates.length)throw Error('NAV_READBACK_FAILED');
  }
  const valuation=async()=>{
    const r=await request('getFundValuationStatus',{from,to:valuationTo,code:'F00002'});
    const dates=r.fundResults?.F00002?.dates;
    if(r.status!=='ok'||!Array.isArray(dates)||dates.length>32||dates.some(d=>typeof d.date!=='string'||d.date<from||d.date>valuationTo))throw Error('NAV_DERIVED_SCHEMA');
    return dates;
  };
  const needsWrite=d=>d.evaluationState==='WRITE_REQUIRED'||d.snapshotState==='WRITE_REQUIRED';
  const pending=(await valuation()).filter(needsWrite);
  for(const day of pending){
    const r=await request('collectKbFundNav',{mode:'refresh',date:day.date});
    if(r.status!=='ok')throw Error('NAV_DERIVED_'+classifyFundError(r.message));
  }
  const final=await valuation();
  if(final.some(d=>needsWrite(d)||!['EXISTING_VALID','NOT_REQUIRED'].includes(d.evaluationState)||!['EXISTING_VALID','NOT_REQUIRED'].includes(d.snapshotState)))throw Error('NAV_DERIVED_PENDING');
  return {mode:'APPLY',sourceRows:rows.length,candidates:candidates.length,imported:candidates.length,derivedRepaired:pending.length};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  try{console.log(JSON.stringify(await run({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,apply:process.argv.includes('--apply')})));}
  catch(error){console.error(/^NAV_[A-Z_0-9]+$/.test(error?.message||'')?error.message:'KB_NAV_COLLECTION_FAILED');process.exitCode=1;}
}
