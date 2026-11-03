// Source-only, fail-closed review proposal. Never deploy or modify Apps Script.
import {createHash} from 'node:crypto';
import vm from 'node:vm';

export const APPROVED_GAS_V9282_BLOB = '9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
const GET_ANCHOR = "  if (params.action === 'getAutomationStatus') return handleGetAutomationStatus();";
const POST_ANCHOR = "  if (params.action === 'diagnoseNhMarketData') return handleDiagnoseNhMarketData(params);";
const GET_DENIAL = "  if (params.action === 'appendPerformanceMetrics' || params.action === 'getPerformanceSummary') return jsonError('POST_ONLY');";
const POST_ROUTES = [
  "  if (params.action === 'appendPerformanceMetrics') return handleAppendPerformanceMetrics(params);",
  "  if (params.action === 'getPerformanceSummary') return handleGetPerformanceSummary(params);"
].join('\n');

function replaceOnce(s,from,to){
 if(s.split(from).length !== 2)throw Error('PERF_COMPOSE_ANCHOR_MISSING_OR_DUPLICATE');
 return s.replace(from,to);
}
export function sourceSha(s){
 return createHash('sha1').update('blob '+Buffer.byteLength(s,'utf8')+'\0').update(s,'utf8').digest('hex');
}
export function composePerformanceGasCandidate(base,collector){
 if(typeof base!=='string'||sourceSha(base)!==APPROVED_GAS_V9282_BLOB)
   throw Error('PERF_COMPOSE_BASE_UNAPPROVED');
 if(typeof collector!=='string'||collector.length<3500||collector.length>14000||
    !collector.includes('function handleAppendPerformanceMetrics(params)')||
    !collector.includes('function handleGetPerformanceSummary(params)'))
   throw Error('PERF_COMPOSE_COLLECTOR_INVALID');
 for(const name of ['handleAppendPerformanceMetrics','handleGetPerformanceSummary','_perfMonitorSheet_']) {
   if(base.includes('function '+name+'('))throw Error('PERF_COMPOSE_NAME_COLLISION');
 }
 if(base.includes("params.action === 'appendPerformanceMetrics'")||
    base.includes("params.action === 'getPerformanceSummary'"))
    throw Error('PERF_COMPOSE_ACTION_COLLISION');
 // Every GAS handler must keep admission before any telemetry route.
 const getStart=base.indexOf('function doGet(e) {');
 const postStart=base.indexOf('function doPost(e) {');
 if(getStart<0||postStart<getStart)throw Error('PERF_COMPOSE_ROUTING_UNVERIFIED');
 const getBody=base.slice(getStart,postStart);
 const postBody=base.slice(postStart,base.indexOf('\n}',postStart)+2);
 const admission="  if (!_isAuthorizedRequest(params)) return jsonError('인증 실패');";
 if(getBody.split(admission).length!==2||postBody.split(admission).length!==2)
    throw Error('PERF_COMPOSE_AUTH_UNVERIFIED');
 if(getBody.indexOf(admission)>getBody.indexOf(GET_ANCHOR)||
    postBody.indexOf(admission)>postBody.indexOf(POST_ANCHOR))
    throw Error('PERF_COMPOSE_AUTH_ORDER');
 let candidate=replaceOnce(base,GET_ANCHOR,GET_DENIAL+'\n'+GET_ANCHOR);
 candidate=replaceOnce(candidate,POST_ANCHOR,POST_ROUTES+'\n'+POST_ANCHOR);
 candidate+='\n// PERFORMANCE_LOG ONLY - isolated source-only integration candidate\n'+collector+'\n';
 // Syntax verification is offline only; runtime integration is a separate test.
 new vm.Script(candidate,{filename:'review-only-gas-performance.gs'});
 return {source:candidate,baseBlob:APPROVED_GAS_V9282_BLOB,
   candidateBlob:sourceSha(candidate),deployable:false,
   financialWriteApproved:false,productionSourceChanged:false,
   requiredApprovals:['ISSUE860_DEPLOYMENT_INVENTORY_CLEARED',
    'WRITER_GATE_OPEN_AND_NO_OLD_ACTORS_VERIFIED',
    'NEW_FULL_GAS_RELEASE_REVIEW_AND_EXPLICIT_APPROVAL']};
}
