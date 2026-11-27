// Preview the crosschecked same-run archive against the existing GAS API.
// No import, refresh, close resume, deployment or financial writes.
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {selectCrosscheckedCandidate} from './nav-crosschecked-candidate.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {supportsPublishedFundNavGasVersion} from './issue860-fund-nav-release-compat.mjs';

export async function previewCrosscheckedNav({archive,url,token,now=new Date(),fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||!token.trim())throw Error('NAV_CANDIDATE_AUTH_MISSING');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const sources=['F00002','F00001'].map(code=>selectCrosscheckedCandidate(archive,code,today));
 const request=async(action,args={},credential=token)=>{
  if(!['getAutomationStatus','previewFundNavImport'].includes(action))throw Error('NAV_CANDIDATE_READ_ONLY');
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,...args,accessToken:credential}),signal:AbortSignal.timeout(90000)});}
  catch{throw Error('NAV_CANDIDATE_GAS_NETWORK_UNVERIFIED');}
  if(!response?.ok)throw Error('NAV_CANDIDATE_GAS_HTTP_UNVERIFIED');
  try{return await response.json();}catch{throw Error('NAV_CANDIDATE_GAS_JSON_UNVERIFIED');}
 };
 const probe=await request('getAutomationStatus',{},token==='NAV_AUTH_PROBE'?'NAV_AUTH_PROBE_ALT':'NAV_AUTH_PROBE');
 if(probe?.status!=='error'||probe.message!=='인증 실패')throw Error('NAV_CANDIDATE_AUTH_GUARD');
 const status=await request('getAutomationStatus');
 if(status?.status!=='ok'||!supportsPublishedFundNavGasVersion('KB',status.gasVersion)
  ||!supportsPublishedFundNavGasVersion('HANWHA',status.gasVersion))throw Error('NAV_CANDIDATE_VERSION_UNVERIFIED');
 const close=status.automation?.closeRun?.runDate;
 if(typeof close!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(close)||!Number.isFinite(Date.parse(close+'T00:00:00Z'))
   ||new Date(close+'T00:00:00Z').toISOString().slice(0,10)!==close||close>today
   ||(Date.parse(today)-Date.parse(close))/86400000>7)
  throw Error('NAV_CANDIDATE_CLOSE_DATE_UNVERIFIED');
 const results=[];
 for(const source of sources){
  const rows=source.rows.filter(r=>r.date<=close);
  if(rows.length<3)throw Error('NAV_CANDIDATE_CLOSE_RANGE_UNVERIFIED');
  const input={code:source.code,provider:source.provider,classCode:source.classCode,
   sourceText:source.sourceText,appendOnly:true,ackWarnings:false,rows};
  const p=await request('previewFundNavImport',{data:JSON.stringify(input)});
  if(p?.status!=='ok'||p.code!==source.code
    ||!['candidates','identical','updates','warnings','errors','duplicates','zeroUnits'].every(k=>Array.isArray(p[k]))
    ||['updates','warnings','errors','duplicates','zeroUnits'].some(k=>p[k].length))
   throw Error('NAV_CANDIDATE_PREVIEW_BLOCKED');
  const covered=[...p.candidates.map(x=>({date:x.date,nav:x.nav})),
   ...p.identical.map(x=>({date:x.date,nav:x.existingNav,uploadedNav:x.uploadedNav,identical:true}))];
  if(covered.length!==rows.length||new Set(covered.map(x=>x.date)).size!==rows.length
    ||covered.some(x=>!rows.some(r=>r.date===x.date&&r.nav===x.nav
      &&(!x.identical||r.nav===x.uploadedNav))))
   throw Error('NAV_CANDIDATE_PREVIEW_MISMATCH');
  // New source may not write before re-proving exact persisted historical overlap.
  if(!p.identical.length)throw Error('NAV_CANDIDATE_PERSISTED_OVERLAP_UNVERIFIED');
  const checkedDates=rows.map(r=>r.date);
  const eligibleRequested=source.requestedDates.filter(d=>d<=close);
  results.push({code:source.code,checkedDates,identicalCount:p.identical.length,
   candidateCount:p.candidates.length,identicalDates:p.identical.map(x=>x.date).sort(),
   candidateDates:p.candidates.map(x=>x.date).sort(),unverifiedDates:source.unverifiedDates,
   latestRequestedDateCrosschecked:source.rows.some(r=>r.date===source.requestedDates.at(-1)),
   allRequestedDatesCrosschecked:source.unverifiedDates.length===0,
   allCloseEligibleDatesPreviewed:eligibleRequested.every(d=>checkedDates.includes(d))});
 }
 return {kind:'NAV_CANDIDATE_GAS_PREVIEW_READ_ONLY',gasVersion:status.gasVersion,
  results,financialWrites:0,importAuthorized:false,writerInvoked:false};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{
  const archive=JSON.parse(readFileSync(process.argv[2]||'', 'utf8'));
  console.log(JSON.stringify(await previewCrosscheckedNav({archive,url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
 }catch(e){console.error(/^NAV_CANDIDATE_[A-Z_]+$/.test(e?.message||'')?e.message:'NAV_CANDIDATE_PREVIEW_UNVERIFIED');process.exitCode=1;}
}
