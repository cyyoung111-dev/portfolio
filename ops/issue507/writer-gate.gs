// GAS v9.282: inline admission guards cover the 555 original functions.
// Original alias functions are private implementation details; direct editor
// calls and other deployments must be disabled by the rollout operator.
var _issue507GateInside_=false;
var ISSUE507_GATE_API_VERSION='9.282';
function _issue507GateAtomic_(fn,quickCleanup) {
  var lock=LockService.getScriptLock(),owned=lock.hasLock();
  if(!owned){
    try{lock.waitLock(quickCleanup?1000:30000);}
    catch(error){throw new Error('GATE_LOCK_BUSY');}
  }
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
  if(Object.keys(s.active).length>24 || s.finished<s.completed.length ||
     Object.keys(s.active).some(function(token){var e=s.active[token];
       return !/^[A-Za-z0-9-]{1,80}$/.test(token) || !e || typeof e.name!=='string' ||
         !Number.isFinite(e.startedAt) || e.startedAt>Date.now();
     }) || s.completed.some(function(e){return !e || e.state!=='ENDED' || typeof e.token!=='string' ||
       typeof e.name!=='string' || !Number.isFinite(e.startedAt) || !Number.isFinite(e.endedAt) ||
       e.endedAt<e.startedAt || e.endedAt>Date.now();}))throw new Error('GATE_STATE_INVALID');
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
    // Bootstrap preserves normal service availability. It proves NO drain,
    // grants NO repair approval and touches NO financial sheet.
    if(!props.getProperty('issue507_writer_gate_v1')){
      _issue507GateSave_(props,{releaseId:ISSUE507_GATE_RELEASE_ID,mode:'OPEN',
        active:{},completed:[],finished:0,barrierAt:Date.now(),bootstrapped:true});
    }
    var s=_issue507GateReconcile_(props,_issue507GateRead_(props));
    if(s.mode!=='OPEN')throw new Error('GATE_MAINTENANCE');
    if(Object.keys(s.active).length>=24)throw new Error('GATE_CAPACITY');
    var token=Utilities.getUuid();
    if(s.active[token])throw new Error('GATE_TOKEN_COLLISION');
    s.active[token]={name:name,startedAt:Date.now()};
    _issue507GateSave_(props,s);return token;
  });
}
function _issue507GateEndKey_(token) {
  if(!/^[A-Za-z0-9-]{1,80}$/.test(token))throw new Error('GATE_TOKEN_INVALID');
  return 'issue507_writer_end_v1_'+token;
}
function _issue507GateReconcile_(props,s) {
  var ended=[];
  Object.keys(s.active).forEach(function(token){
    var key=_issue507GateEndKey_(token),raw=props.getProperty(key);
    if(!raw)return; // no terminal proof: NEVER expire/clear a killed run
    var e=JSON.parse(raw),owner=s.active[token];
    if(e.releaseId!==s.releaseId || e.token!==token || e.name!==owner.name ||
       e.startedAt!==owner.startedAt || !Number.isFinite(e.endedAt) ||
       e.endedAt<e.startedAt || e.endedAt>Date.now() || e.state!=='ENDED')throw new Error('GATE_END_PROOF_INVALID');
    s.completed.push({token:token,name:e.name,startedAt:e.startedAt,endedAt:e.endedAt,state:'ENDED'});
    s.completed=s.completed.slice(-8);delete s.active[token];s.finished++;ended.push(key);
  });
  if(ended.length){
    // Persist removal BEFORE deleting evidence. A crash/readback failure keeps
    // terminal proof; it never turns an unproven active run into completed.
    _issue507GateSave_(props,s);
    ended.forEach(function(key){props.deleteProperty(key);});
  }
  return s;
}
function _issue507GateExit_(token) {
  var props=PropertiesService.getScriptProperties(),s=_issue507GateRead_(props),owner=s.active[token];
  if(!owner){
    if(s.completed.some(function(e){return e.token===token;}))return;
    throw new Error('GATE_OWNER_LOST');
  }
  // Each execution exclusively owns this key. Record ENDED without ScriptLock
  // so a 240-second financial writer cannot strand normal completions.
  var key=_issue507GateEndKey_(token),raw=JSON.stringify({releaseId:s.releaseId,token:token,
    name:owner.name,startedAt:owner.startedAt,endedAt:Date.now(),state:'ENDED'});
  try{props.setProperty(key,raw);if(props.getProperty(key)!==raw)throw new Error('readback');}
  catch(error){throw new Error('GATE_COMPLETION_RECEIPT_UNVERIFIED');}
  try{_issue507GateAtomic_(function(p){_issue507GateReconcile_(p,_issue507GateRead_(p));},true);}
  catch(error){
    // Durable terminal proof survives; next admission/begin/drain reconciles
    // it atomically BEFORE capacity checks. Do not lose the producer result.
    if(typeof Logger!=='undefined')Logger.log('GATE_COMPLETION_CLEANUP_DEFERRED');
  }
}
function _issue507GateInvoke_(name,fn,self,args) {
  // Authenticated metadata-only health read remains reachable during drain.
  if(name==='doGet' && args[0] && args[0].parameter &&
     args[0].parameter.action==='getWriterGateStatus')return _issue507GateStatusRequest_(args[0].parameter);
  if(_issue507GateInside_)return fn.apply(self,args);
  var token=_issue507GateEnter_(name);
  _issue507GateInside_=true;
  try{return fn.apply(self,args);}
  finally{_issue507GateInside_=false;_issue507GateExit_(token);}
}
function issue507BeginWriterDrain_() {
  return _issue507GateAtomic_(function(props){
    var rollout=_issue507GateRollout_(props),raw=props.getProperty('issue507_writer_gate_v1');
    var s=raw?_issue507GateReconcile_(props,_issue507GateRead_(props)):{releaseId:ISSUE507_GATE_RELEASE_ID,mode:'DRAINING',active:{},completed:[],finished:0,barrierAt:Date.now()};
    // Each NEW drain cycle requires a fresh independent rollout attestation.
    // A previous OPEN->DRAINING->OPEN cycle cannot reuse its old proof.
    if((!raw || s.mode==='OPEN') && Date.now()-rollout.verifiedAt>300000)throw new Error('GATE_ROLLOUT_STALE');
    if(s.mode==='OPEN'){s.mode='DRAINING';s.barrierAt=Date.now();}
    // Repeated begin NEVER resets barrier or removes active execution records.
    if(rollout.verifiedAt>s.barrierAt)throw new Error('GATE_ROLLOUT_AFTER_BARRIER');
    _issue507GateSave_(props,s);return {mode:s.mode,activeCount:Object.keys(s.active).length,writeAuthorized:false};
  });
}
function _issue507AssertDrain_() {
  return _issue507GateAtomic_(function(props){
    var s=_issue507GateReconcile_(props,_issue507GateRead_(props)),q=_issue507GateRollout_(props);
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

function _issue507GateStatusRequest_(params) {
  var previous=_issue507GateInside_;_issue507GateInside_=true;
  try {
    if(!_isAuthorizedRequest(params))return jsonError('인증 실패');
    return _issue507GateAtomic_(function(props){
      var raw=props.getProperty('issue507_writer_gate_v1');
      if(!raw)return jsonOk({gasVersion:ISSUE507_GATE_API_VERSION,writerGate:{mode:'UNINITIALIZED',repairAuthorized:false}});
      var s=_issue507GateRead_(props);
      return jsonOk({gasVersion:ISSUE507_GATE_API_VERSION,writerGate:{mode:s.mode,
        activeCount:Object.keys(s.active).length,finished:s.finished,
        repairAuthorized:false,approvalPresent:!!props.getProperty('issue507_f00001_approval_v1')}});
    });
  } catch(error){return jsonError('GATE_STATUS_UNVERIFIED');}
  finally{_issue507GateInside_=previous;}
}
