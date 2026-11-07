// Strict SHADOW-CLONE migration rehearsal, not a production migration.
// This script never connects to GAS, Google Sheets, finance data or secrets.
// Runs the actual unpublished GAS planner in a VM and models a clone-only
// staging/verification/rollback with a simulated mid-write exception.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
const {candidate,manifest}=composeGas9285TradeV2Preview();
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.requiresLegacyMigration,true);
const get=name=>{
 const start=candidate.indexOf('function '+name+'(');
 const end=candidate.indexOf('\n}',start);
 assert(start>=0&&end>start,'missing real GAS helper: '+name);
 return candidate.slice(start,end+2);
};
const ctx=vm.createContext({
 JSON,Array,Date,Number,String,Math,isFinite,
 _issue507GateInside_:true,_normalizeDate:v=>String(v||'').slice(0,10),
 _portfolioSyncDigest_:v=>createHash('sha256').update(v).digest('hex')
});
vm.runInContext([
 "var TRADE_V2_ID_RE=/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/;",
 ...['_cleanCode','_portfolioTradeFxMetadata_','_tradeV2CanonicalRow_',
  '_tradeV2Revision_','_tradeV2MigrationPlan_'].map(get)
].join('\n'),ctx);
const clone=x=>JSON.parse(JSON.stringify(x));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const base=['2026-11-05','buy','US','US_TEST','AAPL',2,100,
 '주식','', '', ''];
const fx=['2026-11-06','buy','US','US_TEST','AAPL',3,7425,
 '주식','corrected','','',5.5,1350];
const duplicate=[clone(base),clone(base)];
const sources=[
 {name:'11-column duplicate',width:11,rows:[...duplicate,(()=>{const r=clone(base);r[0]='2026-11-06';return r;})()]},
 {name:'13-column FX',width:13,rows:[clone(fx),[...base,'','']]},
 {name:'14-column already migrated',width:14,rows:[[...fx,'tr_existing01']]}
];
const snapshotSummary=rows=>rows.map(r=>r.slice(0,11));
let writesToProduction=0,shadowWrites=0,rollbacks=0;
function simulateCloneOnly(source,{failAfterFirstRow=false,externalEdit=false}={}){
 const productionBefore=clone(source),productionDigest=digest(source);
 const plan=ctx._tradeV2MigrationPlan_(source);
 const backup=clone(source),backupDigest=digest(backup);
 assert.equal(plan.count,source.length);
 assert.equal(plan.rows.length,source.length);
 assert.equal(plan.assigned+plan.preserved,source.length);
 assert.equal(new Set(plan.rows.map(r=>r[13])).size,source.length);
 assert.deepEqual(clone(snapshotSummary(plan.rows)),
  clone(snapshotSummary(source)), 'A:K finance rows must not change');
 const staging=clone(source);
 if(externalEdit)staging[0][5]=Number(staging[0][5])+1;
 try{
  // In the actual operational release this must be under a single writer
  // gate and compare a freshly read production source to the signed plan.
  if(digest(staging)!==backupDigest)
    throw Error('MIGRATION_STALE_SOURCE');
  staging.length=0;
  for(const row of plan.rows){
   shadowWrites++;
   staging.push([...row]);
   if(failAfterFirstRow)throw Error('SIMULATED_WRITE_INTERRUPTED');
  }
  if(staging.some(r=>r.length!==14))
    throw Error('MIGRATION_WIDTH_MISMATCH');
  if(ctx._tradeV2Revision_(staging)!==plan.proposedRevision)
    throw Error('MIGRATION_READBACK_HASH_MISMATCH');
  assert.deepEqual(clone(snapshotSummary(staging)),
    clone(snapshotSummary(backup)));
  // No real commit occurs: staging stays a disposable clone.
  assert.equal(digest(source),productionDigest,'production source changed!');
  const replan=ctx._tradeV2MigrationPlan_(staging);
  assert.equal(replan.assigned,0);
  assert.equal(replan.preserved,staging.length);
  assert.equal(replan.proposedRevision,plan.proposedRevision);
  return {ok:true,plan,staging};
 }catch(e){
  // A REAL Sheets rollback requires a verified immutable backup and a
  // separate approved writer path. Here rollback is simulated in memory.
  staging.splice(0,staging.length,...clone(backup));rollbacks++;
  assert.equal(digest(staging),backupDigest);
  assert.equal(digest(source),productionDigest);
  return {ok:false,code:String(e.message),staging};
 }
}
for(const sample of sources){
 const ok=simulateCloneOnly(sample.rows);
 assert.equal(ok.ok,true,sample.name);
 assert.ok(ok.staging.every(r=>r.length===14));
 assert.deepEqual(clone(snapshotSummary(ok.staging)),
   clone(snapshotSummary(sample.rows)));
 const interrupted=simulateCloneOnly(sample.rows,{failAfterFirstRow:true});
 assert.equal(interrupted.ok,false);
 assert.equal(interrupted.code,'SIMULATED_WRITE_INTERRUPTED');
 assert.deepEqual(interrupted.staging,clone(sample.rows));
 const stale=simulateCloneOnly(sample.rows,{externalEdit:true});
 assert.equal(stale.ok,false);
 assert.equal(stale.code,'MIGRATION_STALE_SOURCE');
 assert.deepEqual(stale.staging,clone(sample.rows));
}
const two=ctx._tradeV2MigrationPlan_(duplicate);
assert.notEqual(two.rows[0][13],two.rows[1][13],
 'identical transactions cannot share permanent identity');
assert.equal(two.rows[0][13],ctx._tradeV2MigrationPlan_(duplicate).rows[0][13]);
assert.throws(()=>ctx._tradeV2MigrationPlan_([
 [...fx.slice(0,12),'']]),/TRADE_MIGRATION_FX_INCOMPLETE/);
assert.throws(()=>ctx._tradeV2MigrationPlan_([
 [...fx,'tr_duplicate1'],[...fx,'tr_duplicate1']]),/TRADE_MIGRATION_DUPLICATE_ID/);
assert.equal(writesToProduction,0);
assert.equal(rollbacks,sources.length*2);
assert.ok(shadowWrites>=sources.length*2);
console.log('GAS9285_V2_SHADOW_MIGRATION_PASS '+JSON.stringify({
 fixtures:sources.length,duplicateIdsDistinguished:true,
 sourceHashesPreserved:true,failuresRolledBack:rollbacks,
 realSheetWrites:writesToProduction,productionDeployment:false
}));
