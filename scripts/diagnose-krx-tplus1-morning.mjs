#!/usr/bin/env node
// 08:45 KST official KRX T+1 publication probe, READ_ONLY.
// Never writes Sheets, triggers, portfolio markers or ScriptProperties.
// Reuse the production ledger-based exact-held-code universe via GAS.
import {krxSessionStatus} from './krx-session-calendar.mjs';
import {runCoverage} from './diagnose-krx-held-coverage.mjs';
import {runHeadless} from './run-market-briefing-headless.mjs';

function isoUtcDay(date) {
  return new Date(date+'T00:00:00Z');
}
function previousDay(date) {
  const d=isoUtcDay(date);
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}
export function morningTarget(now=new Date()) {
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw new Error('KRX_MORNING_INVALID_TIME');
  const fmt=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  });
  const v=Object.fromEntries(fmt.formatToParts(now)
    .filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const today=v.year+'-'+v.month+'-'+v.day;
  const hour=Number(v.hour),minute=Number(v.minute);
  const session=krxSessionStatus(today);
  if(session==='UNKNOWN')throw new Error('KRX_MORNING_CALENDAR_UNVERIFIED');
  if(session==='CLOSED')return {action:'SKIP_CLOSED',today,targetDate:null};
  if(hour<8||(hour===8&&minute<30))
    return {action:'SKIP_BEFORE_PUBLICATION',today,targetDate:null};
  let date=previousDay(today);
  for(let i=0;i<31;i++,date=previousDay(date)){
    const status=krxSessionStatus(date);
    if(status==='UNKNOWN')throw new Error('KRX_MORNING_CALENDAR_UNVERIFIED');
    if(status==='OPEN')
      return {action:'PROBE',today,targetDate:date};
  }
  throw new Error('KRX_MORNING_PREVIOUS_SESSION_NOT_FOUND');
}
export async function runMorning({now=new Date(),url,token,coverageFn=runCoverage}={}) {
  const schedule=morningTarget(now);
  if(schedule.action!=='PROBE')
    return {mode:'READ_ONLY',status:schedule.action,checkedDate:schedule.today,
      targetDate:null,providerReady:false};
  const proof=await coverageFn({url,token,dates:schedule.targetDate});
  if(proof?.mode!=='READ_ONLY'||proof.coverageContract!=='KRX_HELD_V1'
      ||!Array.isArray(proof.results)||proof.results.length!==1
      ||proof.results[0].date!==schedule.targetDate)
    throw new Error('KRX_MORNING_COVERAGE_CONTRACT_INVALID');
  const c=proof.results[0];
  // Aggregates only: never emit symbol names, close prices, token, or URL.
  const valid=Number.isSafeInteger(c.expected)&&c.expected>0
    &&Number.isSafeInteger(c.exact)&&c.exact>=0&&c.exact<=c.expected
    &&Number.isSafeInteger(c.missing)&&c.missing===c.expected-c.exact;
  const providerReady=valid&&proof.ready===true&&c.ready===true
    &&c.exact===c.expected&&c.missing===0
    &&c.duplicateMaster===0&&c.orphanLedger===0;
  return {mode:'READ_ONLY',
    status:providerReady?'PROVIDER_READY':'PROVIDER_NOT_READY',
    checkedDate:schedule.today,targetDate:schedule.targetDate,
    expected:valid?c.expected:null,officialExact:valid?c.exact:null,
    missing:valid?c.missing:null,providerReady};
}
// Reuse this existing 08:45 source probe rather than adding a second,
 // similarly delayed GitHub schedule. The extra two-index/two-stock check
 // never hydrates MARKET_MASTER, appends a snapshot, or backdates asOf.
export async function runMorningWithBriefingSources({now=new Date(),url,token,
  coverageFn=runCoverage, officialFn=async ({tradingDate,url,token})=>
    runHeadless({checkpoint:'KRX_FINAL',tradingDate,url,token,sourceReadOnlyT1:true})}={}) {
  const held=await runMorning({now,url,token,coverageFn});
  if(held.status!=='PROVIDER_READY')
    return {...held,published:false,writesPerformed:0,
      briefingOfficialReady:false,officialIndexCount:0,officialStockCount:0};
  const proof=await officialFn({tradingDate:held.targetDate,url,token});
  if(proof?.sourceReadOnly!==true||proof?.checkpoint!=='KRX_FINAL'
    ||proof.tradingDate!==held.targetDate||proof?.persistence)
    throw new Error('KRX_MORNING_BRIEFING_PROOF_INVALID');
  const ready=proof.successful===true&&proof.officialIndexCount===2
    &&proof.officialStockCount===2;
  return {...held,heldProviderReady:held.providerReady,
    status:ready?'PROVIDER_READY':'BRIEFING_SOURCE_NOT_READY',
    providerReady:ready,briefingOfficialReady:ready,
    officialIndexCount:proof.officialIndexCount,
    officialStockCount:proof.officialStockCount,
    published:false,writesPerformed:0};
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    const result=await runMorningWithBriefingSources({url:process.env.GAS_WEB_APP_URL,
      token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(result));
    if(result.status==='PROVIDER_NOT_READY'||result.status==='BRIEFING_SOURCE_NOT_READY')
      process.exitCode=1;
  }catch(e){
    const name=String(e?.message||'');
    const safe=/^KRX_MORNING_[A-Z_]+$/.test(name)?name:'KRX_MORNING_PROBE_FAILED';
    console.error(safe);
    process.exitCode=1;
  }
}
