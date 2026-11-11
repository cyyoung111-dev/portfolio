// #860 - Owner-initiated one-click helper for the already independently
// verified Nov 10 19:33 and 20:37 GAS timeouts. SOURCE ONLY; not deployed.
// This helper is INTENTIONALLY named as an explicit attestation:
// the owner must have checked Apps Script > My Executions > Running (none)
// AND independently confirmed that no OTHER script/service is modifying the
// same financial Sheet concurrently. If unsure, DO NOT RUN.
// No removal of any active Writer unless the strict source-only recovery
// function issue860CommitExactTwoTimeoutRecovery revalidates everything.
function issue860OwnerConfirmsNoExternalWriterAndRecover() {
  if(typeof issue860PreviewExactTwoTimeoutRecovery!=='function'||
     typeof issue860CommitExactTwoTimeoutRecovery!=='function')
    throw Error('ISSUE860_GUIDED_RECOVERY_SOURCE_NOT_INSTALLED');
  var preview=issue860PreviewExactTwoTimeoutRecovery();
  if(!preview||preview.status!=='MATCHED_NOT_AUTHORIZED'||
     preview.gasVersion!=='9.289'||preview.recordedActive!==2||
     preview.exactFunctionAndTimeMatched!==true||
     preview.producerReceiptsPresent!==false||
     preview.financeWrites!==0||preview.scriptPropertyWrites!==0||
     typeof preview.originalGateDigest!=='string'||
     !/^[a-f0-9]{64}$/.test(preview.originalGateDigest))
    throw Error('ISSUE860_GUIDED_RECOVERY_PREVIEW_UNVERIFIED');
  var props=PropertiesService.getScriptProperties(),
      key='issue860_20261110_exact_gate_approval_v1';
  if(props.getProperty(key))
    throw Error('ISSUE860_GUIDED_RECOVERY_PREEXISTING_APPROVAL');
  // The explicit editor function selection and Run click are the owner
  // approval. This is NOT an automatic exclusion test for third-party writers.
  var approval={
    userApproved:true,externalWritersExcluded:true,
    approvedDateKst:Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'),
    expectedGateDigest:preview.originalGateDigest
  };
  var raw=JSON.stringify(approval);
  props.setProperty(key,raw);
  if(props.getProperty(key)!==raw)
    throw Error('ISSUE860_GUIDED_RECOVERY_APPROVAL_READBACK_FAILED');
  // Existing guarded function re-inspects exactly two names/startedAt,
  // producer END receipts, ScriptLock, prior backups and the SAME digest,
  // and stores private full Gate backup BEFORE any active removal.
  // On an error, leave the approval receipt for forensic review; never retry.
  var result=issue860CommitExactTwoTimeoutRecovery();
  if(!result||result.status!=='PRUNED_TIMED_OUT_NOT_COMPLETED'||
     result.recoveredCount!==2||result.backupRetained!==true||
     result.closeMarkedComplete!==false)
    throw Error('ISSUE860_GUIDED_RECOVERY_POSTVERIFY_FAILED');
  var safe={kind:'ISSUE860_GUIDED_OPERATOR_RECOVERY',
    status:result.status,recoveredCount:2,
    recordedActiveImmediatelyAfterPrune:result.recordedActiveImmediatelyAfterPrune,
    backupRetained:true,closeMarkedComplete:false,
    financeWrites:0,operationalGasDeployed:false};
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(safe));
  return safe;
}
