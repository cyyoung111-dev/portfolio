#!/usr/bin/env node
// #507 read-only triage of normalized PRICE_HISTORY rows for 3 historical days.
// Existing GAS skips malformed dates / blank codes: NOT a full raw-row proof.
// Never print target code, price, name, row number, account or token.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {DATES} from './issue507-yearend-carry-readonly.mjs';
import {firstMissingCodes} from './issue507-missing-price-provenance-readonly.mjs';

export const TARGET_DATES=Object.freeze(['2025-12-30','2026-01-02','2026-01-05']);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CODE=/^[A-Z0-9][A-Z0-9.-]{0,29}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SUPPORTED_GAS_VERSIONS=new Set(['9.244','9.281','9.282']);
const STATUSES=new Set(['VALID','MANUAL_PROTECTED','SOURCE_INVALID','FX_MISSING',
  'CORPORATE_ACTION_REVIEW','SUSPICIOUS_DROP','SUSPICIOUS_SPIKE','UNVERIFIED']);
function count(n){
  if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Error('ISSUE507_RAW_AUDIT_BAD_COUNT');
  return n;
}
function validDate(s){
  if(typeof s!=='string'||!DATE.test(s))return false;
  const n=Date.parse(s+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s;
}
export function evidenceGate(diag,status){
  if(status?.status!=='ok'||!SUPPORTED_GAS_VERSIONS.has(status.gasVersion)||
    status.automation?.gasVersion!==status.gasVersion)
    throw Error('ISSUE507_RAW_AUDIT_VERSION');
  if(diag?.status!=='ok'||!DIGEST.test(diag.strictSourceDigest||'')||
    typeof diag.integritySourceRevision!=='string'||
    !diag.integritySourceRevision.trim())
    throw Error('ISSUE507_RAW_AUDIT_STRICT_DIGEST_REQUIRED');
  const codes=[...new Set(firstMissingCodes(diag).map(x=>x.code).filter(Boolean))];
  if(codes.length!==1||!CODE.test(codes[0]))
    throw Error('ISSUE507_RAW_AUDIT_TARGET_SCOPE');
  return {code:codes[0],revision:diag.integritySourceRevision,
    digest:diag.strictSourceDigest,gasVersion:status.gasVersion};
}
export function summarizeRows(payload,targetCode){
  const p=payload?.priceIntegrity;
  if(payload?.status!=='ok'||!p||!Array.isArray(p.rows)||p.rows.length>100000||
    p.checkedRows!==p.rows.length||!p.counts||typeof p.counts!=='object'||
    Array.isArray(p.counts))
    throw Error('ISSUE507_RAW_AUDIT_RESPONSE_SCHEMA');
  const grouped=Object.fromEntries(TARGET_DATES.map(date=>[date,[]]));
  const uniqueRows=new Set(),tally={};
  for(const r of p.rows){
    if(!r||!validDate(r.date)||!TARGET_DATES.includes(r.date)||
      r.code!==targetCode||!STATUSES.has(r.status)||
      !Number.isSafeInteger(r.rowNumber)||r.rowNumber<2||
      uniqueRows.has(r.rowNumber))
      throw Error('ISSUE507_RAW_AUDIT_ROW_SCOPE');
    if(r.storedPrice!==null&&
      (typeof r.storedPrice!=='number'||!Number.isFinite(r.storedPrice)))
      throw Error('ISSUE507_RAW_AUDIT_PRICE_SCHEMA');
    uniqueRows.add(r.rowNumber);grouped[r.date].push(r);
    tally[r.status]=(tally[r.status]||0)+1;
  }
  if(Object.keys(p.counts).length!==Object.keys(tally).length||
    Object.keys(tally).some(k=>p.counts[k]!==tally[k]))
    throw Error('ISSUE507_RAW_AUDIT_COUNT_MISMATCH');
  return TARGET_DATES.map(date=>{
    const rows=grouped[date];
    const classes=[...new Set(rows.map(r=>{
      const source=String(r.source||'').toUpperCase();
      if(source==='MANUAL')return 'MANUAL';
      if(['KRX','KRX_OTP','KRX_OPENAPI'].includes(source))return 'KRX_VERIFIED_FAMILY';
      return source?'OTHER_SOURCE':'BLANK_SOURCE';
    }))].sort();
    return {date,normalizedRawRows:count(rows.length),
      duplicateNormalizedTargetRows:count(Math.max(0,rows.length-1)),
      nonPositiveOrNonNumericRows:count(rows.filter(r=>!(r.storedPrice>0)).length),
      manualProtectedRows:count(rows.filter(r=>r.status==='MANUAL_PROTECTED'||
        String(r.source||'').toUpperCase()==='MANUAL').length),
      invalidSourceRows:count(rows.filter(r=>r.status==='SOURCE_INVALID').length),
      unverifiedSourceRows:count(rows.filter(r=>r.status==='UNVERIFIED').length),
      sourceClasses:classes,safeToAppendFromThisProbe:false};
  });
}
export function buildReport(before,after,rows){
  if(before.revision!==after.revision||before.digest!==after.digest||
    before.code!==after.code||before.gasVersion!==after.gasVersion)
    throw Error('ISSUE507_RAW_AUDIT_SOURCE_CHANGED');
  if(!Array.isArray(rows)||rows.length!==TARGET_DATES.length||
    rows.some((r,i)=>r.date!==TARGET_DATES[i]))
    throw Error('ISSUE507_RAW_AUDIT_SUMMARY_SCHEMA');
  return {mode:'READ_ONLY',gasVersion:before.gasVersion,targetCount:1,
    sourceRevisionStable:true,sourceContentStable:true,inspectedDateCount:rows.length,
    days:rows,allOriginalRowsChecked:false,
    unparseableDateOrEmptyCodeRowsChecked:false,historicalCodeAliasRowsChecked:false,
    fullRawWriteGuardSatisfied:false,manualOrDuplicateDeletionAllowed:false,
    appendOrOverwriteAllowed:false,originalSheetsWritten:false,
    ledgerOrSnapshotWritten:false,
    note:'Existing diagnosePriceHistoryIntegrity excludes malformed date/empty code rows and historical aliases. This is normalized-row triage only. A separately approved writer needs ScriptLock + full raw scan + verified aliases + backup + source/coherence checks.'};
}
async function request(url,token,action,args,fetchImpl){
  let response;
  try{
    response=await fetchImpl(url,{method:'POST',redirect:'follow',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:new URLSearchParams({action,...args,accessToken:token}),
      signal:AbortSignal.timeout(240000)});
  }catch{throw Error('ISSUE507_RAW_AUDIT_NETWORK');}
  if(!response?.ok)throw Error('ISSUE507_RAW_AUDIT_HTTP');
  try{return await response.json();}
  catch{throw Error('ISSUE507_RAW_AUDIT_JSON');}
}
export async function runReadonly({url,token,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim())throw Error('ISSUE507_RAW_AUDIT_AUTH_MISSING');
  const bad=token==='ISSUE507_RAW_BAD_AUTH'
    ?'ISSUE507_RAW_BAD_AUTH_2':'ISSUE507_RAW_BAD_AUTH';
  const denied=await request(endpoint,bad,'getAutomationStatus',{},fetchImpl);
  if(denied?.status!=='error'||denied.message!=='인증 실패')
    throw Error('ISSUE507_RAW_AUDIT_AUTH_GUARD');
  const statusBefore=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
  const diagBefore=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:DATES.join(','),strictReadonly:'1'},fetchImpl);
  const before=evidenceGate(diagBefore,statusBefore);
  const raw=await request(endpoint,token,'diagnosePriceHistoryIntegrity',
    {dates:TARGET_DATES.join(','),codes:before.code},fetchImpl);
  const rows=summarizeRows(raw,before.code);
  const diagAfter=await request(endpoint,token,'diagnoseSnapshotIntegrityRange',
    {dates:DATES.join(','),strictReadonly:'1'},fetchImpl);
  const statusAfter=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
  return buildReport(before,evidenceGate(diagAfter,statusAfter),rows);
}

