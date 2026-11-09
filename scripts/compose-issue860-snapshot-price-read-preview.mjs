// #860 read-only, source-only proposal: one consistent PriceHistory read
// for both price and source metadata within one Snapshot builder invocation.
// Never cache between dates, executions, writes, or independent integrity runs.
import assert from 'node:assert/strict';
function fnEdit(source,name,transform) {
 const a=source.indexOf('function '+name+'(');
 assert(a>=0,'ISSUE860_READ_MISSING_FUNCTION:'+name);
 const z=source.indexOf('\n}',a);
 assert(z>a,'ISSUE860_READ_BAD_BOUNDARY:'+name);
 const old=source.slice(a,z+2),next=transform(old);
 assert.notEqual(next,old,'ISSUE860_READ_NO_CHANGE:'+name);
 return source.slice(0,a)+next+source.slice(z+2);
}
function once(input,a,b,stage) {
 assert.equal(input.split(a).length,2,'ISSUE860_READ_ANCHOR_DRIFT:'+stage);
 return input.replace(a,b);
}
export function composeIssue860SnapshotPriceReadPreview(source) {
 assert.equal(typeof source,'string');
 let s=fnEdit(source,'getPriceHistoryRow',orig=>{
  let f=once(orig,
   'function getPriceHistoryRow(ss, dateStr, throwOnError) {',
   'function getPriceHistoryRow(ss, dateStr, throwOnError, prefetchedHistoryRows) {','PRICE_SIGNATURE');
  f=once(f,
   '    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();',
   '    var data = Array.isArray(prefetchedHistoryRows) ? prefetchedHistoryRows : ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();',
   'PRICE_READ');
  return f;
 });
 s=fnEdit(s,'_getPriceSourceByDate',orig=>{
  let f=once(orig,
   'function _getPriceSourceByDate(ss, dateStr, throwOnError) {',
   'function _getPriceSourceByDate(ss, dateStr, throwOnError, prefetchedHistoryRows) {','SOURCE_SIGNATURE');
  f=once(f,
   '    var data = ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(6, ph.getLastColumn())).getValues();',
   '    var data = Array.isArray(prefetchedHistoryRows) ? prefetchedHistoryRows : ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(6, ph.getLastColumn())).getValues();',
   'SOURCE_READ');
  return f;
 });
 s=fnEdit(s,'_buildSnapshotRowsFromTradeAndPriceHistory',orig=>{
  let f=once(orig,
   '    var prices = getPriceHistoryRow(ss, dateStr, throwOnError);',
   [
    '    // #860 one fresh full-history read PER build, never across independent',
    '    // valuation/diagnostic passes or a later price write.',
    '    var priceShForSnapshot = ss.getSheetByName(CONFIG.SHEET_PH);',
    '    var sharedPriceHistoryRows = priceShForSnapshot && priceShForSnapshot.getLastRow() > 1',
    '      ? priceShForSnapshot.getRange(2, 1, priceShForSnapshot.getLastRow() - 1,',
    '          Math.max(6, priceShForSnapshot.getLastColumn())).getValues() : [];',
    '    var prices = getPriceHistoryRow(ss, dateStr, throwOnError, sharedPriceHistoryRows);'
   ].join('\n'),
   'BUILD_PREFETCH');
  f=once(f,
   '    var sourceMap = _getPriceSourceByDate(ss, dateStr, throwOnError);',
   '    var sourceMap = _getPriceSourceByDate(ss, dateStr, throwOnError, sharedPriceHistoryRows);',
   'BUILD_SOURCE');
  return f;
 });
 return {source:s,base:source,changedFunctions:[
  'getPriceHistoryRow','_getPriceSourceByDate','_buildSnapshotRowsFromTradeAndPriceHistory'
 ],expectedHistoryBulkReadsPerBuild:{before:2,after:1},
  label:'SOURCE_ONLY_NOT_DEPLOYABLE',financeWrites:0,gasDeployments:0,telegramSends:0};
}
