import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import YAML from 'yaml';
import {composeGas9306NavRefreshPreview} from './compose-gas9306-nav-refresh-preview.mjs';
import {assertGasReleaseReady,assertGas9306Prerequisites,assertIssue507ManualReleasePermission} from './deploy-gas.mjs';

const {candidate,manifest}=composeGas9306NavRefreshPreview();
new vm.Script(candidate);
assertGasReleaseReady(candidate);
assert.equal(manifest.version,'9.306');
assert.throws(()=>assertIssue507ManualReleasePermission({version:'9.306',eventName:'push',approved9306:true}),/MANUAL_RELEASE_REQUIRED/);
assert.doesNotThrow(()=>assertIssue507ManualReleasePermission({version:'9.306',eventName:'workflow_dispatch',approved9306:true}));
assert.throws(()=>assertGas9306Prerequisites({version:'9.306',publishedVersion:'9.305'}),/SAME_RUN/);
assert.throws(()=>assertGas9306Prerequisites({version:'9.306',publishedVersion:'9.304',liveIdleVerified:true}),/PUBLISHED_9305/);

const wf=YAML.parse(fs.readFileSync('.github/workflows/gas-deploy.yml','utf8'));
const inputs=wf.on.workflow_dispatch.inputs;
assert.deepEqual(Object.keys(inputs),['operation']);
assert.equal(inputs.operation.default,'진단만');
assert.deepEqual(inputs.operation.options,['진단만','9.306 실제 배포']);
assert.equal(inputs.operation.type,'choice');
assert.equal(inputs.operation.required,true);
const job=wf.jobs.deploy,steps=job.steps;
const inventoryLive=steps.find(s=>s.name==='Require clean full GAS deployment inventory before real deploy');
const inventoryDry=steps.find(s=>s.name==='Require clean full GAS deployment inventory on 9.306 dry-run');
const preflight=steps.find(s=>s.id==='gas9306_gate');
const deploy=steps.find(s=>s.name==='Deploy GAS');
const post=steps.find(s=>s.name==='Verify current NAV and valuation after 9.306 (read only)');
assert(inventoryLive&&inventoryDry&&preflight&&deploy&&post);
assert.equal(inventoryDry.run,inventoryLive.run);
assert.equal(preflight.run,'node scripts/gas9298-release-readonly.mjs pre 9.306');
assert.equal(preflight['continue-on-error'],undefined);
assert(steps.indexOf(inventoryLive)<steps.indexOf(preflight)&&steps.indexOf(inventoryDry)<steps.indexOf(preflight)&&steps.indexOf(preflight)<steps.indexOf(deploy)&&steps.indexOf(deploy)<steps.indexOf(post));
assert.match(job.env.GAS_9306_RELEASE_APPROVAL,/workflow_dispatch.*inputs\.operation == '9\.306 실제 배포'/);
assert.match(job.env.GAS_DEPLOY_DRY_RUN,/workflow_dispatch.*inputs\.operation == '진단만'/);
assert.match(job.env.GAS_9306_NAV_REFRESH,/inputs\.operation == '진단만'.*inputs\.operation == '9\.306 실제 배포'/);
assert.match(job.concurrency.group,/inputs\.operation == '진단만'/);
assert.equal(job.env.GAS_9304_RELEASE_APPROVAL,'false');
assert.equal(job.env.GAS_9304_NH_DIAGNOSTIC,'false');
assert.match(deploy.env.GAS_9306_LIVE_PREFLIGHT_VERIFIED,/gas9306_gate/);
assert.match(post.if,/GAS_9306_RELEASE_APPROVAL == 'true'/);
assert.equal(post.run,'node scripts/audit-kb-nav-postflight-readonly.mjs --both');
assert.match(steps.find(s=>s.name==='Activate NH current prices after real GAS deployment').if,/GAS_9306_NAV_REFRESH != 'true'/);

