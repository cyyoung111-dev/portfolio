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
  '      if (existing.length !== rawExisting.length) {',
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
 candidate=candidate.slice(0,start)+refresh+candidate.slice(end);
 candidate=replace(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.305',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.306');
 candidate=candidate.replace(/(gasVersion:\s*['"])9\.305(['"])/g,(_m,p,s)=>p+'9.306'+s);
 candidate=replace(candidate,"var ISSUE507_GATE_API_VERSION='9.305'","var ISSUE507_GATE_API_VERSION='9.306'");
 return {parent,candidate,manifest:{version:'9.306',parentGitBlob:parentBlob,candidateGitBlob:blob(candidate)}};
}
