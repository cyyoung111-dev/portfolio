// Exact 9.298/9.300 release targets; same 9.297 preflight and read-only ledger proof.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyGas9295ReleaseReadOnly} from './issue734-gas9295-release-readonly.mjs';
import {assertGas9297ReadOnlyProof} from './issue734-gas9297-release-readonly.mjs';
import {probeTradeHash} from './issue734-trade-v2-hash-readonly.mjs';
export async function readGas9298ReleaseProof({readState,readHash,mode='pre',candidateVersion='9.298',delay=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!['pre','post'].includes(mode)||!['9.298','9.300'].includes(candidateVersion)||typeof readState!=='function'||typeof readHash!=='function')
  throw Error('GAS9298_PROOF_CONTRACT_INVALID');
 const version=mode==='pre'?'9.297':candidateVersion;
 const retryable=new Set(['GAS9295_READONLY_NETWORK_UNVERIFIED','AUTOMATION_DIAG_NETWORK_FAILED','READBACK_NETWORK_UNVERIFIED']);
 if(mode==='post')retryable.add('GAS9295_READONLY_VERSION_MISMATCH');
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const state=await readState(version);
   const hash=await readHash();
   const proof=assertGas9297ReadOnlyProof(state,hash,version);
   if(hash.gasVersion!==version||proof.tradeRows<0
    ||hash.migrationPreview.rowCountMatchesApi!==true
    ||hash.migrationPreview.assignedIdsNeeded!==0
    ||hash.migrationPreview.existingIdsPreserved!==proof.tradeRows)
    throw Error('GAS9298_LEDGER_INTEGRITY_UNVERIFIED');
   return {...proof,kind:candidateVersion==='9.300'?'GAS9300_RELEASE_READONLY':'GAS9298_RELEASE_READONLY',mode,readbackAttempts:attempt};
  }catch(e){
   if(!retryable.has(e?.message)||attempt===3)throw e;
   await delay(3000*attempt);
  }
 }
}
export async function verifyGas9298ReleaseReadOnly({url,token,mode='pre',candidateVersion='9.298',fetchImpl=fetch,reportBlockedAutomation=()=>{}}={}){
 return readGas9298ReleaseProof({mode,candidateVersion,
   readState:expectedVersion=>verifyGas9295ReleaseReadOnly({url,token,fetchImpl,expectedVersion,reportBlockedAutomation}),
   readHash:()=>probeTradeHash({url,token,fetchImpl,includeMigrationPreview:true})});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='cyyoung111-dev/portfolio')
   throw Error('GAS9298_MAIN_ONLY');
  const mode=process.argv[2];
  if(mode!=='pre')throw Error('GAS9298_PREFLIGHT_MODE_INVALID');
  const candidateVersion=process.argv[3]||'9.298';
  const proof=await verifyGas9298ReleaseReadOnly({mode,candidateVersion,url:process.env.GAS_WEB_APP_URL,token:process.env.GAS_ACCESS_TOKEN,
   reportBlockedAutomation:row=>console.log(JSON.stringify(row))});
  console.log(JSON.stringify(proof));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'verified=true\n');
 }catch(e){
  const reason=String(e?.message||'');
  console.error(/^(?:GAS929[578]_[A-Z_]+|AUTOMATION_DIAG_NETWORK_FAILED|READBACK_NETWORK_UNVERIFIED)$/.test(reason)?reason:'GAS9298_RELEASE_READONLY_UNVERIFIED');
  process.exitCode=2;
 }
}
