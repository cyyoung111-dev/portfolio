// GAS-only opt-in performance metrics: standalone review candidate.
// Included in the existing Apps Script project ONLY after Issue #860 safe release.
// Financial sheets, Snapshot, NH credentials and portfolio writers are not touched.
var PERF_MONITOR_SHEET = 'PERFORMANCE_LOG';
var PERF_MONITOR_COLUMNS = ['observed_at_kst','device','stage','elapsed_ms','result'];
var PERF_MONITOR_STAGES = [
  'load.initial-restore','load.initial-prices','load.full-update',
  'price.poll-network','price.poll-render','price.poll-total',
  'network.getBootstrap','network.getSettings','network.getPrices','network.getPriceHistory'
];
function _perfMonitorAuthorized_(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('_perfMonitorAuthorized_', _perfMonitorAuthorized_, this, arguments);
  // GAS's legacy compatibility mode permits anonymous requests. Never write metrics
  // in that mode, even when doPost() itself passes _isAuthorizedRequest().
  var configured = String(PropertiesService.getScriptProperties().getProperty('access_token') || '').trim();
  return configured.length >= 24 && _isAuthorizedRequest(params);
}
function _perfMonitorValidate_(text) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('_perfMonitorValidate_', _perfMonitorValidate_, this, arguments);
  if (String(text || '').length > 1800) return null;
  var payload;
  try { payload = JSON.parse(String(text || '')); } catch (_) { return null; }
  if (!payload || payload.version !== 1 || !['desktop','mobile','unknown'].includes(payload.device) ||
      !Array.isArray(payload.samples) || payload.samples.length < 1 || payload.samples.length > 8) return null;
  if (!payload.samples.every(function(s) {
    return s && Object.keys(s).length === 3 &&
      PERF_MONITOR_STAGES.indexOf(s.stage) !== -1 &&
      typeof s.ms === 'number' && isFinite(s.ms) && s.ms >= 0 && s.ms <= 120000 &&
      Math.floor(s.ms) === s.ms &&
      (s.result === 'ok' || s.result === 'error');
  })) return null;
  return payload;
}
function _perfMonitorTimestamp_(value) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('_perfMonitorTimestamp_', _perfMonitorTimestamp_, this, arguments);
  // Sheets may return Date objects even if the server originally wrote text.
  if (value instanceof Date && isFinite(value.getTime()))
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  return String(value || '');
}
function _perfMonitorSheet_(create) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('_perfMonitorSheet_', _perfMonitorSheet_, this, arguments);
  var ss = getss();
  var sh = ss.getSheetByName(PERF_MONITOR_SHEET);
  if (!sh && !create) return null;
  if (!sh) {
    sh = ss.insertSheet(PERF_MONITOR_SHEET);
    sh.getRange(1,1,1,5).setValues([PERF_MONITOR_COLUMNS]);
    // If possible, hide this diagnostic-only tab; never hide the last visible sheet.
    try { sh.hideSheet(); } catch (_) {}
  } else {
    var actual = sh.getRange(1,1,1,5).getValues()[0].map(function(v) {return String(v || '');});
    if (actual.join('|') !== PERF_MONITOR_COLUMNS.join('|')) throw new Error('PERF_SCHEMA_CONFLICT');
  }
  return sh;
}
function handleAppendPerformanceMetrics(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('handleAppendPerformanceMetrics', handleAppendPerformanceMetrics, this, arguments);
  if (!_perfMonitorAuthorized_(params)) return jsonError('PERF_AUTH_REQUIRED');
  var payload = _perfMonitorValidate_(params.data || '');
  if (!payload) return jsonError('PERF_INVALID_PAYLOAD');
  var lock = LockService.getScriptLock();
  // Diagnostics must yield immediately to financial writers.
  if (!lock.tryLock(0)) return jsonError('PERF_LOW_PRIORITY_BUSY');
  try {
    var sh = _perfMonitorSheet_(true);
    var now = new Date();
    var stamp = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    var day = stamp.slice(0,10);
    var n = Math.max(0, sh.getLastRow()-1);
    // Read only the last 240 dates: chronological append guarantees that
    // reaching 240 same-day entries is enough to reject further writes.
    var from = Math.max(2, n - 240 + 2);
    var recent = n ? sh.getRange(from,1,Math.min(240,n),1).getValues() : [];
    var todayCount = recent.filter(function(row){return _perfMonitorTimestamp_(row[0]).slice(0,10) === day;}).length;
    if (todayCount + payload.samples.length > 240) return jsonError('PERF_DAILY_LIMIT');
    var data = payload.samples.map(function(sample) {
      return [stamp,payload.device,sample.stage,sample.ms,sample.result];
    });
    sh.getRange(n + 2,1,data.length,5).setValues(data);
    // Bounded, diagnostics-only retention. Delete old rows only from this tab.
    var count = n + data.length;
    if (count > 2000) sh.deleteRows(2,count-2000);
    var cutoff = Utilities.formatDate(new Date(now.getTime() - 7*86400000),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    var currentRows = Math.max(0,sh.getLastRow()-1);
    if (currentRows > 0) {
      var take = Math.min(80,currentRows);
      var oldest = sh.getRange(2,1,take,1).getValues();
      var expired = 0;
      for (var i=0;i<oldest.length;i++) {
        if (_perfMonitorTimestamp_(oldest[i][0]) >= cutoff) break;
        expired++;
      }
      if (expired > 0) sh.deleteRows(2,expired);
    }
    return jsonOk({accepted:data.length});
  } catch (e) {
    return jsonError('PERF_COLLECTOR_UNAVAILABLE');
  } finally { lock.releaseLock(); }
}
function handleGetPerformanceSummary(params) {
  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('handleGetPerformanceSummary', handleGetPerformanceSummary, this, arguments);
  if (!_perfMonitorAuthorized_(params)) return jsonError('PERF_AUTH_REQUIRED');
  try {
    var sh = _perfMonitorSheet_(false);
    if (!sh || sh.getLastRow() <= 1) return jsonOk({enabled:true,windowDays:7,sampleCount:0,groups:[]});
    var count = Math.min(2000, sh.getLastRow()-1);
    var values = sh.getRange(sh.getLastRow()-count+1,1,count,5).getValues();
    var cutoff = Utilities.formatDate(new Date(Date.now()-7*86400000),'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
    var groups = {};
    var total = 0;
    values.forEach(function(row) {
      var date = _perfMonitorTimestamp_(row[0]),dev = String(row[1] || ''),stage = String(row[2] || '');
      var ms = Number(row[3]),state = String(row[4] || '');
      if (date < cutoff || ['desktop','mobile','unknown'].indexOf(dev) < 0 ||
          PERF_MONITOR_STAGES.indexOf(stage) < 0 || !isFinite(ms) || ms < 0 || ms > 120000 ||
          ['ok','error'].indexOf(state) < 0) return;
      total++;
      var key = dev+'|'+stage;
      if (!groups[key]) groups[key] = {device:dev,stage:stage,values:[],failed:0};
      groups[key].values.push(ms);
      if (state === 'error') groups[key].failed++;
    });
    var summary = Object.keys(groups).sort().map(function(key) {
      var g = groups[key],sorted=g.values.sort(function(a,b){return a-b;}),n=sorted.length;
      return {device:g.device,stage:g.stage,count:n,failed:g.failed,
        medianMs:sorted[Math.floor((n-1)/2)],p95Ms:sorted[Math.ceil(n*0.95)-1],
        failureRatePct:Math.round(g.failed/n*1000)/10};
    });
    return jsonOk({enabled:true,windowDays:7,sampleCount:total,groups:summary,
      truncated:sh.getLastRow()-1>2000});
  } catch (e) {
    return jsonError('PERF_SUMMARY_UNAVAILABLE');
  }
}
