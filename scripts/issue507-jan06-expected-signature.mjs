#!/usr/bin/env node
// Issue #507 — independent, authenticated GAS source-expected SHA-256 proof.
// NEVER log raw expectedRows, prices, trade ledger, fund NAV or access tokens.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DATE='2026-01-06', ALLOWED=new Set(['KRX','FUND_NAV']);
export function normalizedProof(payload){
  if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)
    ||payload.checkedDates.length!==1||payload.checkedDates[0]!==DATE
    ||!Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1)
    throw new Error('JAN06_BAD_RESPONSE');
  const x=payload.diagnostics[0];
  if(x?.date!==DATE||!['CONFLICT','PARTIAL','MISMATCH','VALID'].includes(x.status)
    ||x.expectedRowCount!==33||!Array.isArray(x.expectedRows)
    ||x.expectedRows.length!==33||!Array.isArray(x.sourceDataErrors)
    ||x.sourceDataErrors.length)
    throw new Error('JAN06_SOURCE_GUARD');
  const expected=x.expectedRows.map(row=>{
    if(!Array.isArray(row)||row.length<12||String(row[0])!==DATE
      ||!/^([0-9]{6}|F[0-9]{5}|[0-9]{4}[A-Z][0-9])$/.test(String(row[1]))
      ||!ALLOWED.has(String(row[10])) || String(row[11]||'')!=='')
      throw new Error('JAN06_ROW_SCHEMA');
    const [,, ,qty,,cost,unit,evalAmt]=row;
    const values=[qty,cost,unit,evalAmt];
    if(values.some(z=>typeof z!=='number'||!Number.isFinite(z)||z<0)
      ||Number.isInteger(evalAmt)===false||Number.isInteger(cost)===false)
      throw new Error('JAN06_BAD_NUMBER');
    return [String(row[1]),qty,cost,unit,evalAmt,String(row[10])];
  }).sort((a,b)=>a[0].localeCompare(b[0]));
  if(new Set(expected.map(row=>row[0])).size!==33
    ||expected.filter(x=>x[0].startsWith('F')).length!==3
    ||expected.filter(x=>x[5]==='FUND_NAV').length!==3
    ||!expected.some(x=>x[0]==='487240')
    ||!expected.some(x=>x[0]==='361610'))
    throw new Error('JAN06_CODE_SET_INVALID');
  const cost=expected.reduce((s,x)=>s+x[2],0);
  const valuation=expected.reduce((s,x)=>s+x[4],0);
  const sha256=createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  return{date:DATE,mode:'READ_ONLY',status:x.status,
    expectedRows:33,storedRows:x.storedRowCount,
    sourceErrorCount:0,fundNavRows:3,sha256,
    totalExpectedCost:cost,totalExpectedValuation:valuation};
}
async function request(url,token,fetchImpl){
  let response;
  try{response=await fetchImpl(url,{method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({action:'diagnoseSnapshotIntegrityRange',dates:DATE,accessToken:token}),
    redirect:'follow',signal:AbortSignal.timeout(240000)});
  }catch{throw new Error('JAN06_NETWORK_ERROR');}
  if(!response.ok)throw new Error('JAN06_HTTP_ERROR');
  try{return await response.json()}
  catch{throw new Error('JAN06_JSON_ERROR')}
}
export async function verify({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw new Error('JAN06_TOKEN_MISSING');
  const denied=await request(endpoint,'JAN06_INVALID_AUTH_PROBE',fetchImpl);
  if(denied?.status!=='error'||denied?.message!=='인증 실패')
    throw new Error('JAN06_AUTH_DISABLED');
  return normalizedProof(await request(endpoint,token,fetchImpl));
}
export function selfTest(){
  const rows=Array.from({length:30},(_,i)=>[DATE,String(i+100000),'N',1,100,100,100,100,0,0,'KRX','']);
  // 30 domestic codes + 3 fund codes = 33 expected rows.
  rows[0][1]='361610';rows[1][1]='487240';
  for(let i=1;i<=3;i++) rows.push([DATE,'F0000'+i,'Fund',1,100,100,110,110,10,10,'FUND_NAV','']);
  const p={status:'ok',checkedDates:[DATE],diagnostics:[{
    date:DATE,status:'CONFLICT',expectedRowCount:33,storedRowCount:34,
    expectedRows:rows,sourceDataErrors:[]
  }]};
  const proof=normalizedProof(p);
  assert.equal(proof.expectedRows,33);
  assert.equal(proof.sha256.length,64);
  assert.equal(proof.fundNavRows,3);
  assert.equal(proof.status,'CONFLICT');
  assert.throws(()=>normalizedProof({...p,checkedDates:[]}),/JAN06_BAD_RESPONSE/);
  assert.throws(()=>normalizedProof({...p,diagnostics:[{...p.diagnostics[0],sourceDataErrors:['missing'] }]}),
    /JAN06_SOURCE_GUARD/);
  assert.throws(()=>normalizedProof({...p,diagnostics:[{...p.diagnostics[0],
    expectedRows:rows.map((r,i)=>i===2?[...r.slice(0,10),'MANUAL','']:r)}]}),
    /JAN06_ROW_SCHEMA/);
  return {mode:'LOCAL_CONTRACT_TEST',result:'PASS',cases:7};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{const data=process.argv.includes('--self-test')?selfTest():
    await verify({url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
    console.log(JSON.stringify(data))}
  catch(e){let x=String(e?.message||'');
    console.error(/^JAN06_[A-Z_]+$/.test(x)?x:'JAN06_UNKNOWN_ERROR');
    process.exitCode=1;}
}
