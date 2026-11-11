// #860: Deployment safety != daily-close finality.
// This proof NEVER repairs a close, appends NAV, or synthesizes COMPLETE.
// Full read-only GAS diagnoseSnapshotIntegrity performs independently rebuilt
// trade/price/NAV/FX expectations and checks RAW Snapshot duplicate groups.
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const arrays=['missingCodes','unexpectedCodes','duplicateKeys','conflictKeys',
 'qtyMismatches','costAmtMismatches','evalUnitMismatches','evalAmtMismatches',
 'sourceMismatches','sourceDataErrors'];
function validDate(s){
 return typeof s==='string'&&DATE.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
export function assertReleaseSnapshotProof(payload,date){
 if(!validDate(date)||payload?.status!=='ok'||!Array.isArray(payload.diagnostics)||
   payload.diagnostics.length!==1||!payload.diagnostic||
   payload.diagnostic!==payload.diagnostics[0])
  throw Error('ISSUE860_9290_GATE_SNAPSHOT_PROOF_SCHEMA');
 const d=payload.diagnostic;
 if(d.date!==date||d.status!=='VALID'||
    !Number.isSafeInteger(d.expectedRowCount)||d.expectedRowCount<1||
    d.expectedRowCount>500||
    d.storedRowCount!==d.expectedRowCount||
    !Number.isFinite(d.totalEvalDifference)||d.totalEvalDifference!==0||
    arrays.some(name=>!Array.isArray(d[name])||d[name].length!==0)||
    !Array.isArray(d.priceIntegrity)||
    !d.priceIntegrity.every(x=>x&&['VALID','MANUAL_PROTECTED'].includes(x.status))||
    !Array.isArray(d.fundNavStates)||
    !d.fundNavStates.every(f=>f&&/^F\d{5}$/.test(f.code)&&
      (f.sourceDate===''||validDate(f.sourceDate)&&f.sourceDate<=date)&&
      (f.valueDate===''||validDate(f.valueDate)&&f.valueDate<=date)))
  throw Error('ISSUE860_9290_GATE_SNAPSHOT_NOT_VERIFIED');
 return Object.freeze({
  auditedDate:date,storedRows:d.storedRowCount,
  priceIntegrityRows:d.priceIntegrity.length,
  fundCarryRows:d.fundNavStates.filter(f=>f.temporary===true).length,
  rawSnapshotDuplicateGroups:0,
  sourceErrors:0,
  financeWrites:0
 });
}
