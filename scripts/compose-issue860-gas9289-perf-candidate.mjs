// #860: next-version, SOURCE-ONLY performance+timing successor of reviewed
// 9.288 trade-v2; preserves entire migration, finance/rollback and approvals.
// This source must be separately pinned/reviewed/approved before deployment.
import {createHash} from 'node:crypto';
import {composeGas9288TradeV2From9287Preview} from './compose-gas9288-trade-v2-from-9287-preview.mjs';
import {composeIssue860SnapshotPriceReadPreview} from './compose-issue860-snapshot-price-read-preview.mjs';
import {composeIssue860CloseStageTimingPreview} from './compose-issue860-close-stage-timing-preview.mjs';

const PARENT_SHA='9e8584032daf896c5cffedb02041b604ee82ed07';
function gitBlob(source) {
 const b=Buffer.from(source,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
}
function replaceOnce(source,before,after,label) {
 if(source.split(before).length!==2)throw Error('ISSUE860_9289_SOURCE_DRIFT:'+label);
 return source.replace(before,after);
}
export function composeIssue860Gas9289PerfCandidate(){
 const old=composeGas9288TradeV2From9287Preview();
 if(old.manifest.candidateVersion!=='9.288'||old.manifest.candidateSourceGitBlob!==PARENT_SHA||
    gitBlob(old.candidate)!==PARENT_SHA)
  throw Error('ISSUE860_9289_PARENT_9288_NOT_REVIEWED');
 let candidate=composeIssue860SnapshotPriceReadPreview(old.candidate).source;
 candidate=composeIssue860CloseStageTimingPreview(candidate).source;
 candidate=replaceOnce(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.288',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.289','VERSION_HEADER');
 candidate=replaceOnce(candidate,
  '//  v9.288 거래원장 v2 소스 검증 후보 (미배포):',
  ['//  v9.289 스냅샷/펀드 성능 계측 후보 (미배포):',
   '//  • v9.288 거래원장 v2, 금융 Writer/복구·권한 로직 유지',
   '//  • Snapshot 단일 호출의 중복 PriceHistory 전체 조회 1회 축소',
   '//  • CLOSE 빌드/계획/쓰기/검증, NAV valuation 소요시간만 계측',
   '//  • 별도 버전·정확 소스 SHA 승인 후에만 수동 운영 게시',
   '//',
   '//  v9.288 거래원장 v2 소스 검증 후보 (미배포):'].join('\n'),'CHANGELOG');
 if(candidate.split("gasVersion: '9.288'").length!==10)
  throw Error('ISSUE860_9289_VERSION_FIELDS_DRIFT');
 candidate=candidate.replaceAll("gasVersion: '9.288'","gasVersion: '9.289'");
 candidate=replaceOnce(candidate,
   "var ISSUE507_GATE_API_VERSION='9.288'",
   "var ISSUE507_GATE_API_VERSION='9.289'",'GATE_VERSION');
 if(candidate.includes("gasVersion: '9.288'")||
    candidate.includes("ISSUE507_GATE_API_VERSION='9.288'"))
  throw Error('ISSUE860_9289_OLD_VERSION_LEFT');
 return {parent:old.candidate,candidate,manifest:{
  parentVersion:'9.288',candidateVersion:'9.289',
  parentSourceGitBlob:PARENT_SHA,candidateSourceGitBlob:gitBlob(candidate),
  proposedFunctionChanges:[
   'getPriceHistoryRow','_getPriceSourceByDate',
   '_buildSnapshotRowsFromTradeAndPriceHistory',
   'saveDailyPriceHistory','runDailyFundValuations'
  ],
  tradeV2Unchanged:true,financeWriterUnchanged:true,manualReleaseOnly:true,
  sourceOnly:true,approvedForGasDeploy:false,
  waitingOnTradeV2Release:true,financeWrites:0,gasDeployments:0,telegramSends:0
 }};
}
