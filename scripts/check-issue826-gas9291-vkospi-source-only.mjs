import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gitBlobSha,CURRENT_INDEX_ENDPOINT,PROPOSED_DERIVATIVE_ENDPOINT}
 from './compose-gas-vkospi-derivative-proposal.mjs';
import {composeIssue826Gas9291VkospiSourceOnly,ISSUE826_REVIEWED_GAS_9291_BLOB}
 from './compose-issue826-gas9291-vkospi-source-only.mjs';

const main=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.equal(gitBlobSha(main),ISSUE826_REVIEWED_GAS_9291_BLOB,
 'source must be the actual reviewed v9.291 Git blob');
const result=composeIssue826Gas9291VkospiSourceOnly(main);
assert.equal(result.deployable,false);
assert.equal(result.sourceOnly,true);
assert.deepEqual([result.financialWrites,result.gasRequests,
 result.gasDeployments,result.telegramSends],[0,0,0,0]);
assert.equal(result.changedFunction,'_readVkospiPointsFromKrx');
assert.notEqual(result.candidateGitBlob,result.parentGitBlob);
const roundTrip=result.candidate
 .replace(PROPOSED_DERIVATIVE_ENDPOINT,CURRENT_INDEX_ENDPOINT)
 .replace('vkospi_v3_','vkospi_v2_')
 .replaceAll('vkospi_day_v3_','vkospi_day_v2_');
assert.equal(roundTrip,main,'strict whole-file reverse diff');
assert.equal(result.candidate.split(PROPOSED_DERIVATIVE_ENDPOINT).length,2,
 'no accidental second endpoint in GAS');
assert.ok(result.patchedHandler.includes('vkospi_day_v3_'));
assert.ok(!result.patchedHandler.includes('vkospi_day_v2_'));
assert.throws(()=>composeIssue826Gas9291VkospiSourceOnly(main+'\n'),
 /ISSUE826_GAS_9291_SOURCE_DRIFT/);
assert.equal(result.candidate.slice(0,main.indexOf('function _readVkospiPointsFromKrx(')),
 main.slice(0,main.indexOf('function _readVkospiPointsFromKrx(')));

const nativeResponse=(status,rows)=>({
 getResponseCode:()=>status,
 getContentText:()=>JSON.stringify({OutBlock_1:rows})
});
const okRow={IDX_NM:'코스피 200 변동성지수',
 BAS_DD:'20261110',CLSPRC_IDX:'24.89'};
const testDate='2026-11-10';
const run=({rows=[okRow],mode='primary',date=testDate}={})=>{
 const calls=[],writes=[];
 const cache={
  get:()=>null,getAll:()=>({}),
  put:(k,v)=>writes.push({op:'put',key:k}),
  putAll:x=>writes.push({op:'putAll',keys:Object.keys(x)})
 };
 const env={
  _issue507GateInside_:true,
  _getKrxAuthKeySlots_:()=>({key:'TEST_ONLY_PRIMARY',alternative:'TEST_ONLY_BACKUP'}),
  _buildDateRangeYmd:()=>['20261110'],
  _ymdToDate:()=>new Date('2026-11-10T00:00:00Z'),
  _krxCalendarStatus_:()=> 'OPEN',
  _normalizeYmd:x=>x,
  CacheService:{getScriptCache:()=>cache},
  UrlFetchApp:{fetchAll(reqs){
   for(const req of reqs){
    calls.push({url:req.url,method:req.method,
     authRole:req.headers.AUTH_KEY==='TEST_ONLY_PRIMARY'?'primary':
      req.headers.AUTH_KEY==='TEST_ONLY_BACKUP'?'backup':'unknown'});
   }
   return reqs.map(x=>nativeResponse(
    mode==='denied'?403:mode==='recover'&&x.headers.AUTH_KEY==='TEST_ONLY_PRIMARY'?401:200,
    rows));
  }},
  Logger:{log:()=>{}}
 };
 const fn=vm.runInNewContext(result.patchedHandler+'\n_readVkospiPointsFromKrx;',env);
 let points,error;
 try{points=JSON.parse(JSON.stringify(fn(date,date)));}catch(e){error=String(e.message||e);}
 return {calls,writes,points,error};
};
const good=run();
assert.deepEqual(good.points,[{date:testDate,value:24.89}]);
assert.equal(good.calls.length,1);
assert.match(good.calls[0].url,/\/svc\/apis\/idx\/drvprod_dd_trd\?basDd=20261110$/);
assert.deepEqual(good.calls.map(x=>x.authRole),['primary']);
assert.equal(good.calls[0].method,'get');
assert.equal(good.writes.length,2,'in-memory CacheService only');
assert.ok(good.writes[1].keys.every(x=>x.includes('vkospi_day_v3_')));
assert.ok(good.writes[0].key.startsWith('vkospi_v3_'));
const wrongDate=run({rows:[{...okRow,BAS_DD:'20261109'}]});
assert.deepEqual(wrongDate.points,[]);
const wrongName=run({rows:[{...okRow,IDX_NM:'KOSPI 200'}]});
assert.deepEqual(wrongName.points,[]);
const missing=run({rows:[]});
assert.deepEqual(missing.points,[]);
const recovered=run({mode:'recover'});
assert.deepEqual(recovered.points,[{date:testDate,value:24.89}]);
assert.deepEqual(recovered.calls.map(x=>x.authRole),['primary','backup']);
const denied=run({mode:'denied'});
assert.equal(denied.points,undefined);
assert.match(denied.error||'',/KRX AUTH_KEY/);
assert.deepEqual(denied.calls.map(x=>x.authRole),['primary','backup']);
// No test has touched a live GAS/Sheet/KRX endpoint.
console.log('ISSUE826_GAS_9291_VKOSPI_SOURCE_ONLY_PASS exact SHA, derivative endpoint, v3 cache, 6 fixtures, zero live writes');
