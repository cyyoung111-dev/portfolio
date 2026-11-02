import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fetchNhNightProbeFromGas,callNhGasProxy} from './nh-gas-proxy.mjs';

// One-time production read-only diagnostic. No Telegram, financial sheet writes,
// NH OAuth bootstrap or after-the-fact creation of a 06:00 price record.
export const TARGET_DAY='2026-11-02';
export function kstProbeTime(instant){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(instant).map(x=>[x.type,x.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,
    minute:Number(parts.hour)*60+Number(parts.minute)};
}
export async function verifyTodayNhNight({
  now=()=>new Date(),probe=fetchNhNightProbeFromGas,
  diagnose=async date=>callNhGasProxy('getNhNightProbe',{date})
}={}){
  const t=kstProbeTime(now());
  if(t.date!==TARGET_DAY||t.minute<480||t.minute>=780)
    return {status:'OUTSIDE_READ_ONLY_PROBE_WINDOW',date:t.date,verified:false};
  const errors=[];
  let v=null;
  try{v=await probe(TARGET_DAY,{now,onError:code=>{
    if(/^NH_PROXY_[A-Z0-9_]{1,70}$/.test(code))errors.push(code);
  }});}catch{errors.push('NH_PROBE_CALL_FAILED');}
  if(!v){
    // Classify once through the same cached, read-only GAS action. Return
    // only fixed reason enums, never raw response bodies or token contents.
    let detail='NH_PROBE_DETAIL_UNAVAILABLE';
    try{
      const body=await diagnose(TARGET_DAY);
      const r=body?.reference;
      if(body?.diagnosticOnly!==true||body?.tokenIssued!==false
        ||body?.bearerExposed!==false)detail='NH_PROBE_OUTER_CONTRACT_INVALID';
      else if(r==null)detail='NH_PROBE_REFERENCE_EMPTY';
      else if(typeof r!=='object'||Array.isArray(r))detail='NH_PROBE_REFERENCE_SCHEMA_INVALID';
      else if(r.source!=='NH'||r.kind!=='REFERENCE'
        ||r.tradingDate!==TARGET_DAY||r.sourceUpdatedAt!==TARGET_DAY+'T06:00:00+09:00')
        detail='NH_PROBE_REFERENCE_PROVENANCE_MISMATCH';
      else if(!Number.isFinite(Date.parse(r.receivedAt||''))
        ||Date.parse(r.receivedAt)>now().getTime())
        detail='NH_PROBE_RECEIPT_TIME_INVALID';
      else if(!(Number(r.value)>0)||!/^K[A-Z0-9]{8}$/.test(r.contract||''))
        detail='NH_PROBE_VALUE_OR_CONTRACT_INVALID';
      else detail='NH_PROBE_REFERENCE_NOT_ACCEPTED_BY_VALIDATOR';
    }catch{detail='NH_PROBE_DETAIL_UNAVAILABLE';}
    return {status:'NH_0600_REFERENCE_UNVERIFIED',date:TARGET_DAY,
      verified:false,reason:errors[0]||'NH_REFERENCE_NOT_RETURNED',detail};
  }
  const expected=TARGET_DAY+'T06:00:00+09:00';
  if(v.source!=='NH'||v.tradingDate!==TARGET_DAY||v.officialClose!==false
    ||v.sourceUpdatedAt!==expected||!/^K[A-Z0-9]{8}$/.test(v.contract||'')
    ||!Number.isFinite(Number(v.value))||Number(v.value)<=0
    ||!Number.isFinite(Date.parse(v.receivedAt||''))||Date.parse(v.receivedAt)>now().getTime())
    return {status:'NH_0600_REFERENCE_UNVERIFIED',date:TARGET_DAY,
      verified:false,reason:'NH_REFERENCE_SCHEMA_REJECTED'};
  return {status:'NH_0600_READ_ONLY_VERIFIED',date:TARGET_DAY,
    verified:true,source:'NH',contract:v.contract,contractMonth:v.contractMonth,
    referenceValue:v.value,sourceUpdatedAt:v.sourceUpdatedAt,
    receivedAt:v.receivedAt,officialExchangeFinal:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio'
      ||process.env.GITHUB_REF!=='refs/heads/main'
      ||process.env.GITHUB_EVENT_NAME!=='push'
      ||process.env.GITHUB_RUN_ATTEMPT!=='1')
      throw Error('NH_ONEOFF_EVENT_DENIED');
    const r=await verifyTodayNhNight();
    const report=JSON.stringify(r);
    console.log(report);
    fs.writeFileSync('.nh-night-once-result.txt',
      '2026-11-02 중앙 NH 06:00 읽기 전용 진단 (PR #832 반영 후)\n\n'
      +report+'\n'
      +'실제 장전 07:40~08:00 복구 발송은 이 테스트 범위에 포함되지 않습니다.\n');
    if(!r.verified)process.exitCode=2;
  }catch(error){
    const e=String(error?.message||'');
    console.error(/^NH_ONEOFF_[A-Z_]+$/.test(e)?e:'NH_ONEOFF_UNVERIFIED');
    process.exitCode=1;
  }
}
