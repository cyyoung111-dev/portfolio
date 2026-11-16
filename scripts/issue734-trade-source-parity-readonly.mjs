// Exact published-source/native-Sheet/API parity. No writes or runtime eval API.
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fetchGoogleAuditToken} from './audit-published-gas-gate-readonly.mjs';
import {gasSourceBlobSha,deploymentIdFromWebAppUrl,parseClaspCredentials} from './deploy-gas.mjs';
import {composeGas9295CodeMasterReusePreview} from './compose-gas9295-code-master-reuse-preview.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';

const SHEET='1oyk6qY4pRV3zB_n_ldHeIKLbFS6ZbVLKp0t5OBWZV5c';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=code=>{throw Error('TRADE_SOURCE_PARITY_'+code);};
export async function fetchParityOAuth(clasprc,fetchImpl=fetch){
 try{parseClaspCredentials(clasprc);}catch{fail('OAUTH_CONFIG_INVALID');}
 let reason='OAUTH_NETWORK_UNVERIFIED';
 try{return await fetchGoogleAuditToken({clasprc,fetchImpl:async(...args)=>{
  const r=await fetchImpl(...args);
  reason='OAUTH_RESPONSE_UNVERIFIED';
  if(!r.ok){
   reason='OAUTH_HTTP_'+r.status;
   try{const body=await r.clone().json();
    const known={invalid_grant:'OAUTH_INVALID_GRANT',invalid_client:'OAUTH_INVALID_CLIENT',
     unauthorized_client:'OAUTH_UNAUTHORIZED_CLIENT',access_denied:'OAUTH_ACCESS_DENIED'};
    if(Object.hasOwn(known,body?.error))reason=known[body.error];
   }catch{}
  }
  return r;
 }});}catch{fail(reason);}
}
const extract=(source,name)=>{
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
 if(start<0||end<=start)fail('FUNCTION_MISSING');
 return source.slice(start,end+2);
};
export function inspectPhysicalTradeParity({source,physicalRows,api,preview}){
 if(!Array.isArray(physicalRows)||physicalRows.some(r=>!Array.isArray(r)||r.length!==14)
  ||!Array.isArray(api?.trades)||api.status!=='ok'||api.tradeLedgerProtocolVersion!==2
  ||preview?.status!=='ok'||preview.migrationApplied!==false||preview.financeWrites!==0
  ||!Number.isSafeInteger(preview.sourceRows)||preview.sourceRows!==physicalRows.length
  ||api.trades.length!==physicalRows.length)fail('SCHEMA_UNVERIFIED');
 const ctx=vm.createContext({JSON,Date,String,Number,Math,Array,isFinite,parseFloat,
  _issue507GateInside_:true,CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>
   [...createHash('sha256').update(text,'utf8').digest()].map(n=>n>127?n-256:n)}
 });
 vm.runInContext(['_normalizeDate','_cleanCode','_portfolioSyncDigest_',
  '_tradeV2CanonicalRow_','_tradeV2Revision_'].map(n=>extract(source,n)).join('\n'),ctx,
  {timeout:1000});
 const web=readFileSync('src/web/features/settings/settings_sync.js','utf8');
 vm.runInContext(['_tradeV2NormalizeCode','_tradeV2BrowserCanonical']
  .map(n=>extract(web,n)).join('\n'),ctx,{timeout:1000});
 const rawDigest=hash(JSON.stringify(physicalRows.map(r=>r.map((v,i)=>
  i===0?String(v).slice(0,10):String(v??'')))));
 const physicalRevision=ctx._tradeV2Revision_(physicalRows);
 const byId=new Map(api.trades.map(t=>[t.id,t]));
 if(byId.size!==api.trades.length||physicalRows.some(r=>!byId.has(r[13])))
  fail('IDENTITY_UNVERIFIED');
 const names=['id','date','tradeType','acct','name','code','qty','price',
  'assetType','memo','ratio','fractionalCash','priceRaw','fxRateAtBuy'];
 const differences={};let mismatchedRows=0;
 for(const row of physicalRows){
  const a=ctx._tradeV2CanonicalRow_(row);
  const b=ctx._tradeV2BrowserCanonical(byId.get(row[13]));let mismatch=false;
  for(let i=0;i<14;i++)if(a[i]!==b[i]){
   differences[names[i]]=(differences[names[i]]||0)+1;mismatch=true;
  }
  if(mismatch)mismatchedRows++;
 }
 const sourceMatched=rawDigest===preview.sourceDigest;
 const physicalMatches=physicalRevision===api.ledgerRevision;
 const browserRevision=hash(JSON.stringify(api.trades.slice().sort((a,b)=>
  String(a.date||'').localeCompare(String(b.date||''))).map(ctx._tradeV2BrowserCanonical)));
 return {kind:'ISSUE734_EXACT_SOURCE_PARITY_READONLY',
  status:!sourceMatched?'PHYSICAL_SOURCE_NOT_MATCHED':mismatchedRows?
   'EXACT_FIELD_DIVERGENCE':!physicalMatches?'RUNTIME_DIGEST_DIVERGENCE':
   browserRevision!==api.ledgerRevision?'ORDER_DIVERGENCE':'CONSISTENT',
  rows:physicalRows.length,nativeSheetMatchesRuntimeSource:sourceMatched,
  physicalUtf8RevisionMatchesRuntime:physicalMatches,
  browserRevisionMatchesRuntime:browserRevision===api.ledgerRevision,
  mismatchedRows,fieldMismatchCounts:differences,financeWrites:0};
}
export async function runSourceParity({url,token,clasprc,scriptId,fetchImpl=fetch}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12||!/^[-\w]{8,160}$/.test(scriptId||''))
  fail('AUTH_CONFIG_MISSING');
 const oauth=await fetchParityOAuth(clasprc,fetchImpl);
 const get=async address=>{
  const r=await fetchImpl(address,{method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+oauth},signal:AbortSignal.timeout(20000)});
  if(!r.ok)fail('GOOGLE_HTTP_'+r.status);
  return r.json();
 };
 const root='https://script.googleapis.com/v1/projects/'+encodeURIComponent(scriptId);
 const deployment=await get(root+'/deployments/'+encodeURIComponent(deploymentIdFromWebAppUrl(endpoint)));
 const version=deployment?.deploymentConfig?.versionNumber;
 if(!Number.isSafeInteger(version)||version<1)fail('DEPLOYMENT_UNVERIFIED');
 const content=await get(root+'/content?versionNumber='+version);
 const files=content?.files?.filter(f=>f.type==='SERVER_JS')||[];
 if(files.length!==1)fail('SOURCE_UNVERIFIED');
 const source=files[0].source;
 const expected=composeGas9295CodeMasterReusePreview().candidate;
 if(gasSourceBlobSha(source)!==gasSourceBlobSha(expected))fail('PUBLISHED_SOURCE_CHANGED');
 const read=async action=>{
  const r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)fail('GAS_HTTP_UNVERIFIED');return r.json();
 };
 const before=await read('previewTradeLedgerV2Migration');
 if(before?.status!=='ok'||before.migrationApplied!==false||before.financeWrites!==0
  ||!Number.isSafeInteger(before.sourceRows)||before.sourceRows<1||before.sourceRows>20000)
  fail('PREVIEW_UNVERIFIED');
 const range=encodeURIComponent("'거래이력'!A1:N"+(before.sourceRows+1));
 const native=await get('https://sheets.googleapis.com/v4/spreadsheets/'+SHEET+
  '/values/'+range+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
 const values=native?.values;
 if(!Array.isArray(values)||values.length!==before.sourceRows+1)fail('NATIVE_ROWS_UNVERIFIED');
 const headers=['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산','외화단가','매입환율','거래ID'];
 if(JSON.stringify(values[0])!==JSON.stringify(headers))fail('NATIVE_HEADERS_UNVERIFIED');
 const physicalRows=values.slice(1).map(r=>{
  const row=Array.from({length:14},(_,i)=>r[i]??'');
  // Source sheet has date-only cells. Reject time-valued dates rather than
  // guessing their spreadsheet-zone conversion.
  if(!Number.isSafeInteger(row[0]))fail('NATIVE_DATE_TYPE_UNVERIFIED');
  row[0]=new Date(Date.UTC(1899,11,30)+row[0]*86400000).toISOString().slice(0,10);
  return row;
 });
 const api=await read('getTrades'),after=await read('previewTradeLedgerV2Migration');
 if(after?.sourceDigest!==before.sourceDigest||after?.proposedRevision!==before.proposedRevision)
  fail('SOURCE_CHANGED');
 return {...inspectPhysicalTradeParity({source,physicalRows,api,preview:after}),
  publishedSourceVerified:true,appsScriptVersion:version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')
   fail('MAIN_FIRST_ATTEMPT_REQUIRED');
  const result=await runSourceParity({url:process.env.GAS_WEB_APP_URL,
   token:process.env.GAS_ACCESS_TOKEN,clasprc:process.env.CLASPRC_JSON,
   scriptId:process.env.GAS_SCRIPT_ID});
  console.log(JSON.stringify(result));
  if(result.status!=='CONSISTENT')process.exitCode=2;
 }catch(e){const code=String(e?.message||'');
  console.log(JSON.stringify({kind:'ISSUE734_EXACT_SOURCE_PARITY_READONLY',status:'UNVERIFIED',
   reason:/^TRADE_SOURCE_PARITY_[A-Z0-9_]+$/.test(code)?code:'READ_UNVERIFIED',financeWrites:0}));
  process.exitCode=2;
 }
}
