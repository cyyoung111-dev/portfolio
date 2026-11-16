#!/usr/bin/env node
// #734: independent PC/GAS v2 revision comparison using an authenticated,
// READ-ONLY getTrades response. Never emit raw financial data, identifiers,
// tokens, account names, prices or either revision digest to Actions logs.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const clean=x=>{
 const s=String(x||'').trim().toUpperCase();
 if(!s)return '';
 if(/^[0-9]+$/.test(s))return s.padStart(6,'0');
 return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(s)&&s.length<=30&&/[A-Z]/.test(s)?s:'';
};
const number=(v,zeroBlank=false)=>{
 if(v===null||v===undefined||v==='')return '';
 const n=Number(v);
 if(!Number.isFinite(n))throw Error('TRADE_NUMBER_INVALID');
 return zeroBlank&&!n?'':n;
};
const canonical=(t,{zeroBlank=true,normalizeCode=true}={})=>[
 String(t?.id||''),String(t?.date||'').slice(0,10),
 String(t?.tradeType||''),String(t?.acct||''),
 String(t?.name||''),normalizeCode?clean(t?.code):String(t?.code||''),
 number(t?.qty??0),number(t?.price??0),
 String(t?.assetType||'주식'),String(t?.memo||''),
 number(t?.ratio??0,zeroBlank),number(t?.fractionalCash??0,zeroBlank),
 number(t?.priceRaw),number(t?.fxRateAtBuy)
];
const byDateTradeRevision=rows=>sha(rows.slice().sort((a,b)=>
 String(a.date||'').localeCompare(String(b.date||''))).map(t=>canonical(t)));
