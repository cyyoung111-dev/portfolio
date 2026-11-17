#!/usr/bin/env node
// #734: 9.297 NAV two-stage candidate. All checks are read-only; no NAV/price
// imports, no Snapshot repairs, no GAS project modification, no write retry.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyGas9296PostDeploy} from './issue734-gas9296-release-readonly.mjs';
import {verifyGas9295ReleaseReadOnly} from './issue734-gas9295-release-readonly.mjs';
import {probeTradeHash} from './issue734-trade-v2-hash-readonly.mjs';

export function assertGas9297ReadOnlyProof(state,hash,version='9.297'){
 if(state?.status!=='VERIFIED'||state.version!==version
  ||state.writerGateMode!=='OPEN'||state.activeCount!==0
  ||state.tradeSnapshotDeferredCount!==0||state.pendingCount!==0
  ||state.financeWrites!==0||!Number.isSafeInteger(state.tradeRows)
  ||hash?.status!=='CONSISTENT'||hash.rows!==state.tradeRows
  ||hash.uniqueIds!==state.tradeRows
  ||hash.migrationPreview?.status!=='VERIFIED'
  ||hash.migrationPreview.physicalRevisionMatchesGasGetTrades!==true
  ||hash.migrationPreview.physicalRevisionMatchesPcCanonical!==true)
  throw Error('GAS9297_READONLY_FINANCIAL_INTEGRITY_UNVERIFIED');
 return {kind:'GAS9297_NAV_RELEASE_READONLY',status:'VERIFIED',version,
  tradeRows:state.tradeRows,writerGateMode:'OPEN',activeCount:0,
  tradeSnapshotDeferredCount:0,pendingCount:0,tradeV2HashVerified:true,
  financeWrites:0,gasDeployments:0};
}
export async function verifyGas9297PostDeploy({url,token,fetchImpl=fetch}={}){
 const state=await verifyGas9295ReleaseReadOnly({url,token,fetchImpl,expectedVersion:'9.297'});
 const hash=await probeTradeHash({url,token,fetchImpl,includeMigrationPreview:true});
 return assertGas9297ReadOnlyProof(state,hash);
}
// Unlike post-deployment visibility checks, the 9.296 preflight must never
// retry a version, ledger/hash, authorization or writer mismatch. Only a
// transient transport failure may restart the complete read-only proof.
export async function verifyGas9297PreflightWithRetry({verify,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(typeof verify!=='function'||typeof delay!=='function')
  throw Error('GAS9297_VERIFY_CONTRACT_INVALID');
 const transient=new Set(['GAS9295_READONLY_NETWORK_UNVERIFIED',
  'AUTOMATION_DIAG_NETWORK_FAILED','READBACK_NETWORK_UNVERIFIED']);
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const proof=await verify();
   if(proof?.status!=='VERIFIED'||proof.version!=='9.296'
      ||proof.financeWrites!==0||proof.pcAndPhysicalRevisionMatch!==true
      ||proof.writerGateMode!=='OPEN'||proof.activeCount!==0
      ||proof.pendingCount!==0||proof.tradeSnapshotDeferredCount!==0
      ||!Number.isSafeInteger(proof.tradeRows)||proof.tradeRows<0)
    throw Error('GAS9297_PREDEPLOY_INTEGRITY_UNVERIFIED');
   return {...proof,readbackAttempts:attempt};
  }catch(error){
   const reason=String(error?.message||'');
   if(!transient.has(reason)||attempt===3)throw error;
   console.log(JSON.stringify({kind:'GAS9297_PREFLIGHT_READONLY_RETRY',
    reason,attempt,financeWrites:0}));
   await delay(attempt*3000);
  }
 }
}
export async function verifyGas9297WithRetry({verify,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(typeof verify!=='function'||typeof delay!=='function')
  throw Error('GAS9297_VERIFY_CONTRACT_INVALID');
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const proof=await verify();
   if(proof?.status!=='VERIFIED'||proof.version!=='9.297'
      ||proof.financeWrites!==0||proof.tradeV2HashVerified!==true)
     throw Error('GAS9297_POSTDEPLOY_PROOF_INVALID');
   return {...proof,readbackAttempts:attempt};
  }catch(error){
   const reason=String(error?.message||'');
   // Fresh read-only proof may await a new immutable deployment becoming visible.
   // Persistent authentication/ledger/Gate/financial errors fail immediately.
   if(!['GAS9295_READONLY_VERSION_MISMATCH','GAS9295_READONLY_NETWORK_UNVERIFIED']
      .includes(reason)||attempt===3)throw error;
   await delay(attempt*3000);
  }
 }
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invoked){
 try{
  const mode=process.argv[2];
  if(!['pre','post'].includes(mode))throw Error('GAS9297_RELEASE_MODE_INVALID');
  const config={url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN};
  const result=mode==='pre'
   ?await verifyGas9297PreflightWithRetry({verify:()=>verifyGas9296PostDeploy(config)})
   :await verifyGas9297WithRetry({verify:()=>verifyGas9297PostDeploy(config)});
  if(result.status!=='VERIFIED'||result.financeWrites!==0)
   throw Error('GAS9297_PREDEPLOY_INTEGRITY_UNVERIFIED');
  console.log(JSON.stringify({mode,version:result.version,status:result.status,
   kind:result.kind,tradeRows:result.tradeRows,
   readbackAttempts:result.readbackAttempts||1,financeWrites:0}));
  if(mode==='pre'&&process.env.GITHUB_OUTPUT)
   appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(error){
  const s=String(error?.message||'');
  console.error(/^(?:GAS(?:9295|9296|9297)_[A-Z_]+|AUTOMATION_DIAG_NETWORK_FAILED|READBACK_NETWORK_UNVERIFIED)$/.test(s)?s:'GAS9297_RELEASE_READONLY_UNVERIFIED');
  process.exitCode=2;
 }
}
