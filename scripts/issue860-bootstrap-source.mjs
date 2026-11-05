import fs from 'node:fs';
import {gasSourceBlobSha} from './deploy-gas.mjs';

export const BASE_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const FINAL_BLOB='edd6e79c885600767b8cfe9ab9c81576ec15fa69';
export const LEGACY_BLOB='ebe697563e94cf49e514037353260fce70ae1d57';
export const RELEASE='257c26d1ad789d8f036e74d56418644385e8860dab8c5551fb8c2f493e9626b5';
// A bootstrap is a deliberately unavailable service, not an OPEN release.
// The standard deployment route and its first-gate prohibition are unchanged.
export function buildBootstrapSource(finalSource,maintenance){
 if(gasSourceBlobSha(finalSource)!==BASE_BLOB)throw Error('CUTOVER_FINAL_SOURCE');
 const point='function _issue507GateEnter_(name) {';
 if(finalSource.split(point).length!==2)throw Error('CUTOVER_LAYOUT');
 let code=finalSource.replace(point,point+"\n  throw new Error('ISSUE860_BOOTSTRAP_MAINTENANCE');");
 code=code.replace("if(!raw)return jsonOk({gasVersion:ISSUE507_GATE_API_VERSION,writerGate:{mode:'UNINITIALIZED',repairAuthorized:false}});",
  "if(!raw)return jsonOk({gasVersion:ISSUE507_GATE_API_VERSION,writerGate:{mode:'UNINITIALIZED',repairAuthorized:false,firstCutoverReady:false,firstCutoverAbortReady:_issue860BootstrapAbortReady_(props),journalPresent:!!props.getProperty(ISSUE860_TRIGGER_JOURNAL)}});");
 code=code.replace('activeCount:Object.keys(s.active).length,finished:s.finished,',
  'activeCount:Object.keys(s.active).length,finished:s.finished,releaseId:s.releaseId,firstCutoverReady:_issue860BootstrapReady_(props,s),journalPresent:!!props.getProperty(ISSUE860_TRIGGER_JOURNAL),');
 return code+'\n'+maintenance+'\n'+EDITOR_HELPERS;
}
export function loadCutoverSources(){
 const baseSource=fs.readFileSync('src/gas/apps_script.gs','utf8').replace(/\r\n/g,'\n');
 const maintenance=fs.readFileSync('scripts/staged/issue860-trigger-maintenance.gs','utf8').replace(/\r\n/g,'\n');
 return {finalSource:baseSource+FINAL_EDITOR_RESUME,bootstrapSource:buildBootstrapSource(baseSource,maintenance)};
}
// Apps Script's editor picker omits names ending in underscore. This public
// editor alias delegates unchanged to the existing atomic drain/resume checks.
// It is absent from the bootstrap profile and has no HTTP/menu/trigger route.
const FINAL_EDITOR_RESUME='\n// Issue860 editor-only resume; existing drain validation is unchanged.\nfunction issue507ResumeWriters() {\n  return issue507ResumeWriters_();\n}\n';
const EDITOR_HELPERS=String.raw`
// Editor-only metadata operations. No HTTP/menu/trigger routes are registered.
function issue860BootstrapPrepare() {
  var p=PropertiesService.getScriptProperties(),m;
  try{m=JSON.parse(p.getProperty('issue860_ui_trigger_manifest_v1'));}
  catch(ignore){_issue860Fail_('UI_MANIFEST');}
  return issue860PrepareTriggerPause_(_issue860BootstrapManifestIds_(m));
}
function _issue860BootstrapManifestIds_(m) {
  if(!m||!Array.isArray(m.triggers))_issue860Fail_('UI_MANIFEST');
  var rows=_issue860Rows_();
  m.triggers.forEach(function(t){
    var found=rows.filter(function(r){return r.handler===t.handler;});
    if(found.length!==1)_issue860Fail_('UI_MANIFEST');
    var r=found[0];
    if(t.event!==r.event||t.source!==r.source||t.sourceId!==r.sourceId)_issue860Fail_('UI_MANIFEST');
    t.id=r.id;
  });
  return m;
}
// Container-bound editor prompts avoid the >50-properties read-only settings
// UI. Prompt BEFORE acquiring a lock: Apps Script releases locks on suspension.
// These functions have no web, menu, trigger, or credential route.
function _issue860BootstrapPromptJson_(title) {
  var ui=SpreadsheetApp.getUi();
  var reply=ui.prompt(title,'독립 확인한 전환 메타데이터 JSON만 입력하세요. 인증값·금융정보 입력 금지.',ui.ButtonSet.OK_CANCEL);
  if(reply.getSelectedButton()!==ui.Button.OK)return null;
  var raw=reply.getResponseText();
  if(typeof raw!=='string'||Utilities.newBlob(raw).getBytes().length>8000)_issue860Fail_('INPUT_CAPACITY');
  try{return JSON.parse(raw);}catch(ignore){_issue860Fail_('INPUT_JSON');}
}
function issue860BootstrapPreparePrompt() {
  var m=_issue860BootstrapPromptJson_('Issue860 원래 트리거 UI 기록');
  if(m===null)return {cancelled:true,financeWrites:0};
  // The existing atomic prepare rechecks actual IDs after the dialog closes
  // and durably records the full manifest before any deletion is possible.
  return issue860PrepareTriggerPause_(_issue860BootstrapManifestIds_(m));
}
function issue860BootstrapRolloutPrompt() {
  var q=_issue860BootstrapPromptJson_('Issue860 모든 actor 종료·격리 독립 증빙');
  if(q===null)return {cancelled:true,financeWrites:0};
  return _issue507GateAtomic_(function(p){
    var j=_issue860Read_(p),rows=_issue860Rows_();
    if(j.phase==='PAUSED'){
      if(rows.length)_issue860Fail_('NOT_PAUSED');
    }else if(j.phase==='RESTORED'){
      if(j.pending!==null||rows.length!==11||Object.keys(j.created).length!==11||
        !j.manifest.triggers.every(function(t){return rows.filter(function(r){
          return r.id===j.created[t.handler]&&_issue860Matches_(r,t);
        }).length===1;}))_issue860Fail_('RESTORE_UNVERIFIED');
    }else _issue860Fail_('NOT_PAUSED');
    if(p.getProperty('issue507_writer_gate_v1'))_issue860RequireDrainingGate_(p);
    else if(j.phase!=='PAUSED')_issue860Fail_('GATE');
    // Do not manufacture booleans, evidence references, or verification time.
    // Preserve only the existing gate schema and validate it before persistence.
    var clean={releaseId:q.releaseId,oldDeploymentsDisabled:q.oldDeploymentsDisabled,
      externalWritersBlocked:q.externalWritersBlocked,editorsBlocked:q.editorsBlocked,
      verifiedAt:q.verifiedAt,legacyDrainEvidence:q.legacyDrainEvidence&&{
        kind:q.legacyDrainEvidence.kind,scope:q.legacyDrainEvidence.scope,
        terminalOnly:q.legacyDrainEvidence.terminalOnly,reference:q.legacyDrainEvidence.reference}};
    var raw=JSON.stringify(clean),valid=_issue507GateRollout_({getProperty:function(){return raw;}});
    if(Date.now()-valid.verifiedAt>300000||valid.legacyDrainEvidence.reference.length>200)
      _issue860Fail_('ROLLOUT_STALE');
    p.setProperty('issue507_writer_gate_rollout_v1',raw);
    if(p.getProperty('issue507_writer_gate_rollout_v1')!==raw)_issue860Fail_('ROLLOUT_READBACK');
    return {rolloutRecorded:true,financeWrites:0};
  });
}
function issue860BootstrapPause() {
  var j=_issue860Read_(PropertiesService.getScriptProperties());
  return issue860PausePreparedTriggers_(j.manifest.operationId);
}
function issue860BootstrapInitialize() {
  return _issue507GateAtomic_(function(p){
    var j=_issue860Read_(p);
    if(j.phase!=='PAUSED'||_issue860Rows_().length)_issue860Fail_('NOT_PAUSED');
    var q=_issue507GateRollout_(p),raw=p.getProperty('issue507_writer_gate_v1');
    if(raw){
      var existing=_issue507GateRead_(p);
      if(existing.mode!=='DRAINING'||Object.keys(existing.active).length)_issue860Fail_('GATE');
      return {mode:'DRAINING',initialized:false,financeWrites:0};
    }
    if(Date.now()-q.verifiedAt>300000)_issue860Fail_('ROLLOUT_STALE');
    _issue507GateSave_(p,{releaseId:ISSUE507_GATE_RELEASE_ID,mode:'DRAINING',
      active:{},completed:[],finished:0,barrierAt:Date.now(),bootstrapMaintenance:true});
    return {mode:'DRAINING',initialized:true,financeWrites:0};
  });
}
function issue860BootstrapRestore() {
  var j=_issue860Read_(PropertiesService.getScriptProperties());
  return issue860RestorePreparedTriggers_(j.manifest.operationId);
}
function issue860BootstrapRenewBarrier() {
  return _issue507GateAtomic_(function(p){
    var q=_issue507GateRollout_(p),s=_issue507GateRead_(p),j=_issue860Read_(p),rows=_issue860Rows_();
    if(s.mode!=='DRAINING'||s.bootstrapMaintenance!==true||Object.keys(s.active).length||
      j.phase!=='RESTORED'||j.pending!==null||rows.length!==11||Object.keys(j.created).length!==11||
      !j.manifest.triggers.every(function(t){return rows.filter(function(r){
        return r.id===j.created[t.handler]&&_issue860Matches_(r,t);
      }).length===1;})||q.verifiedAt<=s.barrierAt||Date.now()-q.verifiedAt>300000)
      _issue860Fail_('RENEW_UNVERIFIED');
    s.barrierAt=Date.now();_issue507GateSave_(p,s);
    return {mode:'DRAINING',barrierRenewed:true,financeWrites:0};
  });
}
function _issue860BootstrapReady_(p,s) {
  try{
    var q=_issue507GateRollout_(p),j=_issue860Read_(p),rows=_issue860Rows_();
    return s.mode==='DRAINING'&&Object.keys(s.active).length===0&&
      s.bootstrapMaintenance===true&&q.verifiedAt<=s.barrierAt&&Date.now()-s.barrierAt>=420000&&
      Date.now()-q.verifiedAt<=1800000&&Date.now()-s.barrierAt<=1800000&&
      j.phase==='RESTORED'&&j.pending===null&&rows.length===11&&Object.keys(j.created).length===11&&
      j.manifest.triggers.every(function(t){return rows.filter(function(r){
        return r.id===j.created[t.handler]&&_issue860Matches_(r,t);
      }).length===1;});
  }catch(ignore){return false;}
}
function _issue860BootstrapAbortReady_(p) {
  try{
    if(p.getProperty('issue507_writer_gate_v1'))return false;
    var j=_issue860Read_(p),rows=_issue860Rows_();
    return j.phase==='PREPARED'&&j.pending===null&&Object.keys(j.created).length===0&&rows.length===11&&
      j.manifest.triggers.every(function(t){return rows.filter(function(r){
        return r.id===t.id&&_issue860Matches_(r,t);
      }).length===1;});
  }catch(ignore){return false;}
}
`;
