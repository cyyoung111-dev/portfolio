import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9305NhAccountScopePreview} from './compose-gas9305-nh-account-scope-preview.mjs';

const parentBlob='ed000678f26f1c3018880b7a556d5fb033328342';
const blob=source=>{const bytes=Buffer.from(source,'utf8');return createHash('sha1')
 .update('blob '+bytes.length+'\0').update(bytes).digest('hex');};
function replace(source,before,after){
 assert.equal(source.split(before).length,2,'GAS9306_SOURCE_DRIFT: '+before.split('\n')[0]);
 return source.replace(before,after);
}

export function composeGas9306NavRefreshPreview(){
 const {candidate:parent}=composeGas9305NhAccountScopePreview();
 assert.equal(blob(parent),parentBlob,'GAS9306_UNREVIEWED_PARENT');
 let candidate=replace(parent,"handleRefreshFundValuations(date,date,code,'',true);",
  "handleRefreshFundValuations(date,date,code,'',true,true);");
 candidate=replace(candidate,
  'function handleRefreshFundValuations(from, to, code, diagnosticFlag, storedOnly) {',
  'function handleRefreshFundValuations(from, to, code, diagnosticFlag, storedOnly, collectorDerivedOnly) {');
 candidate=replace(candidate,
  'var result = _refreshFundValuations(getss(), from, to, code || undefined, storedOnly === true, diagnostic);',
  'var result = _refreshFundValuations(getss(), from, to, code || undefined, storedOnly === true, diagnostic, collectorDerivedOnly === true ? 1 : undefined, undefined, collectorDerivedOnly === true);');
 candidate=replace(candidate,
  'function _refreshFundValuations(ss, from, to, onlyCode, skipExternal, diagnostic, maxSnapshotWrites, storedOnlyProviders) {',
  'function _refreshFundValuations(ss, from, to, onlyCode, skipExternal, diagnostic, maxSnapshotWrites, storedOnlyProviders, collectorDerivedOnly) {');
 const start=candidate.indexOf('function _refreshFundValuations(');
 const end=candidate.indexOf('\n}',start)+2;
 assert(start>=0&&end>start);
 let refresh=candidate.slice(start,end);
 refresh=replace(refresh,
  "  _fundDate(from); _fundDate(to);",
  "  _fundDate(from); _fundDate(to);\n  if (collectorDerivedOnly && (from !== to || !onlyCode || !skipExternal)) throw new Error('FUND_DERIVED_SCOPE_UNVERIFIED');");
 refresh=replace(refresh,'  if (newNav.length) {',[
  '  if (collectorDerivedOnly && (navChanged || newNav.length))',
  "    throw new Error('FUND_DERIVED_STORED_NAV_UNVERIFIED');",
  '  if (newNav.length) {'
 ].join('\n'));
 refresh=replace(refresh,[
  '    var existing = _filterSnapshotRowsByFundLifecycle(_readSnapshotRowsByDate(ss, date), configs, date);',
  '    var rebuilt = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true);',
  '    var combined = _mergeSnapshotRowsSafely(rebuilt, byDate[date], true);',
  '    combined = _mergeSnapshotRowsSafely(existing, combined, true);',
  '    var holdings = calcHoldingsAtDate(trades, date, nameCodes);',
  '    _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, date);'
 ].join('\n'),[
  '    var rawExisting = _readSnapshotRowsByDate(ss, date);',
  '    var existing = _filterSnapshotRowsByFundLifecycle(rawExisting, configs, date);',
  '    var holdings = calcHoldingsAtDate(trades, date, nameCodes);',
  '    _applyFundUnitLifecycleToSnapshotHoldings(holdings, configs, date);',
  '    var combined;',
  '    if (collectorDerivedOnly && rawExisting.length) {',
  '      // The automatic collector owns one fund, not other historical valuations.',
  '      // The price close/backfill remains the owner of incomplete portfolio days.',
  '      combined = _mergeSnapshotRowsSafely(existing, byDate[date], true);',
  '      if (existing.length !== rawExisting.length || existing.some(function(row) {',
  '        return !row[1] && row[2] === byDate[date][0][2];',
  '      })) {',
  "        missingHoldings.push(date + ':FUND_DERIVED_LIFECYCLE_CONFLICT'); return;",
  '      }',
  '    } else {',
  '      // A new date still requires a full portfolio valuation from source.',
  '      var rebuilt = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true);',
  '      combined = _mergeSnapshotRowsSafely(rebuilt, byDate[date], true);',
  '      combined = _mergeSnapshotRowsSafely(existing, combined, true);',
  '    }'
 ].join('\n'));
 refresh=replace(refresh,
  '  try { Object.keys(byDate).sort(function(a,b)',
  '  var collectorSnapshotLocked = false;\n  try {\n    if (collectorDerivedOnly && Object.keys(byDate).length) {\n      writeLock.waitLock(30000); collectorSnapshotLocked = true;\n    }\n    Object.keys(byDate).sort(function(a,b)');
 refresh=replace(refresh,
  '  } finally { _snapshotBackupOperationId = previousSnapshotOperationId; }',
  '  } finally {\n    _snapshotBackupOperationId = previousSnapshotOperationId;\n    if (collectorSnapshotLocked) writeLock.releaseLock();\n  }');
 refresh=replace(refresh,
  "    if (fundRewritePlan.unsafe.length) {",
  "    if (fundRewritePlan.unsafe.length || (collectorDerivedOnly && existing.length && fundRewritePlan.duplicateGroups.some(function(group) { return group.key !== onlyCode; }))) {");
 refresh=replace(refresh,
  '    writeSnapshotRows(ss, date, combined, true, null, configs);',
  '    writeSnapshotRows(ss, date, combined, true, null, configs, false, collectorDerivedOnly && existing.length ? onlyCode : undefined);');
 for(const target of [
  "          _verifyWrittenRange(ph,first+2,1,batch,'펀드 가격이력 쓰기 후 검증 실패');",
  "    if (scopedPriceWrite) _verifyWrittenRange(ph,appendAt,1,normalizedAppend,'펀드 가격이력 추가 후 검증 실패');"
 ]){
  refresh=replace(refresh,target,target.replace("검증 실패');","검증 실패', true);"));
 }
 candidate=candidate.slice(0,start)+refresh+candidate.slice(end);
 candidate=replace(candidate,
  'function _verifyWrittenRange(sheet, row, column, values, message) {',
  'function _verifyWrittenRange(sheet, row, column, values, message, priceHistoryDates) {');
 candidate=replace(candidate,
  "  if (JSON.stringify(actual) !== JSON.stringify(values)) throw new Error(message || '쓰기 후 read-back 검증 실패');",
  [
   '  if (priceHistoryDates) {',
   '    actual = actual.map(function(found, index) {',
   '      var expected = values[index], normalized = found.slice();',
   '      if (!expected) return normalized;',
   '      if (_normalizeDate(found[0]) && _normalizeDate(found[0]) === _normalizeDate(expected[0])) normalized[0] = expected[0];',
   "      if (found[4] instanceof Date && typeof expected[4] === 'string' && found[4].getTime() === Date.parse(expected[4])) normalized[4] = expected[4];",
   '      return normalized;',
   '    });',
   '  }',
   "  if (JSON.stringify(actual) !== JSON.stringify(values)) throw new Error(message || '쓰기 후 read-back 검증 실패');"
  ].join('\n'));
 candidate=replace(candidate,
  'function writeSnapshotRows(ss, dateStr, newRows, overwrite, manualKeys, lifecycleConfigs, allowEmptyOverwrite) {',
  'function writeSnapshotRows(ss, dateStr, newRows, overwrite, manualKeys, lifecycleConfigs, allowEmptyOverwrite, onlyCode) {');
 candidate=replace(candidate,
  "      snapshotWriteTimingMark('date_write_start');\n      _writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize);",
  "      snapshotWriteTimingMark('date_write_start');\n      _writeSnapshotDateScoped_(ss, sh, normDate, existing, mergedDate, colSize, onlyCode);");
 candidate=replace(candidate,
  'function _writeSnapshotDateScoped_(ss, sheet, date, existing, desired, width) {',
  'function _writeSnapshotDateScoped_(ss, sheet, date, existing, desired, width, onlyCode) {');
 candidate=replace(candidate,
  "    var replacement = candidates.length ? candidates.shift() : Array(width).fill('');",
  [
   "    var replacement = candidates.length ? candidates.shift() : Array(width).fill('');",
   '    if (onlyCode && key !== onlyCode) {',
   '      if (_snapshotComparableSignature(replacement) !== _snapshotComparableSignature(slot.before))',
   "        throw new Error('FUND_SNAPSHOT_OUTSIDE_TARGET_UNVERIFIED');",
   '      return;',
   '    }'
  ].join('\n'));
 candidate=replace(candidate,
  '  if (pending.length) {\n    var appendRow = originalLastRow + 1;',
  "  if (pending.length) {\n    if (onlyCode && pending.some(function(row) { return _snapshotIntegrityKey(row) !== onlyCode; }))\n      throw new Error('FUND_SNAPSHOT_APPEND_OUTSIDE_TARGET_UNVERIFIED');\n    var appendRow = originalLastRow + 1;");
 candidate=replace(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.305',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.306');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.305(['"])/g,(_m,p,s)=>p+'9.306'+s);
 candidate=replace(candidate,"var ISSUE507_GATE_API_VERSION='9.305'","var ISSUE507_GATE_API_VERSION='9.306'");
 return {parent,candidate,manifest:{version:'9.306',parentGitBlob:parentBlob,candidateGitBlob:blob(candidate)}};
}
