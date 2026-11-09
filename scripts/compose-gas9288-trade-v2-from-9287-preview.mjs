// Source-only trade-v2 successor. The exact reviewed v9.287 runtime is the
// parent, NOT the historical v9.284/v9.286 preview. Never publishes or writes.
import {createHash} from 'node:crypto';
import {composeFundSnapshot9287SourcePreview}
  from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9286IntegratedPreview}
  from './compose-gas9286-integrated-preview.mjs';
import {TRADE_V2_GAS_HELPERS} from './trade-v2-gas-functions.mjs';
import {TRADE_V2_GAS_RECEIPTS} from './trade-v2-gas-receipts.mjs';
import {TRADE_V2_GAS_MIGRATION_PREVIEW} from './trade-v2-gas-migration-preview.mjs';
import {TRADE_V2_GAS_MIGRATION_APPLY} from './trade-v2-gas-migration-apply-preview.mjs';

const PINNED_9287_GIT_BLOB='e2f5239746598754305eb603bc33651f5c36d914';
const blob=source=>{
 const b=Buffer.from(source,'utf8');
 return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
};
function replaceExactlyOnce(source,from,to,label){
 if(source.split(from).length!==2)throw Error('GAS9288_SOURCE_ANCHOR_DRIFT:'+label);
 return source.replace(from,to);
}
function functions(source){
 const found=new Map();
 for(const m of source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)){
  const end=source.indexOf('\n}',m.index);
  if(end<0||found.has(m[1]))throw Error('GAS9288_FUNCTION_BOUNDARY:'+m[1]);
  found.set(m[1],source.slice(m.index,end+2));
 }
 return found;
}
const sorted=a=>a.slice().sort();
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const normalizeVersion=s=>s.replaceAll("gasVersion: '9.286'","gasVersion: '9.287'");
const CHANGED_9286_VS_9287=Object.freeze([
 'doPost','handleGetFundUnits','_portfolioSyncCanonical_',
 '_recordPortfolioSyncSnapshotCompletion_','handleGetPortfolioSyncReceipt',
 'handlePortfolioSyncWithReceipt','handleSyncTrades',
 '_getAutomationStatusData','handleGetAutomationStatus',
 'handleGetCodeListReadOnly','handleGetTrades','handleGetSettings',
 'handleGetBootstrap','handleDiagnoseNhMarketData',
 'handleGetNhAuthStatusProxy','handleGetNhIndexProbe'
]);
const NEW_V2_FUNCTIONS=Object.freeze([
 '_portfolioTradeFxMetadata_','_tradeV2CanonicalRow_','_tradeV2RowsFromTrades_',
 '_tradeV2RowHash_','_tradeV2Revision_','_tradeV2ValidateMutation_',
 '_tradeV2ReceiptInput_','_tradeV2CheckpointVerified_',
 '_tradeV2ReceiptState_','handleTradeV2ReceiptReadOnly_',
 'handleTradeSyncV2WithReceipt_','_tradeV2MigrationPlan_',
 'handlePreviewTradeLedgerV2Migration_'
]);
const MANUAL_MIGRATION_FUNCTIONS=Object.freeze([
 'runTradeV2MigrationPreflight','runTradeV2MigrationApply',
 'runTradeV2MigrationRestore','_tradeV2MigrationManual_'
]);
const PROTECTED_FINANCE=Object.freeze([
 '_refreshFundValuations','_backupSheetBeforeWrite','writeSnapshotRows',
 '_issue507GateEnter_','_issue507GateInvoke_','_sheetContentSignature'
]);
export function composeGas9288TradeV2From9287Preview(){
 const current=composeFundSnapshot9287SourcePreview();
 const previous=composeGas9286IntegratedPreview();
 if(current.manifest.candidateVersion!=='9.287'||
    current.manifest.candidateSourceGitBlob!==PINNED_9287_GIT_BLOB||
    blob(current.candidate)!==PINNED_9287_GIT_BLOB||
    previous.manifest.proposedVersion!=='9.286'||
    previous.manifest.columns!==14||
    previous.manifest.productionDeploymentApproved!==false)
   throw Error('GAS9288_PARENT_PIN_OR_CANDIDATE_DRIFT');
 const approved=current.candidate,legacy=previous.candidate;
 const oldFns=functions(approved),newFns=functions(legacy);
 const changed=[...newFns].filter(([name,s])=>
  oldFns.has(name)&&oldFns.get(name)!==s).map(([name])=>name);
 const added=[...newFns.keys()].filter(name=>!oldFns.has(name));
 const removed=[...oldFns.keys()].filter(name=>!newFns.has(name));
 if(!same(changed,CHANGED_9286_VS_9287)||
   !same(added,NEW_V2_FUNCTIONS)||removed.length!==0)
   throw Error('GAS9288_UNREVIEWED_FUNCTION_DELTA');
 const extra=TRADE_V2_GAS_HELPERS+'\n'+TRADE_V2_GAS_RECEIPTS+
   '\n'+TRADE_V2_GAS_MIGRATION_PREVIEW;
 const helperFns=functions(extra);
 if(!same([...helperFns.keys()],NEW_V2_FUNCTIONS.filter(x=>x!=='_portfolioTradeFxMetadata_')))
   throw Error('GAS9288_UNEXPECTED_HELPER_FUNCTIONS');
 if(!same([...functions(TRADE_V2_GAS_MIGRATION_APPLY).keys()],MANUAL_MIGRATION_FUNCTIONS))
   throw Error('GAS9288_UNEXPECTED_MIGRATION_ENTRYPOINTS');
 let source=approved;
 const transplanted=[];
 for(const name of changed){
  const old=oldFns.get(name),next=normalizeVersion(newFns.get(name));
  // Other GAS APIs must stay byte-identical to approved 9.287. In
  // particular fund valuation, all price providers, and live writer gates
  // cannot regress merely because the older 9.286 preview returned a
  // different version string.
  if(old===next)continue;
  if(PROTECTED_FINANCE.includes(name))throw Error('GAS9288_FINANCE_REGRESSION:'+name);
  source=replaceExactlyOnce(source,old,next,'TRADE_FUNCTION_'+name);
  transplanted.push(name);
 }
 const fxName='_portfolioTradeFxMetadata_';
 source=replaceExactlyOnce(source,'function _portfolioSyncCanonical_(kind, rows) {',
  newFns.get(fxName)+'\nfunction _portfolioSyncCanonical_(kind, rows) {',
  'ADD_FX_VALIDATOR');
 source=replaceExactlyOnce(source,'function handleSyncTrades(',
  extra+'\n'+TRADE_V2_GAS_MIGRATION_APPLY+'\nfunction handleSyncTrades(',
  'ADD_ID_CAS_RECEIPT_MIGRATION_HELPERS');
 // Preserve 9.287 release history, only prepend the trade-v2 candidate.
 source=replaceExactlyOnce(source,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.287',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.288',
  'HEADER');
 source=replaceExactlyOnce(source,
  '//  v9.287 펀드·스냅샷 단독 검증 후보 (2026.11.09):',
  ['//  v9.288 거래원장 v2 소스 검증 후보 (미배포):',
   '//  • 9.287 펀드/스냅샷 원본 보존, 거래 원장 14열 ID·CAS·FX/receipt 추가',
   '//  • 승인된 운영 9.287을 부모로 함; 실제 원본 이관과 배포는 별도 승인',
   '//',
   '//  v9.287 펀드·스냅샷 단독 검증 후보 (2026.11.09):'].join('\n'),
  'CHANGELOG');
 if(source.split("gasVersion: '9.287'").length!==10)
  throw Error('GAS9288_VERSION_COUNTER_DRIFT');
 source=source.replaceAll("gasVersion: '9.287'","gasVersion: '9.288'");
 if(source.includes("gasVersion: '9.286'"))
  throw Error('GAS9288_LEGACY_VERSION_REMAINING');
 source=replaceExactlyOnce(source,
  "var ISSUE507_GATE_API_VERSION='9.287'",
  "var ISSUE507_GATE_API_VERSION='9.288'",'GATE_API_VERSION');
 const after=functions(source);
 if(after.size!==oldFns.size+NEW_V2_FUNCTIONS.length+MANUAL_MIGRATION_FUNCTIONS.length)
  throw Error('GAS9288_EXTRA_ENTRYPOINT_OR_DUPLICATE');
 for(const name of PROTECTED_FINANCE){
  if(after.get(name)!==oldFns.get(name))
   throw Error('GAS9288_PROTECTED_FINANCE_CHANGED:'+name);
 }
 for(const name of NEW_V2_FUNCTIONS){
  if(!after.has(name))throw Error('GAS9288_V2_HANDLER_MISSING:'+name);
 }
 for(const name of MANUAL_MIGRATION_FUNCTIONS){
  if(!after.has(name))throw Error('GAS9288_MANUAL_MIGRATION_MISSING:'+name);
 }
 return {base:approved,candidate:source,manifest:{
  parentVersion:'9.287',candidateVersion:'9.288',
  parentSourceGitBlob:PINNED_9287_GIT_BLOB,
  candidateSourceGitBlob:blob(source),
  tradeLedgerProtocolVersion:2,columns:14,
  changedLegacyFunctions:changed,
  transplantedFunctions:transplanted,
  introducedFunctions:NEW_V2_FUNCTIONS,
  manualMigrationFunctions:MANUAL_MIGRATION_FUNCTIONS,
  migrationApplyRequiresApproval:true,
  migrationBackupNeverAutomaticallyDeleted:true,
  migrationPreservesSourceColumns:'A:K',
  protectedFinanceFunctions:PROTECTED_FINANCE,
  releaseStatus:'SOURCE_PREVIEW_ONLY',approvedForGasDeploy:false,
  requiresManualReleaseApproval:true,requiresProductionMigration:true,
  financeWrites:0,gasProjectWrites:0,telegramSends:0
 }};
}
