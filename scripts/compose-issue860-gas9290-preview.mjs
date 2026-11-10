// #860 proposed NEXT GAS release source: 9.290 (source only, NOT deployable).
// Deterministically combine two independently CI-verified source previews over
// exact reviewed v9.289, preserving trade v2/owner gates, NAV, backup recovery,
// date-scoped rollback, and original close/fund timing instrumentation.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';
import {composeIssue860FreshDateAppendPreview} from './compose-issue860-fresh-date-append-preview.mjs';
import {composeIssue860CloseIntegrityReusePreview} from './compose-issue860-close-integrity-reuse-preview.mjs';

const PARENT_SHA='e6c0d8eba5eba8012ae761de7f436e86601b63d9';
function gitBlob(source) {
 const b=Buffer.from(source,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
}
function replaceOnce(source,before,after,name) {
 assert.equal(source.split(before).length,2,'ISSUE860_9290_SOURCE_DRIFT:'+name);
 return source.replace(before,after);
}
export function composeIssue860Gas9290Preview() {
 const old=composeIssue860Gas9289PerfCandidate();
 if(old.manifest.candidateVersion!=='9.289'||old.manifest.candidateSourceGitBlob!==PARENT_SHA||
    gitBlob(old.candidate)!==PARENT_SHA)
  throw Error('ISSUE860_9290_PARENT_NOT_EXACT_REVIEWED_9289');
 let candidate=composeIssue860FreshDateAppendPreview(old.candidate).source;
 candidate=composeIssue860CloseIntegrityReusePreview(candidate).source;
 candidate=replaceOnce(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.289',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.290',
  'HEADER');
 candidate=replaceOnce(candidate,
  '//  v9.289 스냅샷/펀드 성능 계측 후보 (미배포):',
  [
   '//  v9.290 원장 안전성 유지 스냅샷 성능 개선 검토 후보 (미배포):',
   '//  • 신규일만 date-scoped journal append; 기존 날짜 편집은 전체 백업 유지',
   '//  • 동일 close 호출 중 이미 계산한 expected 행 재사용; 저장값/가격 원천은 재조회',
   '//  • 9.289 계측/거래원장 v2/CAS/복구/ScriptLock/Writer gate 원문 유지',
   '//  • 별도 exact full-source review + SHA pin + 수동 게이트 전 운영 게시 금지',
   '//',
   '//  v9.289 스냅샷/펀드 성능 계측 후보 (미배포):'
  ].join('\n'),'CHANGELOG');
 if(candidate.split("gasVersion: '9.289'").length!==10)
  throw Error('ISSUE860_9290_VERSION_FIELDS_DRIFT');
 candidate=candidate.replaceAll("gasVersion: '9.289'","gasVersion: '9.290'");
 candidate=replaceOnce(candidate,
  "var ISSUE507_GATE_API_VERSION='9.289'",
  "var ISSUE507_GATE_API_VERSION='9.290'",
  'GATE_VERSION');
 if(candidate.includes("gasVersion: '9.289'")||
    candidate.includes("ISSUE507_GATE_API_VERSION='9.289'"))
  throw Error('ISSUE860_9290_OLD_RUNTIME_VERSION');
 const sha=gitBlob(candidate);
 return {parent:old.candidate,candidate,manifest:{
  parentVersion:'9.289',candidateVersion:'9.290',
  parentSourceGitBlob:PARENT_SHA,candidateSourceGitBlob:sha,
  changedBusinessFunctions:['writeSnapshotRows','diagnoseSnapshotIntegrity','saveDailyPriceHistory'],
  protectedWriterVersion:'9.289',tradeV2Unchanged:true,
  sourceOnly:true,reviewed:false,approvedForGasDeploy:false,
  financeWrites:0,gasDeployments:0,telegramSends:0
 }};
}
