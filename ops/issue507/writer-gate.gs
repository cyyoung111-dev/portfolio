// STAGED ONLY. Generated wrappers admit every original top-level function.
// Original alias functions are private implementation details; direct editor
// calls and other deployments must be disabled by the rollout operator.
var _issue507GateInside_=false;
function _issue507GateAtomic_(fn) {
  var lock=LockService.getScriptLock(),owned=lock.hasLock();
  if(!owned)lock.waitLock(1000);
  try{return fn(PropertiesService.getScriptProperties());}
  finally{if(!owned)lock.releaseLock();}
}
function _issue507GateRead_(props) {
  var raw=props.getProperty('issue507_writer_gate_v1');
  if(!raw)throw new Error('GATE_UNINITIALIZED');
  var s=JSON.parse(raw);
  if(s.releaseId!==ISSUE507_GATE_RELEASE_ID || !['OPEN','DRAINING'].includes(s.mode) ||
     !s.active || typeof s.active!=='object' || Array.isArray(s.active) ||
     !Array.isArray(s.completed) || s.completed.length>8 ||
     !Number.isFinite(s.barrierAt) || !Number.isInteger(s.finished) || s.finished<0)
    throw new Error('GATE_STATE_INVALID');
  return s;
}
function _issue507GateSave_(props,s) {
  var raw=JSON.stringify(s);
  if(raw.length>7000)throw new Error('GATE_CAPACITY');
  props.setProperty('issue507_writer_gate_v1',raw);
  if(props.getProperty('issue507_writer_gate_v1')!==raw)throw new Error('GATE_WRITE_UNVERIFIED');
}
function _issue507GateRollout_(props) {
  var q=JSON.parse(props.getProperty('issue507_writer_gate_rollout_v1')||'null');
  if(!q || q.releaseId!==ISSUE507_GATE_RELEASE_ID || q.oldDeploymentsDisabled!==true ||
     q.externalWritersBlocked!==true || q.editorsBlocked!==true ||
     !q.legacyDrainEvidence || q.legacyDrainEvidence.kind!=='EXECUTIONS_UI' ||
     q.legacyDrainEvidence.scope!=='ALL_PROJECT_ACTORS_AND_VERSIONS' ||
     q.legacyDrainEvidence.terminalOnly!==true ||
     typeof q.legacyDrainEvidence.reference!=='string' || !q.legacyDrainEvidence.reference.trim() ||
     !Number.isFinite(q.verifiedAt) || q.verifiedAt>Date.now())throw new Error('GATE_ROLLOUT_REQUIRED');
  return q;
}
function _issue507GateEnter_(name) {
  return _issue507GateAtomic_(function(props){
    var s=_issue507GateRead_(props);
    if(s.mode!=='OPEN')throw new Error('GATE_MAINTENANCE');
    if(Object.keys(s.active).length>=24)throw new Error('GATE_CAPACITY');
    var token=Utilities.getUuid();
    if(s.active[token])throw new Error('GATE_TOKEN_COLLISION');
    s.active[token]={name:name,startedAt:Date.now()};
    _issue507GateSave_(props,s);return token;
  });
}
function _issue507GateExit_(token) {
  _issue507GateAtomic_(function(props){
    var s=_issue507GateRead_(props);
    if(!Object.prototype.hasOwnProperty.call(s.active,token))throw new Error('GATE_OWNER_LOST');
    s.completed.push({token:token,name:s.active[token].name,startedAt:s.active[token].startedAt,endedAt:Date.now(),state:'ENDED'});
    s.completed=s.completed.slice(-8);
    delete s.active[token];s.finished++;_issue507GateSave_(props,s);
  });
}
function _issue507GateInvoke_(name,fn,self,args) {
  if(_issue507GateInside_)return fn.apply(self,args);
  var token=_issue507GateEnter_(name);
  _issue507GateInside_=true;
  try{return fn.apply(self,args);}
  finally{_issue507GateInside_=false;_issue507GateExit_(token);}
}
function issue507BeginWriterDrain_() {
  return _issue507GateAtomic_(function(props){
    var rollout=_issue507GateRollout_(props),raw=props.getProperty('issue507_writer_gate_v1');
    if(!raw && Date.now()-rollout.verifiedAt>300000)throw new Error('GATE_ROLLOUT_STALE');
    var s=raw?_issue507GateRead_(props):{releaseId:ISSUE507_GATE_RELEASE_ID,mode:'DRAINING',active:{},completed:[],finished:0,barrierAt:Date.now()};
    if(s.mode==='OPEN'){s.mode='DRAINING';s.barrierAt=Date.now();}
    // Repeated begin NEVER resets barrier or removes active execution records.
    if(rollout.verifiedAt>s.barrierAt)throw new Error('GATE_ROLLOUT_AFTER_BARRIER');
    _issue507GateSave_(props,s);return {mode:s.mode,activeCount:Object.keys(s.active).length,writeAuthorized:false};
  });
}
function _issue507AssertDrain_() {
  return _issue507GateAtomic_(function(props){
    var s=_issue507GateRead_(props),q=_issue507GateRollout_(props);
    // Continuous seven-minute barrier is an additional observation window only.
    // It NEVER substitutes for the rollout's independent legacy terminal-run
    // evidence (delayed/paused legacy runs cannot be inferred from elapsed time).
    // Active receipts NEVER expire, including hard-killed executions.
    if(s.mode!=='DRAINING' || q.verifiedAt>s.barrierAt || Date.now()-s.barrierAt<420000 ||
       Object.keys(s.active).length)throw new Error('GATE_NOT_DRAINED');
    return {releaseId:s.releaseId,barrierAt:s.barrierAt,activeCount:0,finished:s.finished,
      proof:'ADMISSION_BARRIER_AND_COMPLETION_RECEIPTS',legacyEvidence:'OPERATOR_VERIFIED_EXECUTIONS_UI',processApiRequired:false,writeAuthorized:false};
  });
}
function issue507WriterDrainStatus_(){return _issue507AssertDrain_();}
function issue507ResumeWriters_() {
  return _issue507GateAtomic_(function(props){
    _issue507AssertDrain_();var s=_issue507GateRead_(props);
    // Never reopen while approval capabilities remain live.
    if(props.getProperty('issue507_f00001_approval_v1') ||
       props.getProperty('issue507_f00001_external_writers_excluded_v1'))throw new Error('GATE_APPROVAL_STILL_LIVE');
    s.mode='OPEN';_issue507GateSave_(props,s);return {mode:'OPEN',writeAuthorized:false};
  });
}
