import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {prepareNh0645Gas9283,V9282_BLOB} from './prepare-nh-0645-gas-release-9283.mjs';
import {gasSourceBlobSha} from './deploy-gas.mjs';

const {candidate,manifest}=prepareNh0645Gas9283();
const baseline=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.equal(gasSourceBlobSha(baseline),V9282_BLOB);
assert.notEqual(candidate,baseline);
const pinned=JSON.parse(fs.readFileSync('ops/issue507/nh-0645-v9283-preview.json','utf8'));
assert.equal(pinned.candidateSourceBlob,manifest.candidateBlob,
 'the in-memory candidate must match the separately pinned review blob');
assert.equal(pinned.predecessorSourceBlob,V9282_BLOB);
assert.equal(pinned.proposedVersion,manifest.proposedVersion);
assert.equal(pinned.productionSourceChanged,false);
assert.equal(pinned.financeWriteAuthorized,false);
assert.equal(pinned.gasDeploymentApproved,false);
assert.equal(pinned.requiresLivePredecessorReadback,true);
assert.equal(manifest.status,'PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.proposedVersion,'9.283');
assert.equal(manifest.predecessorBlob,V9282_BLOB);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateBlob);
assert.equal(manifest.changedNhWindowClauses,2);
assert.equal(manifest.reviewedResponseVersions,9);
assert.equal(manifest.entrypointCount,555);
assert.equal(manifest.gateReleaseIdPreserved,true);
assert.equal(manifest.productionSourceChanged,false);
assert.equal(manifest.deploymentApproved,false);
assert.equal(manifest.financeWriteAuthorized,false);
assert.equal(manifest.morningBriefingKst,'07:40');
assert.equal(manifest.windowStartKst,'06:45');
assert.equal(manifest.windowEndKst,'08:00');
assert.match(candidate,/Google Apps Script\s+v9\.283/);
assert.match(candidate,/var ISSUE507_GATE_API_VERSION='9\.283'/);
assert.equal((candidate.match(/\bgasVersion:\s*'9\.283'/g)||[]).length,9);
assert.doesNotMatch(candidate,/\bgasVersion:\s*'9\.282'/);
assert.equal((candidate.match(/function _issue507GateInvoke_/g)||[]).length,1);
assert.equal((candidate.match(/function handleRepairF00001Snapshot/g)||[]).length,
 (baseline.match(/function handleRepairF00001Snapshot/g)||[]).length);
const part=name=>{
 const head='function '+name+'(';
 const start=candidate.indexOf(head),end=candidate.indexOf('\n}',start+head.length);
 assert.ok(start>=0&&end>start,name);
 return candidate.slice(start,end+2);
};
const fullFns=part('_nhProxyNightReference_')+'\n'+part('handleGetNhNightProxy');
new vm.Script(candidate); // Parse the entire candidate, not just the modified handlers.
new vm.Script(fullFns);

// Real production GAS functions under a controlled KST clock. All provider
// calls are synthetic and run in memory; no OAuth, Apps Script or Sheets access.
const utcOf=s=>Date.parse('2026-11-02T'+s+'+09:00');
let nowMs=utcOf('06:44:59'),posts=0;
class Clock extends Date {
 constructor(...args){super(...(args.length?args:[nowMs]));}
 static now(){return nowMs;}
}
const cache=new Map(),putKeys=[],locks={held:false};
const output={source:'NH',kind:'REFERENCE',tradingDate:'2026-11-02',
 contract:'KA016C000',contractMonth:'2026-12',value:873.10,
 clock:'06:00:00',sourceUpdatedAt:'2026-11-02T06:00:00+09:00',
 receivedAt:null,officialClose:false};
