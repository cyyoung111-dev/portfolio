#!/usr/bin/env node
// #734: exact KRX-day GAS Snapshot internal reconciliation. READ ONLY.
// Two authenticated private reads; never log rows, account identifiers,
// securities, values, credential material, raw error messages or digests.
// A PASS is not evidence of external writer exclusion or official price origin.
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const STATES=new Set(['VALID','MISMATCH','PARTIAL','CONFLICT','NO_SNAPSHOT',
  'SOURCE_INCOMPLETE','PRICE_SUSPICIOUS']);
const ARRAYS=['expectedCodes','storedCodes','missingCodes','unexpectedCodes',
  'qtyMismatches','costAmtMismatches','evalAmtMismatches','evalUnitMismatches',
  'sourceMismatches','duplicateKeys','conflictKeys','sourceDataErrors'];
function fail(reason){throw Error('ISSUE734_SNAPSHOT_EXACT_'+reason);}
function validDay(v){
 return typeof v==='string'&&DAY.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))
   &&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
}
function codes(items){
 const out=[];
 for(const item of items){
  if(!item||typeof item.code!=='string'||!item.code.trim()
    ||item.code.length>32||!Number.isFinite(Number(item.qty))
    ||!Number.isFinite(Number(item.evalAmt))||Number(item.evalAmt)<0
    ||typeof item.source!=='string')fail('HISTORY_SCHEMA');
  out.push(item.code.trim().toUpperCase());
 }
 return out;
}
const sameSet=(a,b)=>a.length===b.length&&
  a.slice().sort().every((x,i)=>x===b.slice().sort()[i]);

export function classifySnapshotExact({history,integrity,date}={}){
 if(!validDay(date)||history?.status!=='ok'||history.date!==date||
  !Array.isArray(history.items)||history.items.length>1000)fail('HISTORY_SCHEMA');
 if(integrity?.status!=='ok'||!Array.isArray(integrity.checkedDates)
   ||integrity.checkedDates.length!==1||integrity.checkedDates[0]!==date
   ||!Array.isArray(integrity.diagnostics)||integrity.diagnostics.length!==1
   ||typeof integrity.integritySourceRevision!=='string'
   ||!integrity.integritySourceRevision
   ||!/^[a-f0-9]{64}$/.test(String(integrity.strictSourceDigest||'')))
  fail('INTEGRITY_ENVELOPE');
 const d=integrity.diagnostics[0];
 if(d?.date!==date||!STATES.has(d.status)
   ||!Number.isSafeInteger(d.expectedRowCount)||!Number.isSafeInteger(d.storedRowCount)
   ||d.expectedRowCount<0||d.expectedRowCount>1000
   ||d.storedRowCount<0||d.storedRowCount>1000
   ||ARRAYS.some(k=>!Array.isArray(d[k])||d[k].length>1000))fail('INTEGRITY_SCHEMA');
 const all=codes(history.items),unique=new Set(all);
 const expected=d.expectedCodes.map(s=>String(s).toUpperCase());
 const stored=d.storedCodes.map(s=>String(s).toUpperCase());
 const countMatch=d.expectedRowCount===d.storedRowCount
   &&d.storedRowCount===history.items.length;
 const codeMatch=unique.size===all.length&&new Set(expected).size===expected.length
   &&new Set(stored).size===stored.length&&sameSet(all,stored)
   &&sameSet(expected,stored);
 const mismatches=ARRAYS.filter(k=>!['expectedCodes','storedCodes'].includes(k))
   .reduce((n,k)=>n+d[k].length,0);
 const noErrors=mismatches===0;
 const internallyVerified=d.status==='VALID'&&d.expectedRowCount>0
   &&countMatch&&codeMatch&&noErrors;
 return {kind:'ISSUE734_SNAPSHOT_EXACT_READONLY',date,
  state:internallyVerified?'VERIFIED':'INCOMPLETE_OR_MISMATCH',
  integrityState:d.status,
  expectedRows:d.expectedRowCount,storedRows:d.storedRowCount,
  retrievedRows:history.items.length,duplicateStoredCodes:all.length-unique.size,
  rowCountMatch:countMatch,codeSetMatch:codeMatch,
  mismatchGroupsPresent:ARRAYS.filter(k=>!['expectedCodes','storedCodes'].includes(k)
   &&d[k].length>0).length,
  internalRevaluationVerified:internallyVerified,
  // This is two reads of a GAS-owned source, not an independent broker/source
  // read or an atomic cross-client lock. Never authorize a Writer from here.
  officialPriceSourceIndependentlyVerified:false,
  externalWriterExcludedVerified:false,exactWriterOwnerVerified:false,
  writeAuthorized:false,financialWrites:0,gasWrites:0,
  propertyWrites:0,telegramSends:0,readOnlyRequests:2};
}
async function read(url,token,action,extra,fetchImpl){
 let response;
 try{response=await fetchImpl(url,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,...extra,accessToken:token}),
   signal:AbortSignal.timeout(90000)});
 }catch{fail('NETWORK_OR_TIMEOUT');}
 if(!response?.ok)fail('HTTP_UNVERIFIED');
 try{return await response.json();}catch{fail('JSON_UNVERIFIED');}
}
export async function auditSnapshotExact({url,token,date,fetchImpl=fetch}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12||!validDay(date))fail('CONFIG');
 // First verify the recomputed strict data contract. Raw data remains memory-only.
 const integrity=await read(endpoint,token,'diagnoseSnapshotIntegrityRange',
   {dates:date,strictReadonly:'1'},fetchImpl);
 const history=await read(endpoint,token,'getHistoryDetail',{date},fetchImpl);
 return classifySnapshotExact({history,integrity,date});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3)fail('DATE_REQUIRED');
  console.log(JSON.stringify(await auditSnapshotExact({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   date:process.argv[2]
  })));
 }catch(e){
  const reason=String(e?.message||'');
  console.error(/^ISSUE734_SNAPSHOT_EXACT_[A-Z_]+$/.test(reason)?reason:
    'ISSUE734_SNAPSHOT_EXACT_UNVERIFIED');
  process.exitCode=2;
 }
}
