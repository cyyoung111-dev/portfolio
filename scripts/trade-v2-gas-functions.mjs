// Source-only helper injected into the unpublished GAS candidate.
// The approved production Apps Script file is untouched.
export const TRADE_V2_GAS_HELPERS = String.raw`
// Every check executes under the existing ScriptLock, before a sheet write.
var TRADE_V2_ID_RE=/^(tr|srv)_[A-Za-z0-9_-]{6,128}$/;
function _tradeV2CanonicalRow_(r) {
  var numeric=[5,6,9,10,11,12];
  return [String(r[13]==null?'':r[13])].concat(r.slice(0,13).map(function(v,i){
    if(i===0)return _normalizeDate(v);
    // Match the actual GAS writer (_normalizeCodeRows, column E) exactly.
    // Legacy inputs such as 5930 are stored as 005930. Hashes and CAS
    // therefore describe the persisted value, never the browser spelling.
    if(i===4)return v==null||v===''?'':_cleanCode(v);
    if(v==null||v==='')return '';
    if(numeric.indexOf(i)>=0){
      var n=Number(v);
      if(!isFinite(n))throw Error('TRADE_NUMBER_INVALID');
      return n;
    }
    return String(v);
  }));
}
function _tradeV2RowsFromTrades_(trades) {
  return trades.slice().sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''));})
    .map(function(t){
      var fx=_portfolioTradeFxMetadata_(t);
      return [_normalizeDate(t.date),t.tradeType||'',t.acct||'',t.name||'',
        _cleanCode(t.code)||'',t.qty||0,t.price||0,t.assetType||'주식',
        t.memo||'',t.ratio||'',t.fractionalCash||'',fx[0],fx[1],t.id||''];
    });
}
function _tradeV2RowHash_(r){return _portfolioSyncDigest_(JSON.stringify(_tradeV2CanonicalRow_(r)));}
function _tradeV2Revision_(rows){
  return _portfolioSyncDigest_(JSON.stringify(rows.map(_tradeV2CanonicalRow_)));
}
function _tradeV2ValidateMutation_(previousRows,trades,meta,lastColumn) {
  if(!meta||meta.tradeLedgerProtocolVersion!==2)
    return {ok:false,errorCode:'TRADE_LEDGER_V2_REQUIRED'};
  if(!Array.isArray(meta.intents)||!meta.expectedLedgerRevision)
    return {ok:false,errorCode:'TRADE_INTENT_REQUIRED'};
  // A migrated 14-column ledger can legitimately be empty after deleting
  // its last trade. Column N's header is the migration proof in that case.
  if(lastColumn<14)
    return {ok:false,errorCode:'TRADE_LEDGER_IDENTITY_MIGRATION_REQUIRED'};
  var old={},next={},intents={},oldRows=previousRows;
  var i,id,row,kind;
  for(i=0;i<oldRows.length;i++){
    row=oldRows[i];id=String(row[13]||'');
    if(!TRADE_V2_ID_RE.test(id))
      return {ok:false,errorCode:'TRADE_LEDGER_IDENTITY_MIGRATION_REQUIRED'};
    if(Object.prototype.hasOwnProperty.call(old,id))
      return {ok:false,errorCode:'TRADE_ID_DUPLICATE'};
    old[id]=row;
  }
  var current=_tradeV2Revision_(oldRows);
  if(current!==meta.expectedLedgerRevision)
    return {ok:false,errorCode:'TRADE_LEDGER_REVISION_CONFLICT'};
  var intendedRows;
  try{intendedRows=_tradeV2RowsFromTrades_(trades);}
  catch(err){return {ok:false,errorCode:String(err.message||'TRADE_FX_METADATA_INVALID')};}
  for(i=0;i<intendedRows.length;i++){
    row=intendedRows[i];id=String(row[13]||'');
    if(!TRADE_V2_ID_RE.test(id))return {ok:false,errorCode:'TRADE_ID_MISSING_OR_INVALID'};
    if(Object.prototype.hasOwnProperty.call(next,id))
      return {ok:false,errorCode:'TRADE_ID_DUPLICATE'};
    next[id]=row;
  }
  for(i=0;i<meta.intents.length;i++){
    var it=meta.intents[i]||{};
    id=String(it.id||'');kind=String(it.type||'');
    if(!TRADE_V2_ID_RE.test(id)||['create','update','delete'].indexOf(kind)<0
        ||Object.prototype.hasOwnProperty.call(intents,id))
      return {ok:false,errorCode:'TRADE_INTENT_INVALID'};
    intents[id]=it;
  }
  for(id in old)if(Object.prototype.hasOwnProperty.call(old,id)){
    row=old[id];var currentIntent=intents[id];
    if(!Object.prototype.hasOwnProperty.call(next,id)){
      if(!currentIntent||currentIntent.type!=='delete')
        return {ok:false,errorCode:'TRADE_DELETE_INTENT_REQUIRED'};
      if(currentIntent.beforeHash!==_tradeV2RowHash_(row))
        return {ok:false,errorCode:'TRADE_PREIMAGE_MISMATCH'};
      continue;
    }
    if(currentIntent&&(currentIntent.type==='create'||currentIntent.type==='delete'))
      return {ok:false,errorCode:'TRADE_INTENT_CONFLICT'};
    var target=next[id];
    if(row[11]!=null&&row[11]!==''&&
        (target[11]==null||target[11]===''||target[12]==null||target[12]===''))
      return {ok:false,errorCode:'TRADE_FX_METADATA_LOSS_RISK'};
    if(_tradeV2RowHash_(row)!==_tradeV2RowHash_(target)&&
        (!currentIntent||currentIntent.type!=='update'))
      return {ok:false,errorCode:'TRADE_UPDATE_INTENT_REQUIRED'};
    if(currentIntent&&currentIntent.type==='update'&&
       currentIntent.beforeHash!==_tradeV2RowHash_(row))
      return {ok:false,errorCode:'TRADE_PREIMAGE_MISMATCH'};
  }
  for(id in next)if(Object.prototype.hasOwnProperty.call(next,id)){
    if(!Object.prototype.hasOwnProperty.call(old,id)&&
       (!intents[id]||intents[id].type!=='create'))
      return {ok:false,errorCode:'TRADE_CREATE_INTENT_REQUIRED'};
  }
  for(id in intents)if(Object.prototype.hasOwnProperty.call(intents,id)){
    var op=intents[id];
    if(op.type==='create'?
       (Object.prototype.hasOwnProperty.call(old,id)||!Object.prototype.hasOwnProperty.call(next,id)):
       !Object.prototype.hasOwnProperty.call(old,id))
      return {ok:false,errorCode:'TRADE_INTENT_CONFLICT'};
  }
  return {ok:true,previousRevision:current,nextRevision:_tradeV2Revision_(intendedRows)};
}
`;
