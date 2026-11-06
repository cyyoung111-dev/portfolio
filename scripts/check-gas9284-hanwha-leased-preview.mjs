import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {gasSourceBlobSha,extractExpectedGasVersion,assertGasReleaseReady} from './deploy-gas.mjs';
import {composeGas9284HanwhaLeasedPreview} from './compose-gas9284-hanwha-leased-preview.mjs';

const {candidate,base,manifest}=composeGas9284HanwhaLeasedPreview();
const promoted=fs.readFileSync('src/gas/apps_script.gs','utf8');
assert.equal(promoted,candidate,'actual full source must match the reviewed v9.284 candidate byte-for-byte');
assert.equal(gasSourceBlobSha(promoted),'b5b1c7fd5a27454419ddd6d12ecb20751c207c63');
assert.equal(assertGasReleaseReady(promoted),'9.284');
assert.equal(gasSourceBlobSha(base),manifest.baseSourceGitBlob);
assert.equal(gasSourceBlobSha(candidate),manifest.candidateSourceGitBlob);
assert.equal(manifest.status,'SOURCE_PREVIEW_NOT_DEPLOYABLE');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(extractExpectedGasVersion(base),'9.283');
assert.equal(extractExpectedGasVersion(candidate),'9.284');
assert.equal((candidate.match(/gasVersion: '9\.284'/g)||[]).length,9);
assert.match(candidate,/var ISSUE507_GATE_API_VERSION='9\.284'/);
assert.match(candidate,/params\.action === 'collectHanwhaFundNav'.*'F00001'/);
assert.ok(!base.includes('collectHanwhaFundNav'));
new vm.Script(candidate,{filename:'gas-v9.284-hanwha-source-preview.gs'});
function getFunction(source,name){
 const marker='function '+name+'(';
 const i=source.indexOf(marker);
 const end=source.indexOf('\n}',i);
 assert.ok(i>=0&&end>i, 'function must exist '+name);
 assert.equal(source.indexOf(marker,i+marker.length),-1);
 return source.slice(i,end+2);
}
const text=getFunction(candidate,'handleCollectKbFundNav');
const propsData=new Map();
const props={
 getProperty:k=>propsData.get(k)??null,
 setProperty:(k,v)=>propsData.set(k,String(v)),
 deleteProperty:k=>propsData.delete(k),
};
const keys={fund:'portfolio_fund_lease_test',backfill:'portfolio_backfill_lease_test'};
let called=0,refreshCalls=[],origin='',leaseSeen=false,replaceOwner=false,forcedThrow=false;
const setup=()=>{
 propsData.clear();props.setProperty('access_token','test');
 called=0;refreshCalls=[];origin='';leaseSeen=false;replaceOwner=false;forcedThrow=false;
};
const ctx=vm.createContext({
 _issue507GateInside_:true,
 Utilities:{getUuid:()=>'lease-owner-test'},
 PORTFOLIO_FUND_LEASE_KEY:keys.fund,
 PORTFOLIO_CLOSE_BACKFILL_LEASE_KEY:keys.backfill,
 _portfolioFundState_:(p,k)=>{
  try{return JSON.parse(p.getProperty(k)||'null')}catch{return null}
 },
 _portfolioFundAtomic_:callback=>callback(props),
 _fundDate:d=>{
  if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)
    ||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('date');
  return d;
 },
 _fundDateOffset:(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),
 today:()=> '2026-11-06',
 jsonError:message=>({status:'error',message}),
 handleImportFundNav:()=>{
  called++;
  const lease=JSON.parse(props.getProperty(keys.backfill));
  origin=lease.origin;
  leaseSeen=lease.token==='lease-owner-test'&&lease.until>Date.now();
  if(replaceOwner)props.setProperty(keys.backfill,JSON.stringify({token:'another-owner',until:Date.now()+100000}));
  if(forcedThrow)throw Error('simulation only');
  return {status:'ok'};
 },
 handleRefreshFundValuations:(from,to,code)=>{
  called++;refreshCalls.push({from,to,code});
  const lease=JSON.parse(props.getProperty(keys.backfill));
  origin=lease.origin;
  leaseSeen=lease.until>Date.now();
  return {status:'ok'};
 },
});
vm.runInContext(text,ctx);
const kb=JSON.stringify({code:'F00002',provider:'KB_VALUE_ST',classCode:'AQ018',appendOnly:true,
 rows:[{date:'2026-11-05',nav:2169.72}]});
