import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gasSourceBlobSha} from './deploy-gas.mjs';
import {prepareNh0645Gas9283} from './prepare-nh-0645-gas-release-9283.mjs';
import {composeGasTurnoverProposal,TURNOVER_GAS_FUNCTIONS}
 from './compose-gas-krx-turnover-proposal.mjs';
import {prepareGasNh9283WithKrxTurnoverPreview,REVIEWED_NH_PREVIEW_BLOB}
 from './compose-gas9283-turnover-preview.mjs';
const original=fs.readFileSync('src/gas/apps_script.gs','utf8');
const originalBlob=gasSourceBlobSha(original);
assert.equal(originalBlob,'9c1a5f31d1abc4b44f7da9af7a50fe3f15967134');
const nh=prepareNh0645Gas9283();
assert.equal(gasSourceBlobSha(nh.candidate),REVIEWED_NH_PREVIEW_BLOB);
const krx=composeGasTurnoverProposal(original);
const {candidate,manifest}=prepareGasNh9283WithKrxTurnoverPreview();
assert.equal(manifest.status,'COMBINED_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.predecessorSourceBlob,originalBlob);
assert.equal(manifest.nhReviewedPreviewBlob,REVIEWED_NH_PREVIEW_BLOB);
assert.equal(manifest.combinedPreviewBlob,gasSourceBlobSha(candidate));
assert.equal(manifest.productionSourceChanged,false);
assert.equal(manifest.deploymentApproved,false);
assert.equal(manifest.fullSourceApproved,false);
assert.equal(manifest.releaseVersionApproved,false);
assert.equal(manifest.financeWriteAuthorized,false);
assert.equal(manifest.requiresProductionRelease,true);
assert.equal(manifest.requiresNhLiveVerification,true);
assert.equal(manifest.requiresKrxLiveVerification,true);
assert.equal((candidate.match(/\bgasVersion:\s*'9\.283'/g)||[]).length,9);
assert.equal((candidate.match(/function handleGetKrxMarketTurnover\(/g)||[]).length,1);
assert.equal((candidate.match(/function _nhProxyNightReference_\(/g)||[]).length,1);
assert.match(candidate,/kst\.minutes<405\|\|kst\.minutes>=480/);
assert.match(candidate,/\(diagnosticOnly\?\(kst\.minutes<480\|\|kst\.minutes>=780\):\(kst\.minutes<405\|\|kst\.minutes>=480\)\)/);
assert.doesNotMatch(candidate,/kst\.minutes<450\|\|kst\.minutes>=480/);
assert.equal((candidate.match(/_issue507GateInvoke_\('handleGetKrxMarketTurnover'/g)||[]).length,1);
assert.match(candidate,/'getBenchmark', 'getKrxMarketTurnover', 'getBenchmarks'/);
assert.match(candidate,/params\.action === 'getKrxMarketTurnover'\)\s+return handleGetKrxMarketTurnover/);
assert.match(candidate,/var ISSUE507_GATE_API_VERSION='9\.283'/);
const oldGate=original.match(/var ISSUE507_GATE_RELEASE_ID='[a-f0-9]{64}'/);
assert.ok(oldGate && candidate.includes(oldGate[0]));
assert.equal((candidate.match(/function handleRepairF00001Snapshot/g)||[]).length,
 (original.match(/function handleRepairF00001Snapshot/g)||[]).length);
assert.equal((candidate.match(/function _issue507GateInvoke_/g)||[]).length,1);
// The candidate must contain exactly the 3 pre-reviewed KRX patches,
// with the rest byte-for-byte identical to the official #837 v9.283 preview.
const getAdded="  if (params.action === 'getKrxMarketTurnover')            return handleGetKrxMarketTurnover(params.date || '');";
const postNew="'getKrxOfficialStockCloses', 'getBenchmark', 'getKrxMarketTurnover', 'getBenchmarks',";
const postOld="'getKrxOfficialStockCloses', 'getBenchmark', 'getBenchmarks',";
let stripped=candidate.replace('\n'+getAdded,'')
 .replace(postNew,postOld).replace(TURNOVER_GAS_FUNCTIONS,'');
assert.equal(stripped,nh.candidate,'combined release preview must not modify NH production contract');
assert.equal(fs.readFileSync('src/gas/apps_script.gs','utf8'),original,'approved production source must not change');
assert.equal(gasSourceBlobSha(krx)!==originalBlob,true,'new KRX additions are only in preview');

// Parse the entire combined production source; no mocks needed to parse.
new vm.Script(candidate,{filename:'combined-preview.gs'});
const extract=name=>{
 const from=candidate.indexOf('function '+name+'(');
 assert.ok(from>=0);
 const to=candidate.indexOf('\n}',from);
 assert.ok(to>from);
 return candidate.slice(from,to+2);
};
const ctx={
 _issue507GateInside_:true,
 _normalizeDate:s=>s,
 _krxCalendarStatus_:()=> 'OPEN',
 _isKrxOfficialCloseAvailableTime_:()=>true,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>({
  access_token:'VALID_COMBINED_GAS_TOKEN',krx_auth_key:'KRX_TEST_PRIMARY_KEY'
 })[k]||null})},
 UrlFetchApp:{fetchAll:requests=>requests.map(x=>({
  getResponseCode:()=>200,
  getContentText:()=>JSON.stringify({OutBlock_1:[{
   IDX_NM:x.url.includes('/kospi_dd_trd')?'코스피':'코스닥',
   BAS_DD:'20261102',ACC_TRDVAL:'12,000,000,000,000'
  }]})
 }))},
 ContentService:{MimeType:{JSON:'application/json'},
  createTextOutput:x=>({getContent:()=>x,setMimeType(){return this;}})}
};
vm.createContext(ctx);
vm.runInContext([
 '_isAuthorizedRequest','_getKrxAuthKeySlots_','doGet','doPost','jsonOk','jsonError',
 '_krxMarketTurnoverKrw_','_selectKrxMarketTurnover_','handleGetKrxMarketTurnover'
].map(extract).join('\n'),ctx);
const get=t=>JSON.parse(ctx.doGet({parameter:{
 action:'getKrxMarketTurnover',date:'2026-11-02',accessToken:t
}}).getContent());
const post=t=>JSON.parse(ctx.doPost({postData:{contents:new URLSearchParams({
 action:'getKrxMarketTurnover',date:'2026-11-02',accessToken:t
}).toString()}}).getContent());
assert.equal(get('VALID_COMBINED_GAS_TOKEN').rows.length,2);
assert.equal(post('VALID_COMBINED_GAS_TOKEN').rows.length,2);
assert.equal(get('INVALID').status,'error');
assert.equal(post('INVALID').status,'error');
console.log(JSON.stringify({status:'PASS',mode:'NH_AND_KRX_TURNOVER_SOURCE_PREVIEW_ONLY',
 originalBlob,nhReviewedBlob:REVIEWED_NH_PREVIEW_BLOB,
 combinedBlob:manifest.combinedPreviewBlob,gasDeployed:false,
 financeWrites:0,liveKrxRequests:0,newOauthRequests:0}));
