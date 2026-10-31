import {isolateGasBusinessLogic} from './gas-business-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=isolateGasBusinessLogic(fs.readFileSync('src/gas/apps_script.gs','utf8'));
const extract=name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name+' must exist');
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,name+' must close');
  return source.slice(start,end+2);
};
assert.match(source,/params.action === 'getKrxK200NightDiagnostics'/);
assert.match(source,/'getKrxK200NightDiagnostics', 'getExchangeRateHistory'/);
for(const name of ['_summarizeKrxK200NightRows_','handleGetKrxK200NightDiagnostics']) {
  assert.doesNotMatch(extract(name),/\.(?:setValues|appendRow|deleteRows|setProperty|deleteProperty)\s*\(/,
    'diagnostics must not write to Google Sheets or Properties');
}
const date='2026-10-14',token='secret-do-not-expose';
const valid={
  BAS_DD:'20261014',MKT_NM:'야간',PROD_NM:'코스피200 선물',
  ISU_CD:'SECRET_CONTRACT_ID',ISU_NM:'코스피200 F 202612 (야간)',TDD_CLSPRC:'351.25'
};
let rows=[valid,{...valid,ISU_NM:'코스피200 F 202703 (야간)',TDD_CLSPRC:'351.10'}];
let httpStatus=200,rawText='',otherKey='',calls=[];
const response=(status,body)=>({
  getResponseCode:()=>status,getContentText:()=>body
});
const ctx=vm.createContext({
  _normalizeDate:v=>String(v||'').trim(),
  _normalizeYmd:v=>String(v||'').replace(/-/g,''),
  _getKrxAuthKeySlots_:()=>({key:token,alternative:otherKey}),
  _isAuthorizedRequest:()=>true,
  jsonOk:v=>({status:'ok',...v}),jsonError:message=>({status:'error',message}),
  CONFIG:{TIMEZONE:'Asia/Seoul'},
  Utilities:{formatDate:()=> '0800'},
  UrlFetchApp:{fetch:(url,options)=>{
    calls.push({url,options});
    return response(httpStatus,rawText||JSON.stringify({OutBlock_1:rows}));
  }}
});
for(const name of ['_parseKrxK200NightExpiry_','_selectKrxK200NightClose_',
    '_summarizeKrxK200NightRows_','handleGetKrxK200NightDiagnostics'])
  vm.runInContext(extract(name),ctx);
const query=()=>JSON.parse(JSON.stringify(ctx.handleGetKrxK200NightDiagnostics(date)));
let out=query();
assert.equal(out.status,'ok');
assert.equal(out.diagnostic.mode,'READ_ONLY');
assert.equal(out.diagnostic.parseStatus,'ROWS');
assert.equal(out.diagnostic.stats.totalRows,2);
assert.equal(out.diagnostic.stats.exactDateRows,2);
assert.equal(out.diagnostic.stats.exactDateNightRows,2);
assert.equal(out.diagnostic.stats.exactNightProductRows,2);
assert.equal(out.diagnostic.stats.positiveCloseRows,2);
assert.equal(out.diagnostic.stats.nearestExpiryRows,1);
assert.equal(out.diagnostic.stats.wouldSelect,true);
assert.ok(ctx._selectKrxK200NightClose_(rows,date));
assert.equal(calls.length,1);
assert.equal(calls[0].options.headers.AUTH_KEY,token);
assert.equal(calls[0].options.method,'get');
assert.doesNotMatch(JSON.stringify(out),/SECRET_CONTRACT_ID|351\.25|secret-do-not-expose|코스피200 F/);

rows=[{...valid,MKT_NM:'정규'},{...valid,PROD_NM:'코스피200 야간선물'}];
out=query();
assert.equal(out.diagnostic.stats.exactDateNightRows,1);
assert.equal(out.diagnostic.stats.exactNightProductRows,0);
assert.equal(out.diagnostic.stats.exactProductLabelVariants,1);
assert.equal(out.diagnostic.stats.wouldSelect,false);
assert.equal(ctx._selectKrxK200NightClose_(rows,date),null);
rows=[{...valid,BAS_DD:'20261013'}];
out=query();
assert.equal(out.diagnostic.stats.nightMarketRows,1);
assert.equal(out.diagnostic.stats.exactDateRows,0);
assert.equal(out.diagnostic.stats.wouldSelect,false);
rows=[{...valid,ISU_NM:'예상과 다른 월물 표기'}];
out=query();
assert.equal(out.diagnostic.stats.exactNightProductRows,1);
assert.equal(out.diagnostic.stats.validExpiryRows,0);
rows=[{...valid,TDD_CLSPRC:'0'}];
out=query();
assert.equal(out.diagnostic.stats.unexpiredExpiryRows,1);
assert.equal(out.diagnostic.stats.positiveCloseRows,0);
rows=[valid,{...valid,TDD_CLSPRC:'351.75'}];
out=query();
assert.equal(out.diagnostic.stats.nearestExpiryRows,2);
assert.equal(out.diagnostic.stats.wouldSelect,false);
assert.equal(ctx._selectKrxK200NightClose_(rows,date),null);
rows=[];
out=query();
assert.equal(out.diagnostic.parseStatus,'EMPTY');
assert.equal(out.diagnostic.stats.totalRows,0);
rawText='{"not_expected":[]}';
out=query();
assert.equal(out.diagnostic.parseStatus,'UNEXPECTED_SCHEMA');
rawText='{invalid';
out=query();
assert.equal(out.diagnostic.parseStatus,'NON_JSON');
rawText='';
httpStatus=403;
out=query();
assert.equal(out.diagnostic.primaryHttpStatus,403);
assert.equal(out.diagnostic.parseStatus,'HTTP_DENIED_OR_UNAVAILABLE');
assert.equal(out.diagnostic.stats,null);
otherKey='backup-secret';
ctx.UrlFetchApp.fetch=(url,options)=>{
  calls.push({url,options});
  return response(options.headers.AUTH_KEY===token?403:200,JSON.stringify({OutBlock_1:[valid]}));
};
out=query();
assert.equal(out.diagnostic.source,'ALTERNATIVE');
assert.equal(out.diagnostic.primaryHttpStatus,403);
assert.equal(out.diagnostic.alternativeHttpStatus,200);
assert.equal(out.diagnostic.stats.wouldSelect,true);
assert.doesNotMatch(JSON.stringify(out),/backup-secret|secret-do-not-expose|SECRET_CONTRACT_ID|351\.25/);
assert.equal(ctx.handleGetKrxK200NightDiagnostics('bad').status,'error');
console.log('KRX night read-only summary + mismatch stages + auth fallback + privacy passed');