const ctx={
 Date:Clock,
 _nhProxyKst_:()=>({date:'2026-11-02',minutes:new Date(nowMs).getUTCHours()*60+
   new Date(nowMs).getUTCMinutes()+540>=1440?
   // Tests are all within 06:44–08:00 KST and don't cross KST midnight.
   (new Date(nowMs).getUTCHours()*60+new Date(nowMs).getUTCMinutes()+540-1440):
   (new Date(nowMs).getUTCHours()*60+new Date(nowMs).getUTCMinutes()+540)}),
 _nhProxyAuthenticated_:p=>p.accessToken==='TEST_GAS_TOKEN',
 jsonError:message=>({status:'error',message}),
 jsonOk:body=>({status:'ok',...body}),
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
 _nhEnabled_:()=>true,_nhCredentials_:()=>({key:'TEST_KEY',secret:'TEST_SECRET'}),
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>{
   putKeys.push(k);cache.set(k,v);
 }})},
 LockService:{getScriptLock:()=>({
   hasLock:()=>locks.held,tryLock:()=>{locks.held=true;return true;},
   releaseLock:()=>{locks.held=false;}
 })},
 _nhProxyFutureCandidate_:()=>({contract:'KA016C000',contractMonth:'2026-12'}),
 _nhPost_:(route,body)=>{
   posts++;
   assert.equal(route,'/krfuture/quote/v1/nightPeriod');
   assert.equal(body.edate,'20261102');
   assert.equal(body.iem_cd,'KA016C000');
   return {Output_0:{iem_cd:'KA016C000',end_time_n:'060000'},
     Output_1:[{work_bsop_date:'20261102',bsop_time:'060000',prpr:'873.10'}]};
 },
};
vm.createContext(ctx);
vm.runInContext(fullFns,ctx);
const request=()=>ctx.handleGetNhNightProxy({date:'2026-11-02',accessToken:'TEST_GAS_TOKEN'});
assert.equal(request().message,'NH_PROXY_WINDOW','06:44:59 rejected');
assert.equal(posts,0);
nowMs=utcOf('06:45:00');
const early=request();
assert.equal(early.status,'ok','06:45:00 accepted');
assert.equal(early.reference.value,873.10);
assert.equal(early.reference.sourceUpdatedAt,output.sourceUpdatedAt);
assert.equal(early.reference.receivedAt,'2026-11-01T21:45:00.000Z');
assert.equal(posts,1);
assert.equal(putKeys.length,1,'single validated dated cache');
nowMs=utcOf('07:25:00');
assert.equal(request().reference.value,873.10);
nowMs=utcOf('07:40:00');
assert.equal(request().reference.value,873.10,'07:40 backup can reuse the cached exact 06:00 session');
nowMs=utcOf('07:59:59');
assert.equal(request().status,'ok','07:59:59 still allowed for backup');
nowMs=utcOf('08:00:00');
assert.equal(request().message,'NH_PROXY_WINDOW','08:00:00 rejected');
assert.equal(posts,1,'all post-06:45 reads reuse cached reference, no token repeated');
assert.equal(ctx.handleGetNhNightProxy({date:'2026-11-02',accessToken:'BAD'}).message,'NH_PROXY_AUTH_REQUIRED');
assert.equal(ctx.handleGetNhNightProxy({date:'2026-11-01',accessToken:'TEST_GAS_TOKEN'}).message,'NH_PROXY_WINDOW');
assert.throws(()=>prepareNh0645Gas9283({read:()=>baseline+'// unexpected mutable edit'}),
 /NH_9283_PRODUCTION_V9282_BASELINE_CHANGED/);
assert.equal(fs.readFileSync('src/gas/apps_script.gs','utf8'),baseline,
 'the preview must never touch production GAS source');
console.log(JSON.stringify({status:'PASS',mode:'NH_9283_RELEASE_PREVIEW_ONLY',
 candidateBlob:manifest.candidateBlob,verifiedKst:['06:44:59 rejected','06:45 accepted',
 '07:25 cached','07:40 cached','07:59:59 accepted','08:00 rejected'],
 newOAuthRequests:0,financialWrites:0,productionChanges:0}));
