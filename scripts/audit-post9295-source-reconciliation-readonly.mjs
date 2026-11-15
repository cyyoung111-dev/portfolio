#!/usr/bin/env node
// One-shot GAS v9.295 master/ledger/holdings and persisted 2026-11-14
// Snapshot evidence audit. Strictly read-only and aggregate-only output.
// Private holdings, trades, codes, names, quantities, amounts, accounts,
// tokens, sheet/source hashes and raw responses remain inside the runner.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

export const REQUIRED_GAS_VERSION='9.295';
export const SNAPSHOT_DATE='2026-11-14';
const CODE=/^[A-Z0-9][A-Z0-9.-]{0,29}$/;
const DIAGNOSTIC_STATES=new Set(['VALID','PARTIAL','MISMATCH','CONFLICT',
 'SOURCE_INCOMPLETE','NO_SNAPSHOT','PRICE_SUSPICIOUS']);
const MISMATCH_KEYS=Object.freeze(['missingCodes','unexpectedCodes',
 'duplicateKeys','conflictKeys','qtyMismatches','costAmtMismatches',
 'evalUnitMismatches','evalAmtMismatches','sourceMismatches','sourceDataErrors']);
const clean=x=>{
 const s=String(x??'').trim().toUpperCase();
 if(!CODE.test(s)||s==='000000')return '';
 return /^[0-9]{1,6}$/.test(s)?s.padStart(6,'0'):s;
};
const fund=r=>{
 const t=String(r?.assetType??r?.type??'').trim().toUpperCase();
 return ['FUND','TDF','펀드'].includes(t)||/^F\d{5}$/.test(clean(r?.code));
};
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const foreignHint=r=>/^(USD)$/i.test(String(r?.currency||'').trim())
 ||/해외|미국|US STOCK|FOREIGN/i.test(String(r?.assetType??r?.type??''))
 ||/^(US|NASDAQ|NYSE|AMEX)$/i.test(String(r?.market||'').trim());
const usShape=code=>/^[A-Z]{1,5}(?:[.-][A-Z]{1,4})?$/.test(code);
const fail=code=>{throw Error('POST9295_'+code)};
const cnt=(n,max=100000)=>Number.isSafeInteger(n)&&n>=0&&n<=max?n:fail('COUNT_SCHEMA');

