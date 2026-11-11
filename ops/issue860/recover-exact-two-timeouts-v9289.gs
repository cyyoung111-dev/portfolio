// #860 - Source-only operator recovery candidate, not part of published GAS.
// ONLY two independently observed 11/10 timeouts, never old 14/v9.288.
// The function body is not exposed to web clients. It preserves full raw gate
// evidence privately in the original project's Script Properties before prune.
// Never fabricate ENDED, COMPLETE, NAV success or execution UID.
var ISSUE860_EXACT_TIMEOUT_20261110_ = [
 ['runDailyPortfolioClose1900',1794306792206],
 ['runPortfolioCloseWatchdog2030',1794310621147]
];
function _issue860ExactSha_(value) {
 var b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
   value,Utilities.Charset.UTF_8);
 return b.map(function(x){return ((x+256)%256).toString(16).padStart(2,'0');}).join('');
}
function _issue860ExactInspect_(props) {
 if(ISSUE507_GATE_API_VERSION!=='9.289')throw Error('ISSUE860_EXACT_VERSION');
 var raw=props.getProperty('issue507_writer_gate_v1');
 if(!raw)throw Error('ISSUE860_EXACT_GATE_MISSING');
 var gate=_issue507GateRead_(props);
 if(gate.releaseId!==ISSUE507_GATE_RELEASE_ID||
    gate.mode!=='OPEN'||Object.keys(gate.active).length!==2)
   throw Error('ISSUE860_EXACT_GATE_DRIFT');
 var expected=ISSUE860_EXACT_TIMEOUT_20261110_.map(function(a){return a.join('|');}).sort();
 var actual=Object.keys(gate.active).map(function(token){
   var a=gate.active[token];
   if(props.getProperty('issue507_writer_end_v1_'+token))
     throw Error('ISSUE860_EXACT_PRODUCER_RECEIPT_PRESENT');
   return a.name+'|'+a.startedAt;
 }).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))
   throw Error('ISSUE860_EXACT_EXECUTION_SET_DRIFT');
 if(ISSUE860_EXACT_TIMEOUT_20261110_.some(function(a){
   return Date.now()-a[1]<420000;
 }))throw Error('ISSUE860_EXACT_QUIET_PERIOD');
 // This prune is NOT permitted during any pending trade-ledger/snapshot
 // writer, or if a previous backed-up repair is incomplete.
 if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
   throw Error('ISSUE860_EXACT_PENDING_TRADE_WRITER');
 var backupKey='issue860_20261110_exact_gate_backup_v1';
 var auditKey='issue860_20261110_exact_gate_audit_v1';
 if(props.getProperty(backupKey)||props.getProperty(auditKey))
   throw Error('ISSUE860_EXACT_PREVIOUS_ATTEMPT_EXISTS');
 return {raw:raw,gate:gate,digest:_issue860ExactSha_(raw),
   backupKey:backupKey,auditKey:auditKey};
}
// Reproducible read-only digest; no approval or mutation.
function issue860PreviewExactTwoTimeoutRecovery() {
 var preview=_issue507GateAtomic_(function(props){
   var x=_issue860ExactInspect_(props);
   return {kind:'ISSUE860_EXACT_TWO_TIMEOUT_PREVIEW',
     status:'MATCHED_NOT_AUTHORIZED',gasVersion:'9.289',
     gateMode:x.gate.mode,recordedActive:2,
     exactFunctionAndTimeMatched:true,originalGateDigest:x.digest,
     producerReceiptsPresent:false,processUidVerified:false,
     authorizationRequired:true,financeWrites:0,scriptPropertyWrites:0};
 });
 if(typeof Logger!=='undefined')Logger.log(JSON.stringify(preview));
 return preview;
}
// One-shot operator-only commit. The operator must *personally* establish
// no external running financial writer and inspect the two terminal UI rows.
// Script property issue860_20261110_exact_gate_approval_v1 must contain:
// {"userApproved":true,"externalWritersExcluded":true,
// "approvedDateKst":"YYYY-MM-DD","expectedGateDigest":"<preview hash>"}
// This never calls a finance writer and never claims close completion.
function issue860CommitExactTwoTimeoutRecovery() {
 var result=_issue507GateAtomic_(function(props){
  var x=_issue860ExactInspect_(props);
  var raw=props.getProperty('issue860_20261110_exact_gate_approval_v1'),a;
  try{a=raw?JSON.parse(raw):null;}catch(err){a=null;}
  var today=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  if(!a||a.userApproved!==true||a.externalWritersExcluded!==true||
     a.approvedDateKst!==today||a.expectedGateDigest!==x.digest||
     !/^[a-f0-9]{64}$/.test(x.digest))
   throw Error('ISSUE860_EXACT_APPROVAL_REQUIRED');
  // Lock serializes gate admissions. Backup and audit readback precede any
  // change of active records; any mismatch blocks entire transition.
  props.setProperty(x.backupKey,x.raw);
  if(props.getProperty(x.backupKey)!==x.raw)
   throw Error('ISSUE860_EXACT_BACKUP_READBACK');
  var audit={kind:'ISSUE860_EXACT_TIMEOUT_RECOVERY',state:'PREPARED',
   originalDigest:x.digest,recordCount:2,startedAt:new Date().toISOString(),
   matchingUIRows:'2026-11-10_193309_203658_TIMED_OUT',
   producerReceiptsForged:false,closeMarkedComplete:false};
  var initial=JSON.stringify(audit);
  props.setProperty(x.auditKey,initial);
  if(props.getProperty(x.auditKey)!==initial)
   throw Error('ISSUE860_EXACT_AUDIT_READBACK');
  var next=JSON.parse(x.raw);
  Object.keys(next.active).forEach(function(token){delete next.active[token];});
  // No change to finished or completed; these executions do NOT have producer
  // ENDED proof. This removes only exact two entries matched above.
  var nextRaw=JSON.stringify(next);
  props.setProperty('issue507_writer_gate_v1',nextRaw);
  if(props.getProperty('issue507_writer_gate_v1')!==nextRaw)
   throw Error('ISSUE860_EXACT_GATE_READBACK');
  audit.state='PRUNED_TIMED_OUT_NOT_COMPLETED';
  audit.completedAt=new Date().toISOString();
  var final=JSON.stringify(audit);
  props.setProperty(x.auditKey,final);
  if(props.getProperty(x.auditKey)!==final)
   throw Error('ISSUE860_EXACT_FINAL_AUDIT_READBACK');
  return {kind:'ISSUE860_EXACT_TIMEOUT_RECOVERY',
   status:'PRUNED_TIMED_OUT_NOT_COMPLETED',recoveredCount:2,
   recordedActiveImmediatelyAfterPrune:0,backupRetained:true,
   closeMarkedComplete:false,processUidVerified:false,
   financialWrites:0,producerEndReceiptsForged:0};
 });
 if(typeof Logger!=='undefined')Logger.log(JSON.stringify(result));
 return result;
}
