// Source-only v9.285 candidate. NEVER deploy this module output directly:
// authenticated receipt, ID migration, new web client and E2E still required.
import {createHash} from 'node:crypto';
import {composeGas9285TradeFxPreview} from './compose-gas9285-trade-fx-preview.mjs';
import {TRADE_V2_GAS_HELPERS} from './trade-v2-gas-functions.mjs';
import {TRADE_V2_GAS_RECEIPTS} from './trade-v2-gas-receipts.mjs';
import {TRADE_V2_GAS_MIGRATION_PREVIEW} from './trade-v2-gas-migration-preview.mjs';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(source,oldValue,newValue,label){
 if(source.split(oldValue).length!==2)throw Error('TRADE_V2_ANCHOR_DRIFT:'+label);
 return source.replace(oldValue,newValue);
}
export function composeGas9285TradeV2Preview(){
 const original=composeGas9285TradeFxPreview();
 let candidate=original.candidate;
 candidate=once(candidate,
  "function handleSyncTrades(dataJson, rebuildFrom, explicitEmpty, receiptLockHeld, receiptRows) {",
  TRADE_V2_GAS_HELPERS+"\n"+TRADE_V2_GAS_RECEIPTS+"\n"+TRADE_V2_GAS_MIGRATION_PREVIEW+"\nfunction handleSyncTrades(dataJson, rebuildFrom, explicitEmpty, receiptLockHeld, receiptRows, tradeV2Meta) {",
  'INSERT_V2_GAS_FUNCTIONS');
 // An ID-less client cannot modify an ID-bearing ledger, nor initialize
 // an unreviewed legacy sheet as if it had permanent IDs.
 const start="    var existingFx=previousRows.some(function(row){return row[11]!=='' && row[11]!=null;});";
 const end="    if (!sh) {";
 let a=candidate.indexOf(start,candidate.indexOf("function handleSyncTrades("));
 let b=candidate.indexOf(end,a);
 if(a<0||b<=a)throw Error('TRADE_V2_LEGACY_GUARD_DRIFT');
 candidate=candidate.slice(0,a)+[
  "    var v2Check=_tradeV2ValidateMutation_(previousRows,trades,tradeV2Meta,sh?sh.getLastColumn():0);",
  "    if(!v2Check.ok)return jsonError('거래 ID·수정삭제·버전 확인 필요',",
  "      {errorCode:v2Check.errorCode,saveState:'failed'});",
  ""
 ].join('\n')+candidate.slice(b);
 candidate=once(candidate,
  "Math.min(13, sh.getLastColumn())).getValues() : [];",
  "Math.min(14, sh.getLastColumn())).getValues() : [];",
  'READ_14');
 // The 13-column group heuristic was unsafe across account changes.
 const heuristicStart="    // Never let a stale 11-column client wipe existing FX evidence for an";
 const heuristicEnd="    var explicitEmptyReset = explicitEmpty === true && intendedRows.length === 0;";
 a=candidate.indexOf(heuristicStart,candidate.indexOf("function handleSyncTrades("));
 b=candidate.indexOf(heuristicEnd,a);
 if(a<0||b<=a)throw Error('TRADE_V2_HEURISTIC_DRIFT');
 candidate=candidate.slice(0,a)+candidate.slice(b);
 candidate=once(candidate,
  "t.ratio || '', t.fractionalCash || ''].concat(_portfolioTradeFxMetadata_(t));",
  "t.ratio || '', t.fractionalCash || ''].concat(_portfolioTradeFxMetadata_(t),[t.id||'']);",
  'INTENDED_ID');
 candidate=once(candidate,
  "sh.getRange(1,1,1,13).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산','외화단가','매입환율']]);",
  "sh.getRange(1,1,1,14).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산','외화단가','매입환율','거래ID']]);",
  'HEADERS_14');
 candidate=once(candidate,
  "sh.getRange(1,1,1,13).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');",
  "sh.getRange(1,1,1,14).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');",
  'HEADER_FORMAT_14');
 candidate=once(candidate,
  "sh.getRange(2, 1, intendedRows.length, 13).setValues(_normalizeCodeRows(intendedRows, 4));",
  "sh.getRange(2, 1, intendedRows.length, 14).setValues(_normalizeCodeRows(intendedRows, 4));",
  'WRITER_14');
 candidate=once(candidate,
  "backupCleanup: tradeBackupCleanup, tradeFxMetadataVersion: 1 });",
  "backupCleanup: tradeBackupCleanup, tradeFxMetadataVersion: 1, tradeLedgerProtocolVersion:2, ledgerRevision:v2Check.nextRevision });",
  'WRITE_ACK');
 candidate=once(candidate,
  "...(fx.length ? {priceRaw:fx[0],fxRateAtBuy:fx[1]} : {})",
  "...(fx.length ? {priceRaw:fx[0],fxRateAtBuy:fx[1]} : {}),\n          ...(r[13] ? {id:String(r[13])} : {})",
  'READ_ID');
 // Source and Snapshot are verified before pending is cleared.
 // Persist a v2-specific receipt proof here so a hard stop between pending
 // clear and outer receipt COMPLETE cannot strand STARTED forever. This is
 // inside the existing trade writer, never a separate unguarded write path.
 candidate=once(candidate,
  "    if (affectedFrom || pendingSnapshotRebuild) {\n      _recordTradeLedgerFingerprint_(ss);\n      _clearPendingTradeSnapshotRebuild();\n    } else {\n      _recordTradeLedgerFingerprint_(ss);\n    }",
  "    if (affectedFrom || pendingSnapshotRebuild) {\n      _recordTradeLedgerFingerprint_(ss);\n      _tradeV2CheckpointVerified_(tradeV2Meta,ss,affectedFrom,affectedTo);\n      _clearPendingTradeSnapshotRebuild();\n    } else {\n      _recordTradeLedgerFingerprint_(ss);\n      _tradeV2CheckpointVerified_(tradeV2Meta,ss,affectedFrom,affectedTo);\n    }",
  'V2_DURABLE_AFTER_SNAPSHOT_CHECKPOINT');
 // A legitimate last-trade deletion leaves an N-column header and zero
 // data rows. Still return the empty-ledger revision so receipt/CAS can
 // acknowledge deletion and the next create.
 candidate=once(candidate,
  "    if (!sh || sh.getLastRow() < 2) return jsonOk({ trades: [] });",
  "    if (!sh) return jsonOk({ trades: [], tradeFxMetadataVersion:1, tradeLedgerProtocolVersion:0, ledgerRevision:'' });\n    if (sh.getLastRow() < 2) return jsonOk({ trades:[], tradeFxMetadataVersion:1, tradeLedgerProtocolVersion:sh.getLastColumn()>=14?2:0, ledgerRevision:sh.getLastColumn()>=14?_tradeV2Revision_([]):'' });",
  'EMPTY_14_READ');
 candidate=once(candidate,
  "return jsonOk({ trades: trades, tradeFxMetadataVersion: 1 });",
  "return jsonOk({ trades: trades, tradeFxMetadataVersion: 1,\n      tradeLedgerProtocolVersion:numCols>=14?2:0,\n      ledgerRevision:numCols>=14?_tradeV2Revision_(data):'' });",
  'READ_REVISION');
 // Deliberately separate v2 route. The legacy syncTrades action is blocked
 // before writing by the mandatory v2 metadata gate in handleSyncTrades.
 candidate=once(candidate,
  "  if (params.action === 'syncTrades'           && params.data) return handleSyncTrades(params.data, params.rebuildFrom || '', params.explicitEmpty === '1');",
  "  if (params.action === 'syncTradesV2' && params.data) return handleTradeSyncV2WithReceipt_(params);\n  if (params.action === 'syncTrades'           && params.data) return handleSyncTrades(params.data, params.rebuildFrom || '', params.explicitEmpty === '1');",
  'V2_POST_ROUTE');
 candidate=once(candidate,
  "  if (params.action === 'getPortfolioSyncReceipt') return handleGetPortfolioSyncReceipt(params);",
  "  if (params.action === 'getPortfolioSyncReceipt' && params.kind === 'syncTradesV2') return handleTradeV2ReceiptReadOnly_(params);\n  if (params.action === 'getPortfolioSyncReceipt') return handleGetPortfolioSyncReceipt(params);",
  'V2_RECEIPT_LOOKUP_ROUTE');
 candidate=once(candidate,
  "  if (params.action === 'getPortfolioSyncReceipt') return handleGetPortfolioSyncReceipt(params);",
  "  if (params.action === 'previewTradeLedgerV2Migration') return handlePreviewTradeLedgerV2Migration_();\n  if (params.action === 'getPortfolioSyncReceipt') return handleGetPortfolioSyncReceipt(params);",
  'V2_MIGRATION_READONLY_ROUTE');
 // The existing Snapshot worker stamps a durable completion proof only
 // when it can see a pending receipt. Include v2 PARTIAL/STARTED receipts;
 // otherwise an interrupted v2 write could never safely recover its ACK.
 candidate=once(candidate,
  "      if (key.indexOf(PORTFOLIO_SYNC_RECEIPT_PREFIX)!==0) return false;\n      try {var receipt=JSON.parse(all[key]);return receipt.kind==='syncTrades' && receipt.state==='PARTIAL';}",
  "      if (key.indexOf(PORTFOLIO_SYNC_RECEIPT_PREFIX)!==0 && key.indexOf(TRADE_V2_RECEIPT_PREFIX)!==0) return false;\n      try {var receipt=JSON.parse(all[key]);return (receipt.kind==='syncTrades' && receipt.state==='PARTIAL') || (receipt.kind==='syncTradesV2' && (receipt.state==='PARTIAL' || receipt.state==='STARTED'));}",
  'V2_WORKER_SNAPSHOT_PROOF');
 // Bootstrap must advertise the ACTUAL migrated schema and ledger
 // revision from the same getTrades read (not a static v9.285 capability).
 // An 11/13-column server must never authorize v2 browser writes.
 candidate=once(candidate,
  "      tradeFxMetadataVersion: 1,\n      codeMasterSourceId: _portfolioCodeMasterSourceIdentity_(ss),",
  "      tradeFxMetadataVersion: 1,\n      tradeLedgerProtocolVersion:tradesOk?Number(tradesResponse.tradeLedgerProtocolVersion||0):0,\n      ledgerRevision:tradesOk?String(tradesResponse.ledgerRevision||''):'',\n      codeMasterSourceId: _portfolioCodeMasterSourceIdentity_(ss),",
  'BOOTSTRAP_ACTUAL_V2_REVISION');
 // Fold in the previously independent fund no-op optimization.
 const oldFund=[
  "  // 검증과 외부 조회를 모두 마친 뒤 누락만 추가합니다. 재시도는 기존 저장값을 사용합니다.",
  "  // 외부 HTTP·NAV 파싱·평가 계산은 lock 밖에서 완료합니다.",
  "  // 동시 실행에서 중복 추가를 막기 위해 쓰기 직전 최신 상태를 다시 읽습니다.",
  "  var writeLock = LockService.getScriptLock();"
 ].join('\n');
 const fundNoop=[
  "  // Exact no-op avoids duplicate NAV reads and writer-lock contention.",
  "  if (values.length === 0) {",
  "    _fundRecoveryDiagnosticStart(diagnostic, onlyCode, 'resultAggregate', '_refreshFundValuations');",
  "    var unchanged = {",
  "      continuation:false, deferredSnapshotDates:0,",
  "      completionStatus:Object.keys(fundResults).some(function(code) {",
  "        return fundResults[code].status !== 'ok';",
  "      }) ? 'partial' : 'ok',",
  "      saved:0, navSaved:0, snapshots:0,",
  "      processing:{",
  "        nav:{processed:0,pending:Object.keys(fundResults).reduce(function(sum,code) {",
  "          return sum + Number(fundResults[code].navMissing || 0);",
  "        },0)},",
  "        priceHistory:{processed:0,pending:0},",
  "        snapshots:{processed:0,pending:0,reasons:[]}",
  "      },",
  "      missingHoldings:[],snapshotWarnings:[],lastDate:'',fundResults:fundResults",
  "    };",
  "    _fundRecoveryDiagnosticFinish(diagnostic,'end');",
  "    return unchanged;",
  "  }"
 ].join('\n')+'\n';
 candidate=once(candidate,oldFund,fundNoop+oldFund,'FUND_NOOP');
 // The source-only 13-column builder remains an input for legacy FX
 // parsing, NOT an independently releasable writer. Every 14-column output
 // must prove that the lossy account/stock-group heuristic was removed.
 const writerStart=candidate.indexOf('function handleSyncTrades(');
 const writerEnd=candidate.indexOf('\n}',writerStart);
 if(writerStart<0||writerEnd<=writerStart)
   throw Error('TRADE_V2_WRITER_MISSING');
 const writerBody=candidate.slice(writerStart,writerEnd+2);
 if(/previousFxGroups|oldOrdinaryCounts|TRADE_FX_GROUP_/.test(writerBody))
   throw Error('TRADE_V2_UNSAFE_13_COLUMN_HEURISTIC_PRESENT');
 if(!writerBody.includes('_tradeV2ValidateMutation_(')
     || !writerBody.includes('Math.min(14, sh.getLastColumn())')
     || !writerBody.includes('t.id||')
     || !writerBody.includes('intendedRows.length, 14)'))
   throw Error('TRADE_V2_WRITER_ID_CAS_INVARIANT_MISSING');
 const manifest={...original.manifest,
  candidateSourceGitBlob:blob(candidate),tradeLedgerProtocolVersion:2,
  columns:14,legacy13ColumnWriterExcluded:true,
  finalWriterRequiresIdCas:true,features:['fx-original-price','immutable-trade-id','CAS',
    'explicit-create-update-delete','fund-noop','migration-readonly-preview'],
  requiresReceiptImplementation:false,requiresLegacyMigration:true,
  status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',productionDeploymentApproved:false,
  gasProjectWrites:0,financeWrites:0};
 return {base:original.base,candidate,manifest};
}
