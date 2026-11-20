// Exact 9.298/9.300 release targets; same 9.297 preflight and read-only ledger proof.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyGas9295ReleaseReadOnly} from './issue734-gas9295-release-readonly.mjs';
import {assertGas9297ReadOnlyProof} from './issue734-gas9297-release-readonly.mjs';
import {probeTradeHash} from './issue734-trade-v2-hash-readonly.mjs';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
export async function readGas9298ReleaseProof({readState,readHash,readVersionGate,mode='pre',candidateVersion='9.298',delay=ms=>new Promise(r=>setTimeout(r,ms)),reportWriterWait=()=>{}}={}){
 if(!['pre','post'].includes(mode)||!['9.298','9.300','9.301','9.302','9.303','9.304','9.305'].includes(candidateVersion)||typeof readState!=='function'||typeof readHash!=='function')
  throw Error('GAS9298_PROOF_CONTRACT_INVALID');
 const version=mode==='pre'?(candidateVersion==='9.305'?'9.304':candidateVersion==='9.304'?'9.303':candidateVersion==='9.303'?'9.302':candidateVersion==='9.302'?'9.301':candidateVersion==='9.301'?'9.300':'9.297'):candidateVersion;
 const retryable=new Set(['GAS9295_READONLY_NETWORK_UNVERIFIED','AUTOMATION_DIAG_NETWORK_FAILED','READBACK_NETWORK_UNVERIFIED']);
 if(mode==='post')retryable.add('GAS9295_READONLY_VERSION_MISMATCH');
 let writerWaited=false;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const state=await readState(version);
   const hash=await readHash();
   const proof=assertGas9297ReadOnlyProof(state,hash,version);
   if(proof.tradeRows<0
    ||hash.migrationPreview.rowCountMatchesApi!==true
    ||hash.migrationPreview.assignedIdsNeeded!==0
    ||hash.migrationPreview.existingIdsPreserved!==proof.tradeRows)
    throw Error('GAS9298_LEDGER_INTEGRITY_UNVERIFIED');
   // getTrades on the reviewed v2 source returns the ledger revision but
   // does not expose gasVersion. The independent status proof before this
   // read has already checked the version. Recheck the versioned gate after
   // physical/API/PC hash equality, never substitute an expected version.
   let ledgerVersionEvidence='TRADE_RESPONSE';
   if(hash.gasVersion==='UNSPECIFIED'){
    if(typeof readVersionGate!=='function')throw Error('GAS9298_LEDGER_VERSION_UNVERIFIED');
    const gate=await readVersionGate(version);
    assertReleaseVersionGateAfterHash(gate,version);
    ledgerVersionEvidence='VERSIONED_GATE_AFTER_HASH';
   }else if(hash.gasVersion!==version)throw Error('GAS9298_LEDGER_INTEGRITY_UNVERIFIED');
   return {...proof,ledgerVersionEvidence,kind:candidateVersion==='9.305'?'GAS9305_RELEASE_READONLY':candidateVersion==='9.304'?'GAS9304_RELEASE_READONLY':candidateVersion==='9.303'?'GAS9303_RELEASE_READONLY':candidateVersion==='9.302'?'GAS9302_RELEASE_READONLY':candidateVersion==='9.301'?'GAS9301_RELEASE_READONLY':candidateVersion==='9.300'?'GAS9300_RELEASE_READONLY':'GAS9298_RELEASE_READONLY',mode,readbackAttempts:attempt};
  }catch(e){
   // A genuine concurrent writer observed AFTER the ledger proof is not
   // a failed write to retry. Discard all read evidence and recheck once,
   // only for the current preflight. Never proceed solely on a later idle GET.
   if(mode==='pre'&&['9.301','9.302','9.303','9.304','9.305'].includes(candidateVersion)&&!writerWaited&&attempt<3
      &&e?.message==='GAS9298_LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER'
      &&e.readonlyWaitSafe===true){
    writerWaited=true;
    reportWriterWait({kind:candidateVersion==='9.305'?'GAS9305_READONLY_WRITER_WAIT':candidateVersion==='9.304'?'GAS9304_READONLY_WRITER_WAIT':candidateVersion==='9.303'?'GAS9303_READONLY_WRITER_WAIT':candidateVersion==='9.302'?'GAS9302_READONLY_WRITER_WAIT':'GAS9301_READONLY_WRITER_WAIT',delaySeconds:45,
      nextAttempt:attempt+1,activeCount:e.activeCount,writerClasses:e.writerClasses,
      financeWrites:0,gasDeployments:0});
    await delay(45000);
    continue;
   }
   if(!retryable.has(e?.message)||attempt===3)throw e;
   await delay(3000*attempt);
  }
 }
}
// Distinguish sanitized blocker classes without printing private gate owners,
// response bodies, version strings supplied by the server or credentials.
// Every mismatch still blocks. Only a structurally verified recent active writer
// may cause one full read-only preflight recheck; never retry a writer or bypass a gate.
const gateFail=reason=>{throw Error('GAS9298_LEDGER_VERSION_UNVERIFIED_'+reason);};
export function assertReleaseVersionGateAfterHash(response,expectedVersion){
 const g=response?.writerGate;
 if(!['9.297','9.298','9.300','9.301','9.302','9.303','9.304','9.305'].includes(expectedVersion))gateFail('EXPECTED_VERSION');
 if(response?.status!=='ok')gateFail('RESPONSE_STATUS');
 if(response.gasVersion!==expectedVersion)gateFail('VERSION_MISMATCH');
 if(g?.mode!=='OPEN')gateFail('MODE');
 if(!Number.isSafeInteger(g.activeCount)||g.activeCount<0||g.activeCount>24)gateFail('ACTIVE_COUNT_INVALID');
 if(g.repairAuthorized!==false)gateFail('REPAIR_STATE');
 if(g.timeoutRetirementCandidates!==0)gateFail('RETIREMENT_STATE');
 if(!Array.isArray(g.activeOwners)||g.activeOwners.length!==g.activeCount)gateFail('OWNER_STATE');
 if(g.activeCount!==0){
  const known=new Set(['doGet','doPost','runDailyPortfolioClose1900','runDailyFundValuations',
   'runPortfolioCloseWatchdog2030','runPendingTradeSnapshotRebuild','runPortfolioHistoricalBackfill2240',
   'runDeferredFundAfterPortfolioCloseFailure','refreshEtfDividends']);
  const err=Error('GAS9298_LEDGER_VERSION_UNVERIFIED_ACTIVE_WRITER');
  // Report only known code identifiers and aggregate count, never owner data.
  err.activeCount=g.activeCount;
  err.writerClasses=[...new Set(g.activeOwners.map(o=>known.has(o?.functionName)?o.functionName:'OTHER'))].sort();
  err.readonlyWaitSafe=g.activeOwners.every(o=>o&&typeof o.functionName==='string'
   &&Number.isSafeInteger(o.ageMinutes)&&o.ageMinutes>=0&&o.ageMinutes<6
   &&o.terminalReceiptPresent===false&&o.retirementEligible===false);
  throw err;
 }
}
export async function readReleaseVersionGate({url,token,fetchImpl=fetch}={}){
 const endpoint=new URL(validateWebAppUrl(url));
 if(typeof token!=='string'||token.length<12)throw Error('GAS9298_AUTH_MISSING');
 endpoint.searchParams.set('action','getWriterGateStatus');
 endpoint.searchParams.set('accessToken',token);
 let response;
 try{response=await fetchImpl(endpoint.toString(),{method:'GET',redirect:'follow',signal:AbortSignal.timeout(30000)})}
 catch{throw Error('GAS9295_READONLY_NETWORK_UNVERIFIED')}
 if(response?.ok!==true){
  const code=response?.status;
  gateFail(code===401||code===403?'HTTP_AUTH':code===429?'HTTP_RATE_LIMIT':[502,503,504].includes(code)?'HTTP_GATEWAY':'HTTP_OTHER');
 }
 try{return await response.json()}catch{gateFail('JSON')}
}
export async function verifyGas9298ReleaseReadOnly({url,token,mode='pre',candidateVersion='9.298',fetchImpl=fetch,reportBlockedAutomation=()=>{}}={}){
 return readGas9298ReleaseProof({mode,candidateVersion,
   readState:expectedVersion=>verifyGas9295ReleaseReadOnly({url,token,fetchImpl,expectedVersion,reportBlockedAutomation}),
   readHash:()=>probeTradeHash({url,token,fetchImpl,includeMigrationPreview:true}),
   readVersionGate:()=>readReleaseVersionGate({url,token,fetchImpl}),
   reportWriterWait:reportBlockedAutomation});
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
