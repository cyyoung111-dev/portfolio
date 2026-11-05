import fs from 'node:fs';
import {gasSourceBlobSha} from '../scripts/deploy-gas.mjs';

export const FINAL_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const LEGACY_BLOB='ebe697563e94cf49e514037353260fce70ae1d57';
export const RELEASE='257c26d1ad789d8f036e74d56418644385e8860dab8c5551fb8c2f493e9626b5';
// A bootstrap is a deliberately unavailable service, not an OPEN release.
// The standard deployment route and its first-gate prohibition are unchanged.
export function buildBootstrapSource(finalSource,maintenance){
 if(gasSourceBlobSha(finalSource)!==FINAL_BLOB)throw Error('CUTOVER_FINAL_SOURCE');
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
 const finalSource=fs.readFileSync('reference/gas-v9.282.gs','utf8').replace(/\r\n/g,'\n');
 const maintenance=fs.readFileSync('scripts/staged/issue860-trigger-maintenance.gs','utf8').replace(/\r\n/g,'\n');
 return {finalSource,bootstrapSource:buildBootstrapSource(finalSource,maintenance)};
}
const EDITOR_HELPERS=String.raw`
// Editor-only metadata operations. No HTTP/menu/trigger routes are registered.
function issue860BootstrapPrepare() {
  var p=PropertiesService.getScriptProperties(),m;
  try{m=JSON.parse(p.getProperty('issue860_ui_trigger_manifest_v1'));}
  catch(ignore){_issue860Fail_('UI_MANIFEST');}
  if(!m||!Array.isArray(m.triggers))_issue860Fail_('UI_MANIFEST');
  var rows=_issue860Rows_();
  m.triggers.forEach(function(t){
    var found=rows.filter(function(r){return r.handler===t.handler;});
    if(found.length!==1)_issue860Fail_('UI_MANIFEST');
    var r=found[0];
    if(t.event!==r.event||t.source!==r.source||t.sourceId!==r.sourceId)_issue860Fail_('UI_MANIFEST');
    t.id=r.id;
  });
  return issue860PrepareTriggerPause_(m);
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

