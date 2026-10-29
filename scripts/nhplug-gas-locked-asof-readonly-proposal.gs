/*
 * DRAFT ONLY — NOT PART OF src/gas/apps_script.gs, not dispatched in doGet/doPost.
 * A future reviewed GAS v9.276+ release would need to copy/review this handler
 * and install a protected authenticated read-only action in the router.
 *
 * GAS ScriptLock coordinates cooperating GAS writers, NOT direct Sheets API
 * writers. Therefore even successful double reads are NOT globally atomic.
 * No source is marked verified; historical listing state is still unknown.
 */
function nhplugHeldAsOfReadOnlyProposal(dateInput, accessToken) {
  var lock=null, owned=false, outcome=null;
  var bad=function(reason){return {status:'error',errorCode:'NH_HELD_'+reason};};
  try {
    var configured=String(PropertiesService.getScriptProperties().getProperty('access_token')||'').trim();
    // GAS's historical auth compatibility mode allows anonymous doGet.
    // This new route must explicitly refuse that mode, even if the router
    // validates _isAuthorizedRequest before calling this handler.
    if (!configured) throw new Error('AUTH_DISABLED');
    if (!_isAuthorizedRequest({accessToken:accessToken})) throw new Error('AUTH_REQUIRED');
    var date=String(dateInput||'');
    var dt=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00Z'):null;
    if(!dt || !isFinite(dt.getTime()) || dt.toISOString().slice(0,10)!==date
        || date>today())throw new Error('DATE_INVALID');
    if(_krxCalendarStatus_(date)!=='OPEN')throw new Error('MARKET_UNVERIFIED');
    lock=LockService.getScriptLock();
    if(!lock.tryLock(5000))throw new Error('BUSY');
    owned=true;
    // A timed-out syncTrades may leave a durable WRITING journal even after
    // the ScriptLock is released. Two identical reads cannot certify that.
    if (_tradeLedgerWriteUnverified_())throw new Error('LEDGER_WRITE_UNVERIFIED');
    if (PropertiesService.getScriptProperties().getProperty(CODE_DELETE_TXN_KEY_))
      throw new Error('CODE_DELETE_PENDING');
    var ss=getss(), sh=ss.getSheetByName(CONFIG.SHEET_TRADES);
    if(!sh || sh.getLastRow()<2 || sh.getLastRow()>20001
        || sh.getLastColumn()<8)throw new Error('LEDGER_UNAVAILABLE');
    var n=sh.getLastRow()-1, width=Math.min(sh.getLastColumn(),11);
    var master1=getCodeItems(ss,true);
    if(!Array.isArray(master1)||!master1.length||master1.length>20000)
      throw new Error('MASTER_UNAVAILABLE');
    var ledger1=sh.getRange(2,1,n,width).getValues();
    if(!Array.isArray(ledger1)||ledger1.length!==n)throw new Error('LEDGER_UNAVAILABLE');
    var masters={}, names={};
    master1.forEach(function(row){
      var code=_cleanCode(row&&row.code),name=String(row&&row.name||'').trim();
      if(!code||!name||masters[code])throw new Error('MASTER_CONFLICT');
      masters[code]=row;
      if(!names[name])names[name]=[];
      names[name].push(code);
    });
    var nameToCode={};
    Object.keys(names).forEach(function(name){
      if(names[name].length===1)nameToCode[name]=names[name][0];
    });
    // Only previously known names can resolve a missing transaction code.
    // An ambiguous, unknown or malformed trade is not silently discarded.
    ledger1.forEach(function(row){
      var d=_normalizeDate(row[0]),name=String(row[3]||'').trim();
      if(!d){
        if(row.some(function(value){return value!=='' && value!==null && value!==undefined;}))throw new Error('TRADE_DATE_UNVERIFIED');
        return;
      }
      if(d>date)return;
      var raw=String(row[4]||'').trim(),code=_cleanCode(raw);
      if(raw && !code)throw new Error('TRADE_CODE_UNVERIFIED');
      if(!code && (!name||!nameToCode[name]))throw new Error('TRADE_CODE_UNVERIFIED');
      var t=String(row[1]||'').trim();
      if(['buy','sell','split','reverse_split'].indexOf(t)<0)
        throw new Error('TRADE_TYPE_UNVERIFIED');
      if(!isFinite(Number(row[5]))||Number(row[5])<0)
        throw new Error('TRADE_QTY_UNVERIFIED');
      if((t==='split'||t==='reverse_split') && (!isFinite(Number(row[9])) || !(Number(row[9])>0)))
        throw new Error('TRADE_RATIO_UNVERIFIED');
    });
    var holdings=_calcCodeHoldingsAtDate(ledger1,date,nameToCode);
    var positions=[],items=[], included={}, excluded=0;
    Object.keys(holdings).forEach(function(key){
      var h=holdings[key],code=_cleanCode(h&&h.code),qty=Number(h&&h.qty);
      if(!(qty>0.0001))return;
      if(!code || !masters[code] || !isFinite(qty))
        throw new Error('ORPHAN_HELD_CODE');
      var item=masters[code],type=String(item.type||'').trim().toUpperCase();
      var market=String(item.market||'').trim().toUpperCase();
      var currency=String(item.currency||'').trim().toUpperCase();
      var kind=(type==='ETF'||market==='ETF')?'ETF':
        (['펀드','FUND','TDF'].indexOf(type)>=0?'FUND':
        (['주식','STOCK'].indexOf(type)>=0?'STOCK':'UNKNOWN'));
      var domestic=['KOSPI','KOSDAQ','KRX','KR','ETF'].indexOf(market)>=0
        && currency==='KRW' && (kind==='STOCK'||kind==='ETF');
      if(!domestic) {
        // Explicit foreign/cash/fund holdings may be out of scope. An
        // *ambiguous* Korean market record must not quietly disappear.
        if((kind==='STOCK'||kind==='ETF'||kind==='UNKNOWN') &&
          (currency==='KRW'||['KR','KOSPI','KOSDAQ','KRX','ETF'].indexOf(market)>=0))
          throw new Error('MARKET_CLASSIFICATION_UNVERIFIED');
        excluded++;return;
      }
      if(!/^[A-Z0-9]{6}$/.test(code))throw new Error('DOMESTIC_CODE_INVALID');
      if(included[code])throw new Error('DUPLICATE_HELD_CODE');
      included[code]=true;
      positions.push({code:code,quantity:qty});
      items.push({code:code,kind:kind,market:market,currency:currency,
        listingState:'UNKNOWN',listingStateAsOf:null});
    });
    // Detect direct Sheets edits during the lock, although even a match
    // cannot prevent ABA or later external edits.
    if(sh.getLastRow()!==n+1||Math.min(sh.getLastColumn(),11)!==width)
      throw new Error('SOURCE_CHANGED');
    var ledger2=sh.getRange(2,1,n,width).getValues();
    var master2=getCodeItems(ss,true);
    if(JSON.stringify(ledger1)!==JSON.stringify(ledger2)
      ||JSON.stringify(master1)!==JSON.stringify(master2))
      throw new Error('SOURCE_CHANGED');
    // Catch a journal/transaction introduced after the first source read.
    if (_tradeLedgerWriteUnverified_())throw new Error('LEDGER_WRITE_UNVERIFIED');
    if (PropertiesService.getScriptProperties().getProperty(CODE_DELETE_TXN_KEY_))
      throw new Error('CODE_DELETE_PENDING');
    positions.sort(function(a,b){return a.code.localeCompare(b.code);});
    items.sort(function(a,b){return a.code.localeCompare(b.code);});
    outcome={
      status:'ok',mode:'READ_ONLY_PROPOSAL',asOfDate:date,
      sourceConsistency:'GAS_SCRIPT_LOCK_DOUBLE_READ_MATCH_NOT_ATOMIC',
      readOnly:true,verified:false,listingStatusVerified:false,
      ledgerSnapshot:{source:'GAS_VERIFIED_ASOF_LEDGER',asOfDate:date,
        verified:false,positions:positions},
      masterSnapshot:{source:'GAS_VERIFIED_CODE_MASTER',asOfDate:date,
        verified:false,items:items},
      counts:{heldDomesticCodes:positions.length,excludedOtherCodes:excluded},
      blockers:['EXTERNAL_SHEETS_WRITERS_NOT_LOCKED',
        'HISTORICAL_LISTING_STATUS_UNKNOWN','REVIEWED_DEPLOYMENT_NOT_COMPLETE']
    };
  }catch(e){
    var allowed=['AUTH_DISABLED','AUTH_REQUIRED','DATE_INVALID','MARKET_UNVERIFIED',
      'BUSY','LEDGER_UNAVAILABLE','MASTER_UNAVAILABLE','MASTER_CONFLICT',
      'TRADE_CODE_UNVERIFIED','TRADE_TYPE_UNVERIFIED','TRADE_QTY_UNVERIFIED',
      'TRADE_DATE_UNVERIFIED','TRADE_RATIO_UNVERIFIED',
      'ORPHAN_HELD_CODE','MARKET_CLASSIFICATION_UNVERIFIED',
      'DOMESTIC_CODE_INVALID','DUPLICATE_HELD_CODE','SOURCE_CHANGED',
      'LEDGER_WRITE_UNVERIFIED','CODE_DELETE_PENDING'];
    var code=allowed.indexOf(String(e&&e.message))>=0?e.message:'READ_FAILED';
    outcome=bad(code);
  }finally{
    if(owned){
      try{lock.releaseLock();}catch(ignore){outcome=bad('LOCK_RELEASE_UNVERIFIED');}
    }
  }
  return outcome;
}