const start=candidate.indexOf('function _refreshFundValuations(');
const source=candidate.slice(start,candidate.indexOf('\n}',start)+2);
const date='2026-11-20',code='F00002',stock='005930';
function simulate({existing=true,partial=false,storedUnits=2000,manual=false,collector=true,conflict=false}={}){
 const nav=[date,code,'Fund',100,date,storedUnits,200,'','KB'];
 const sameDayPrice=[date,code,'Fund',190,'','FUND_NAV_CARRY'];
 const stockRow=[date,stock,'Stock',1,200,200,230,230,30,15,'PRICE_HISTORY',''];
 const fundRow=[date,code,'Fund',1,100,100,190,190,90,90,manual?'MANUAL':'FUND_NAV_CARRY',''];
 const existingRows=existing?(partial?[fundRow]:[stockRow,fundRow]):[];
 const config={code,name:'Fund',provider:'KB',units:2000};
 const writes=[];
 const sheetsNow={
  NAV:{getLastRow:()=>2,getRange:()=>({getValues:()=>[nav.slice()]})},
  PH:{getLastRow:()=>2,getRange:(row,col,count,width)=>({
   getValues:()=>[sameDayPrice.slice()],
   setValues:rows=>writes.push({type:'price',row,col,count,width,rows}),
   setNumberFormat:()=>{}
  })}
 };
 const select=(first,second)=>{
  const rows=new Map(first.map(row=>[row[1],row]));
  second.forEach(row=>{if(rows.get(row[1])?.[10]!=='MANUAL')rows.set(row[1],row);});
  return [...rows.values()];
 };
 const runtime={
  CONFIG:{SHEET_PH:'PH',SHEET_TRADES:'TRADES'},FUND_NAV_SHEET:'NAV',
  FUND_PROVIDERS:{KB:{source:'FUNETF'}},today:()=>date,
  _fundDate:d=>d,_fundDateOffset:(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10),
  _readFundUnits:()=>[config],_fundUnitsAtDate:()=>config,
  _normalizeDate:d=>d,_fundNavExpectedPublicationDate:()=>true,
  _storedFundNavRows:()=>[{date,nav:100}],
  _fundDailyValues:()=>[{code,date,name:'Fund',sourceDate:date,nav:100,evalAmt:200,units:2000,provider:'KB'}],
  _fundValueNeedsProcessing:()=>true,_fundConfiguredCodeForPriceRow:row=>row[1],
  _preferFundRepresentativeRow:()=>true,
  _fundDerivedState:()=>({sheet:sheetsNow.PH,prices:[sameDayPrice.slice()],priceKeys:{[date+'|'+code]:sameDayPrice.slice()},snapshotKeys:{}}),
  _fundRecoveryDiagnosticStart:()=>{},_fundRecoveryDiagnosticFinish:()=>{},
  LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  _backupSheetBeforeWrite:()=>({}),_markSnapshotBackupStatus:()=>{},_cleanupCurrentSystemBackup:()=>{},
  _setCodeColumnText:()=>{},_normalizeCodeRows:rows=>rows,_verifyWrittenRange:()=>{},
  _touchSnapshotIntegritySourceRevision:()=>{},_readSnapshotRowsByDate:()=>existingRows,
  _filterSnapshotRowsByFundLifecycle:rows=>rows,
  _buildSnapshotRowsFromTradeAndPriceHistory:()=>{writes.push({type:'whole-date-build'});return [stockRow];},
  _mergeSnapshotRowsSafely:select,
  calcHoldingsAtDate:()=>({fund:{code,costAmt:100},stock:{code:stock,costAmt:200}}),
  _applyFundUnitLifecycleToSnapshotHoldings:()=>{},
  _snapshotRewritePlan:()=>({unsafe:conflict?[{classification:'MANUAL_PROTECTED',reason:'duplicate'}]:[],needsRewrite:true}),
  writeSnapshotRows:(ss,day,rows)=>writes.push({type:'snapshot',day,rows}),
  _snapshotBackupOperationId:'',_settleSnapshotBackupOperation:()=>{},
  Utilities:{getUuid:()=>''},SpreadsheetApp:{flush:()=>{}},
  ss:{getSheetByName:name=>sheetsNow[name]||null},date,code,collector
 };
 const invoke=()=>vm.runInNewContext(source+'\n_refreshFundValuations(ss,date,date,code,true,null,collector?1:undefined,undefined,collector)',runtime);
 return {invoke,writes,stockRow};
}
const ordinary=simulate();
assert.equal(ordinary.invoke().snapshots,1);
assert.deepEqual(ordinary.writes.map(w=>w.type),['price','snapshot']);
const [price,snap]=ordinary.writes;
assert.equal(price.count,1);
assert.equal(snap.day,date);
assert.deepEqual(JSON.parse(JSON.stringify(snap.rows.find(r=>r[1]===stock))),ordinary.stockRow);
assert.equal(snap.rows.find(r=>r[1]===code)[7],200);
for(const opts of [{partial:true},{conflict:true}]){
 const blocked=simulate(opts);
 assert.equal(blocked.invoke().snapshots,0);
 assert(!blocked.writes.some(w=>w.type==='snapshot'||w.type==='whole-date-build'));
}
const protectedManual=simulate({manual:true});
protectedManual.invoke();
assert.equal(protectedManual.writes.find(w=>w.type==='snapshot').rows.find(r=>r[1]===code)[7],190);
const navChanged=simulate({storedUnits:999});
assert.throws(navChanged.invoke,/FUND_DERIVED_STORED_NAV_UNVERIFIED/);
assert.equal(navChanged.writes.length,0);
for(const opts of [{existing:false},{collector:false}]){
 const full=simulate(opts);
 full.invoke();
 assert(full.writes.some(w=>w.type==='whole-date-build'));
}
console.log('GAS 9.306 NAV refresh scope, manual row, NAV source and release gate checks passed');
