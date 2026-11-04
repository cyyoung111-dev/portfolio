// Staged editor-only tool. NOT included in apps_script.gs or deploy-gas.
// Trigger metadata cannot recover clock schedules or deployment bindings.
// An operator must first record those in the UI and isolate ALL other actors.
// This tool neither certifies that isolation nor authorizes a deployment.
var ISSUE860_TRIGGER_JOURNAL='issue860_trigger_maintenance_v1';
var ISSUE860_TRIGGER_RELEASE='257c26d1ad789d8f036e74d56418644385e8860dab8c5551fb8c2f493e9626b5';
var ISSUE860_TRIGGER_HANDLERS=[
  'runPortfolioHistoricalBackfill2240','runPortfolioMorningKrxBackfill0845',
  'runDailyPortfolioClose1900','runPendingTradeSnapshotRebuild',
  'runPortfolioCloseBackfill2210','handleSnapshotIntegritySheetChange',
  'syncMortgageFromSchedule','handleSnapshotIntegritySheetEdit',
  'runPortfolioHistoricalBackfill0010','runPortfolioCloseWatchdog2030','runCodeNormalize1550'
];
function _issue860Fail_(code){throw new Error('ISSUE860_TRIGGER_'+code);}
function _issue860Atomic_(fn){
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{return fn(PropertiesService.getScriptProperties());}
  finally{lock.releaseLock();}
}
function _issue860Save_(p,j){
  var raw=JSON.stringify(j);
  if(raw.length>8000)_issue860Fail_('JOURNAL_CAPACITY');
  p.setProperty(ISSUE860_TRIGGER_JOURNAL,raw);
  if(p.getProperty(ISSUE860_TRIGGER_JOURNAL)!==raw)_issue860Fail_('JOURNAL_READBACK');
}
function _issue860ValidateManifest_(m){
  if(!m||m.schema!==1||typeof m.operationId!=='string'||!/^[a-zA-Z0-9_-]{8,60}$/.test(m.operationId)||
    typeof m.uiEvidence!=='string'||!m.uiEvidence.trim()||m.uiEvidence.length>200||
    !Array.isArray(m.triggers)||m.triggers.length!==ISSUE860_TRIGGER_HANDLERS.length)
    _issue860Fail_('MANIFEST');
  var ids={},handlers={};
  m.triggers.forEach(function(t){
    if(!t||typeof t.id!=='string'||!t.id||t.id.length>100||ids[t.id]||
      ISSUE860_TRIGGER_HANDLERS.indexOf(t.handler)<0||handlers[t.handler]||
      ['HEAD','336'].indexOf(t.originalDeployment)<0)_issue860Fail_('MANIFEST');
    ids[t.id]=true;handlers[t.handler]=true;
    var edit=t.handler==='handleSnapshotIntegritySheetEdit';
    var change=t.handler==='handleSnapshotIntegritySheetChange';
    if(edit||change){
      if(t.event!==(edit?'ON_EDIT':'ON_CHANGE')||t.source!=='SPREADSHEETS'||
        typeof t.sourceId!=='string'||!/^[a-zA-Z0-9_-]{20,160}$/.test(t.sourceId)||t.schedule!==null)
        _issue860Fail_('MANIFEST');
    }else{
      var s=t.schedule;
      if(t.event!=='CLOCK'||t.source!=='CLOCK'||t.sourceId!==null||!s||s.timezone!=='Asia/Seoul')
        _issue860Fail_('MANIFEST');
      if(s.kind==='HOURLY'){
        if(t.handler!=='runPendingTradeSnapshotRebuild'||s.hours!==1||s.hour!==undefined||s.minute!==undefined)
          _issue860Fail_('MANIFEST');
      }else if(s.kind==='DAILY'){
        if(t.handler==='runPendingTradeSnapshotRebuild'||!Number.isInteger(s.hour)||s.hour<0||s.hour>23||
          (s.minute!==null&&(!Number.isInteger(s.minute)||s.minute<0||s.minute>59)))_issue860Fail_('MANIFEST');
      }else _issue860Fail_('MANIFEST');
    }
  });
}
function _issue860Read_(p){
  var raw=p.getProperty(ISSUE860_TRIGGER_JOURNAL),j;
  try{j=JSON.parse(raw);}catch(ignore){_issue860Fail_('JOURNAL');}
  if(!j||['PREPARED','PAUSING','PAUSED','RESTORING','RESTORED'].indexOf(j.phase)<0||
    !j.created||typeof j.created!=='object'||Array.isArray(j.created))_issue860Fail_('JOURNAL');
  _issue860ValidateManifest_(j.manifest);
  var known=j.manifest.triggers.map(function(t){return t.handler;});
  if(Object.keys(j.created).some(function(h){return known.indexOf(h)<0||typeof j.created[h]!=='string'||!j.created[h];})||
    (j.pending!==null&&known.indexOf(j.pending)<0))_issue860Fail_('JOURNAL');
  return j;
}
function _issue860Rows_(){
  return ScriptApp.getProjectTriggers().map(function(t){return {trigger:t,id:String(t.getUniqueId()),
    handler:t.getHandlerFunction(),event:String(t.getEventType()),source:String(t.getTriggerSource()),
    sourceId:t.getTriggerSourceId()||null};});
}
function _issue860Matches_(r,t){
  return r.handler===t.handler&&r.event===t.event&&r.source===t.source&&r.sourceId===t.sourceId;
}
function _issue860Summary_(j){return {phase:j.phase,originalCount:j.manifest.triggers.length,
  restoredCount:Object.keys(j.created).length,deploymentAuthorized:false,financeWrites:0};}