export function summarizeMasterCoverage(master,holdings,trades){
 if(master?.status!=='ok'||master?.readOnly!==true||
    master.gasVersion!==REQUIRED_GAS_VERSION||!Array.isArray(master.codes)||
    master.codes.length>20000)fail('MASTER_SCHEMA');
 if(holdings?.status!=='ok'||!Array.isArray(holdings.holdings)||
    holdings.holdings.length>20000)fail('HOLDINGS_SCHEMA');
 if(trades?.status!=='ok'||!Array.isArray(trades.trades)||
    trades.trades.length>100000)fail('TRADES_SCHEMA');
 const masterMap=new Map();
 for(const item of master.codes){
  const code=clean(item?.code);
  if(!code||masterMap.has(code)||typeof item.currency!=='string')
   fail('MASTER_CODES_UNVERIFIED');
  masterMap.set(code,item);
 }
 const usdMaster=[...masterMap.values()].filter(x=>x.currency==='USD').length;
 const krwMaster=[...masterMap.values()].filter(x=>x.currency==='KRW').length;
 const active=holdings.holdings.filter(x=>positive(Number(x?.qty))&&!fund(x));
 const activeCodes=new Set(active.map(x=>clean(x?.code)).filter(Boolean));
 const matched=[...activeCodes].filter(x=>masterMap.has(x)).length;
 const unmatched=[...activeCodes].filter(x=>!masterMap.has(x));
 const explicitForeign=[...new Set(active.filter(foreignHint).map(x=>clean(x.code)).filter(Boolean))];
 const shapes=unmatched.filter(usShape);
 const tradeRows=trades.trades.filter(x=>!fund(x));
 const tradeCodes=new Set(tradeRows.map(x=>clean(x?.code)).filter(Boolean));
 const foreignTrades=[...new Set(tradeRows.filter(foreignHint).map(x=>clean(x.code)).filter(Boolean))];
 const allHistoricalTickerHints=[...tradeCodes].filter(usShape);
 const masterAll=[...masterMap.keys()];
 const result={
  kind:'POST9295_MASTER_VS_CONNECTED_PORTFOLIO_READONLY',
  gasVersion:REQUIRED_GAS_VERSION,
  masterRows:cnt(masterMap.size),masterKrwRows:cnt(krwMaster),
  masterUsdRows:cnt(usdMaster),
  holdingRows:cnt(holdings.holdings.length),
  activeNonFundHoldingRows:cnt(active.length),
  distinctActiveNonFundCodes:cnt(activeCodes.size),
  matchedActiveCodes:cnt(matched),
  unmatchedActiveCodes:cnt(unmatched.length),
  unmatchedUsTickerShapeHints:cnt(shapes.length),
  explicitlyForeignTaggedActiveCodes:cnt(explicitForeign.length),
  explicitlyForeignTaggedUnmatchedActiveCodes:cnt(
   explicitForeign.filter(x=>!masterMap.has(x)).length),
  tradeRows:cnt(trades.trades.length),
  distinctNonFundTradeCodes:cnt(tradeCodes.size),
  historicalUsTickerShapeHints:cnt(allHistoricalTickerHints.length),
  historicalUsTickerShapeNotInMaster:cnt(
   allHistoricalTickerHints.filter(x=>!masterMap.has(x)).length),
  explicitlyForeignTaggedTradeCodes:cnt(foreignTrades.length),
  explicitlyForeignTaggedTradeCodesNotInMaster:cnt(
   foreignTrades.filter(x=>!masterMap.has(x)).length),
  classification:unmatched.length>0?'ACTIVE_HOLDINGS_CODE_COVERAGE_REVIEW':
   usdMaster===0?'CONNECTED_MASTER_NO_USD_ROWS':'CONNECTED_MASTER_COVERAGE_CONFIRMED',
  // Neither ticker shape nor historical trades prove a current US position.
  externalBrokerageCoverageVerified:false,
  ledgerVsHoldingsQuantityReconciled:false,
  physicalSnapshotReconciled:false,
  financialWrites:0,gasDeployments:0
 };
 if(result.matchedActiveCodes+result.unmatchedActiveCodes!==result.distinctActiveNonFundCodes)
  fail('JOIN_COUNT_MISMATCH');
 return result;
}

