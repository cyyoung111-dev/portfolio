// #860: operator-only read-only active Writer Gate inspector for existing GAS v9.289.
// Never deployed as a release candidate, never exposed by doGet/doPost, and never
// prunes active tokens, forges END receipts, edits finance sheets, or deploys GAS.
// The historic "two-active" preview is stale after the 11/11 active count reached 3.
function issue860PreviewCurrentActiveGateRecords() {
  if(ISSUE507_GATE_API_VERSION!=='9.289')
    throw new Error('ISSUE860_GATE_PREVIEW_VERSION_MISMATCH');
  var result=_issue507GateAtomic_(function(props){
    var state=_issue507GateRead_(props);
    var tokens=Object.keys(state.active||{});
    if(!['OPEN','DRAINING'].includes(state.mode)||tokens.length>24)
      throw new Error('ISSUE860_GATE_PREVIEW_STATE_UNVERIFIED');
    var now=Date.now();
    var allowed={
      runDailyPortfolioClose1900:true,
      runPortfolioCloseWatchdog2030:true,
      runDeferredFundAfterPortfolioCloseFailure:true,
      runPortfolioHistoricalBackfill2240:true,
      runPortfolioHistoricalBackfill0010:true,
      runPendingTradeSnapshotRebuild:true,
      saveDailyPriceHistory:true
    };
    var records=tokens.map(function(token){
      var entry=state.active[token];
      if(!entry||typeof entry.name!=='string'||!Number.isFinite(entry.startedAt)||
        entry.startedAt<new Date('2026-11-01T00:00:00Z').getTime()||
        entry.startedAt>now)
        throw new Error('ISSUE860_GATE_PREVIEW_RECORD_UNVERIFIED');
      var raw=props.getProperty('issue507_writer_end_v1_'+token);
      var receiptStatus='ABSENT';
      if(raw){
        try{
          var e=JSON.parse(raw);
          if(e.releaseId===state.releaseId&&e.token===token&&
            e.name===entry.name&&e.startedAt===entry.startedAt&&
            e.state==='ENDED'&&Number.isFinite(e.endedAt)&&
            e.endedAt>=e.startedAt&&e.endedAt<=now&&
            typeof e.acknowledged==='boolean')receiptStatus='VALID_ENDED';
          else receiptStatus='MISMATCH';
        }catch(error){receiptStatus='INVALID_JSON';}
      }
      return {
        functionName:allowed[entry.name]?entry.name:'OTHER_UNRECOGNIZED',
        startedKst:Utilities.formatDate(new Date(entry.startedAt),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),
        ageMinutes:Math.floor((now-entry.startedAt)/60000),
        producerReceipt:receiptStatus
      };
    });
    records.sort(function(a,b){return a.startedKst.localeCompare(b.startedKst);});
    return {
      kind:'ISSUE860_CURRENT_GATE_PREVIEW_READ_ONLY',
      sourceVersion:'9.289',mode:state.mode,recordedActive:tokens.length,
      finished:state.finished,records:records,
      processTerminalVerified:false,activeCleanupAuthorized:false,
      deployAuthorized:false,financialWrites:0,scriptPropertyWrites:0,
      gasDeployments:0,telegramSends:0
    };
  });
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(result));
  return result;
}
