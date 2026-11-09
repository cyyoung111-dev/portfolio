// Independent fund/Snapshot source-only release candidate.
// v9.286 is reserved for trade-ledger v2. This never changes/deploys v9.285.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {composeSnapshotBackupReadPreview} from './snapshot-backup-read-optimization-preview.mjs';
import {composeGas9286SnapshotTimingProbe} from './compose-gas9286-snapshot-timing-probe.mjs';

const PINNED_FUND_SOURCE_BLOB='954fd4aeae767ddac0cb161d3a81003b5b699d1c';
const blob=s=>{
  const b=Buffer.from(s,'utf8');
  return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
};
function replaceOnce(source,before,after,label){
  if(source.split(before).length!==2)
    throw Error('FUND_SNAPSHOT_9287_ANCHOR_DRIFT:'+label);
  return source.replace(before,after);
}
export function composeFundSnapshot9287SourcePreview(){
  const parent=fs.readFileSync('src/gas/apps_script.gs','utf8');
  if(blob(parent)!==PINNED_FUND_SOURCE_BLOB)
    throw Error('FUND_SNAPSHOT_9287_UNREVIEWED_9285_SOURCE');
  if(!parent.includes("var ISSUE507_GATE_API_VERSION='9.285'"))
    throw Error('FUND_SNAPSHOT_9287_PARENT_GATE_DRIFT');
  if(parent.includes('function _tradeV2ValidateMutation_(')||
    parent.includes("params.action === 'syncTradesV2'"))
    throw Error('FUND_SNAPSHOT_9287_TRADE_MIGRATION_PRESENT');
  let candidate=composeSnapshotBackupReadPreview(parent).source;
  candidate=composeGas9286SnapshotTimingProbe(candidate).source;
  candidate=replaceOnce(candidate,
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.285',
    '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.287',
    'VERSION_HEADER');
  candidate=replaceOnce(candidate,
    '//  v9.285 변경사항 (2026.11.07):',
    ['//  v9.287 펀드·스냅샷 단독 검증 후보 (2026.11.09):',
     '//  • 펀드 no-op 유지, Snapshot 백업 중복 전체 읽기 제거',
     '//  • 단계별 시간 측정(민감정보 제외), 백업·복구·잠금 유지',
     '//  • 거래원장 v2 마이그레이션 제외, 별도 검토·승인 전 배포 금지',
     '//',
     '//  v9.285 변경사항 (2026.11.07):'].join('\n'),
    'CHANGELOG');
  if(candidate.split("gasVersion: '9.285'").length!==10)
    throw Error('FUND_SNAPSHOT_9287_VERSION_FIELD_COUNT_DRIFT');
  candidate=candidate.replaceAll("gasVersion: '9.285'","gasVersion: '9.287'");
  candidate=replaceOnce(candidate,
    "var ISSUE507_GATE_API_VERSION='9.285'",
    "var ISSUE507_GATE_API_VERSION='9.287'",'GATE_VERSION');
  if(candidate.includes("gasVersion: '9.285'")||
    candidate.includes("ISSUE507_GATE_API_VERSION='9.285'")||
    candidate.includes('function _tradeV2ValidateMutation_(')||
    candidate.includes("params.action === 'syncTradesV2'"))
    throw Error('FUND_SNAPSHOT_9287_UNEXPECTED_FEATURE');
  return {
    parent,candidate,
    manifest:{
      parentVersion:'9.285',candidateVersion:'9.287',
      parentSourceGitBlob:PINNED_FUND_SOURCE_BLOB,
      candidateSourceGitBlob:blob(candidate),
      purpose:'FUND_SNAPSHOT_HOTFIX_NO_TRADE_V2',
      features:['fund-noop','snapshot-backup-read-optimization','snapshot-stage-timing'],
      tradeLedgerV2Included:false,tradeLedgerMigrationRequired:false,
      releaseMode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,
      productionGASUpdated:false,webVersionCompatible:false,
      approvedForGasDeploy:false,
      blockers:[
        'V9287_SOURCE_REVIEW_REQUIRED',
        'V9287_WEB_VERSION_CONSUMER_GATE_REQUIRED',
        'V9287_FULL_SOURCE_PIN_AND_DEPLOY_INVENTORY_REQUIRED',
        'V9287_MANUAL_DRY_RUN_REQUIRED',
        'V9287_PROTECTED_GAS_EXECUTION_REQUIRED',
        'V9287_FINANCIAL_READBACK_AND_ROLLBACK_REHEARSAL_REQUIRED',
        'PERSISTED_FUND_TIMEOUT_UNRESOLVED'
      ],
      financeWrites:0,gasProjectWrites:0,telegramSends:0
    }
  };
}
