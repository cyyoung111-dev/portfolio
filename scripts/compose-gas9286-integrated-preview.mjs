// Combined source-only GAS v9.286 preview. Never writes or deploys.
// v9.285 fund-only and trade-only candidates are mutually exclusive.
import {createHash} from 'node:crypto';
import {composeGas9285TradeV2Preview} from './compose-gas9285-trade-v2-preview.mjs';
import {composeGas9285FundNoopPreview} from './compose-gas9285-fund-noop-preview.mjs';
import {composeSnapshotBackupReadPreview} from './snapshot-backup-read-optimization-preview.mjs';
import {composeGas9286SnapshotTimingProbe} from './compose-gas9286-snapshot-timing-probe.mjs';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function replaceOnce(src,from,to,label){
 if(src.split(from).length!==2)throw Error('GAS9286_ANCHOR_DRIFT:'+label);
 return src.replace(from,to);
}
export function composeGas9286IntegratedPreview(){
 const trade=composeGas9285TradeV2Preview();
 const fund=composeGas9285FundNoopPreview();
 if(trade.base!==fund.base||blob(trade.base)!==trade.manifest.baseSourceGitBlob)
  throw Error('GAS9286_BASE_MISMATCH');
 if(trade.manifest.proposedVersion!=='9.285'||fund.manifest.proposedVersion!=='9.285')
  throw Error('GAS9286_PARENT_VERSION_DRIFT');
 if(trade.manifest.columns!==14||!trade.manifest.legacy13ColumnWriterExcluded)
  throw Error('GAS9286_TRADE_V2_REQUIRED');
 if(trade.manifest.productionDeploymentApproved||fund.manifest.productionDeploymentApproved)
  throw Error('GAS9286_UNEXPECTED_APPROVAL');
 let candidate=trade.candidate;
 // Preserve the independently staged 9.285 fund writer verbatim. The
 // trade-v2 preview may have been composed from an older fund fixture.
 const extractFunction=(src,name)=>{
  const start=src.indexOf('function '+name+'(');
  if(start<0)throw Error('GAS9286_MISSING_FUNCTION:'+name);
  const end=src.indexOf('\n}',start);
  if(end<0)throw Error('GAS9286_UNTERMINATED_FUNCTION:'+name);
  return src.slice(start,end+2);
 };
 const fundName='_refreshFundValuations';
 const tradeFund=extractFunction(candidate,fundName);
 const stagedFund=extractFunction(fund.candidate,fundName);
 if(tradeFund!==stagedFund)
  candidate=replaceOnce(candidate,tradeFund,stagedFund,'STAGED_FUND_WRITER');
 // Reject duplicate or missing no-op branches after exact function adoption.
 const marker='if (values.length === 0)';
 if(candidate.split(marker).length!==2)throw Error('GAS9286_FUND_NOOP_MISSING_OR_DUPLICATE');
 candidate=replaceOnce(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.285',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.286','HEADER');
 candidate=replaceOnce(candidate,
  '//  v9.285 변경사항 (2026.11.07):',
  '//  v9.286 통합 후보 (2026.11.08):\\n//  • 거래원장 14열 영구 ID/CAS/FX + 펀드 no-op 통합\\n//  • 승인된 운영 v9.284 소스에서만 메모리 생성; 배포 불가\\n//\\n//  v9.285 변경사항 (2026.11.07):'.replaceAll('\\n','\n'),'CHANGELOG');
 if(candidate.split("gasVersion: '9.285'").length!==10)
  throw Error('GAS9286_VERSION_FIELD_COUNT_DRIFT');
 candidate=candidate.replaceAll("gasVersion: '9.285'","gasVersion: '9.286'");
 candidate=replaceOnce(candidate,
  "var ISSUE507_GATE_API_VERSION='9.285'",
  "var ISSUE507_GATE_API_VERSION='9.286'",'GATE');
 if(candidate.includes("gasVersion: '9.285'")||candidate.includes("ISSUE507_GATE_API_VERSION='9.285'"))
  throw Error('GAS9286_STALE_VERSION');
 // Apply the independently tested backup read optimization only to the
 // integrated 9.286 source-only candidate; never mutate approved 9.285.
 candidate=composeSnapshotBackupReadPreview(candidate).source;
 // Release-candidate-only stage timings; no workbook I/O is introduced.
 candidate=composeGas9286SnapshotTimingProbe(candidate).source;
 return {base:trade.base,candidate,manifest:{
  baseSourceGitBlob:blob(trade.base),candidateSourceGitBlob:blob(candidate),
  parentVersion:'9.284',proposedVersion:'9.286',
  integratedFeatures:['fund-noop','trade-ledger-v2','fx-source-preservation','receipt','CAS','backup-read-optimization','snapshot-stage-timing'],
  tradeLedgerProtocolVersion:2,columns:14,legacy13ColumnWriterExcluded:true,
  status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',productionDeploymentApproved:false,
  requiresReleaseReview:true,requiresProductionMigration:true,
  gasProjectWrites:0,financeWrites:0
 }};
}