export function summarizeSnapshotIntegrity(payload,date=SNAPSHOT_DATE){
 if(payload?.status!=='ok'||!Array.isArray(payload.checkedDates)||
  payload.checkedDates.length!==1||payload.checkedDates[0]!==date||
  !Array.isArray(payload.diagnostics)||payload.diagnostics.length!==1)
  fail('SNAPSHOT_SCHEMA');
 const d=payload.diagnostics[0];
 if(d?.date!==date||!DIAGNOSTIC_STATES.has(d.status))fail('SNAPSHOT_STATE_SCHEMA');
 const expected=cnt(d.expectedRowCount,500),stored=cnt(d.storedRowCount,500);
 const issues={};
 for(const key of MISMATCH_KEYS){
  if(!Array.isArray(d[key])||d[key].length>500)fail('SNAPSHOT_ISSUES_SCHEMA');
  issues[key]=cnt(d[key].length,500);
 }
 const duplicateGroups=cnt(d.duplicateSummary?.groups,500);
 const totalDifference=Number(d.totalEvalDifference);
 const differenceVerified=d.totalEvalDifference!==null &&
   d.totalEvalDifference!==undefined &&
   typeof d.totalEvalDifference==='number'&&Number.isFinite(totalDifference);
 const zeroDifferenceVerified=differenceVerified&&totalDifference===0;
 const strictDigestVerified=typeof payload.strictSourceDigest==='string'&&
   /^[a-f0-9]{64}$/i.test(payload.strictSourceDigest);
 const revisionVerified=typeof payload.integritySourceRevision==='string'&&
   payload.integritySourceRevision.trim().length>0;
 const allRowMismatchCountsZero=Object.values(issues).every(x=>x===0);
 const dataMatch=d.status==='VALID'&&expected===stored&&expected>0&&
   zeroDifferenceVerified&&duplicateGroups===0&&allRowMismatchCountsZero&&
   strictDigestVerified&&revisionVerified;
 const perf=payload.performance||{};
 const safeMs=key=>Number.isSafeInteger(perf[key])&&perf[key]>=0&&perf[key]<=360000
  ?perf[key]:null;
 return {
  kind:'POST9295_SNAPSHOT_RECALC_STRICT_READONLY',date,
  gasVersion:REQUIRED_GAS_VERSION,
  integrityState:d.status,expectedRows:expected,storedRows:stored,
  issues,duplicateGroups,
  differenceZeroVerified:zeroDifferenceVerified,
  strictSourceDigestPresent:strictDigestVerified,
  sourceRevisionPresent:revisionVerified,
  status:dataMatch?'RECALC_MATCH_CONFIRMED':'RECALC_REVIEW_REQUIRED',
  rangeTotalMs:safeMs('totalMs'),sheetReadMs:safeMs('readMs'),
  indexBuildMs:safeMs('indexBuildMs'),calculationMs:safeMs('calculationMs'),
  officialExternalSourceIndependentlyVerified:false,
  processWriterOwnerIndependentlyVerified:false,
  moneyValuesLogged:false,financialWrites:0,gasDeployments:0
 };
}

export async function auditPost9295({url,token,fetchImpl=fetch,
 mode='all',report=()=>{}}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)fail('AUTH_MISSING');
 if(!['all','coverage','snapshot'].includes(mode))fail('MODE_INVALID');
 const request=async(action,opts={},timeout=120000)=>{
  if(!['getCodeListReadOnly','getHoldings','getTrades',
   'diagnoseSnapshotIntegrityRange'].includes(action))fail('ACTION_FORBIDDEN');
  const phase=action==='diagnoseSnapshotIntegrityRange'?'SNAPSHOT':
   action==='getCodeListReadOnly'?'MASTER':action==='getHoldings'?'HOLDINGS':'LEDGER';
  let response;
  try{
   response=await fetchImpl(endpoint,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    redirect:'follow',signal:AbortSignal.timeout(timeout),
    body:new URLSearchParams({action,accessToken:token,...opts})
   });
  }catch{fail(phase+'_NETWORK_OR_TIMEOUT')}
  if(!response?.ok)fail(phase+'_HTTP');
  try{return await response.json()}catch{fail(phase+'_JSON')}
 };
 const outputs={};
 if(mode==='coverage'||mode==='all'){
  const master=await request('getCodeListReadOnly');
  const holdings=await request('getHoldings');
  const trades=await request('getTrades');
  outputs.coverage=summarizeMasterCoverage(master,holdings,trades);
  report(outputs.coverage);
 }
 if(mode==='snapshot'||mode==='all'){
  const response=await request('diagnoseSnapshotIntegrityRange',{
   dates:SNAPSHOT_DATE,strictReadonly:'1'
  },180000);
  outputs.snapshot=summarizeSnapshotIntegrity(response);
  report(outputs.snapshot);
 }
 return outputs;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||
   process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')
    fail('MAIN_ONLY');
  const out=await auditPost9295({url:process.env.GAS_WEB_APP_URL,
   token:process.env.GAS_ACCESS_TOKEN,mode:process.argv[2]||'all',
   report:r=>console.log(JSON.stringify(r))});
  if(out.snapshot?.status==='RECALC_REVIEW_REQUIRED')process.exitCode=2;
 }catch(e){
  const label=String(e?.message||'');
  console.error(/^POST9295_[A-Z_]+$/.test(label)?label:'POST9295_UNVERIFIED');
  process.exitCode=1;
 }
}
