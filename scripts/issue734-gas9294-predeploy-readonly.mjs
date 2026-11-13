#!/usr/bin/env node
// #734: live, read-only 9.294 release gate. No GAS Script API or financial writes.
// Require the existing 9.293 baseline, valid 39-row Snapshot and idle writer.
// Accept the original 11/12 INCOMPLETE owner or an independently repaired
// same-date COMPLETE receipt. Never downgrade COMPLETE or revive an old day.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyGas9293PostDeploy} from './issue734-gas9293-postdeploy-readonly.mjs';
import {runBackfillStatus} from './diagnose-backfill-status.mjs';
import {readNov12Snapshot} from './diagnose-nov12-snapshot-readonly.mjs';

const fail=reason=>{throw Error('ISSUE734_9294_PREFLIGHT_'+reason);};
export function assessGas9294Preflight({published,status,snapshot}={}){
  if(published?.status!=='VERIFIED'||published.gasVersion!=='9.293'
    ||published.tradeLedgerVersion!==2||published.tradeRows!==338)
    fail('BASELINE_LEDGER_UNVERIFIED');
  if(published.writerGateMode!=='OPEN'||published.recordedActive!==0)
    fail('WRITER_ACTIVE');
  if(status?.gasVersion!=='9.293'||status.triggerReady!==true
    ||status.tradeLedgerWriteUnverified===true
    ||status.pendingTradeSnapshotRebuildFrom!=='-'
    ||(status.tradeSnapshotDeferredCount??0)!==0)
    fail('LIVE_AUTOMATION_UNVERIFIED');
  // The original 9.294 gate only accepted INCOMPLETE. After the protected
  // 11/12 one-shot recovery, the correct persisted marker is COMPLETE.
  // A completed receipt must prove both PRICE and NAV for exactly the same
  // business date, not merely a previous fund DONE, new-day run or stage flag.
  const c=status.close;
  const target='2026-11-12';
  const incomplete=!!c&&c.state==='INCOMPLETE'
    && ['PRICE','FUND','ERROR','FUND_PENDING'].includes(c.stage)
    && c.fundState!=='IN_PROGRESS';
  const complete=!!c&&c.state==='COMPLETE'
    && c.stage==='COMPLETE'
    && c.summaryPresent===true
    && c.summaryRunDate===target
    && c.priceOk===true&&c.fundOk===true
    && c.closeErrorCount===0
    && c.closeErrorPresent===false
    && c.fundErrorPresent===false
    && c.fundWarningPresent===false
    && c.fundState==='DONE'
    && c.fundAttemptDate===target
    && c.fundDate===target
    && c.krxPublicationWaiting===false
    && status.overallStatus==='NORMAL'
    && status.pendingCount===0;
  if(!c||c.runDate!==target||(!incomplete&&!complete)
    ||c.snapshotStale!==false
    ||status.snapshotLastDate!==target
    ||status.priceHistoryLastDate<target)
    fail('CLOSE_OWNER_OR_DATE_CHANGED');
  if(snapshot?.observedDate!=='2026-11-12'
    ||snapshot.storeStatus!=='VALID'||snapshot.expectedRows!==39
    ||snapshot.storedRows!==39
    ||snapshot.verifiedFunds!==2
    ||snapshot.duplicateSummary?.groups!==0
    ||Object.values(snapshot.issues??{}).some(v=>v!==0)
    ||snapshot.writes!==0||snapshot.noRebuildAttempted!==true)
    fail('SNAPSHOT_PRICE_PROOF_INVALID');
  return {kind:'ISSUE734_9294_PREFLIGHT_READ_ONLY',
    status:'VERIFIED',currentGas:'9.293',candidateGas:'9.294',
    date:'2026-11-12',tradeRows:338,snapshotRows:39,
    state:c.state,stage:c.stage,previousFundDate:c.fundAttemptDate,
    persistedCloseComplete:complete,
    complete:false,navOwnerVerified:false,writerIdle:true,
    // Persisted CLOSE COMPLETE is not an independent Script API execution proof.
    processExecutionOwnerVerified:false,
    financeWrites:0,gasDeployments:0};
}
export async function verifyGas9294Preflight({url,token,fetchImpl=fetch}={}){
 const published=await verifyGas9293PostDeploy({url,token,fetchImpl});
 const status=await runBackfillStatus({url,token,fetchImpl});
 const snapshot=await readNov12Snapshot({url,token,fetchImpl});
 return assessGas9294Preflight({published,status,snapshot});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await verifyGas9294Preflight({
    url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN});
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(e){
  const code=String(e?.message||'');
  console.error(/^ISSUE734_9294_PREFLIGHT_[A-Z_]+$/.test(code)
    ?code:'ISSUE734_9294_PREFLIGHT_UNVERIFIED');
  process.exitCode=1;
 }
}
