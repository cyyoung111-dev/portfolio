// #860 SOURCE-ONLY successor to v9.289. During the same ScriptLock-held
// daily close, expected snapshot rows have just been constructed and passed
// through the rewrite planner. Reuse those rows for the final read-only
// integrity comparison instead of rebuilding all trade/price/NAV inputs.
// Independent persisted Snapshot re-read and price-integrity source audit
// MUST still execute. Other diagnostics remain unchanged.
// Requires new separately reviewed, pinned GAS release before deployment.
import assert from 'node:assert/strict';
import {composeIssue860Gas9289PerfCandidate} from './compose-issue860-gas9289-perf-candidate.mjs';

function editFunction(source, name, callback) {
 const a=source.indexOf('function '+name+'('), b=source.indexOf('\n}',a);
 assert(a>=0&&b>a,'ISSUE860_FINALITY_FUNCTION_MISSING:'+name);
 const original=source.slice(a,b+2);
 const changed=callback(original);
 assert.notEqual(changed,original,'ISSUE860_FINALITY_NOT_CHANGED:'+name);
 return source.slice(0,a)+changed+source.slice(b+2);
}
function once(source, before, after, label) {
 assert.equal(source.split(before).length,2,'ISSUE860_FINALITY_ANCHOR_DRIFT:'+label);
 return source.replace(before,after);
}
export function composeIssue860CloseIntegrityReusePreview(source=composeIssue860Gas9289PerfCandidate().candidate){
 assert.equal(typeof source,'string');
 assert(!source.includes('ISSUE860_PREVERIFIED_EXPECTED_ROWS'),'ISSUE860_FINALITY_ALREADY_PATCHED');
 let next=editFunction(source,'diagnoseSnapshotIntegrity',f=>{
  f=once(f,
   'function diagnoseSnapshotIntegrity(ss, dateStr, priceContext, rangeContext) {',
   'function diagnoseSnapshotIntegrity(ss, dateStr, priceContext, rangeContext, preverifiedExpectedRows) {',
   'DIAG_SIGNATURE');
  f=once(f,
   '  try { expected = rangeContext ? _buildIndexedSnapshotRows(rangeContext, date) : _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true); }',
   [
    '  try {',
    '    if (rangeContext) expected = _buildIndexedSnapshotRows(rangeContext, date);',
    '    else if (preverifiedExpectedRows !== undefined && preverifiedExpectedRows !== null) {',
    '      // ISSUE860_PREVERIFIED_EXPECTED_ROWS: exact call-local expected image,',
    '      // not arbitrary old Snapshot content or cached cross-run results.',
    '      if (!Array.isArray(preverifiedExpectedRows) || !preverifiedExpectedRows.length ||',
    '          preverifiedExpectedRows.some(function(row) {',
    '            return !Array.isArray(row) || row.length < 12 || _normalizeDate(row[0]) !== date ||',
    '              !(_cleanCode(row[1]) || String(row[1] || "").trim());',
    '          })) throw new Error("ISSUE860_INVALID_PREVERIFIED_ROWS");',
    '      var keys = {};',
    '      preverifiedExpectedRows.forEach(function(row) {',
    '        var key = _snapshotIntegrityKey(row);',
    '        if (keys[key]) throw new Error("ISSUE860_DUPLICATE_PREVERIFIED_ROWS");',
    '        keys[key] = true;',
    '      });',
    '      expected = preverifiedExpectedRows;',
    '    } else expected = _buildSnapshotRowsFromTradeAndPriceHistory(ss, date, true);',
    '  }'
   ].join('\n'),'DIAG_EXPECTED');
  return f;
 });
 next=editFunction(next,'saveDailyPriceHistory',f=>{
  return once(f,
   '      var savedIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate);',
   [
    '      // #860 use the exact same close-local expected image after planner/write.',
    '      // The diagnostic still independently re-reads persisted rows and',
    '      // validates price-source integrity; no complete marker is synthesized.',
    '      var savedIntegrity = diagnoseSnapshotIntegrity(ss, snapshotDate, undefined, undefined, expected);'
   ].join('\n'),'CLOSE_DIAG_CALL');
 });
 return {source:next,parent:source,changedFunctions:['diagnoseSnapshotIntegrity','saveDailyPriceHistory'],
  snapshotReReadRetained:true,priceIntegrityRetained:true,existingOtherCallersUnchanged:true,
  sourceOnly:true,approvedForDeploy:false,financeWrites:0,gasDeployments:0,telegramSends:0};
}
