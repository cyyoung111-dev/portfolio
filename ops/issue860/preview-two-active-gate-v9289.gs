// #860 v9.289 operator-only read-only gate record preview.
// NOT COMPOSED into GAS release, not called from GitHub, no HTTP route.
// Run inside the ORIGINAL GAS editor only after verifying published v9.289.
// No cleanup, approval, receipts, Snapshot or ScriptProperties writes.
function issue860PreviewTwoActiveGateRecords() {
  if(ISSUE507_GATE_API_VERSION!=='9.289')
    throw Error('ISSUE860_GATE_PREVIEW_VERSION_MISMATCH');
  var output=_issue507GateAtomic_(function(props) {
    var g=_issue507GateRead_(props),tokens=Object.keys(g.active||{});
    if(!['OPEN','DRAINING'].includes(g.mode) || tokens.length!==2)
      throw Error('ISSUE860_GATE_PREVIEW_ACTIVE_SET_CHANGED');
    var now=Date.now(),records=tokens.map(function(token) {
      var entry=g.active[token],t=entry.startedAt;
      if(!entry||typeof entry.name!=='string'||!Number.isFinite(t)||
        t<new Date('2026-11-10T09:00:00Z').getTime()||t>now)
        throw Error('ISSUE860_GATE_PREVIEW_ENTRY_UNVERIFIED');
      var end=props.getProperty('issue507_writer_end_v1_'+token);
      return {
        functionName:[
          'runDailyPortfolioClose1900',
          'runPortfolioCloseWatchdog2030',
          'runDeferredFundAfterPortfolioCloseFailure',
          'runPortfolioHistoricalBackfill2240',
          'runPortfolioHistoricalBackfill0010'
        ].includes(entry.name)?entry.name:'OTHER_UNRECOGNIZED',
        startedKst:Utilities.formatDate(new Date(t),'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),
        ageMinutes:Math.floor((now-t)/60000),
        producerEndReceiptPresent:!!end
      };
    });
    records.sort(function(a,b){return a.startedKst.localeCompare(b.startedKst);});
    return {kind:'ISSUE860_TWO_ACTIVE_GATE_PREVIEW_ONLY',
      releaseVersion:'9.289',gateMode:g.mode,activeCount:tokens.length,
      records:records,
      exactProcessTerminalVerified:false,
      activeCleanupAuthorized:false,approvedToDeploy9290:false,
      scriptPropertyWrites:0,financialWrites:0,gasDeployments:0,
      backupDeletes:0,telegramSends:0};
  });
  if(typeof Logger!=='undefined')Logger.log(JSON.stringify(output));
  return output;
}
