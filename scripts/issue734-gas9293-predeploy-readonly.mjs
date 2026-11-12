#!/usr/bin/env node
// #734 9.292 -> 9.293 production preflight. READ ONLY.
// A GREEN CI is not permission to replay missing financial days.
import {pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';
import {verifyGas9292PostDeploy} from './issue860-gas9292-postdeploy-readonly.mjs';
import {readIssue860Once} from './issue860-close-single-status-readonly.mjs';
import {readNov12Snapshot} from './diagnose-nov12-snapshot-readonly.mjs';

const fail=code=>{throw Error('ISSUE734_9293_PREFLIGHT_'+code);};
export function assessGas9293Preflight({published,close,snapshot}={}){
 if(published?.status!=='VERIFIED'||published.gasVersion!=='9.292'
    ||published.tradeLedgerVersion!==2||published.tradeRows!==338)
  fail('PUBLISHED_9292_LEDGER_UNVERIFIED');
 if(published.gateMode!=='OPEN'||published.recordedActive!==0
    ||published.timeoutRetirementCandidates!==0)
  fail('WRITER_GATE_NOT_IDLE');
 // This one-shot emergency recovery intentionally accepts an incomplete
 // CLOSE. A settled COMPLETE requirement would deadlock the defect it fixes.
 if(close?.gasVersion!=='9.292'
    ||close.observedKstDate!=='2026-11-12'
    ||close.closeRunDate!=='2026-11-12'
    ||close.closeState!=='INCOMPLETE'||close.closeStage!=='PRICE'
    ||close.snapshotLastDate!=='2026-11-11'
    ||close.priceHistoryLastDate!=='2026-11-12'
    ||close.pendingKrxDatesCount!==0
    ||close.snapshotStale!==true)
  fail('ORPHANED_CLOSE_STATE_CHANGED');
 if(snapshot?.observedDate!=='2026-11-12'
    ||snapshot.storeStatus!=='NO_SNAPSHOT'||snapshot.expectedRows!==39
    ||snapshot.storedRows!==0||snapshot.verifiedFunds!==2
    ||snapshot.priceSourceStates?.VALID!==37
    ||snapshot.issues?.missingCodes!==39
    ||Object.entries(snapshot.issues||{}).some(([k,v])=>k!=='missingCodes'&&v!==0)
    ||snapshot.duplicateSummary?.groups!==0
    ||snapshot.writes!==0||snapshot.noRebuildAttempted!==true)
  fail('SNAPSHOT_SOURCE_OR_PROOF_CHANGED');
 return {kind:'ISSUE734_9293_PREFLIGHT_READONLY',status:'VERIFIED',
  publishedVersion:'9.292',candidateVersion:'9.293',
  observedDate:'2026-11-12',unrecoveredRows:39,
  verifiedPriceSources:37,verifiedFundSources:2,
  writerGateIdle:true,tradeRows:338,ledgerV2:true,
  finishProofNotClaimed:true,processExecutionOwnerVerified:false,
  financeWrites:0,propertyWrites:0,gasDeployments:0,apiReads:5};
}
export async function verifyGas9293Preflight({url,token,fetchImpl=fetch}={}){
 const published=await verifyGas9292PostDeploy({url,token,fetchImpl});
 const [close,snapshot]=await Promise.all([
  readIssue860Once({url,token,fetchImpl}),
  readNov12Snapshot({url,token,fetchImpl})
 ]);
 return assessGas9293Preflight({published,close,snapshot});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await verifyGas9293Preflight({
   url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN
  });
  console.log(JSON.stringify(result));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(e){
  const code=String(e?.message||'');
  console.error(/^ISSUE734_9293_PREFLIGHT_[A-Z_]+$/.test(code)
   ?code:'ISSUE734_9293_PREFLIGHT_UNVERIFIED');
  process.exitCode=1;
 }
}
