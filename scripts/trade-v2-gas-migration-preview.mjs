// Read-only 11/13 -> 14 column migration planning functions. No apply path.
export const TRADE_V2_GAS_MIGRATION_PREVIEW = String.raw`
function _tradeV2MigrationPlan_(sourceRows) {
  if(!Array.isArray(sourceRows)||sourceRows.length>100000)
    throw Error('TRADE_MIGRATION_SOURCE_INVALID');
  var used={},assigned=0,preserved=0,fxEvidence=0;
  var rows=sourceRows.map(function(raw,i){
    if(!raw||raw.length<11)throw Error('TRADE_MIGRATION_ROW_INVALID');
    var row=Array.from({length:14},function(_,j){
      return raw[j]==null?'':raw[j];
    });
    row[0]=_normalizeDate(row[0]);
    if(!row[0]||!row[3])throw Error('TRADE_MIGRATION_ROW_INVALID');
    var hasPrice=row[11]!==''&&row[11]!=null,
        hasRate=row[12]!==''&&row[12]!=null;
    if(hasPrice!==hasRate)throw Error('TRADE_MIGRATION_FX_INCOMPLETE');
    if(hasPrice){
      _portfolioTradeFxMetadata_({price:row[6],priceRaw:row[11],fxRateAtBuy:row[12]});
      fxEvidence++;
    }
    var id=String(row[13]||'');
    if(!id){
      // Row ordinal disambiguates physically duplicated legacy trades.
      // No account, quantity or security values leave the server.
      id='srv_'+_portfolioSyncDigest_(JSON.stringify([
        'trade-v2-migration',i,_tradeV2CanonicalRow_(row)
      ])).slice(0,32);
      row[13]=id;assigned++;
    }else{
      if(!TRADE_V2_ID_RE.test(id))throw Error('TRADE_MIGRATION_ID_INVALID');
      preserved++;
    }
    if(Object.prototype.hasOwnProperty.call(used,id))
      throw Error('TRADE_MIGRATION_DUPLICATE_ID');
    used[id]=true;
    return row;
  });
  return {rows:rows,count:rows.length,assigned:assigned,preserved:preserved,
    fxEvidence:fxEvidence,
    sourceDigest:_portfolioSyncDigest_(JSON.stringify(sourceRows.map(function(row){
      return row.map(function(v,i){return i===0?_normalizeDate(v):String(v==null?'':v);});
    }))),
    proposedRevision:_tradeV2Revision_(rows)};
}
function handlePreviewTradeLedgerV2Migration_() {
  var lock=LockService.getScriptLock(),locked=false;
  try{
    if(!lock.tryLock(1000))return jsonError('원장 다른 작업 진행중',{
      errorCode:'TRADE_MIGRATION_LOCK_BUSY'});
    locked=true;
    var sh=getss().getSheetByName(CONFIG.SHEET_TRADES);
    if(!sh)return jsonError('거래 원장 없음',{
      errorCode:'TRADE_MIGRATION_SOURCE_MISSING'});
    var rows=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,
      Math.min(14,sh.getLastColumn())).getValues():[];
    var plan=_tradeV2MigrationPlan_(rows);
    // Candidate only: do not return individual trades/IDs or mutate a sheet.
    return jsonOk({migrationStatus:plan.assigned?'REQUIRES_APPROVED_MIGRATION':'READY',
      tradeLedgerProtocolVersion:2,sourceRows:plan.count,
      assignedIdsNeeded:plan.assigned,existingIdsPreserved:plan.preserved,
      existingFxRows:plan.fxEvidence,
      sourceDigest:plan.sourceDigest,proposedRevision:plan.proposedRevision,
      migrationApplied:false,financeWrites:0});
  }catch(err){return jsonError('거래 원장 ID 이관 사전검사 실패',{
    errorCode:String(err.message||'TRADE_MIGRATION_PREVIEW_FAILED')});}
  finally{if(locked)lock.releaseLock();}
}
`;
