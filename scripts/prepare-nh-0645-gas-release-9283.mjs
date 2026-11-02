// GAS v9.283 PREVIEW ONLY: no GAS project writes, secret reads or deploy.
import fs from 'node:fs';
import {gasSourceBlobSha,extractExpectedGasVersion} from './deploy-gas.mjs';
import {buildIssue507LiveRelease} from './build-issue507-live-release.mjs';

export const V9282_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const CAPTURE_BEGIN=405; // 06:45 KST
export const CAPTURE_END=480;   // 08:00 KST; existing 07:40 recovery allowed

const CAPTURE_GUARDS=Object.freeze([
  Object.freeze({
    from:'(diagnosticOnly?(kst.minutes<480||kst.minutes>=780):(kst.minutes<450||kst.minutes>=480))',
    to:'(diagnosticOnly?(kst.minutes<480||kst.minutes>=780):(kst.minutes<405||kst.minutes>=480))',
  }),
  Object.freeze({
    from:"||kst.minutes<450||kst.minutes>=480)return jsonError('NH_PROXY_WINDOW');",
    to:"||kst.minutes<405||kst.minutes>=480)return jsonError('NH_PROXY_WINDOW');",
  }),
]);

function once(source,oldText,newText,tag){
  if(source.split(oldText).length!==2)throw Error('NH_9283_'+tag+'_SCOPE_UNVERIFIED');
  return source.replace(oldText,newText);
}
export function prepareNh0645Gas9283({read=fs.readFileSync}={}){
  const source=read('src/gas/apps_script.gs','utf8');
  if(typeof source!=='string'||gasSourceBlobSha(source)!==V9282_BLOB)
    throw Error('NH_9283_PRODUCTION_V9282_BASELINE_CHANGED');
  const historical=buildIssue507LiveRelease();
  if(historical.entrypointCount!==555||historical.source!==source)
    throw Error('NH_9283_GATE_BASELINE_CHANGED');
  let candidate=source;
  for(const [i,guard] of CAPTURE_GUARDS.entries())
    candidate=once(candidate,guard.from,guard.to,'WINDOW_'+i);
  candidate=once(candidate,
    'Google Apps Script  v9.282','Google Apps Script  v9.283','HEADER');
  const changelog='//  v9.283 변경사항 (2026.11.02):\n'+
    '//  • NH 야간선물 06:00 기준값 조기 수집을 위한 06:45 조회 허용\n'+
    '//  • 08:00 종전 종료 및 금융 writer gate/스냅샷 복구 범위 유지\n//\n';
  candidate=once(candidate,'//  v9.282 변경사항',changelog+'//  v9.282 변경사항','CHANGELOG');
  const match=[...candidate.matchAll(/\bgasVersion:\s*['"]9\.282['"]/g)];
  if(match.length!==9)throw Error('NH_9283_VERSION_FIELDS_UNVERIFIED_'+match.length);
  candidate=candidate.replace(/\bgasVersion:\s*(['"])9\.282\1/g,(_full,quote)=>'gasVersion: '+quote+'9.283'+quote);
  candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.282';",
    "var ISSUE507_GATE_API_VERSION='9.283';",'WRITER_GATE_API_VERSION');
  // Version is the only change to the writer gate. Retain the gate releaseId,
  // 555 admission wrappers, F00001 repair and all stored financial records.
  const oldGate=source.match(/var ISSUE507_GATE_RELEASE_ID='[a-f0-9]{64}'/);
  if(!oldGate||!candidate.includes(oldGate[0]))throw Error('NH_9283_GATE_ID_CHANGED');
  if(extractExpectedGasVersion(candidate)!=='9.283')
    throw Error('NH_9283_VERSION_INCONSISTENT');
  return {candidate,manifest:{
    status:'PREVIEW_NOT_DEPLOYABLE',
    predecessor:'9.282',proposedVersion:'9.283',
    predecessorBlob:V9282_BLOB,candidateBlob:gasSourceBlobSha(candidate),
    windowStartKst:'06:45',windowEndKst:'08:00',
    morningBriefingKst:'07:40',
    changedNhWindowClauses:CAPTURE_GUARDS.length,
    reviewedResponseVersions:match.length,
    entrypointCount:historical.entrypointCount,
    gateReleaseIdPreserved:true,
    deploymentApproved:false,productionSourceChanged:false,
    oauthRequested:false,financeWriteAuthorized:false,
  }};
}
