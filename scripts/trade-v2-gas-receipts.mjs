// Source-only v2 durable receipt protocol for unpublished GAS candidate.
// It is not a production Apps Script deployment.
export const TRADE_V2_GAS_RECEIPTS = String.raw`
var TRADE_V2_RECEIPT_PREFIX='portfolio_sync_receipt_v2_';
function _tradeV2ReceiptInput_(params) {
  var id=String(params.operationId||'');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(id)||String(params.tradeLedgerProtocolVersion)!=='2')
    throw Error('TRADE_V2_RECEIPT_INVALID');
  var rows=JSON.parse(params.data||'[]'),intents=JSON.parse(params.intents||'[]');
  if(!Array.isArray(rows)||!Array.isArray(intents))throw Error('TRADE_INTENT_REQUIRED');
  var expected=String(params.expectedLedgerRevision||'');
  if(!/^[0-9a-f]{64}$/.test(expected))throw Error('TRADE_LEDGER_REVISION_INVALID');
  var target=_tradeV2Revision_(_tradeV2RowsFromTrades_(rows));
  var contract={tradeLedgerProtocolVersion:2,expectedLedgerRevision:expected,intents:intents};
  var signature=_portfolioSyncDigest_(JSON.stringify([
    'syncTradesV2',_tradeV2RowsFromTrades_(rows).map(_tradeV2CanonicalRow_),
    expected,intents,params.rebuildFrom||'',params.explicitEmpty||''
  ]));
  return {id:id,kind:'syncTradesV2',key:TRADE_V2_RECEIPT_PREFIX+
    _portfolioSyncDigest_('syncTradesV2|'+id),requestHash:signature,
    targetRevision:target,contract:contract,rows:rows};
}
function _tradeV2ReceiptState_(input,record,ss) {
  if(!record)return 'NOT_FOUND';
  if(record.id!==input.id||record.kind!=='syncTradesV2'||
     record.sourceId!==ss.getId()||record.requestHash!==input.requestHash)
    return 'CONFLICT';
  if(record.state==='FAILED')return 'FAILED';
  if(_tradeLedgerWriteUnverified_()||_readPendingTradeSnapshotRebuild())
    return 'PARTIAL';
  var read=JSON.parse(handleGetTrades(ss).getContent());
  if(read.status!=='ok'||read.tradeLedgerProtocolVersion!==2)
    return 'UNKNOWN';
  if(read.ledgerRevision!==input.targetRevision)return 'CHANGED';
  // A hard stop after source+Snapshot verification but before receipt update
  // is recoverable by read-only revision and pending-state evidence.
  if(record.state==='COMPLETE'||record.state==='STARTED'||record.state==='PARTIAL')
    return 'COMPLETE';
  return 'UNKNOWN';
}
function handleTradeV2ReceiptReadOnly_(params) {
  var lock=LockService.getScriptLock(),locked=false;
  try{
    if(!lock.tryLock(1000))return jsonOk({receiptState:'BUSY',kind:'syncTradesV2'});
    locked=true;
    var input=_tradeV2ReceiptInput_(params),ss=getss(),props=PropertiesService.getScriptProperties();
    var raw=props.getProperty(input.key),record=raw?JSON.parse(raw):null;
    return jsonOk({operationId:input.id,kind:input.kind,
      tradeLedgerProtocolVersion:2,tradeFxMetadataVersion:1,
      receiptState:_tradeV2ReceiptState_(input,record,ss)});
  }catch(err){return jsonError('거래 v2 저장 영수증 조회 실패',{errorCode:'TRADE_V2_RECEIPT_UNAVAILABLE'});}
  finally{if(locked)lock.releaseLock();}
}
function handleTradeSyncV2WithReceipt_(params) {
  var lock=LockService.getScriptLock(),locked=false,props=null,record=null;
  try{
    lock.waitLock(30000);locked=true;
    var input=_tradeV2ReceiptInput_(params),ss=getss();
    props=PropertiesService.getScriptProperties();
    var raw=props.getProperty(input.key);
    if(raw){
      record=JSON.parse(raw);
      var state=_tradeV2ReceiptState_(input,record,ss);
      return state==='COMPLETE'?jsonOk({
        operationId:input.id,kind:'syncTradesV2',receiptState:'COMPLETE',
        tradeLedgerProtocolVersion:2,tradeFxMetadataVersion:1,
        ledgerRevision:input.targetRevision,saveState:'success',replayed:true
      }):jsonError('이전 거래 저장 완료 확인 필요',
        {errorCode:'SYNC_RECEIPT_'+state,receiptState:state});
    }
    record={sourceId:ss.getId(),kind:'syncTradesV2',id:input.id,
      requestHash:input.requestHash,targetRevision:input.targetRevision,
      state:'STARTED',at:new Date().toISOString()};
    props.setProperty(input.key,JSON.stringify(record));
    // handleSyncTrades takes the same lock in receiptLockHeld mode and
    // performs revision/intents validation before touching the source.
    var result=JSON.parse(handleSyncTrades(params.data,params.rebuildFrom||'',
      params.explicitEmpty==='1',true,input.rows,input.contract).getContent());
    record.affectedFrom=String(result.affectedFrom||'');
    record.affectedTo=String(result.affectedTo||'');
    record.state=result.status==='ok'&&result.saveState!=='partial'
      ?'COMPLETE':result.saveState==='partial'?'PARTIAL':'FAILED';
    props.setProperty(input.key,JSON.stringify(record));
    if(record.state==='COMPLETE'&&_tradeV2ReceiptState_(input,record,ss)==='COMPLETE')
      return jsonOk(Object.assign({},result,{operationId:input.id,
        kind:'syncTradesV2',receiptState:'COMPLETE'}));
    return jsonError('거래 저장 또는 Snapshot 완료 미확인',{
      errorCode:'SYNC_RECEIPT_'+record.state,receiptState:record.state,
      saveState:result.saveState||'unknown'});
  }catch(err){
    return jsonError('거래 v2 저장 영수증 확인 불가',{errorCode:'TRADE_V2_RECEIPT_UNAVAILABLE'});
  }finally{if(locked)lock.releaseLock();}
}
`;
