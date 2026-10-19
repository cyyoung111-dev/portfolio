#!/usr/bin/env node
// One-time repair of SOURCE ONLY drift in 2026-10-08 fund Snapshot metadata.
// Fail closed for any numeric/ledger change, duplicate, other mismatched code,
// insufficient original-sheet backup capacity, or missing GAS authentication.
// Only the existing ScriptLock + signed backup GAS rewrite is allowed to write.
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const DATE='2026-10-08';
const EXPECTED_FUNDS=Object.freeze(['F00001','F00002']);
const NUMERIC_COLUMNS=[3,4,5,6,7,8,9];
const noRows=v=>Array.isArray(v)&&v.length===0;
const number=v=>{
  const n=Number(v);if(!Number.isFinite(n))throw new Error('SOURCE_ONLY_BAD_NUMBER');return n;
};
function byCode(rows){
  if(!Array.isArray(rows))throw new Error('SOURCE_ONLY_MISSING_ROWS');
  const out=new Map();
  for(const row of rows){
    if(!Array.isArray(row)||String(row[0])!==DATE)throw new Error('SOURCE_ONLY_INVALID_ROW');
    const code=String(row[1]);
    if(!code||out.has(code))throw new Error('SOURCE_ONLY_DUPLICATE_ROW');
    out.set(code,row);
  }
  return out;
}
export function assertSourceOnlyMismatch(d){
  if(!d||d.date!==DATE||d.status!=='MISMATCH'||d.expectedRowCount!==39||
    d.storedRowCount!==39||!Array.isArray(d.sourceMismatches)
    ||d.sourceMismatches.length!==2
    ||d.sourceMismatches.map(x=>x.code).sort().join(',')!==EXPECTED_FUNDS.join(',')
    ||![d.duplicateKeys,d.conflictKeys,d.missingCodes,d.unexpectedCodes,
      d.qtyMismatches,d.costAmtMismatches,d.evalUnitMismatches,
      d.evalAmtMismatches,d.sourceDataErrors].every(noRows))
    throw new Error('SOURCE_ONLY_PREFLIGHT_NOT_EXACT');
  const expected=byCode(d.expectedRows),stored=byCode(d.storedRows);
  if(expected.size!==39||stored.size!==39)throw new Error('SOURCE_ONLY_ROW_COUNT');
  for(const [code,x] of expected){
    const y=stored.get(code);
    if(!y||x[2]!==y[2]||String(x[0])!==String(y[0])
        ||String(x[11]||'')!==String(y[11]||''))
      throw new Error('SOURCE_ONLY_ROW_CHANGE');
    for(const col of NUMERIC_COLUMNS)
      if(number(x[col])!==number(y[col]))throw new Error('SOURCE_ONLY_NUMERIC_CHANGE');
    if(code.startsWith('F')){
      if(!EXPECTED_FUNDS.includes(code)||
          !/^FUND_NAV(?:_CARRY@\d{4}-\d{2}-\d{2})?$/.test(String(x[10]))||
          !/^FUND_NAV(?:_CARRY@\d{4}-\d{2}-\d{2})?$/.test(String(y[10]))||
          x[10]===y[10]||String(y[11]||''))throw new Error('SOURCE_ONLY_FUND_SOURCE');
    }else if(x[10]!==y[10])throw new Error('SOURCE_ONLY_NON_FUND_SOURCE');
  }
  return {date:DATE,expectedRows:39,protectedFundCodes:EXPECTED_FUNDS.slice()};
}
export function assertBaselineValid(d){
  if(!d||d.date!==DATE||d.status!=='VALID'||
      d.expectedRowCount!==39||d.storedRowCount!==39||
      ![d.duplicateKeys,d.conflictKeys,d.missingCodes,d.unexpectedCodes,
        d.qtyMismatches,d.costAmtMismatches,d.evalUnitMismatches,
        d.evalAmtMismatches,d.sourceMismatches,d.sourceDataErrors].every(noRows))
    throw new Error('SOURCE_ONLY_POST_VERIFY_FAILED');
  return {date:DATE,status:'VALID',storedRows:39};
}
export function assertBackupCapacity(payload){
  const wb=payload?.workbook;
  if(payload?.status!=='ok'||!wb||!Number.isSafeInteger(wb.remainingCells)
      ||!Array.isArray(wb.sheets))throw new Error('SOURCE_ONLY_CAPACITY_UNKNOWN');
  const original=wb.sheets.find(x=>x.name==='스냅샷');
  if(!original||!Number.isSafeInteger(original.lastRow)||
      !Number.isSafeInteger(original.lastColumn)||original.lastRow<39||
      original.lastColumn<12)
    throw new Error('SOURCE_ONLY_CAPACITY_UNKNOWN');
  const needed=Math.max(26000,original.lastRow*original.lastColumn)+10000;
  if(wb.remainingCells<needed)throw new Error('SOURCE_ONLY_BACKUP_CAPACITY_LOW');
  return {remainingCells:wb.remainingCells,minimumSafeCells:needed};
}
async function request(endpoint,token,action,fields={},fetchImpl=fetch){
  if(!['getAutomationStatus','diagnoseSnapshotIntegrity','diagnoseWorkbookCells',
    'repairOct08FundSourceOnly'].includes(action))throw new Error('SOURCE_ONLY_FORBIDDEN_ACTION');
  const body=new URLSearchParams({action,accessToken:token,...fields});
  let response;
  try{
    response=await fetchImpl(endpoint,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body,redirect:'follow',signal:AbortSignal.timeout(300000)});
  }catch{throw new Error('SOURCE_ONLY_GAS_NETWORK_FAILED_VERIFY_BEFORE_RETRY');}
  if(!response.ok)throw new Error('SOURCE_ONLY_GAS_HTTP_FAILED');
  try{return await response.json();}
  catch{throw new Error('SOURCE_ONLY_GAS_NON_JSON');}
}
async function fetchDiagnostic(endpoint,token,fetchImpl){
  const payload=await request(endpoint,token,'diagnoseSnapshotIntegrity',{date:DATE},fetchImpl);
  if(payload?.status!=='ok'||!payload.diagnostic)
    throw new Error('SOURCE_ONLY_GAS_DIAG_FAILED');
  return payload.diagnostic;
}
export async function runSourceOnlyRepair({url,token,apply=false,fetchImpl=fetch}){
  const endpoint=validateWebAppUrl(url);
  if(typeof token!=='string'||!token.trim()||typeof apply!=='boolean')
    throw new Error('SOURCE_ONLY_BAD_ARGUMENTS');
  const rejected=await request(endpoint,'SOURCE_ONLY_AUTH_DENY',
    'diagnoseSnapshotIntegrity',{date:DATE},fetchImpl);
  if(rejected?.status!=='error'||rejected.message!=='인증 실패')
    throw new Error('SOURCE_ONLY_AUTH_NOT_ENFORCED');
  // GAS workflows can finish validation without deploying if the auto-deploy
  // setting is disabled. Exact deployed API version is a mandatory gate.
  const status=await request(endpoint,token,'getAutomationStatus',{},fetchImpl);
  if(status?.status!=='ok'||!['9.231','9.232','9.233','9.234','9.235','9.236','9.237','9.238','9.239'].includes(status.automation?.gasVersion))
    throw new Error('SOURCE_ONLY_GAS_VERSION_NOT_DEPLOYED');
  const before=await fetchDiagnostic(endpoint,token,fetchImpl);
  if(before.status==='VALID'){
    assertBaselineValid(before);
    return {mode:'ALREADY_VALID',date:DATE,changed:0};
  }
  assertSourceOnlyMismatch(before);
  const capacity=assertBackupCapacity(await request(
    endpoint,token,'diagnoseWorkbookCells',{},fetchImpl));
  if(!apply)return {mode:'DRY_RUN',date:DATE,changed:0,
    sourceOnlyCodes:EXPECTED_FUNDS.slice(),minimumSafeBackupCells:capacity.minimumSafeCells};
  // GAS v9.231+ acquires ScriptLock and rechecks the exact 2-code source
  // contract BEFORE touching any cells; only K column at the proven two
  // physical fund rows can be updated. A full-date rewrite is forbidden.
  const write=await request(endpoint,token,'repairOct08FundSourceOnly',{},fetchImpl);
  if(write?.status!=='ok'||!['APPLIED','ALREADY_VALID'].includes(write.mode)
      ||write.date!==DATE||write.verified!=='VALID'
      ||(write.mode==='APPLIED'&&write.changed!==2)
      ||(write.mode==='ALREADY_VALID'&&write.changed!==0))
    throw new Error('SOURCE_ONLY_GAS_REWRITE_FAILED_VERIFY_BEFORE_RETRY');
  const after=await fetchDiagnostic(endpoint,token,fetchImpl);
  assertBaselineValid(after);
  return {mode:write.mode,date:DATE,changed:write.changed,
    snapshotRows:39,verified:'VALID'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  try{
    console.log(JSON.stringify(await runSourceOnlyRepair({
      url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
      apply:process.env.SOURCE_ONLY_APPLY==='1'})));
  }catch(error){
    const code=String(error?.message||'');
    console.error(/^SOURCE_ONLY_[A-Z_]+$/.test(code)?code:'SOURCE_ONLY_UNKNOWN_ERROR');
    process.exitCode=1;
  }
}
