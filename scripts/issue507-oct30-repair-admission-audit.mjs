// #507 October 30 proposal-only admission barrier.
// These functions are pure. They DO NOT create permissions, acquire locks,
// call GAS, touch spreadsheets, or implement a repair/rollback.
export const DAY='2026-10-30';
export const GAS_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const SHA256=/^[0-9a-f]{64}$/i;
const nonnegative=v=>Number.isSafeInteger(v)&&v>=0;
const equal=(a,b)=>a===b;
const supportedSheets=['가격이력','스냅샷'];
const reason=(name)=>name;

export function inspectOct30RepairAdmission({
  source,gate,backups,lock,provenance,operator
}={}){
  const blockers=[];
  const add=(ok,issue)=>{if(!ok)blockers.push(reason(issue));};
  add(source?.date===DAY&&source?.snapshotRows===39
    &&source?.domesticCarried===37
    &&source?.domesticHistoryRows===0
    &&source?.fundNavRows===2&&source?.fundHistoryRows===2
    &&source?.officialExactCount===37
    &&source?.individualPricesVerifiedInsideProtectedProcess===true
    &&source?.priceValuesDisclosed===false
    &&source?.dateCodeSourceOneToOne===true,
    'PRIVATE_OFFICIAL_SOURCE_OR_ORIGINAL_SCOPE_MISSING');
  add(provenance?.frozenGasBlob===GAS_BLOB
    &&provenance?.gasVersion==='9.281'
    &&provenance?.scriptTimezone==='Asia/Seoul'
    &&provenance?.sheetTimezoneVerified===true
    &&provenance?.sourceSameWithinRun===true,
    'SOURCE_PROVENANCE_UNVERIFIED');
  const op=operator?.operationId;
  add(typeof op==='string'&&/^issue507-oct30-[a-z0-9-]{8,64}$/.test(op)
    &&operator?.financialWriteApprovalDocumented===true
    &&operator?.authorizedScope==='2026-10-30-domestic-37-only'
    &&operator?.independentApprovalFresh===true,
    'EXPLICIT_WRITE_APPROVAL_MISSING');
  add(gate?.mode==='DRAINING'
    &&gate?.activeCount===0
    &&nonnegative(gate?.barrierAt)
    &&nonnegative(gate?.rolloutVerifiedAt)
    &&nonnegative(gate?.observedAt)
    &&gate.barrierAt>=gate.rolloutVerifiedAt
    &&gate.observedAt>=gate.barrierAt+420000
    &&gate?.legacyTerminalRunsIndependentlyVerified===true
    &&typeof gate?.releaseId==='string'&&gate.releaseId.length>0
    &&gate?.releaseId===operator?.expectedGateReleaseId,
    'GLOBAL_WRITER_DRAIN_NOT_PROVEN');
  add(lock?.scriptLockHeld===true&&lock?.ownerOperationId===op
    &&lock?.externalSheetsApiWritersExcluded===true
    &&lock?.noCompetingManualWriter===true,
    'EXCLUSIVE_WRITER_OWNERSHIP_NOT_PROVEN');
  const backupSet=Array.isArray(backups)?backups:[];
  add(backupSet.length===2&&new Set(backupSet.map(x=>x?.sheet)).size===2
    &&supportedSheets.every(s=>backupSet.some(b=>
      b?.sheet===s
      &&b.operationId===op
      &&b?.systemGenerated===true
      &&b?.status==='CREATED'
      &&SHA256.test(String(b.sourceSignature||''))
      &&SHA256.test(String(b.backupSignature||''))
      &&b.backupCopyDigestMatchesSource===true
      &&b.backupReadbackVerified===true
      &&b.sourceUnchangedSinceBackup===true
      &&b.backupRestorationProcedureRehearsed===true)),
    'BOTH_SHEETS_VERIFIED_BACKUPS_MISSING');
  // Real production _issue507GateEnter_ rejects DRAINING even if drain is
  // proved. A future scoped exception is NOT currently installed/approved.
  add(operator?.independentScopedGateBypassReviewed===true
    &&operator?.legacy555WriterFenceVerified===true,
    'SCOPED_DRAINING_GATE_EXCEPTION_NOT_PROVEN');
  return Object.freeze({
    mode:'ISSUE507_OCT30_REPAIR_ADMISSION_AUDIT',
    date:DAY,
    status:blockers.length?'BLOCKED':'CHECKLIST_COMPLETE_NOT_EXECUTABLE',
    blockers:Object.freeze(blockers),
    checksPassed:7-blockers.length,
    requiredChecks:7,
    existingProductionGateAllowsDrainedRepair:false,
    sourceOnlyEvidenceCanAuthorizeFinancialWrite:false,
    writeAuthorized:false,
    deployAuthorized:false,
    financialWrites:0,
    individualCodesOrPricesLogged:false
  });
}

// A standalone, synthetic state machine. It models *possible outcomes*, not
// actual operations or proof of an atomic multi-sheet transaction.
export function simulateOct30PlannedRecovery(events){
  if(!Array.isArray(events))throw Error('ISSUE507_BARRIER_EVENTS_INVALID');
  let state='PLANNED',historyWritten=false,snapshotWritten=false;
  for(const e of events){
    if(!e||typeof e!=='object')throw Error('ISSUE507_BARRIER_EVENT_INVALID');
    const step=e.step,outcome=e.outcome;
    if(!['OK','FAILED','TIMEOUT','UNKNOWN'].includes(outcome))
      throw Error('ISSUE507_BARRIER_OUTCOME_UNKNOWN');
    if(state==='INCIDENT_PARTIAL_UNKNOWN'||state==='HALTED_NO_WRITES'
      ||state==='NEEDS_OPERATOR_CONFIRMATION')
      throw Error('ISSUE507_BARRIER_TERMINAL_RETRY_DENIED');
    const expected=state==='PLANNED'?'BACKUPS':
      state==='BACKUPS_READY'?'PRICE_HISTORY':
      state==='PRICE_WRITTEN'?'SNAPSHOT':
      state==='SNAPSHOT_WRITTEN'?'READBACK':null;
    if(step!==expected)throw Error('ISSUE507_BARRIER_OUT_OF_ORDER');
    if(outcome!=='OK'){
      // Even the *first* financial write may partially commit before a
      // timeout, rejection or lost response; an absent ACK proves nothing.
      // A backup-stage failure is the only no-financial-write condition.
      state=step==='BACKUPS'?'HALTED_NO_WRITES':'INCIDENT_PARTIAL_UNKNOWN';
      // Do not silently ignore a queued retry/extra event after a fault.
      // The next loop iteration must throw TERMINAL_RETRY_DENIED.
      continue;
    }
    if(step==='BACKUPS')state='BACKUPS_READY';
    if(step==='PRICE_HISTORY'){historyWritten=true;state='PRICE_WRITTEN';}
    if(step==='SNAPSHOT'){snapshotWritten=true;state='SNAPSHOT_WRITTEN';}
    if(step==='READBACK')state='NEEDS_OPERATOR_CONFIRMATION';
  }
  return Object.freeze({
    mode:'ISSUE507_OCT30_SYNTHETIC_TRANSACTION_SIMULATOR',
    status:state,
    // None of these synthetic states can release the pending marker or grant
    // real write approval. Partial failure may need an operator-led rollback.
    operatorRollbackOrReconciliationRequired:state==='INCIDENT_PARTIAL_UNKNOWN',
    allMutationsProvenDurable:false,
    completionMarkerAuthorized:false,
    autoRetryAuthorized:false,
    financialWrites:0,containsIndividualPrices:false
  });
}