const hanwhaInput={code:'F00001',provider:'HANWHA_2045_CRPE',classCode:'C-RPe',
 appendOnly:true,ackWarnings:false,rows:[{date:'2026-11-05',nav:1951.24}]};
const hanwha=JSON.stringify(hanwhaInput);
// Existing KB import behavior must remain unchanged and single-owned.
setup();
assert.equal(ctx.handleCollectKbFundNav('import',kb,'').status,'ok');
assert.equal(called,1);assert.equal(origin,'KB_NAV_COLLECTOR');
assert.equal(leaseSeen,true);assert.equal(propsData.has(keys.backfill),false);
// Hanwha class requires SAME atomic FUND/backfill shared lease.
setup();
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'ok');
assert.equal(called,1);assert.equal(origin,'HANWHA_NAV_COLLECTOR');
assert.equal(leaseSeen,true);assert.equal(propsData.has(keys.backfill),false);
// Refresh of exact-date F00001 must use stored-only NAV, never public guess.
setup();
assert.equal(ctx.handleCollectKbFundNav('refresh','{}','2026-11-05','F00001').status,'ok');
assert.equal(called,1);assert.equal(origin,'HANWHA_NAV_COLLECTOR');
assert.equal(JSON.stringify(refreshCalls),JSON.stringify([{from:'2026-11-05',to:'2026-11-05',code:'F00001'}]));
// Same-day Hanwha NAV may still be provisional; refuse stored-only refresh.
setup();
assert.equal(ctx.handleCollectKbFundNav('refresh','{}','2026-11-06','F00001').status,'error');
assert.equal(called,0);
assert.equal(propsData.has(keys.backfill),false);
// Existing KB collector keeps its unchanged same-day acceptance semantics.
setup();
assert.equal(ctx.handleCollectKbFundNav('refresh','{}','2026-11-06').status,'ok');
assert.equal(called,1);
// No unauthorized class crossovers or live write attempt on a bad NAV row.
for(const changed of [
 {...hanwhaInput,code:'F00002'},
 {...hanwhaInput,provider:'KB_VALUE_ST'},
 {...hanwhaInput,classCode:'S-T'},
 {...hanwhaInput,ackWarnings:true},
 {...hanwhaInput,appendOnly:false},
 {...hanwhaInput,rows:[{date:'2026-11-06',nav:1951.24}]},
 {...hanwhaInput,rows:[{date:'2026-11-05',nav:1951.24},{date:'2026-11-05',nav:1951.24}]},
 {...hanwhaInput,rows:[]}
]){
 setup();
 assert.equal(ctx.handleCollectKbFundNav('import',JSON.stringify(changed),'','F00001').status,'error');
 assert.equal(called,0);
 assert.equal(propsData.has(keys.backfill),false);
}
// No silent change of KB source on the existing action.
setup();
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00002').status,'error');
assert.equal(called,0);
for(const [key,originName] of [[keys.fund,'FUND_ACTIVE'],[keys.backfill,'BACKFILL_ACTIVE']]){
 setup();
 props.setProperty(key,JSON.stringify({token:originName,until:Date.now()+120000}));
 assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'error');
 assert.equal(called,0);assert.ok(propsData.has(key));
}
setup();
props.setProperty('portfolio_close_stage','PRICE');
props.setProperty('portfolio_close_run_started_ms',String(Date.now()));
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'error');
assert.equal(called,0);
setup();forcedThrow=true;
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'error');
assert.equal(propsData.has(keys.backfill),false);
setup();replaceOwner=true;
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'ok');
assert.equal(JSON.parse(props.getProperty(keys.backfill)).token,'another-owner',
 'stale finally must not release another worker owner');
// Fail before acquiring lease when caller is unauthenticated.
setup();propsData.delete('access_token');
assert.equal(ctx.handleCollectKbFundNav('import',hanwha,'','F00001').status,'error');
assert.equal(called,0);
console.log('GAS9284_HANWHA_LEASE_PREVIEW_OK '+JSON.stringify({
  baseBlob:manifest.baseSourceGitBlob,candidateBlob:manifest.candidateSourceGitBlob,
  proposedVersion:manifest.proposedVersion,reviewedSourceOnly:true,
  productionGasDeployed:false,financeWrites:0}));