// Raw-string oracle from the existing GAS migration PREVIEW sourceDigest.
// This is a candidate projection of getTrades, NOT proof that the physical
// sheet has identical blank/zero cell types. Only aggregate equality is logged.
export function reconstructedRawSourceDigest(trades,{
 zeroOptional=false,emptyStockType=false
}={}){
 return sha(trades.map(t=>[
  String(t?.date||'').slice(0,10),
  String(t?.tradeType||''),String(t?.acct||''),String(t?.name||''),
  String(t?.code||''),String(t?.qty??0),String(t?.price??0),
  emptyStockType&&t?.assetType==='주식'?'':String(t?.assetType||'주식'),
  String(t?.memo||''),
  zeroOptional?'0':'',zeroOptional?'0':'',
  t?.priceRaw==null?'':String(t.priceRaw),
  t?.fxRateAtBuy==null?'':String(t.fxRateAtBuy),
  String(t?.id||'')
 ]));
}
export function inspectTradeV2RevisionResponse(result){
 if(result?.status!=='ok'||result.tradeLedgerProtocolVersion!==2
    ||!/^[0-9a-f]{64}$/.test(String(result.ledgerRevision||''))
    ||!Array.isArray(result.trades)||result.trades.length>20000)
   throw Error('READBACK_SCHEMA_UNVERIFIED');
 const rows=result.trades;
 const ids=new Set();
 for(const t of rows){
  const id=String(t?.id||'');
  if(!/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/.test(id)||ids.has(id))
   throw Error('READBACK_ID_UNVERIFIED');
  ids.add(id);
 }
 const byDate=rows.slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
 const current=byDate.map(t=>canonical(t));
 const hash=result.ledgerRevision;
 // Candidate comparisons are diagnostic only. They do NOT authorize a
 // revision rewrite, a financial save, a receipt repair or a local ACK.
 const alternatives={
  sourceOrder:sha(rows.map(t=>canonical(t)))===hash,
  numericZero:sha(byDate.map(t=>canonical(t,{zeroBlank:false})))===hash,
  rawCode:sha(byDate.map(t=>canonical(t,{normalizeCode:false})))===hash,
  rawCodeNumericZero:sha(byDate.map(t=>canonical(t,{zeroBlank:false,normalizeCode:false})))===hash
 };
 const mismatch=sha(current)!==hash;
 return {
  kind:'ISSUE734_TRADE_V2_REVISION_READONLY',
  status:mismatch?'REVISION_DRIFT':'CONSISTENT',
  gasVersion:String(result.gasVersion||'UNSPECIFIED').slice(0,14),
  rows:rows.length,uniqueIds:ids.size,
  pcCanonicalMatchesGasRevision:!mismatch,
  candidates:mismatch?alternatives:{},
  alternativeDigestEncodingMatches:mismatch?{
    utf16le:createHash('sha256').update(JSON.stringify(current),'utf16le').digest('hex')===hash,
    latin1:createHash('sha256').update(JSON.stringify(current),'latin1').digest('hex')===hash
  }:{},
  dateOrderInversions:rows.slice(1).filter((r,i)=>
    String(r.date||'')<String(rows[i]?.date||'')).length,
  emptyFxFields:rows.filter(t=>t.priceRaw==null&&t.fxRateAtBuy==null).length,
  optionalZeroFields:rows.filter(t=>Number(t.ratio||0)===0
    &&Number(t.fractionalCash||0)===0).length,
  financeWrites:0
 };
}
export async function probeTradeHash({url,token,fetchImpl=fetch,includeMigrationPreview=false}={}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)throw Error('AUTH_MISSING');
 let response;
 try{response=await fetchImpl(endpoint,{
   method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   redirect:'follow',signal:AbortSignal.timeout(30000),
   body:new URLSearchParams({action:'getTrades',accessToken:token})
 });}catch{throw Error('READBACK_NETWORK_UNVERIFIED');}
 if(!response?.ok)throw Error('READBACK_HTTP_UNVERIFIED');
 let data;
 try{data=await response.json();}catch{throw Error('READBACK_JSON_UNVERIFIED');}
 const analysis=inspectTradeV2RevisionResponse(data);
 if(!includeMigrationPreview)return analysis;
 // This migration *preview* is a ScriptLock-protected read-only view of the
 // exact physical 14-column sheet; its proposedRevision must agree with
 // getTrades' computed revision when both see the same stable source.
 let preview;
 try{
  const response2=await fetchImpl(endpoint,{
   method:'POST',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   redirect:'follow',signal:AbortSignal.timeout(30000),
   body:new URLSearchParams({action:'previewTradeLedgerV2Migration',accessToken:token})
  });
  if(!response2?.ok)throw Error('PREVIEW_HTTP_UNVERIFIED');
  preview=await response2.json();
 }catch{return {...analysis,migrationPreview:{status:'READ_UNVERIFIED'}};}
 const raw=preview?.status==='ok'&&preview.migrationApplied===false
   &&preview.financeWrites===0
   &&Number.isSafeInteger(preview.sourceRows)
   &&Number.isSafeInteger(preview.assignedIdsNeeded)
   &&Number.isSafeInteger(preview.existingIdsPreserved)
   &&/^[0-9a-f]{64}$/.test(String(preview.proposedRevision||''));
 const safeError=new Set(['TRADE_MIGRATION_SHEET_WIDTH_INVALID',
   'TRADE_MIGRATION_HEADER_MISMATCH','TRADE_MIGRATION_SOURCE_INVALID',
   'TRADE_MIGRATION_ROW_INVALID','TRADE_MIGRATION_DUPLICATE_ID',
   'TRADE_MIGRATION_LOCK_BUSY','TRADE_MIGRATION_SOURCE_MISSING']);
 if(!raw)return {...analysis,migrationPreview:{status:'NOT_VERIFIED',
   errorClass:safeError.has(preview?.errorCode)?preview.errorCode:'OTHER_OR_UNAVAILABLE'}};
 const calc=byDateTradeRevision(data.trades);
 return {...analysis,migrationPreview:{
  status:'VERIFIED',sourceRows:preview.sourceRows,
  assignedIdsNeeded:preview.assignedIdsNeeded,
  existingIdsPreserved:preview.existingIdsPreserved,
  physicalRevisionMatchesGasGetTrades:preview.proposedRevision===data.ledgerRevision,
  physicalRevisionMatchesPcCanonical:preview.proposedRevision===calc,
  rowCountMatchesApi:preview.sourceRows===data.trades.length,
  rawStringSourceDigestMatches: /^[0-9a-f]{64}$/.test(String(preview.sourceDigest||''))
   &&preview.sourceDigest===reconstructedRawSourceDigest(data.trades),
  rawStringOptionalZeroMatches:/^[0-9a-f]{64}$/.test(String(preview.sourceDigest||''))
   &&preview.sourceDigest===reconstructedRawSourceDigest(data.trades,{zeroOptional:true}),
  rawStringStockDefaultMatches:/^[0-9a-f]{64}$/.test(String(preview.sourceDigest||''))
   &&preview.sourceDigest===reconstructedRawSourceDigest(data.trades,{emptyStockType:true})
 }};

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||
    process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')
    throw Error('MAIN_ONLY');
  const output=await probeTradeHash({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   includeMigrationPreview:true
  });
  console.log(JSON.stringify(output));
  if(output.status==='REVISION_DRIFT')
    console.log('::warning title=Read-only GAS revision mismatch::PC canonical hash does not match GAS-reported revision; financial data untouched');
 }catch(error){
  const code=String(error?.message||'');
  console.error(/^(?:READBACK_[A-Z_]+|AUTH_MISSING|MAIN_ONLY|TRADE_NUMBER_INVALID)$/.test(code)
    ?code:'READBACK_UNVERIFIED');
  process.exitCode=2;
 }
}
