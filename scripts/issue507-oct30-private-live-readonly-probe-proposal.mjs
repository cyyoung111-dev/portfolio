// Issue #507 — SOURCE-ONLY private GAS candidate. Not routed in doGet/doPost.
// Production GAS at src/gas/apps_script.gs is intentionally unchanged.
// Reads official KRX 2026-10-30 close ONCE, verifies 37 individual quotes in
// protected server memory, returns counts ONLY. No prices, codes, quantities,
// account rows, digests, or source responses may be printed or returned.
export const DAY='2026-10-30';
export const FROZEN_GAS_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const PRIVATE_LIVE_READONLY_FUNCTION=String.raw`
function _issue507Oct30PrivateLiveReadOnlyProof_(){
  // INTERNAL ONLY: no public action, doPost routing, trigger, writer, or release.
  var date='2026-10-30';
  function reject(why){throw new Error('ISSUE507_OCT30_LIVE_PROOF_'+why);}
  var ss=getss(),catalog=getCodeItems(ss,true);
  if(!catalog||!Array.isArray(catalog)||!catalog.length)reject('MASTER_EMPTY');
  var held=_getDailyHeldCodeItems(ss,date,catalog).filter(_isKrxDailyCloseTarget_);
  if(held.length!==37)reject('HELD_SCOPE');
  var snap=ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  var ph=ss.getSheetByName(CONFIG.SHEET_PH);
  if(!snap||!ph)reject('SHEET_MISSING');
  function datedRows(sheet,width){
    var end=Number(sheet.getLastRow()),cols=Number(sheet.getLastColumn());
    if(!isFinite(end)||end<2||end>100000||cols<width)reject('SHEET_SHAPE');
    var all=sheet.getRange(2,1,end-1,width).getValues();
    if(!Array.isArray(all)||all.length!==end-1)reject('SHEET_READ');
    return all.filter(function(row){
      if(!Array.isArray(row)||row.length!==width)reject('ROW_SHAPE');
      return _normalizeDate(row[0])===date;
    });
  }
  // The same 39+2 target rows must remain identical before and after the
  // official source call, otherwise fail closed. This is NOT global CAS proof.
  var snapBefore=datedRows(snap,12),phBefore=datedRows(ph,6);
  if(snapBefore.length!==39||phBefore.length!==2)reject('TARGET_SCOPE');
  var quotes=fetchPricesKrx(held,date);
  var proof=_issue507Oct30PrivateQuoteProof_(
    date,held,snapBefore,phBefore,quotes);
  if(!proof||proof.safeToWrite!==false
      ||proof.status!=='PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED'
      ||proof.verifiedPrivateQuoteCount!==37
      ||proof.stockConfirmed!==16||proof.etfConfirmed!==21
      ||proof.domesticExactPriceHistoryRows!==0
      ||proof.individualQuoteValuesDisclosed!==false
      ||proof.codeListDisclosed!==false)reject('QUOTE_PROOF');
  var snapAfter=datedRows(snap,12),phAfter=datedRows(ph,6);
  if(JSON.stringify(snapBefore)!==JSON.stringify(snapAfter)
      ||JSON.stringify(phBefore)!==JSON.stringify(phAfter))
    reject('TARGET_CHANGED_DURING_READ');
  return {
    mode:'ISSUE507_OCT30_PRIVATE_SINGLE_PASS_KRX_SOURCE',
    date:date,status:'SOURCE_ONLY_PRIVATE_PROOF',
    expectedHeldCodes:37,stockConfirmed:16,etfConfirmed:21,
    officialExactDatePerCodeVerified:37,
    physicalSnapshotRowsRead:39,physicalExistingHistoryRowsRead:2,
    targetRowsStableWithinRead:true,
    noIndividualQuoteOrCodeDisclosed:true,
    doesNotProveLedgerCostQty:true,
    doesNotProveBackupOrGate:true,
    pendingRecoveryCount:37,
    deployAuthorized:false,writeAuthorized:false,
    financialWrites:0,nhTokenRequests:0
  };
}
`;
