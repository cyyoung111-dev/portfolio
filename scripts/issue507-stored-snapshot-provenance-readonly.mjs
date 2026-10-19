#!/usr/bin/env node
// Issue #507 historical Snapshot provenance verification.
// Every raw row and account, security code, name, market value, quantity, cost,
// and token stays inside this short-lived runner. Only safe flags are printed.
import assert from 'node:assert/strict';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';
export const SNAPSHOT_DATES=Object.freeze([
  '2025-09-03','2025-12-30','2025-12-31',
  '2026-01-01','2026-01-02','2026-01-06']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const n=x=>{
  if(!Number.isSafeInteger(x)||x<0||x>100000)throw Error('YEARBOUNDARY_SNAP_BAD_COUNT');
  return x;
};
const classify=s=>{
  s=String(s||'').trim().toUpperCase();
  if(s==='MANUAL')return 'MANUAL';
  if(s==='COST_FALLBACK')return 'COST_FALLBACK';
  if(s.startsWith('FUND_NAV_CARRY_INPUT_REQUIRED'))return 'FUND_NAV_INPUT_REQUIRED';
  if(s.startsWith('FUND_NAV_CARRY'))return 'FUND_NAV_CARRY';
  if(s.startsWith('FUND_NAV'))return 'FUND_NAV';
  if(s.includes('CARRY'))return 'PRICE_CARRY';
  if(/^(KRX|KRX_CONFIRMED_CLOSE|KRX_OTP|TOSS_CONFIRMED_DAILY_CLOSE|STORED_CONFIRMED_CLOSE)$/.test(s))
    return 'ORIGIN_CLAIMED_CONFIRMED';
  if(s==='PRICE_HISTORY')return 'PRICE_HISTORY_UNDATED';
  return s?'OTHER_OR_UNKNOWN_SOURCE':'SOURCE_BLANK';
};
export function summarizeSnapshots(diag,details){
  const missing=firstMissingCodes(diag);
  const codes=[...new Set(missing.map(x=>x.code).filter(Boolean))];
  if(!Array.isArray(details)||details.length!==SNAPSHOT_DATES.length)
    throw Error('YEARBOUNDARY_SNAP_DETAILS_SCHEMA');
  const reports=[];
  for(let i=0;i<SNAPSHOT_DATES.length;i++){
    const date=SNAPSHOT_DATES[i],d=details[i];
    if(d?.status!=='ok'||d.date!==date||!Array.isArray(d.items)||d.items.length>100000)
      throw Error('YEARBOUNDARY_SNAP_DETAILS_SCHEMA');
    const rows=d.items.filter(item=>{
      if(!item||typeof item.code!=='string'||typeof item.source!=='string'||
        typeof item.name!=='string')throw Error('YEARBOUNDARY_SNAP_ROW_SCHEMA');
      return codes.includes(item.code.trim().toUpperCase());
    });
    const sourceFamilies=[...new Set(rows.map(r=>classify(r.source)))].sort();
    const asOfDates=[...new Set(rows.map(r=>
      String(r.source||'').match(/CARRY@(\d{4}-\d{2}-\d{2})/i)?.[1]||'').filter(Boolean))].sort();
    if(asOfDates.some(x=>!DATE.test(x)||x>date))throw Error('YEARBOUNDARY_SNAP_FUTURE_PROVENANCE');
    const hasPositiveStoredEvaluation=rows.some(r=>Number.isFinite(Number(r.evalUnit))&&Number(r.evalUnit)>0);
    const hasPositiveStoredQuantity=rows.some(r=>Number.isFinite(Number(r.qty))&&Number(r.qty)>0);
    reports.push({date,storedItemsExcludingDuplicateRules:n(d.items.length),
      currentMissingCodeMatches:n(rows.length),
      hasPositiveStoredEvaluation,hasPositiveStoredQuantity,
      sourceFamilies,explicitCarrySourceDates:asOfDates,
      isStoredValueTrustedAsConfirmedHistoricClose:false});
  }
  return {mode:'READ_ONLY',checkedDates:SNAPSHOT_DATES,
    firstMissingDistinctCurrentCodes:n(codes.length),storedSnapshotProvenance:reports,
    sourceOfTruth:'TRADE_LEDGER_WITH_CONFIRMED_PRICE_HISTORY',
    allStoredRowsRemainUntouched:true,
    note:'Stored Snapshot price is historical evidence only, not proof of a confirmed price-history source'};
}
export async function readLive({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('YEARBOUNDARY_SNAP_TOKEN_REQUIRED');
  async function request(action,options={},credential=token){
    let response;
    try{response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...options,accessToken:credential}),
      redirect:'follow',signal:AbortSignal.timeout(240000)});}
    catch{throw Error('YEARBOUNDARY_SNAP_NETWORK');}
    if(!response?.ok)throw Error('YEARBOUNDARY_SNAP_HTTP');
    try{return await response.json();}
    catch{throw Error('YEARBOUNDARY_SNAP_JSON');}
  }
  const denied=await request('getHistoryDetail',{date:'2026-01-01'},
    token==='YEARBOUNDARY_SNAP_BAD_AUTH'?'YEARBOUNDARY_SNAP_BAD_AUTH_ALT':'YEARBOUNDARY_SNAP_BAD_AUTH');
  if(denied?.status!=='error'||denied.message!=='인증 실패')throw Error('YEARBOUNDARY_SNAP_AUTH_DISABLED');
  const diag=await request('diagnoseSnapshotIntegrityRange',{dates:DATES.join(',')});
  // One snapshot day per call, no bulk price or ledger exports in runner logs.
  const details=[];
  for(const date of SNAPSHOT_DATES)details.push(await request('getHistoryDetail',{date}));
  return summarizeSnapshots(diag,details);
}
export async function selfTest(){
  const diag={status:'ok',checkedDates:[...DATES],diagnostics:DATES.map(date=>({
    date,status:'SOURCE_INCOMPLETE',
    sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: 0046Y0'] }))};
  const details=SNAPSHOT_DATES.map(date=>({status:'ok',date,items:[]}));
  details[3].items=[{code:'0046Y0',name:'PRIVATE_ETF',source:'COST_FALLBACK',
    qty:3,costAmt:456,evalAmt:456,evalUnit:152}];
  details[4].items=[{code:'0046Y0',name:'PRIVATE_ETF',source:'KRX_CARRY@2025-12-30',
    qty:3,evalUnit:180},{code:'000660',name:'PRIVATE_OTHER',source:'MANUAL',qty:2,evalUnit:450}];
  const result=summarizeSnapshots(diag,details);
  assert.equal(result.firstMissingDistinctCurrentCodes,1);
  assert.equal(result.storedSnapshotProvenance[2].currentMissingCodeMatches,0);
  assert.equal(result.storedSnapshotProvenance[3].sourceFamilies[0],'COST_FALLBACK');
  assert.deepEqual(result.storedSnapshotProvenance[4].explicitCarrySourceDates,['2025-12-30']);
  assert.equal(result.storedSnapshotProvenance[4].currentMissingCodeMatches,1);
  assert.equal(result.storedSnapshotProvenance[3].isStoredValueTrustedAsConfirmedHistoricClose,false);
  for(const [source,expected] of [
    ['FUND_NAV_CARRY','FUND_NAV_CARRY'],
    ['FUND_NAV_CARRY@2025-12-30','FUND_NAV_CARRY'],
    ['FUND_NAV_CARRY_INPUT_REQUIRED','FUND_NAV_INPUT_REQUIRED'],
    ['FUND_NAV','FUND_NAV']]){
    const synthetic=SNAPSHOT_DATES.map(date=>({status:'ok',date,items:[]}));
    synthetic[3].items=[{code:'0046Y0',name:'PRIVATE_FUND',source,qty:1,evalUnit:100}];
    assert.equal(summarizeSnapshots(diag,synthetic).storedSnapshotProvenance[3].sourceFamilies[0],expected);
  }
  assert.ok(!JSON.stringify(result).includes('0046Y0'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_ETF'));
  assert.ok(!JSON.stringify(result).includes('456'));
  assert.throws(()=>summarizeSnapshots(diag,details.map((item,i)=>i===4?
    {...item,items:[{code:'0046Y0',name:'private',source:'KRX_CARRY@2026-01-06',
      qty:1,evalUnit:5}]}:item)),/YEARBOUNDARY_SNAP_FUTURE_PROVENANCE/);
  const actions=[];
  const mock=async(_url,req)=>{
    const action=req.body.get('action'),date=req.body.get('date');
    actions.push(action);
    const result=req.body.get('accessToken')!=='SYNTHETIC_TOKEN'
      ? {status:'error',message:'인증 실패'}
      : action==='diagnoseSnapshotIntegrityRange'?diag
      : details.find(d=>d.date===date);
    return {ok:true,json:async()=>result};
  };
  const live=await readLive({url:'https://script.google.com/macros/s/TEST/exec',
    token:'SYNTHETIC_TOKEN',fetchImpl:mock});
  assert.equal(live.storedSnapshotProvenance[3].hasPositiveStoredEvaluation,true);
  assert.deepEqual(actions,[
    'getHistoryDetail','diagnoseSnapshotIntegrityRange',
    ...SNAPSHOT_DATES.map(()=> 'getHistoryDetail')]);
  assert.ok(!JSON.stringify(live).includes('SYNTHETIC_TOKEN'));
  console.log('Issue #507 stored Snapshot provenance safety and read-only access: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await readLive({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else{
      const err=String(e?.message||'');
      console.error(/^YEARBOUNDARY_SNAP_[A-Z_]+$/.test(err)?err:'YEARBOUNDARY_SNAP_UNKNOWN');
    }
    process.exitCode=1;
  }
}
