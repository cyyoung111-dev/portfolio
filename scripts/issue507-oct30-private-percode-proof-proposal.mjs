// Source-only proposal. It is NOT wired into doPost, GAS, or any writer.
// The return object intentionally has no individual code/price or digest.
export const DAY='2026-10-30';
export const APPROVED_GAS_BLOB='9c1a5f31d1abc4b44f7da9af7a50fe3f15967134';
export const PRIVATE_GAS_FUNCTION=String.raw`
function _issue507Oct30PrivateQuoteProof_(date,held,snapshotRows,historyRows,quotes){
  if(typeof _issue507GateInside_!=='undefined'&&!_issue507GateInside_)
    return _issue507GateInvoke_('_issue507Oct30PrivateQuoteProof_',_issue507Oct30PrivateQuoteProof_,this,arguments);
  var day='2026-10-30',carry='KRX_CARRY@2026-10-29',fundCodes={F00001:true,F00002:true};
  function reject(code){throw new Error('ISSUE507_QUOTE_PROOF_'+code);}
  function code(v){return _cleanCode(v||'');}
  function asDate(v){return _normalizeDate(v||'');}
  function num(v){return Number(String(v===null||v===undefined?'':v).replace(/,/g,'').trim());}
  if(date!==day||!Array.isArray(held)||held.length!==37
      ||!Array.isArray(snapshotRows)||snapshotRows.length!==39
      ||!Array.isArray(historyRows)||historyRows.length!==2
      ||!quotes||typeof quotes!=='object'||Array.isArray(quotes))reject('INVALID_SCOPE');
  var expected={},stock=0,etf=0;
  held.forEach(function(item){
    var c=code(item&&item.code);
    if(!/^[A-Z0-9]{6}$/.test(c)||fundCodes[c]||expected[c]||!_isKrxDailyCloseTarget_(item))
      reject('INVALID_HELD');
    expected[c]=true;
    if(String(item.type||'').toUpperCase()==='ETF'
        ||String(item.market||'').toUpperCase()==='ETF')etf++;
    else stock++;
  });
  if(stock!==16||etf!==21)reject('MARKET_SCOPE_DRIFT');
  var seen={},carried=0,funds=0;
  snapshotRows.forEach(function(row){
    if(!Array.isArray(row)||asDate(row[0])!==day)reject('SNAPSHOT_DATE');
    var c=code(row[1]),src=String(row[10]||'').trim();
    if(!c||seen[c])reject('SNAPSHOT_DUPLICATE');
    seen[c]=true;
    if(expected[c]){
      if(src!==carry||!(num(row[3])>0)||!(num(row[6])>0))reject('SNAPSHOT_CARRY_CHANGED');
      carried++;
    }else if(fundCodes[c]){
      if(src!=='FUND_NAV'||!(num(row[6])>0)||!(num(row[7])>0))reject('FUND_SNAPSHOT_CHANGED');
      funds++;
    }else reject('SNAPSHOT_UNEXPECTED_CODE');
  });
  if(carried!==37||funds!==2)reject('SNAPSHOT_INCOMPLETE');
  var seenNav={};
  historyRows.forEach(function(row){
    if(!Array.isArray(row)||asDate(row[0])!==day)reject('HISTORY_DATE');
    var c=code(row[1]);
    if(!fundCodes[c]||seenNav[c]||String(row[5]||'').trim()!=='FUND_NAV'
        ||!(num(row[3])>0))reject('HISTORY_NOT_FUND_ONLY');
    seenNav[c]=true;
    var snap=snapshotRows.filter(function(s){return code(s[1])===c;})[0];
    if(!snap||num(snap[6])!==num(row[3]))reject('FUND_NAV_MISMATCH');
  });
  if(!seenNav.F00001||!seenNav.F00002)reject('FUND_HISTORY_MISSING');
  var keys=Object.keys(quotes);
  if(keys.length!==37)reject('SOURCE_COUNT');
  keys.forEach(function(c){
    if(!expected[c])reject('SOURCE_UNEXPECTED_CODE');
  });
  Object.keys(expected).forEach(function(c){
    var q=quotes[c],used=asDate(q&&q.usedDate),src=String(q&&q.source||'').toUpperCase();
    if(!q||used!==day||(src!=='KRX'&&src!=='KRX_OTP')
        ||!(num(q.price)>0)||!isFinite(num(q.price)))reject('SOURCE_NOT_EXACT');
  });
  return {mode:'ISSUE507_OCT30_PRIVATE_KRX_QUOTE_PROOF',date:day,
    status:'PER_CODE_SOURCE_AND_STORAGE_SCOPE_VERIFIED',
    snapshotRows:39,domesticCarriedRows:37,fundNavRowsPreserved:2,
    domesticExactPriceHistoryRows:0,verifiedPrivateQuoteCount:37,
    stockConfirmed:16,etfConfirmed:21,
    individualQuoteValuesDisclosed:false,codeListDisclosed:false,
    historicalNhFailureReasonProven:false,physicalBackupVerified:false,
    safeToWrite:false,gasDeployed:false,financialWrites:0};
}
`;