function issue860PrepareTriggerPause_(manifest){
  _issue860ValidateManifest_(manifest);
  // Copy caller data before persistence; no caller-supplied callbacks.
  manifest=JSON.parse(JSON.stringify(manifest));
  return _issue860Atomic_(function(p){
    if(p.getProperty(ISSUE860_TRIGGER_JOURNAL))_issue860Fail_('JOURNAL_EXISTS');
    var rows=_issue860Rows_();
    if(rows.length!==manifest.triggers.length||manifest.triggers.some(function(t){
      return rows.filter(function(r){return r.id===t.id&&_issue860Matches_(r,t);}).length!==1;
    }))_issue860Fail_('INVENTORY_CHANGED');
    var j={phase:'PREPARED',manifest:manifest,created:{},pending:null};
    _issue860Save_(p,j);return _issue860Summary_(j);
  });
}
function issue860PausePreparedTriggers_(operationId){
  return _issue860Atomic_(function(p){
    var j=_issue860Read_(p);
    if(j.manifest.operationId!==operationId)_issue860Fail_('OPERATION');
    if(['PREPARED','PAUSING','PAUSED'].indexOf(j.phase)<0)_issue860Fail_('PHASE');
    var rows=_issue860Rows_();
    if(rows.some(function(r){return !j.manifest.triggers.some(function(t){return t.id===r.id&&_issue860Matches_(r,t);});}))
      _issue860Fail_('INVENTORY_CHANGED');
    if(j.phase==='PREPARED'&&rows.length!==j.manifest.triggers.length)_issue860Fail_('INVENTORY_CHANGED');
    if(j.phase==='PAUSED'){
      if(rows.length)_issue860Fail_('INVENTORY_CHANGED');
      return _issue860Summary_(j);
    }
    j.phase='PAUSING';_issue860Save_(p,j); // durable recovery before first delete
    rows.forEach(function(r){ScriptApp.deleteTrigger(r.trigger);});
    if(_issue860Rows_().length)_issue860Fail_('PAUSE_READBACK');
    j.phase='PAUSED';_issue860Save_(p,j);return _issue860Summary_(j);
  });
}
function _issue860RequireDrainingGate_(p){
  var s;
  try{
    if(typeof _issue507GateRead_!=='function'||typeof ISSUE507_GATE_RELEASE_ID==='undefined'||
      ISSUE507_GATE_RELEASE_ID!==ISSUE860_TRIGGER_RELEASE)_issue860Fail_('GATE');
    s=_issue507GateRead_(p);
  }catch(ignore){_issue860Fail_('GATE');}
  // The independently verified deployment must have initialized DRAINING.
  // This helper NEVER bootstraps, opens, drains or removes gate state.
  if(!s||s.releaseId!==ISSUE860_TRIGGER_RELEASE||s.mode!=='DRAINING'||
    !s.active||typeof s.active!=='object'||Array.isArray(s.active)||Object.keys(s.active).length)
    _issue860Fail_('GATE');
}
function _issue860Create_(t){
  var b=ScriptApp.newTrigger(t.handler);
  if(t.event==='ON_EDIT')return b.forSpreadsheet(t.sourceId).onEdit().create();
  if(t.event==='ON_CHANGE')return b.forSpreadsheet(t.sourceId).onChange().create();
  b=b.timeBased().inTimezone(t.schedule.timezone);
  if(t.schedule.kind==='HOURLY')return b.everyHours(t.schedule.hours).create();
  b=b.everyDays(1).atHour(t.schedule.hour);
  if(t.schedule.minute!==null)b=b.nearMinute(t.schedule.minute);
  return b.create();
}
function issue860RestorePreparedTriggers_(operationId){
  return _issue860Atomic_(function(p){
    var j=_issue860Read_(p);
    if(j.manifest.operationId!==operationId)_issue860Fail_('OPERATION');
    if(['PAUSED','RESTORING','RESTORED'].indexOf(j.phase)<0)_issue860Fail_('PHASE');
    _issue860RequireDrainingGate_(p);
    j.phase='RESTORING';_issue860Save_(p,j);
    function validateRows(){
      var rows=_issue860Rows_();
      if(rows.some(function(r){return !j.manifest.triggers.some(function(t){
        return _issue860Matches_(r,t)&&(j.created[t.handler]===r.id||
          (j.pending===t.handler&&!j.created[t.handler]));
      });})||Object.keys(j.created).some(function(h){return rows.filter(function(r){return r.id===j.created[h];}).length!==1;}))
        _issue860Fail_('RESTORE_INVENTORY_CHANGED');
      return rows;
    }
    validateRows();
    j.manifest.triggers.forEach(function(t){
      if(j.created[t.handler])return;
      var candidates=validateRows().filter(function(r){return _issue860Matches_(r,t);});
      if(candidates.length>1)_issue860Fail_('RESTORE_AMBIGUOUS');
      if(!candidates.length){
        // A timed-out create may still complete. Absence is NOT terminal proof;
        // leave intent intact for independent reconciliation, never blindly retry.
        if(j.pending!==null)_issue860Fail_('CREATE_OUTCOME_UNVERIFIED');
        // Persist creation intent BEFORE create; a lost response must not duplicate.
        j.pending=t.handler;_issue860Save_(p,j);
        _issue860Create_(t);
        candidates=validateRows().filter(function(r){return _issue860Matches_(r,t);});
        if(candidates.length!==1)_issue860Fail_('RESTORE_READBACK');
      }
      j.created[t.handler]=candidates[0].id;j.pending=null;_issue860Save_(p,j);
    });
    if(validateRows().length!==j.manifest.triggers.length)_issue860Fail_('RESTORE_READBACK');
    _issue860RequireDrainingGate_(p);
    j.phase='RESTORED';_issue860Save_(p,j);return _issue860Summary_(j);
  });
}