function checkProductionPriceIntegrityContract(){
  // Run actual GAS production reader/classifier/handler against inert in-memory
  // fixtures. A GAS-only PR triggers this contract through workflow paths.
  const gas=fs.readFileSync(new URL('../src/gas/apps_script.gs',import.meta.url),'utf8');
  const names=['_priceIntegrityRows','diagnosePriceHistoryIntegrity',
    'handleDiagnosePriceHistoryIntegrity'];
  const production=names.map(name=>{
    const start=gas.indexOf('function '+name+'(');
    const end=start<0?-1:gas.indexOf('\n}',start);
    assert.ok(start>=0&&end>start,'GAS price diagnostic production boundary: '+name);
    return gas.slice(start,end+2);
  }).join('\n');
  const baseline=fs.readFileSync(new URL('../reference/gas-v9.281.gs',import.meta.url),'utf8');
  const historical=names.map(name=>{
    const start=baseline.indexOf('function '+name+'(');
    const end=start<0?-1:baseline.indexOf('\n}',start);
    assert.ok(start>=0&&end>start,'GAS 9.281 price diagnostic boundary: '+name);
    return baseline.slice(start,end+2);
  }).join('\n');
  // Gates are new in 9.282, but the reader/handler contracts are identical.
  const removeGate=source=>source.replace(/^  if \(typeof _issue507GateInside_[^\n]*\n/gm,'');
  assert.equal(removeGate(production),historical);
  const code='0046Y0';
  const context={
    codeItems:[{code,currency:'KRW'}],byCode:{[code]:{code,currency:'KRW'}},
    priceRows:[
      ['2025-12-30',code,'PRIVATE_NAME',0,'','KRX'],
      ['2025-12-30',code,'PRIVATE_NAME',99,'','MANUAL'],
      ['2026-01-02',code,'PRIVATE_NAME',100,'','KRX'],
      ['2026-01-02','OTHER_CODE','OTHER_NAME',105,'','KRX']
    ],tradeRows:[],fxRows:[],navRows:[]
  };
  const sandbox={
    _readPriceIntegrityContext:()=>context,
    _cleanCode:s=>String(s||'').trim(),
    _normalizeDate:s=>String(s||'').slice(0,10),
    _normalizeDatetime:s=>String(s||''),
    PRICE_HISTORY_UNVERIFIED_SOURCES:/REALTIME|INDICATIVE|DAILY_CANDLE|UNVERIFIED_CLOSE/i,
    getss:()=>({}),jsonOk:data=>({status:'ok',...data}),
    jsonError:msg=>({status:'error',message:msg})
  };
  vm.runInNewContext(production,vm.createContext(sandbox),{timeout:3000});
  const response=sandbox.handleDiagnosePriceHistoryIntegrity(
    '',TARGET_DATES.join(','),code);
  const report=summarizeRows(response,code);
  assert.equal(report[0].normalizedRawRows,2);
  assert.equal(report[0].nonPositiveOrNonNumericRows,1);
  assert.equal(report[0].manualProtectedRows,1);
  assert.equal(report[1].normalizedRawRows,1);
  assert.equal(report[2].normalizedRawRows,0);
  assert.equal(response.priceIntegrity.checkedRows,3);
  assert.equal(response.priceIntegrity.counts.SOURCE_INVALID,1);
  assert.equal(response.priceIntegrity.counts.MANUAL_PROTECTED,1);
  assert.equal(response.priceIntegrity.counts.VALID,1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_NAME'));
}

export async function selfTest(){
  checkProductionPriceIntegrityContract();
  const code='0046Y0';
  const diag={status:'ok',strictSourceDigest:'a'.repeat(64),
    integritySourceRevision:'541',checkedDates:[...DATES],
    diagnostics:DATES.map(date=>({date,status:'SOURCE_INCOMPLETE',
      sourceDataErrors:['확정 원자료 부족으로 기존 Snapshot 보존: '+code]}))};
  const status={status:'ok',gasVersion:'9.244',automation:{gasVersion:'9.244'}};
  const prices={status:'ok',priceIntegrity:{checkedRows:3,
    counts:{SOURCE_INVALID:1,MANUAL_PROTECTED:1,VALID:1},rows:[
      {date:'2025-12-30',code,rowNumber:15,storedPrice:0,source:'KRX',
        status:'SOURCE_INVALID',name:'SECRET_NAME'},
      {date:'2025-12-30',code,rowNumber:16,storedPrice:99,source:'MANUAL',
        status:'MANUAL_PROTECTED'},
      {date:'2026-01-02',code,rowNumber:20,storedPrice:100,source:'KRX',status:'VALID'}]}};
  const a=evidenceGate(diag,status),rows=summarizeRows(prices,code);
  assert.equal(rows[0].normalizedRawRows,2);
  assert.equal(rows[0].duplicateNormalizedTargetRows,1);
  assert.equal(rows[0].nonPositiveOrNonNumericRows,1);
  assert.equal(rows[0].manualProtectedRows,1);
  assert.equal(rows[2].normalizedRawRows,0);
  const report=buildReport(a,a,rows);
  for(const value of [code,'SECRET_NAME','99','100','541'])
    assert.ok(!JSON.stringify(report).includes('"'+value+'"'));
  assert.equal(report.fullRawWriteGuardSatisfied,false);
  assert.equal(report.gasVersion,'9.244');
  for(const version of ['9.281','9.282']){
    const statusForVersion={...status,gasVersion:version,
      automation:{...status.automation,gasVersion:version}};
    const scoped=evidenceGate(diag,statusForVersion);
    assert.equal(buildReport(scoped,scoped,rows).gasVersion,version);
    assert.throws(()=>buildReport(a,scoped,rows),/SOURCE_CHANGED/);
    const updated=await runReadonly({
      url:'https://script.google.com/macros/s/TEST/exec',token:'TEST_TOKEN',
      fetchImpl:async(_url,opts)=>({ok:true,json:async()=>opts.body.get('accessToken')!=='TEST_TOKEN'
        ?{status:'error',message:'인증 실패'}
        :opts.body.get('action')==='getAutomationStatus'?statusForVersion
          :opts.body.get('action')==='diagnoseSnapshotIntegrityRange'?diag:prices})
    });
    assert.equal(updated.gasVersion,version);
    assert.equal(updated.originalSheetsWritten,false);
    assert.equal(updated.ledgerOrSnapshotWritten,false);
  }
  assert.throws(()=>evidenceGate(diag,{...status,gasVersion:'9.283'}),/VERSION/);
  assert.throws(()=>evidenceGate(diag,{...status,gasVersion:'9.282'}),/VERSION/);
  const drift={...diag,strictSourceDigest:'b'.repeat(64)};
  assert.throws(()=>buildReport(a,evidenceGate(drift,status),rows),/SOURCE_CHANGED/);
  const wrong=structuredClone(prices);wrong.priceIntegrity.rows[0].code='SECRET_OTHER';
  assert.throws(()=>summarizeRows(wrong,code),/ROW_SCOPE/);
  const badCount=structuredClone(prices);badCount.priceIntegrity.counts.VALID=2;
  assert.throws(()=>summarizeRows(badCount,code),/COUNT_MISMATCH/);
  const replay=structuredClone(prices);replay.priceIntegrity.rows[1].rowNumber=15;
  assert.throws(()=>summarizeRows(replay,code),/ROW_SCOPE/);
  const actions=[];
  const fixture=async(_url,opts)=>{
    const action=opts.body.get('action');actions.push(action);
    const result=opts.body.get('accessToken')!=='TEST_TOKEN'
      ?{status:'error',message:'인증 실패'}
      :action==='getAutomationStatus'?status
      :action==='diagnoseSnapshotIntegrityRange'?diag:prices;
    return {ok:true,json:async()=>result};
  };
  const live=await runReadonly({url:'https://script.google.com/macros/s/TEST/exec',
    token:'TEST_TOKEN',fetchImpl:fixture});
  assert.equal(live.days[0].normalizedRawRows,2);
  assert.deepEqual(actions,['getAutomationStatus','getAutomationStatus',
    'diagnoseSnapshotIntegrityRange','diagnosePriceHistoryIntegrity',
    'diagnoseSnapshotIntegrityRange','getAutomationStatus']);
  assert.ok(!JSON.stringify(live).includes(code));
  console.log('Issue #507 normalized PRICE_HISTORY rows READ ONLY contract: PASS');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    if(process.argv.includes('--self-test'))await selfTest();
    else console.log(JSON.stringify(await runReadonly({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN})));
  }catch(e){
    if(process.argv.includes('--self-test'))console.error(String(e?.stack||e).slice(0,1800));
    else console.error(/^ISSUE507_RAW_AUDIT_[A-Z_]+$/.test(String(e?.message||''))
      ?String(e.message):'ISSUE507_RAW_AUDIT_UNKNOWN');
    process.exitCode=1;
  }
}
