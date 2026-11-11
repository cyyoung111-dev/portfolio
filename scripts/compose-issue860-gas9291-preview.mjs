// #860: exact next-version candidate combining 9.290 Snapshot speedup and
// the newly tested watchdog: PRICE timeout -> persisted RAW audit -> same-run NAV;
// normal PRICE_OK/FUND_PENDING -> skip PRICE replay. Source only, no GAS writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIssue860StoredPriceWatchdogPreview} from './compose-issue860-stored-price-watchdog-preview.mjs';

const BASE='fa12c26b6b6d5f85d6d0e9f17d650a8824d0316c';
const gitBlob=source=>{const b=Buffer.from(source,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b,label){
 assert.equal(s.split(a).length,2,'ISSUE860_9291_DRIFT_'+label);
 return s.replace(a,b);
}
export function composeIssue860Gas9291Preview(){
 const old=composeIssue860StoredPriceWatchdogPreview();
 assert.equal(old.manifest.parentGitBlob,BASE);
 assert.equal(gitBlob(old.parent),BASE);
 assert.equal(old.manifest.sourceOnly,true);
 assert.equal(old.manifest.deployable,false);
 let source=old.source;
 source=once(source,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.290',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.291','VERSION_HEADER');
 source=once(source,
  '//  v9.290 원장 안전성 유지 스냅샷 성능 개선 검토 후보 (미배포):',
  [
   '//  v9.291 마감과 펀드 비동기 상태 분리 (배포 전 검증 후보):',
   '//  • 9.290 EXACT source의 Snapshot I/O 개선 유지',
   '//  • 20:30 FUND_PENDING은 정상 NAV 대기: 가격 재실행 금지',
   '//  • PRICE timeout은 15분 lease 이후 원본 RAW/Revision/Owner 검증',
   '//  • 동일 owner NAV 예약만 복구, 새로운 가격/스냅샷 재기입 금지',
   '//  • 원장 v2 / Writer Gate / 백업·복구 / 수동배포 승인 유지',
   '//',
   '//  v9.290 원장 안전성 유지 스냅샷 성능 개선 검토 후보 (미배포):'
  ].join('\n'),'CHANGELOG');
 const count=source.split("gasVersion: '9.290'").length-1;
 assert(count>=5&&count<=20,'ISSUE860_9291_VERSION_COUNT_UNVERIFIED_'+count);
 source=source.replaceAll("gasVersion: '9.290'","gasVersion: '9.291'");
 source=once(source,
  "var ISSUE507_GATE_API_VERSION='9.290'",
  "var ISSUE507_GATE_API_VERSION='9.291'",'GATE_API_VERSION');
 assert(!source.includes("gasVersion: '9.290'"));
 assert(!source.includes("ISSUE507_GATE_API_VERSION='9.290'"));
 return {parent:old.parent,source,manifest:{
  parentVersion:'9.290',candidateVersion:'9.291',
  parentGitBlob:BASE,sourceGitBlob:gitBlob(source),
  changedFunctions:['_scheduleFundAfterFailedPortfolioPrice_',
    'runPortfolioCloseWatchdog2030'],
  addedFunctions:['_issue860RecoverStoredPriceWatchdog_'],
  financeWritersUnchanged:true,
  tradeV2Unchanged:true,
  asyncNavIndependent:true,
  originalDataUntouched:true,
  explicitManualReleaseRequired:true,
  sourceOnly:true,financeWrites:0,gasDeployments:0,telegramSends:0
 }};
}
