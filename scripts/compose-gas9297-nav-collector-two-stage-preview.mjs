// Source-only 9.297 proposal. Never change the pinned 9.285 baseline or publish GAS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9296TradeUtf8Preview} from './compose-gas9296-trade-utf8-preview.mjs';

const PARENT_BLOB='e7dfcc8a1ad194e4a0ef586b83b7df66a83dd2c6';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1')
  .update('blob '+b.length+'\0').update(b).digest('hex');};
function once(source,before,after,label){
 assert.equal(source.split(before).length,2,'GAS9297_NAV_SOURCE_DRIFT:'+label);
 return source.replace(before,after);
}
export function composeGas9297NavCollectorTwoStagePreview(){
 const parent=composeGas9296TradeUtf8Preview().candidate;
 assert.equal(blob(parent),PARENT_BLOB,'GAS9297_NAV_UNREVIEWED_9296_PARENT');
 let candidate=parent;
 candidate=once(candidate,
  "return mode === 'import' ? handleImportFundNav(dataJson)\n      : handleRefreshFundValuations(date,date,code,'',true);",
  "return mode === 'import' ? handleImportFundNav(dataJson, true)\n      : handleRefreshFundValuations(date,date,code,'',true);",'COLLECTOR');
 candidate=once(candidate,
  'function handleImportFundNav(dataJson) {',
  'function handleImportFundNav(dataJson, collectorNavOnly) {','IMPORT_SIGNATURE');
 candidate=once(candidate,
  'var evaluation = _applyFundNavImport(ss, inspected, diagnostic);',
  'var evaluation = _applyFundNavImport(ss, inspected, diagnostic, collectorNavOnly === true);',
  'APPLY_CALL');
 candidate=once(candidate,
  'function _applyFundNavImport(ss, inspected, diagnostic) {',
  'function _applyFundNavImport(ss, inspected, diagnostic, collectorNavOnly) {',
  'APPLY_SIGNATURE');
 candidate=once(candidate,
  '  var derived = _fundDerivedState(ss, configs);\n  function impactEnd(date) {',
  [
   '  // Guarded automatic collectors save official NAV first; each date is',
   '  // repaired/verified by the existing independent derived-value workflow.',
   '  // Manual NAV imports keep their complete synchronous path.',
   '  var derived = collectorNavOnly === true ? {priceKeys: {}, snapshotKeys: {}} : _fundDerivedState(ss, configs);',
   '  function impactEnd(date) {'
  ].join('\n'),'DERIVED_SCAN');
 const navMarker=[
  '  if (Object.keys(changedNav).length) {',
  "    if (!navSheet) { navSheet = ss.insertSheet(FUND_NAV_SHEET); navSheet.appendRow(['일자','종목코드','종목명','기준가격(1000좌)','가격공시일','좌수','평가금액','조회일시','클래스']); }",
  "    diagnostic.persisted.navWrite = _runFundImportStage(diagnostic, inspected.code, 'navWrite', '_writeFundImportRows', function() {",
  '      return _writeFundImportRows(ss, navSheet, navUpdates, navAppends, 9);',
  '    });',
  '  }',
  ''
 ].join('\n');
 const separate=[
  '  if (collectorNavOnly === true) {',
  '    // Only exact source NAV is committed here. Collector readback must prove',
  '    // persisted date+NAV before independently refreshing price/Snapshot.',
  '    // An uncertain acknowledgement must never cause a second import.',
  '    return {',
  "      from: affected[0] || '', to: affected[affected.length-1] || '',",
  '      processed: daily.length, total: Object.keys(imported).length,',
  '      navCount: Object.keys(imported).length,',
  '      valuations: 0, prices: 0, snapshots: 0,',
  '      processing: {',
  '        nav: {processed: daily.length, pending: 0},',
  '        priceHistory: {processed: 0, pending: daily.length},',
  '        snapshots: {processed: 0, pending: daily.length, reasons: []}',
  '      },',
  '      missingHoldings: [], ranges: ranges, persisted: diagnostic.persisted,',
  '      capacity: {before: capacityBefore, after: _fundSheetCapacity(ss)},',
  '      derivedDeferred: true',
  '    };',
  '  }',
  ''
 ].join('\n');
 const start=candidate.indexOf('function _applyFundNavImport('),end=candidate.indexOf('function handleCollectKbFundNav(',start);
 assert(start>0&&end>start,'GAS9297_NAV_APPLY_SCOPE');
 const part=candidate.slice(start,end);
 assert.equal(part.split(navMarker).length,2,'GAS9297_NAV_WRITE_ANCHOR');
 candidate=candidate.slice(0,start)+part.replace(navMarker,navMarker+'\n'+separate+'\n')+candidate.slice(end);
 candidate=once(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.296',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.297','VERSION_BANNER');
 const versionCount=candidate.split("gasVersion: '9.296'").length-1;
 assert(versionCount>=5&&versionCount<=24,'GAS9297_NAV_VERSION_COUNT:'+versionCount);
 candidate=candidate.replaceAll("gasVersion: '9.296'","gasVersion: '9.297'");
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.296'",
  "var ISSUE507_GATE_API_VERSION='9.297'",'GATE_VERSION');
 return {parent,candidate,manifest:{
  version:'9.297',parentVersion:'9.296',parentGitBlob:PARENT_BLOB,
  candidateGitBlob:blob(candidate),
  changedBusinessFunctions:['handleCollectKbFundNav','handleImportFundNav','_applyFundNavImport'],
  mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,
  requiresExplicitVersionReleaseGate:true,gasProjectWrites:0,financialWrites:0,
  manualNavImportPreserved:true,noImportRetry:true,
  derivedPerDateUnderExistingLease:true
 }};
}
