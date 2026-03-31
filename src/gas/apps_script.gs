// ════════════════════════════════════════════════════════════════════
//  📊 포트폴리오 대시보드 — Google Apps Script  v9.6
//
//  v9.6 변경사항 (2026.03.24):
//   ✅ [버그수정] _parseArrayParam() 함수 누락 추가
//              → syncTrades / syncHoldings POST 시 ReferenceError 발생하던 문제 해결
//
//  v9.5 변경사항 (2026.03.13):
//   ✅ [신규]   save/getDividendSettings, save/getRealEstateSettings 액션 추가
//   ✅ [개선]   설정 부분 저장 유틸(_readSettingsMap/_writeSettingsMap)로 기존 키 보존 저장
//
//  v9.4 변경사항 (2026.03.12):
//   ✅ [버그수정] _backfillExecute() — 스냅샷만 저장하고 가격이력(SHEET_PH) 미저장 수정
//              → batchUpsertPriceHistory() 동시 호출로 과거 날짜 조회 정상화
//   ✅ [개선]   BACKFILL_CONFIG.toYear/toMonth 기본값 2026-03으로 업데이트
//   ✅ [정리]   backfillMonth() 삭제 (backfillRange로 완전 대체)
//   ✅ [정리]   BACKFILL_CONFIG 레거시 year/month 필드 제거
//   ✅ [정리]   onOpen 메뉴 순서 재편 (초기설정→종가→소급→유지보수)
//
//  v9.3 변경사항 (2026.03.11):
//   ✅ [버그수정] handleSyncTrades() — 날짜 정규화 누락
//      'Fri Dec 26 2025' 형식으로 저장되던 문제 수정
//      _normalizeDate() 헬퍼 추가 → 어떤 형식이든 YYYY-MM-DD 변환
//   ✅ [방어] handleSaveSnapshot() — dateStr도 동일 헬퍼로 정규화
//
//  v9.2 변경사항 (2026.03.11):
//   ✅ [버그수정] cleanDeadCodes() — new Set() → 객체 방식으로 변경
//      (GAS는 ES5 기반 — Set/Map 미지원)
//   ✅ [최적화] handleSyncCodes() — existingRowData 이중 getValues 읽기 제거
//      (동일 범위를 2회 읽던 중복 제거, 1차 읽기 결과 재활용)
//
//  v9.1 변경사항 (2026.03.11):
//   ✅ [신규] '설정' 시트 추가 — 브라우저 독립 설정 복원
//   ✅ [신규] handleSaveSettings / handleGetSettings — 설정 저장/조회
//   ✅ [신규] handleGetTrades / handleGetHoldings — 거래이력/보유현황 읽기
//   ✅ [버그수정] migratePriceHistory() — 신버전 감지 후 불필요한 재변환 방지
//   ✅ [버그수정] handleGetTrades() — Date 객체 날짜 포맷 정규화
//   ✅ [최적화] handleSyncCodes — 루프 내 단건 setValue → 배치 setValues
//   ✅ [최적화] handleSaveSettings — clearContent + 1회 setValues 재작성
//   ✅ [최적화] batchUpsertPriceHistory — 연속 행 묶음 setValues
//
//  v9.0 변경사항 (2026.03.08):
//   ✅ [버그수정] getss() — 웹앱 배포 시 getActiveSpreadsheet() null 방지
//   ✅ [신규] backfillRange() — 연도 범위 소급채우기
//   ✅ [신규] backfillResume() / backfillStatus()
//   ✅ [최적화] writeSnapshotRows() — 날짜별 upsert → 전체 재구성 1회
//   ✅ [최적화] fetchPricesGoogleFinance() — tmp 시트 삭제 실패 시 clearContents fallback
//   ✅ [최적화] handleGetPriceHistory() — 중복 순회 제거
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  ★ 스프레드시트 ID 설정 (필수)
// ════════════════════════════════════════════════════════════════════
var SS_ID = (function(){
  try {
    return PropertiesService.getScriptProperties().getProperty('SS_ID') || '1oyk6qY4pRV3zB_n_ldHeIKLbFS6ZbVLKp0t5OBWZV5c';
  } catch(e) {
    return '1oyk6qY4pRV3zB_n_ldHeIKLbFS6ZbVLKp0t5OBWZV5c';
  }
})();

// ════════════════════════════════════════════════════════════════════
//  소급채우기 설정
// ════════════════════════════════════════════════════════════════════
var BACKFILL_CONFIG = {
  fromYear:  2024, fromMonth: 1,   // 소급채우기 시작 연월
  toYear:    new Date().getFullYear(), toMonth: new Date().getMonth() + 1,
  overwrite: false,
};

// ════════════════════════════════════════════════════════════════════
//  시트 이름 설정
// ════════════════════════════════════════════════════════════════════
var CONFIG = {
  SHEET_CODES:    '종목코드',
  SHEET_PRICES:   '종가',
  SHEET_SNAPSHOT: '스냅샷',
  SHEET_PH:       '가격이력',
  SHEET_HOLD:     '보유현황',
  SHEET_TRADES:   '거래이력',
  SHEET_SYNC_LOG: '동기화로그',
  SHEET_TMP:      '_gf_tmp',
  SHEET_SETTINGS: '설정',
  TIMEZONE:       'Asia/Seoul',
};

// ════════════════════════════════════════════════════════════════════
//  스프레드시트 핸들러 — 웹앱 배포 시 null 방지
// ════════════════════════════════════════════════════════════════════
function getss() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch(e) { Logger.log('⚠️ getActiveSpreadsheet 실패, openById로 fallback: ' + e.message); }
  return SpreadsheetApp.openById(SS_ID);
}

// ════════════════════════════════════════════════════════════════════
//  doGet
// ════════════════════════════════════════════════════════════════════
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  if (params.action === 'name'           && params.code)  return handleNameLookup(params.code);
  if (params.action === 'getHistory')                     return handleGetHistory(params.from || '', params.to || '');
  if (params.action === 'getCodeList')                    return handleGetCodeList();
  if (params.action === 'getPriceHistory')                return handleGetPriceHistory(params.from || '', params.to || '', params.codes || '');
  if (params.action === 'saveManualPrice')                return handleSaveManualPrice(params.date || '', params.name || '', params.price || '0');
  if (params.action === 'getPrices'      && params.codes) return handleGetPricesCompat(params.codes);
  if (params.action === 'dividend') {
    var codes = params.codes ? params.codes.split(',') : (params.code ? [params.code] : []);
    return handleDividendFetch(codes);
  }
  if (params.action === 'getSettings')          return handleGetSettings();
  if (params.action === 'getDividendSettings')  return handleGetDividendSettings();
  if (params.action === 'getRealEstateSettings')return handleGetRealEstateSettings();
  if (params.action === 'getTrades')            return handleGetTrades();
  if (params.action === 'getHoldings')          return handleGetHoldings();
  if (params.action === 'saveSnapshot' || params.action === 'syncCodes' ||
      params.action === 'syncHoldings' || params.action === 'syncTrades' ||
      params.action === 'saveSettings' || params.action === 'saveDividendSettings' ||
      params.action === 'saveRealEstateSettings' || params.action === 'saveSyncIssues') {
    return jsonError(params.action + ' 은 POST 전용입니다');
  }
  return handlePriceFetch(params.date || '', params.allCodes || '');
}

// ════════════════════════════════════════════════════════════════════
//  doPost
// ════════════════════════════════════════════════════════════════════
function doPost(e) {
  var params = {};
  try {
    if (e && e.postData && e.postData.contents) {
      e.postData.contents.split('&').forEach(function(pair) {
        var idx = pair.indexOf('=');
        if (idx === -1) return;
        var k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '));
        var v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
        params[k] = v;
      });
    }
  } catch(err) {
    return jsonError('POST 파싱 실패: ' + err.message);
  }
  if (params.action === 'syncCodes'    && params.codes) return handleSyncCodes(params.codes);
  if (params.action === 'saveSnapshot')                 return handleSaveSnapshot(params.date || '', params.data || '');
  if (params.action === 'syncHoldings' && params.data)  return handleSyncHoldings(params.data);
  if (params.action === 'syncTrades'           && params.data) return handleSyncTrades(params.data);
  if (params.action === 'saveSettings'         && params.data) return handleSaveSettings(params.data);
  if (params.action === 'saveDividendSettings' && params.data) return handleSaveDividendSettings(params.data);
  if (params.action === 'saveRealEstateSettings' && params.data) return handleSaveRealEstateSettings(params.data);
  if (params.action === 'saveSyncIssues' && params.data) return handleSaveSyncIssues(params.source || '', params.data);
  return jsonError('알 수 없는 action: ' + (params.action || '없음'));
}

function handleSaveSyncIssues(source, dataJson) {
  try {
    var rows;
    try { rows = _parseArrayParam(dataJson, 'syncIssues'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(rows)) return jsonError('배열 형식 필요');
    if (rows.length === 0) return jsonOk({ saved: 0 });

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_SYNC_LOG);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_SYNC_LOG);
      sh.getRange(1,1,1,7).setValues([['기록시각','소스','거래일','종목코드','종목명','계좌','메시지']]);
    }

    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    var values = rows.map(function(r) {
      return [
        now,
        (source || 'unknown').toString(),
        (r.date || '').toString(),
        _cleanCode(r.code || ''),
        (r.name || '').toString(),
        (r.acct || '').toString(),
        (r.message || '기초정보 미매칭').toString()
      ];
    });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, 7).setValues(values);
    return jsonOk({ saved: values.length });
  } catch(err) {
    return jsonError('saveSyncIssues 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  종가 조회 — 오늘: 종가시트 캐시, 특정일/캐시없음: GOOGLEFINANCE
// ════════════════════════════════════════════════════════════════════
function handlePriceFetch(dateParam, allCodesParam) {
  try {
    var ss       = getss();
    var todayStr = today();
    var reqDate  = dateParam || todayStr;
    if (reqDate !== todayStr) return handleHistoricalPriceFetch(reqDate, allCodesParam, ss);

    var priceSheet = ss.getSheetByName(CONFIG.SHEET_PRICES);
    if (priceSheet && priceSheet.getLastRow() >= 2) {
      var data   = priceSheet.getRange(2, 1, priceSheet.getLastRow() - 1, 4).getValues();
      var prices = {};
      data.forEach(function(row) {
        var code  = (row[0] || '').toString().trim();
        var price = parseFloat(row[1]) || 0;
        var name  = (row[2] || '').toString().trim();
        if (code && price > 0) prices[code] = { price: price, name: name, officialName: name };
      });
      if (Object.keys(prices).length > 0) {
        return jsonOk({ date: reqDate, count: Object.keys(prices).length, prices: prices, source: 'cache',
          missingCodes: calcMissing(allCodesParam, Object.keys(prices)) });
      }
    }
    return handleHistoricalPriceFetch(todayStr, allCodesParam, ss);
  } catch(err) {
    return jsonError(err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  특정일 종가 — GOOGLEFINANCE close
// ════════════════════════════════════════════════════════════════════
function handleHistoricalPriceFetch(dateStr, allCodesParam, ss) {
  try {
    var items = getCodeItems(ss);
    if (items.length === 0) return jsonError('종목코드 없음. initSheet() 먼저 실행하세요.');
    var prices = fetchPricesGoogleFinance(items, dateStr, ss);
    return jsonOk({ date: dateStr, count: Object.keys(prices).length, prices: prices,
      source: 'googlefinance', missingCodes: calcMissing(allCodesParam, Object.keys(prices)) });
  } catch(err) {
    return jsonError('특정일 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  GOOGLEFINANCE 가격 조회 핵심
// ════════════════════════════════════════════════════════════════════
function fetchPricesGoogleFinance(items, dateStr, ss) {
  var tmp = ss.getSheetByName(CONFIG.SHEET_TMP);
  if (!tmp) tmp = ss.insertSheet(CONFIG.SHEET_TMP);
  tmp.clearContents();

  var isToday = (dateStr === today());
  var dtObj   = new Date(dateStr.replace(/-/g, '/'));
  var fromObj = new Date(dtObj);
  fromObj.setDate(fromObj.getDate() - 5);

  var fmtDate  = function(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); };
  var fromFmt  = fmtDate(fromObj);
  var toFmt    = fmtDate(dtObj);

  var formulas = items.map(function(item) {
    var krx    = '"KRX:' + item.code + '"';
    var kosdaq = '"KOSDAQ:' + item.code + '"';
    if (isToday) {
      return ['=IFERROR(GOOGLEFINANCE(' + krx + ',"price"),' +
              'IFERROR(GOOGLEFINANCE(' + kosdaq + ',"price"),"-"))'];
    } else {
      return ['=IFERROR(INDEX(GOOGLEFINANCE(' + krx + ',"close","' + fromFmt + '","' + toFmt + '"),2,2),' +
              'IFERROR(INDEX(GOOGLEFINANCE(' + kosdaq + ',"close","' + fromFmt + '","' + toFmt + '"),2,2),"-"))'];
    }
  });

  if (formulas.length === 0) return {};
  tmp.getRange(1, 1, formulas.length, 1).setFormulas(formulas);
  SpreadsheetApp.flush();

  var sleepMs = Math.min(800 + items.length * 30, 4000);
  Utilities.sleep(sleepMs);

  var actualRows = tmp.getLastRow();
  var values;
  if (actualRows >= formulas.length) {
    values = tmp.getRange(1, 1, formulas.length, 1).getValues();
  } else if (actualRows > 0) {
    var partial = tmp.getRange(1, 1, actualRows, 1).getValues();
    values = [];
    for (var vi = 0; vi < formulas.length; vi++) {
      values.push(vi < actualRows ? partial[vi] : ['']);
    }
    Logger.log('⚠️ fetchPricesGoogleFinance: 계산 완료 행(' + actualRows + ') < 요청 행(' + formulas.length + ') — 재시도 권장');
  } else {
    values = formulas.map(function() { return ['']; });
    Logger.log('⚠️ fetchPricesGoogleFinance: tmp 시트 비어있음 — GOOGLEFINANCE 계산 실패');
  }

  try {
    tmp.clearContents();
    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('⚠️ tmp 시트 정리 실패: ' + e.message);
  }

  var prices = {};
  items.forEach(function(item, i) {
    var val   = values[i][0];
    var str   = String(val || '');
    var price = (val && val !== '-' && !str.startsWith('#')) ? Math.round(parseFloat(val)) : 0;
    if (price > 0) prices[item.code] = { price: price, name: item.name, officialName: item.name };
  });

  return prices;
}

// ════════════════════════════════════════════════════════════════════
//  종가 갱신 (수동 실행 / 트리거)
// ════════════════════════════════════════════════════════════════════
function updatePrices() {
  var ss = getss();
  if (!ss) { Logger.log('ERROR: 구글 시트에서 실행하세요'); return; }

  var items = getCodeItems(ss);
  if (items.length === 0) { Logger.log('유효한 종목코드 없음'); return; }

  var prices = fetchPricesGoogleFinance(items, today(), ss);
  var now    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');

  var results = items.map(function(item) {
    var p = prices[item.code];
    return [item.code, p ? p.price : '', item.name, now];
  });

  var ps = ss.getSheetByName(CONFIG.SHEET_PRICES) || ss.insertSheet(CONFIG.SHEET_PRICES);
  ps.clearContents(); ps.clearFormats();
  var allRows = [['종목코드','종가','종목명','갱신일시']].concat(results);
  ps.getRange(1, 1, allRows.length, 4).setValues(allRows);
  ps.getRange(1, 1, 1, 4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  ps.setColumnWidth(1, 90); ps.setColumnWidth(2, 90);
  ps.setColumnWidth(3, 200); ps.setColumnWidth(4, 160);
  SpreadsheetApp.flush();

  var todayStr = today();
  var phItems  = [];
  items.forEach(function(item) {
    var p = prices[item.code];
    if (p && p.price > 0) phItems.push({ code: item.code, name: item.name, price: p.price });
  });
  if (phItems.length > 0) batchUpsertPriceHistory(ss, todayStr, phItems);

  var ok = results.filter(function(r) { return r[1] !== ''; }).length;
  try {
    SpreadsheetApp.getUi().alert(
      '✅ 종가 갱신 완료!\n\n' + ok + '/' + items.length + '개 성공\n' +
      (ok < items.length ? '⚠️ 실패 종목: 코드 확인 또는 장 마감 후 재시도' : '모두 성공!')
    );
  } catch(e) { Logger.log('종가 갱신 완료: ' + ok + '/' + items.length); }
}

// ════════════════════════════════════════════════════════════════════
//  종목명 조회
// ════════════════════════════════════════════════════════════════════
function handleNameLookup(code) {
  try {
    var ss  = getss();
    var tmp = ss.getSheetByName(CONFIG.SHEET_TMP) || ss.insertSheet(CONFIG.SHEET_TMP);
    tmp.clearContents();
    tmp.getRange(1, 1).setFormula(
      '=IFERROR(GOOGLEFINANCE("KRX:'    + code + '","name"),' +
      'IFERROR(GOOGLEFINANCE("KOSDAQ:' + code + '","name"),"-"))'
    );
    SpreadsheetApp.flush();
    Utilities.sleep(1500);
    var val  = tmp.getRange(1, 1).getValue();
    try { ss.deleteSheet(tmp); SpreadsheetApp.flush(); } catch(e) { try { tmp.clearContents(); SpreadsheetApp.flush(); } catch(e2) {} }
    var name = (val && val !== '-' && !String(val).startsWith('#')) ? val.toString().trim() : '';
    return jsonOk({ name: name, officialName: name });
  } catch(err) {
    return jsonError('종목명 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  스냅샷 저장
// ════════════════════════════════════════════════════════════════════
function handleSaveSnapshot(dateStr, dataJson) {
  try {
    if (!dateStr || !dataJson) return jsonError('date, data 필요');
    var rows = JSON.parse(decodeURIComponent(dataJson));
    if (!Array.isArray(rows) || rows.length === 0) return jsonError('빈 데이터');

    var ss        = getss();
    var normDate  = _normalizeDate(dateStr);
    var newRows = rows.map(function(r) {
      return [normDate, r.code||'', r.name||'', r.qty||0,
              r.costAmt||0, r.evalAmt||0, r.pnl||0,
              r.pct ? parseFloat(r.pct.toFixed(2)) : 0];
    });
    writeSnapshotRows(ss, normDate, newRows, true);
    return jsonOk({ saved: newRows.length, date: normDate });
  } catch(err) {
    return jsonError('스냅샷 저장 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  손익 히스토리 조회
// ════════════════════════════════════════════════════════════════════
function handleGetHistory(fromStr, toStr) {
  try {
    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ history: [] });

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    var map  = {};
    data.forEach(function(row) {
      var date = (row[0] || '').toString().trim();
      if (!date) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      if (!map[date]) map[date] = { evalAmt: 0, costAmt: 0 };
      map[date].evalAmt += parseFloat(row[5]) || 0;
      map[date].costAmt += parseFloat(row[4]) || 0;
    });

    var history = Object.keys(map).sort().map(function(date) {
      var ev  = Math.round(map[date].evalAmt);
      var co  = Math.round(map[date].costAmt);
      var pnl = ev - co;
      var pct = co > 0 ? parseFloat(((pnl / co) * 100).toFixed(2)) : 0;
      return { date: date, evalAmt: ev, costAmt: co, pnl: pnl, pct: pct };
    });
    return jsonOk({ snapshots: history });
  } catch(err) {
    return jsonError('히스토리 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  배당 조회
// ════════════════════════════════════════════════════════════════════
function handleDividendFetch(codes) {
  try {
    var ss  = getss();
    var tmp = ss.getSheetByName(CONFIG.SHEET_TMP) || ss.insertSheet(CONFIG.SHEET_TMP);
    tmp.clearContents();

    var toDate   = new Date();
    var fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 13);
    var fmt = function(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); };

    codes.forEach(function(rawCode, i) {
      var code = rawCode.toString().trim();
      if (!code) return;
      tmp.getRange(i * 20 + 1, 1).setFormula(
        '=IFERROR(GOOGLEFINANCE("KRX:'    + code + '","dividends","' + fmt(fromDate) + '","' + fmt(toDate) + '"),' +
        'IFERROR(GOOGLEFINANCE("KOSDAQ:' + code + '","dividends","' + fmt(fromDate) + '","' + fmt(toDate) + '"),"NO_DATA"))'
      );
    });
    SpreadsheetApp.flush();
    Utilities.sleep(Math.min(8000 + codes.length * 500, 55000)); // 종목수 × 300ms, 최대 45초

    var results = {};
    codes.forEach(function(rawCode, i) {
      var code     = rawCode.toString().trim();
      if (!code) return;
      var startRow = i * 20 + 1;
      var cellVal  = tmp.getRange(startRow, 1).getValue();
      if (!cellVal || cellVal === 'NO_DATA' || String(cellVal).startsWith('#')) {
         results[code] = { perShare: 0, freq: '-', months: [], count: 0 }; return;
      }
// GOOGLEFINANCE dividends: 첫 행은 헤더("Date","Amount"), 데이터는 2번째 행부터
     var divRows  = [];
     var headerVal = String(cellVal).toLowerCase();
     var dataStartOffset = (headerVal === 'date' || headerVal.includes('date')) ? 1 : 0;
     var divBlock = tmp.getRange(startRow + 1 + dataStartOffset, 1, 18, 2).getValues();
      for (var ri = 0; ri < divBlock.length; ri++) {
        var dv = divBlock[ri][0];
        var av = divBlock[ri][1];
        if (!dv || !av) break;
        var d = new Date(dv);
        if (isNaN(d.getTime())) break;
        divRows.push({ month: d.getMonth() + 1, amount: parseFloat(av) || 0 });
      }
      if (divRows.length === 0) { results[code] = { perShare: 0, freq: '-', months: [], count: 0 }; return; }
      var months   = divRows.map(function(r) { return r.month; });
      var uniqM    = months.filter(function(v,i,a){ return a.indexOf(v)===i; }).sort(function(a,b){return a-b;});
      var count    = divRows.length;
      var freq     = count >= 10 ? '월배당' : count >= 4 ? '분기' : count >= 2 ? '반기' : '연간';
      var perShare = parseFloat((divRows.reduce(function(s,r){return s+r.amount;},0)/count).toFixed(4));
      results[code] = { perShare: perShare, freq: freq, months: uniqM, count: count };
    });

    try { ss.deleteSheet(tmp); SpreadsheetApp.flush(); } catch(e) { try { tmp.clearContents(); SpreadsheetApp.flush(); } catch(e2) {} }
    return jsonOk({ dividends: results });
  } catch(err) {
    return jsonError('배당 조회 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  getPrices — 가격이력 캐시 우선, 없으면 GOOGLEFINANCE
// ════════════════════════════════════════════════════════════════════
function handleGetPricesCompat(codesParam) {
  try {
    var ss       = getss();
    var todayStr = today();
    var reqCodes = codesParam.split(',').map(function(c){ return c.trim(); }).filter(Boolean);

    var phPrices = getPriceHistoryRow(ss, todayStr);
    var prices   = {};
    var missing  = [];

    reqCodes.forEach(function(code) {
      if (phPrices[code] && phPrices[code] > 0) prices[code] = phPrices[code];
      else missing.push(code);
    });

    if (missing.length > 0) {
      var codeNameMap = {};
      getCodeItems(ss).forEach(function(item) { codeNameMap[item.code] = item.name; });
      var missingItems = missing.map(function(c){ return { code: c, name: codeNameMap[c] || c }; });
      var gfPrices     = fetchPricesGoogleFinance(missingItems, todayStr, ss);
      var newPriceItems = [];
      var stillMissing  = [];
      missing.forEach(function(code) {
        if (gfPrices[code] && gfPrices[code].price > 0) {
          prices[code] = gfPrices[code].price;
          newPriceItems.push({ code: code, name: codeNameMap[code] || code, price: gfPrices[code].price });
        } else {
          stillMissing.push(code);
        }
      });
      if (newPriceItems.length > 0) batchUpsertPriceHistory(ss, todayStr, newPriceItems);

      // ★ 버그수정: GOOGLEFINANCE도 실패한 종목은 가격이력 시트에서 가장 최근 날짜 값으로 fallback
      if (stillMissing.length > 0) {
        var latestPrices = getLatestPriceHistory(ss, stillMissing);
        stillMissing.forEach(function(code) {
          if (latestPrices[code] && latestPrices[code] > 0) {
            prices[code] = latestPrices[code];
          }
        });
      }
    }
    return jsonOk({ prices: prices });
  } catch(err) {
    return jsonError('getPrices 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  getPriceHistory — 날짜 범위별 가격이력 조회
// ════════════════════════════════════════════════════════════════════
function handleGetPriceHistory(fromStr, toStr, codesParam) {
  try {
    var ss = getss();
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return jsonOk({ dates: [], prices: {} });

    var data     = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
    var reqCodes = codesParam ? codesParam.split(',').map(function(c){ return c.trim(); }).filter(Boolean) : null;
    var reqAliasToCanonical = reqCodes ? _buildCodeAliasMap(reqCodes) : null;
    var dateMap  = {};

    data.forEach(function(row) {
      var date  = (row[0] || '').toString().trim();
      var code  = (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (!date || !key || price <= 0) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      if (reqAliasToCanonical && !reqAliasToCanonical[key]) return;
      var outKey = reqAliasToCanonical ? (reqAliasToCanonical[key] || key) : key;
      if (!dateMap[date]) dateMap[date] = {};
      dateMap[date][outKey] = price;
    });

    // dateMap 키에서 직접 추출 — O(n), 중복 없음
    var allDates = Object.keys(dateMap).sort();

    var pricesByCode = {};
    allDates.forEach(function(date) {
      Object.keys(dateMap[date]).forEach(function(key) {
        if (!pricesByCode[key]) pricesByCode[key] = [];
        pricesByCode[key].push({ date: date, price: dateMap[date][key] });
      });
    });

    return jsonOk({ dates: allDates, prices: pricesByCode });
  } catch(err) {
    return jsonError('getPriceHistory 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  saveManualPrice — 펀드·TDF NAV 수동 입력
// ════════════════════════════════════════════════════════════════════
function handleSaveManualPrice(dateStr, name, priceStr) {
  try {
    if (!dateStr || !name || !priceStr) return jsonError('date, name, price 필요');
    var price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return jsonError('유효하지 않은 가격: ' + priceStr);
    var ss = getss();

    // ★ 버그수정: name 파라미터가 종목코드 형식이면
    //   code 자리에 넣고 name은 종목코드 시트에서 찾아서 저장
    //   (프론트 applyPrices에서 코드 있는 종목은 key=code로 넘기기 때문)
    // ★ 영문+숫자 혼합 코드(0046Y0, 0080G0, F00001 등)도 코드로 인식
    var isCodeLike = /^[A-Z0-9]{5,8}$/.test((name || '').trim().toUpperCase()) &&
                    !/^[가-힣a-z\s]+$/.test((name || '').trim());
    var saveCode, saveName;
    if (isCodeLike) {
      saveCode = name.trim();
      // 종목명은 종목코드 시트에서 찾기, 없으면 빈 문자열
      var codeItems = getCodeItems(ss);
      saveName = '';
      for (var ci = 0; ci < codeItems.length; ci++) {
        if (codeItems[ci].code === saveCode) { saveName = codeItems[ci].name; break; }
      }
    } else {
      saveCode = '';
      saveName = name;
    }

    upsertPriceHistory(ss, dateStr, saveCode, saveName, price);
    return jsonOk({ saved: true, date: dateStr, name: name, price: price });
  } catch(err) {
    return jsonError('saveManualPrice 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트 특정 날짜 행 읽기
// ════════════════════════════════════════════════════════════════════
function getPriceHistoryRow(ss, dateStr) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
    var result = {};
    var legacyToCanonical = {};
    getCodeItems(ss).forEach(function(item) {
      var canonical = item.code;
      var legacy = _legacyDigitsCode(item.code);
      if (legacy && canonical && legacy !== canonical) legacyToCanonical[legacy] = canonical;
    });
    data.forEach(function(row) {
      if ((row[0] || '').toString().trim() !== dateStr) return;
      var code  = (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (key && price > 0) {
        result[key] = price;
        if (code && legacyToCanonical[code]) result[legacyToCanonical[code]] = price;
      }
    });
    return result;
  } catch(err) {
    Logger.log('❌ getPriceHistoryRow 실패: ' + err.message);
    return {};
  }
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트에서 지정 코드들의 가장 최근 날짜 가격 조회
// ════════════════════════════════════════════════════════════════════
function getLatestPriceHistory(ss, codes) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
    var codeAliasToCanonical = _buildCodeAliasMap(codes);
    // code → { date, price } 최신값 유지
    var latest = {};
    data.forEach(function(row) {
      var date  = (row[0] || '').toString().trim();
      var code  = (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (!date || !key || price <= 0) return;
      var outKey = codeAliasToCanonical[key];
      if (!outKey) return;
      if (!latest[outKey] || date > latest[outKey].date) {
        latest[outKey] = { date: date, price: price };
      }
    });
    var result = {};
    Object.keys(latest).forEach(function(key) { result[key] = latest[key].price; });
    return result;
  } catch(err) {
    Logger.log('❌ getLatestPriceHistory 실패: ' + err.message);
    return {};
  }
}


function batchUpsertPriceHistory(ss, dateStr, items) {
  if (!items || items.length === 0) return;
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph) {
      ph = ss.insertSheet(CONFIG.SHEET_PH);
      ph.getRange(1,1,1,4).setValues([['날짜','종목코드','종목명','가격']]);
      ph.getRange(1,1,1,4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100);
    }

    var lastRow     = ph.getLastRow();
    var existingMap = {};
    if (lastRow > 1) {
      var data = ph.getRange(2, 1, lastRow - 1, 3).getValues();
      data.forEach(function(row, i) {
        var d = (row[0]||'').toString().trim();
        var c = _cleanCode(row[1]) || (row[2]||'').toString().trim();
        if (d && c) existingMap[d + '|' + c] = i + 2;
      });
    }

    var toAppend = [];
    var toUpdate = [];
    items.forEach(function(item) {
      var cleanedCode = _cleanCode(item.code);
      var rawName     = (item.name || '').toString().trim();
      var cleanedName = (rawName && isNaN(Number(rawName))) ? rawName : '';
      var key         = dateStr + '|' + (cleanedCode || cleanedName);

      if (existingMap[key]) {
        toUpdate.push({ row: existingMap[key], price: item.price });
      } else {
        toAppend.push([dateStr, cleanedCode, cleanedName, item.price]);
      }
    });

    if (toUpdate.length > 0) {
      toUpdate.sort(function(a, b) { return a.row - b.row; });
      var i = 0;
      while (i < toUpdate.length) {
        var startRow = toUpdate[i].row;
        var prices   = [toUpdate[i].price];
        while (i + 1 < toUpdate.length && toUpdate[i + 1].row === toUpdate[i].row + 1) {
          i++;
          prices.push(toUpdate[i].price);
        }
        ph.getRange(startRow, 4, prices.length, 1).setValues(prices.map(function(p){ return [p]; }));
        i++;
      }
    }
    if (toAppend.length > 0) {
      ph.getRange(ph.getLastRow() + 1, 1, toAppend.length, 4).setValues(toAppend);
    }
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ batchUpsertPriceHistory 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트 upsert (단건)
// ════════════════════════════════════════════════════════════════════
function upsertPriceHistory(ss, dateStr, code, name, price) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph) {
      ph = ss.insertSheet(CONFIG.SHEET_PH);
      ph.getRange(1,1,1,4).setValues([['날짜','종목코드','종목명','가격']]);
      ph.getRange(1,1,1,4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100);
    }
    var cleanedCode = _cleanCode(code);
    var rawName     = (name || '').toString().trim();
    var cleanedName = (rawName && isNaN(Number(rawName))) ? rawName : '';
    var matchKey    = cleanedCode || cleanedName;
    var lastRow     = ph.getLastRow();
    if (lastRow > 1) {
      var data = ph.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < data.length; i++) {
        var rowDate = data[i][0].toString().trim();
        var rowCode = data[i][1].toString().trim();
        var rowName = data[i][2].toString().trim();
        var rowKey  = rowCode || rowName;
        if (rowDate === dateStr && rowKey === matchKey) {
          ph.getRange(i + 2, 4).setValue(price);
          SpreadsheetApp.flush();
          return;
        }
      }
    }
    ph.getRange(ph.getLastRow() + 1, 1, 1, 4).setValues([[dateStr, cleanedCode, cleanedName, price]]);
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ upsertPriceHistory 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  보유현황 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncHoldings(dataJson) {
  try {
    var holdings;
    try { holdings = _parseArrayParam(dataJson, 'holdings'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(holdings)) return jsonError('배열 형식 필요');

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_HOLD);
      sh.setColumnWidth(1,90); sh.setColumnWidth(2,180);
      sh.setColumnWidth(3,70); sh.setColumnWidth(4,110); sh.setColumnWidth(5,100);
      sh.setColumnWidth(6,120);
    }
    sh.clearContents();
    sh.getRange(1,1,1,6).setValues([['종목코드','종목명','수량','매수원금','자산유형','계좌']]);
    sh.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (holdings.length > 0) {
      var rows = holdings.map(function(h) {
        return [h.code||'', h.name||'', h.qty||0, h.costAmt||0, h.assetType||'주식', h.acct||''];
      });
      sh.getRange(2, 1, rows.length, 6).setValues(rows);
    }
    SpreadsheetApp.flush();
    return jsonOk({ synced: holdings.length });
  } catch(err) {
    return jsonError('syncHoldings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  거래이력 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncTrades(dataJson) {
  try {
    var trades;
    try { trades = _parseArrayParam(dataJson, 'trades'); } catch(e) { return jsonError(e.message); }
    if (!Array.isArray(trades)) return jsonError('배열 형식 필요');

    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_TRADES);
      sh.setColumnWidth(1,100); sh.setColumnWidth(2,70);  sh.setColumnWidth(3,100);
      sh.setColumnWidth(4,180); sh.setColumnWidth(5,90);  sh.setColumnWidth(6,70);
      sh.setColumnWidth(7,90);  sh.setColumnWidth(8,80);  sh.setColumnWidth(9,200);
    }
    sh.clearContents();
    sh.getRange(1,1,1,9).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모']]);
    sh.getRange(1,1,1,9).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (trades.length > 0) {
      trades.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
      var rows = trades.map(function(t) {
        return [_normalizeDate(t.date), t.tradeType||'', t.acct||'', t.name||'',
                t.code||'', t.qty||0, t.price||0, t.assetType||'주식', t.memo||''];
      });
      sh.getRange(2, 1, rows.length, 9).setValues(rows);
    }
    SpreadsheetApp.flush();
    return jsonOk({ synced: trades.length });
  } catch(err) {
    return jsonError('syncTrades 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  매일 오후 4시 자동 실행 — 가격이력 저장 + 스냅샷 생성
// ════════════════════════════════════════════════════════════════════
function saveDailyPriceHistory() {
  try {
    var ss       = getss();
    var todayStr = today();

    var items = getCodeItems(ss);
    if (items.length === 0) { Logger.log('종목코드 없음'); return; }

    var existing = getPriceHistoryRow(ss, todayStr);
    var toFetch  = items.filter(function(item){ return !existing[item.code]; });
    var prices   = {};
    Object.keys(existing).forEach(function(k){ prices[k] = existing[k]; });

    if (toFetch.length > 0) {
      var gfPrices    = fetchPricesGoogleFinance(toFetch, todayStr, ss);
      var newPriceRows = [];
      toFetch.forEach(function(item) {
        var p = gfPrices[item.code];
        if (p && p.price > 0) {
          newPriceRows.push({ code: item.code, name: item.name, price: p.price });
          prices[item.code] = p.price;
        }
      });
      if (newPriceRows.length > 0) batchUpsertPriceHistory(ss, todayStr, newPriceRows);
    }

    var holdSh = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!holdSh || holdSh.getLastRow() < 2) {
      Logger.log('⚠️ 보유현황 시트 없음 — HTML에서 한 번 접속하면 자동 동기화됩니다'); return;
    }
    var holdData = holdSh.getRange(2, 1, holdSh.getLastRow() - 1, 5).getValues();

    var snapRows = [];
    holdData.forEach(function(row) {
      var code    = (row[0] || '').toString().trim();
      var name    = (row[1] || '').toString().trim();
      var qty     = parseFloat(row[2]) || 0;
      var costAmt = parseFloat(row[3]) || 0;
      if (!name || qty <= 0) return;
      var price   = (code && prices[code]) ? prices[code] : 0;
      var evalAmt = price > 0 ? Math.round(price * qty) : costAmt;
      var pnl     = evalAmt - costAmt;
      var pct     = costAmt > 0 ? parseFloat(((pnl / costAmt) * 100).toFixed(2)) : 0;
      snapRows.push([todayStr, code, name, qty, costAmt, evalAmt, pnl, pct]);
    });

    if (snapRows.length === 0) { Logger.log('스냅샷 저장할 데이터 없음'); return; }
    writeSnapshotRows(ss, todayStr, snapRows, true);
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ saveDailyPriceHistory 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  트리거 등록
// ════════════════════════════════════════════════════════════════════
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'saveDailyPriceHistory' || fn === 'cleanDeadCodes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanDeadCodes').timeBased().everyDays(1).atHour(16).nearMinute(30).create();
  ScriptApp.newTrigger('saveDailyPriceHistory').timeBased().everyDays(1).atHour(17).create();
  Logger.log('트리거 등록 완료: 매일 16:30 cleanDeadCodes → 17:00 saveDailyPriceHistory');
  try { SpreadsheetApp.getUi().alert('✅ 트리거 등록 완료!\n16:30 종목코드 정리 → 17:00 가격이력 자동 저장'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  소급채우기 — 팝업 입력창
// ════════════════════════════════════════════════════════════════════
function backfillRangePrompt() {
  var ui = SpreadsheetApp.getUi();

  var r1 = ui.prompt('소급채우기 — 시작 연월', '시작 연월을 입력하세요\n예) 2024-01', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var fromStr = r1.getResponseText().trim();

  var r2 = ui.prompt('소급채우기 — 종료 연월', '종료 연월을 입력하세요\n예) 2026-03', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var toStr = r2.getResponseText().trim();

  var fromMatch = fromStr.match(/^(\d{4})-(\d{1,2})$/);
  var toMatch   = toStr.match(/^(\d{4})-(\d{1,2})$/);
  if (!fromMatch || !toMatch) {
    ui.alert('❌ 형식 오류: YYYY-MM 형식으로 입력해주세요.\n예) 2024-01');
    return;
  }

  BACKFILL_CONFIG.fromYear  = parseInt(fromMatch[1]);
  BACKFILL_CONFIG.fromMonth = parseInt(fromMatch[2]);
  BACKFILL_CONFIG.toYear    = parseInt(toMatch[1]);
  BACKFILL_CONFIG.toMonth   = parseInt(toMatch[2]);

  backfillRange();
}

function backfillRange() {
  var from = BACKFILL_CONFIG.fromYear * 100 + BACKFILL_CONFIG.fromMonth;
  var to   = BACKFILL_CONFIG.toYear   * 100 + BACKFILL_CONFIG.toMonth;
  if (BACKFILL_CONFIG.fromMonth < 1 || BACKFILL_CONFIG.fromMonth > 12 ||
      BACKFILL_CONFIG.toMonth   < 1 || BACKFILL_CONFIG.toMonth   > 12) {
    try { SpreadsheetApp.getUi().alert('❌ BACKFILL_CONFIG 오류: fromMonth/toMonth 는 1~12 사이여야 합니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    Logger.log('backfillRange 중단: 월 범위 오류'); return;
  }
  if (from > to) {
    try { SpreadsheetApp.getUi().alert('❌ BACKFILL_CONFIG 오류: 시작 연월이 종료 연월보다 늦습니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    Logger.log('backfillRange 중단: 시작 연월 > 종료 연월'); return;
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty('bf_fromYear',  String(BACKFILL_CONFIG.fromYear));
  props.setProperty('bf_fromMonth', String(BACKFILL_CONFIG.fromMonth));
  props.setProperty('bf_toYear',    String(BACKFILL_CONFIG.toYear));
  props.setProperty('bf_toMonth',   String(BACKFILL_CONFIG.toMonth));
  props.setProperty('bf_overwrite', String(BACKFILL_CONFIG.overwrite));
  props.setProperty('bf_curYear',   String(BACKFILL_CONFIG.fromYear));
  props.setProperty('bf_curMonth',  String(BACKFILL_CONFIG.fromMonth));
  props.setProperty('bf_done',      'false');

  Logger.log('소급채우기 시작: ' + BACKFILL_CONFIG.fromYear + '-' + _pad(BACKFILL_CONFIG.fromMonth) +
             ' ~ ' + BACKFILL_CONFIG.toYear + '-' + _pad(BACKFILL_CONFIG.toMonth));
  _backfillExecute();
}

function backfillResume() {
  var props = PropertiesService.getScriptProperties();
  var done  = props.getProperty('bf_done');
  if (done === 'true') {
    try { SpreadsheetApp.getUi().alert('✅ 이미 소급채우기가 완료된 상태입니다.\n새로 실행하려면 backfillRange()를 사용하세요.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  if (!props.getProperty('bf_curYear')) {
    try { SpreadsheetApp.getUi().alert('⚠️ 이어받을 진행상황이 없습니다.\nbackfillRange()를 먼저 실행하세요.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  Logger.log('소급채우기 재개: ' + props.getProperty('bf_curYear') + '-' + _pad(parseInt(props.getProperty('bf_curMonth'))));
  _backfillExecute();
}

function backfillStatus() {
  var props    = PropertiesService.getScriptProperties();
  var curYear  = props.getProperty('bf_curYear');
  var curMonth = props.getProperty('bf_curMonth');
  var toYear   = props.getProperty('bf_toYear');
  var toMonth  = props.getProperty('bf_toMonth');
  var done     = props.getProperty('bf_done');

  var msg;
  if (!curYear) {
    msg = '소급채우기를 시작한 기록이 없습니다.';
  } else if (done === 'true') {
    msg = '✅ 소급채우기 완료!\n종료 시점: ' + toYear + '-' + _pad(parseInt(toMonth));
  } else {
    msg = '⏳ 진행 중\n현재 위치: ' + curYear + '-' + _pad(parseInt(curMonth)) +
          '\n목표: ' + toYear + '-' + _pad(parseInt(toMonth)) +
          '\n\nbackfillResume() 을 실행하면 이어서 진행합니다.';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _backfillExecute() {
  var props     = PropertiesService.getScriptProperties();
  var fromYear  = parseInt(props.getProperty('bf_fromYear'));
  var fromMonth = parseInt(props.getProperty('bf_fromMonth'));
  var toYear    = parseInt(props.getProperty('bf_toYear'));
  var toMonth   = parseInt(props.getProperty('bf_toMonth'));
  var overwrite = props.getProperty('bf_overwrite') === 'true';
  var curYear   = parseInt(props.getProperty('bf_curYear'));
  var curMonth  = parseInt(props.getProperty('bf_curMonth'));

  var ss = getss();

  var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
  if (!tradeSh || tradeSh.getLastRow() < 2) {
    var errMsg = '⚠️ 거래이력 시트가 없습니다.\nHTML 대시보드를 열면 거래이력이 자동으로 동기화됩니다.';
    Logger.log(errMsg);
    try { SpreadsheetApp.getUi().alert(errMsg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  var tradeData = tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, 8).getValues();

  var nameToCode = {};
  getCodeItems(ss).forEach(function(item){ nameToCode[item.name] = item.code; });
  tradeData.forEach(function(row) {
    var name = (row[3]||'').toString().trim();
    var code = (row[4]||'').toString().trim();
    if (name && code && !nameToCode[name]) nameToCode[name] = code;
  });

  var existingDates = {};
  if (!overwrite) {
    var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (snapSh && snapSh.getLastRow() > 1) {
      snapSh.getRange(2, 1, snapSh.getLastRow() - 1, 1).getValues().forEach(function(r) {
        existingDates[(r[0]||'').toString().trim()] = true;
      });
    }
  }

  var startTime    = new Date().getTime();
  var TIME_LIMIT   = 5 * 60 * 1000;
  var totalSuccess = 0, totalFail = 0;
  var interrupted  = false;
  var lastYear     = curYear, lastMonth = curMonth;

  outer:
  while (true) {
    if (curYear > toYear || (curYear === toYear && curMonth > toMonth)) break;

    var tradingDays = getTradingDays(curYear, curMonth);
    var toFetch     = overwrite
      ? tradingDays
      : tradingDays.filter(function(d){ return !existingDates[d]; });

    Logger.log(curYear + '-' + _pad(curMonth) + ' 처리 시작: ' + toFetch.length + '일');

    for (var i = 0; i < toFetch.length; i++) {
      if (new Date().getTime() - startTime > TIME_LIMIT) {
        interrupted = true;
        lastYear    = curYear;
        lastMonth   = curMonth;
        break outer;
      }

      var dateStr = toFetch[i];
      try {
        var holdAtDate = calcHoldingsAtDate(tradeData, dateStr, nameToCode);
        if (Object.keys(holdAtDate).length === 0) continue;

        var codeItems = Object.keys(holdAtDate)
          .map(function(k){ return holdAtDate[k]; })
          .filter(function(h){ return h.code; })
          .map(function(h){ return { code: h.code, name: h.name }; });

        var prices = {};
        if (codeItems.length > 0) {
          var gfResult = {};
          try {
            gfResult = fetchPricesGoogleFinance(codeItems, dateStr, ss);
          } catch(gfErr) {
            Logger.log(dateStr + ' GF 실패, 재시도: ' + gfErr.message);
            Utilities.sleep(3000);
            try { gfResult = fetchPricesGoogleFinance(codeItems, dateStr, ss); } catch(e2) {}
          }
          Object.keys(gfResult).forEach(function(code) {
            var val = gfResult[code];
            prices[code] = val.price || val;
          });
        }

        var snapRows = [];
        Object.keys(holdAtDate).forEach(function(k) {
          var h = holdAtDate[k];
          if (h.qty <= 0) return;
          var price   = (h.code && prices[h.code]) ? prices[h.code] : 0;
          var evalAmt = price > 0 ? Math.round(price * h.qty) : h.costAmt;
          var pnl     = evalAmt - h.costAmt;
          var pct     = h.costAmt > 0 ? parseFloat(((pnl / h.costAmt) * 100).toFixed(2)) : 0;
          snapRows.push([dateStr, h.code, h.name, h.qty, h.costAmt, evalAmt, pnl, pct]);
        });

        if (snapRows.length > 0) {
          writeSnapshotRows(ss, dateStr, snapRows, overwrite);
          // ★ 가격이력 시트도 함께 저장 — 프론트 과거 날짜 조회용
          var phItems = Object.keys(holdAtDate)
            .map(function(k){ return holdAtDate[k]; })
            .filter(function(h){ return h.code && h.qty > 0 && prices[h.code] > 0; })
            .map(function(h){ return { code: h.code, name: h.name, price: prices[h.code] }; });
          if (phItems.length > 0) batchUpsertPriceHistory(ss, dateStr, phItems);
          totalSuccess++;
        }
      } catch(e) {
        Logger.log('❌ ' + dateStr + ' 실패: ' + e.message);
        totalFail++;
      }
    }

    lastYear  = curYear;
    lastMonth = curMonth;
    if (curMonth === 12) { curYear++; curMonth = 1; }
    else { curMonth++; }
  }

  SpreadsheetApp.flush();

  if (interrupted) {
    props.setProperty('bf_curYear',  String(lastYear));
    props.setProperty('bf_curMonth', String(lastMonth));
    var msg = '⏱ 시간 초과로 잠시 중단\n\n' +
              '완료: ' + totalSuccess + '일 성공 / ' + totalFail + '일 실패\n' +
              '중단 위치: ' + lastYear + '-' + _pad(lastMonth) + '\n\n' +
              '📌 [📆 소급채우기 이어서] 메뉴를 눌러 계속 진행하세요.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  } else {
    props.setProperty('bf_curYear',  String(toYear));
    props.setProperty('bf_curMonth', String(toMonth));
    props.setProperty('bf_done', 'true');
    var doneMsg = '✅ 소급채우기 완료!\n\n' +
                  fromYear + '-' + _pad(fromMonth) + ' ~ ' + toYear + '-' + _pad(toMonth) + '\n' +
                  '성공: ' + totalSuccess + '일 / 실패: ' + totalFail + '일';
    Logger.log(doneMsg);
    try { SpreadsheetApp.getUi().alert(doneMsg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  }
}


// ════════════════════════════════════════════════════════════════════
//  거래이력 누적 계산 — dateStr 시점의 보유현황 반환
// ════════════════════════════════════════════════════════════════════
function calcHoldingsAtDate(tradeData, dateStr, nameToCode) {
  var map = {};
  tradeData.forEach(function(row) {
    var rawDate   = row[0];
    var date      = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : (rawDate||'').toString().trim().slice(0, 10);
    var tradeType = (row[1]||'').toString().trim();
    var name      = (row[3]||'').toString().trim();
    var code      = (row[4]||'').toString().trim() || (nameToCode[name] || '');
    var qty       = parseFloat(row[5]) || 0;
    var price     = parseFloat(row[6]) || 0;
    var assetType = (row[7]||'주식').toString().trim();
    if (!date || !name || !tradeType || date > dateStr) return;

    if (!map[name]) map[name] = { name: name, code: code, qty: 0, totalCost: 0, assetType: assetType };
    if (!map[name].code && code) map[name].code = code;

    if (tradeType === 'buy') {
      map[name].qty       += qty;
      map[name].totalCost += qty * price;
    } else if (tradeType === 'sell') {
      var avgCost = map[name].qty > 0 ? map[name].totalCost / map[name].qty : 0;
      var sellQty = Math.min(qty, map[name].qty);
      map[name].qty       -= sellQty;
      map[name].totalCost -= sellQty * avgCost;
      if (map[name].qty < 0.0001) { map[name].qty = 0; map[name].totalCost = 0; }
    }
  });

  var result = {};
  Object.keys(map).forEach(function(name) {
    var h = map[name];
    if (h.qty > 0.0001) {
      result[name] = { name: h.name, code: h.code,
        qty:     Math.round(h.qty * 10000) / 10000,
        costAmt: Math.round(h.totalCost), assetType: h.assetType };
    }
  });
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  영업일 목록 (토·일 제외)
// ════════════════════════════════════════════════════════════════════
function getTradingDays(year, month) {
  var days     = [];
  var last     = new Date(year, month, 0).getDate();
  var todayStr = today();
  for (var d = 1; d <= last; d++) {
    var dt  = new Date(year, month - 1, d);
    var dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    var ds = Utilities.formatDate(dt, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    if (ds >= todayStr) continue;
    days.push(ds);
  }
  return days;
}

// ════════════════════════════════════════════════════════════════════
//  스냅샷 시트 upsert
// ════════════════════════════════════════════════════════════════════
function writeSnapshotRows(ss, dateStr, newRows, overwrite) {
  try {
    var sh     = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    var header = [['날짜','종목코드','종목명','수량','매수원금','평가금액','손익','수익률(%)']];

    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
      sh.getRange(1,1,1,8).setValues(header);
      sh.getRange(1,1,1,8).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (newRows.length > 0) sh.getRange(2, 1, newRows.length, 8).setValues(newRows);
      return;
    }

    if (sh.getLastRow() > 1) {
      var existing = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
      var kept     = existing.filter(function(r){ return (r[0]||'').toString().trim() !== dateStr; });
      if (!overwrite && kept.length < existing.length) return;
      var combined = kept.concat(newRows);
      sh.clearContents();
      sh.getRange(1,1,1,8).setValues(header);
      sh.getRange(1,1,1,8).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (combined.length > 0) sh.getRange(2, 1, combined.length, 8).setValues(combined);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
    }
  } catch(err) {
    Logger.log('❌ writeSnapshotRows 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 정제
// ════════════════════════════════════════════════════════════════════
function _cleanCode(raw) {
  var s = (raw || '').toString().trim().toUpperCase();
  if (!s) return '';

  // 허용 문자만 남김 (숫자/영문)
  var alnum = s.replace(/[^A-Z0-9]/g, '');
  if (!alnum) return '';

  // 숫자 코드: 기존 동작 유지(6자리 0패딩)
  if (/^\d+$/.test(alnum)) {
    while (alnum.length < 6) alnum = '0' + alnum;
    return alnum;
  }

  // 영문+숫자 혼합 코드(예: 0046Y0, F00001): 6자리 유효코드만 허용
  if (/^[A-Z0-9]{6}$/.test(alnum)) return alnum;
  return '';
}

// 과거 버전 호환: 영문 제거 후 숫자만 6자리로 저장되던 키 복원용
function _legacyDigitsCode(raw) {
  var s = (raw || '').toString().trim();
  if (!s) return '';
  var digits = s.replace(/\D/g, '');
  if (!digits) return '';
  while (digits.length < 6) digits = '0' + digits;
  return digits;
}

function _buildCodeAliasMap(codes) {
  var map = {};
  (codes || []).forEach(function(rawCode) {
    var canonical = _cleanCode(rawCode) || (rawCode || '').toString().trim();
    if (!canonical) return;
    map[canonical] = canonical;
    var legacy = _legacyDigitsCode(rawCode);
    if (legacy && legacy !== canonical) map[legacy] = canonical;
  });
  return map;
}

function _pad(n) { return n < 10 ? '0' + n : '' + n; }

// ════════════════════════════════════════════════════════════════════
//  종목코드 목록 로드
// ════════════════════════════════════════════════════════════════════
function getCodeItems(ss) {
  try {
    var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
    if (!cs || cs.getLastRow() < 2) return [];
    var numCols = Math.max(cs.getLastColumn(), 4);
    return cs.getRange(2, 1, cs.getLastRow() - 1, numCols).getValues()
      .map(function(row) {
        return {
          code: _cleanCode(row[0]),
          name: (row[1]||'').toString().trim(),
          type: (row[2]||'주식').toString().trim(),
          sector: (row[3]||'기타').toString().trim(),
        };
      })
      .filter(function(item){ return item.code && item.code !== '000000'; });
  } catch(err) {
    Logger.log('❌ getCodeItems 실패: ' + err.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 목록 반환
// ════════════════════════════════════════════════════════════════════
function handleGetCodeList() {
  try {
    return jsonOk({ codes: getCodeItems(getss()) });
  } catch(err) {
    return jsonError('getCodeList 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  거래이력 / 보유현황 읽기
// ════════════════════════════════════════════════════════════════════
function handleGetTrades() {
  try {
    var ss = getss();
    var sh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ trades: [] });
    var numCols = sh.getLastColumn();
    var data    = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
    var trades  = data
      .filter(function(r){ return r[0] || r[3]; })
      .map(function(r) {
        return {
          date:      (r[0] instanceof Date)
                       ? Utilities.formatDate(r[0], CONFIG.TIMEZONE, 'yyyy-MM-dd')
                       : (r[0] || '').toString().trim().slice(0, 10),
          tradeType: (r[1] || '').toString(),
          acct:      (r[2] || '').toString(),
          name:      (r[3] || '').toString(),
          code:      (r[4] || '').toString(),
          qty:       parseFloat(r[5]) || 0,
          price:     parseFloat(r[6]) || 0,
          assetType: (r[7] || '주식').toString(),
          memo:      (r[8] || '').toString(),
        };
      });
    return jsonOk({ trades: trades });
  } catch(err) {
    return jsonError('getTrades 실패: ' + err.message);
  }
}

function handleGetHoldings() {
  try {
    var ss      = getss();
    var sh      = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!sh || sh.getLastRow() < 2) return jsonOk({ holdings: [] });
    var numCols  = Math.max(sh.getLastColumn(), 5);
    var data     = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
    var holdings = data
      .filter(function(r){ return r[1]; })
      .map(function(r) {
        return {
          code:      (r[0] || '').toString(),
          name:      (r[1] || '').toString(),
          qty:       parseFloat(r[2]) || 0,
          costAmt:   parseFloat(r[3]) || 0,
          assetType: (r[4] || '주식').toString(),
          acct:      (r[5] || '').toString(),
        };
      });
    return jsonOk({ holdings: holdings });
  } catch(err) {
    return jsonError('getHoldings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  설정 저장 / 불러오기
// ════════════════════════════════════════════════════════════════════
// ★ _parseArrayParam: JSON 파싱 후 배열인지 검증
function _parseArrayParam(dataJson, label) {
  var parsed;
  try { parsed = JSON.parse(decodeURIComponent(dataJson)); } catch(e) {
    try { parsed = JSON.parse(dataJson); } catch(e2) { throw new Error(label + ' 파싱 실패'); }
  }
  if (!Array.isArray(parsed)) throw new Error(label + ' 배열 형식 필요');
  return parsed;
}

function _readSettingsMap() {
  var ss = getss();
  var sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sh || sh.getLastRow() < 2) return {};

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var settings = {};
  data.forEach(function(row) {
    var key = (row[0] || '').toString().trim();
    var val = (row[1] || '').toString().trim();
    if (!key || !val) return;
    try { settings[key] = JSON.parse(val); } catch(e) { settings[key] = val; }
  });
  return settings;
}

function _writeSettingsMap(settings) {
  if (typeof settings !== 'object' || settings === null) throw new Error('객체 형식 필요');

  var ss = getss();
  var sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_SETTINGS);
    sh.getRange(1,1,1,2).setValues([['키','값']]);
    sh.getRange(1,1,1,2).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 600);
  }

  var keyOrder = [];
  var lastRow  = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      var k = (r[0] || '').toString().trim();
      if (k) keyOrder.push(k);
    });
  }
  Object.keys(settings).forEach(function(k) {
    if (keyOrder.indexOf(k) === -1) keyOrder.push(k);
  });

  var rows = keyOrder
    .filter(function(k) { return k in settings; })
    .map(function(k) { return [k, JSON.stringify(settings[k])]; });

  if (lastRow > 1) {
    sh.deleteRows(2, lastRow - 1);
  }
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  SpreadsheetApp.flush();
  return rows.length;
}
function handleSaveSettings(dataJson) {
  try {
    var settings = _parseJsonParam(dataJson, 'settings');
    var saved = _writeSettingsMap(settings);
    return jsonOk({ saved: saved });
  } catch(err) {
    return jsonError('saveSettings 실패: ' + err.message);
  }
}

function handleGetSettings() {
  try {
    return jsonOk({ settings: _readSettingsMap() });
  } catch(err) {
    return jsonError('getSettings 실패: ' + err.message);
  }
}

function handleSaveDividendSettings(dataJson) {
  try {
    var divData = _parseJsonParam(dataJson, 'dividend data');
    var settings = _readSettingsMap();
    settings.DIVDATA = divData;
    _writeSettingsMap(settings);
    return jsonOk({ saved: true, key: 'DIVDATA' });
  } catch(err) {
    return jsonError('saveDividendSettings 실패: ' + err.message);
  }
}

function handleGetDividendSettings() {
  try {
    var settings = _readSettingsMap();
    return jsonOk({ divData: (settings.DIVDATA && typeof settings.DIVDATA === 'object') ? settings.DIVDATA : {} });
  } catch(err) {
    return jsonError('getDividendSettings 실패: ' + err.message);
  }
}

function handleSaveRealEstateSettings(dataJson) {
  try {
    var payload = _parseJsonParam(dataJson, 'realEstate data');
    var settings = _readSettingsMap();
    settings.LOAN = payload.LOAN || {};
    settings.REAL_ESTATE = payload.REAL_ESTATE || {};
    settings.LOAN_SCHEDULE = Array.isArray(payload.LOAN_SCHEDULE) ? payload.LOAN_SCHEDULE : [];
    settings.RE_VALUE_HIST = Array.isArray(payload.RE_VALUE_HIST) ? payload.RE_VALUE_HIST : [];
    _writeSettingsMap(settings);
    return jsonOk({ saved: true, keys: ['LOAN','REAL_ESTATE','LOAN_SCHEDULE','RE_VALUE_HIST'] });
  } catch(err) {
    return jsonError('saveRealEstateSettings 실패: ' + err.message);
  }
}

function handleGetRealEstateSettings() {
  try {
    var settings = _readSettingsMap();
    return jsonOk({
      settings: {
        LOAN: settings.LOAN || {},
        REAL_ESTATE: settings.REAL_ESTATE || {},
        LOAN_SCHEDULE: Array.isArray(settings.LOAN_SCHEDULE) ? settings.LOAN_SCHEDULE : [],
        RE_VALUE_HIST: Array.isArray(settings.RE_VALUE_HIST) ? settings.RE_VALUE_HIST : [],
      }
    });
  } catch(err) {
    return jsonError('getRealEstateSettings 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  종목코드 동기화
// ════════════════════════════════════════════════════════════════════
function handleSyncCodes(codesParam) {
  try {
    var incoming;
    try { incoming = JSON.parse(decodeURIComponent(codesParam)); } catch(e) {
      try { incoming = JSON.parse(codesParam); } catch(e2) { return jsonError('codes 파싱 실패'); }
    }
    var ss = getss();
    var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
    if (!cs) {
      cs = ss.insertSheet(CONFIG.SHEET_CODES);
      cs.getRange(1,1,1,4).setValues([['종목코드','종목명','유형','섹터']]);
    } else if (cs.getLastColumn() < 4) {
      cs.getRange(1,1,1,4).setValues([['종목코드','종목명','유형','섹터']]);
    }

    // 구버전({종목명:'코드'})·신버전({종목명:{code,type,sector}}) 모두 처리
    var incomingNorm = {};
    Object.keys(incoming).forEach(function(name) {
      var val = incoming[name];
      if (typeof val === 'string') {
        incomingNorm[name] = { code: val, type: '주식', sector: '기타' };
      } else {
        incomingNorm[name] = {
          code:   (val.code   || '').toString().trim(),
          type:   (val.type   || '주식').toString().trim(),
          sector: (val.sector || '기타').toString().trim(),
        };
      }
    });

    // ── 기존 시트 데이터 1회 로드 (중복 읽기 제거)
    var existingByCode     = {};
    var existingByName     = {};
    var existingTypeByCode = {};
    var existingRowData    = {};
    var lastRow = cs.getLastRow();
    if (lastRow > 1) {
      var numCols = Math.max(cs.getLastColumn(), 4);
      var sheetData = cs.getRange(2, 1, lastRow - 1, numCols).getValues();
      sheetData.forEach(function(r, i) {
        var c = _cleanCode(r[0]);
        var n = (r[1] || '').toString().trim();
        var t = (r[2] || '').toString().trim();
        var rowIdx = i + 2;
        if (c && c !== '000000') {
          existingByCode[c]     = rowIdx;
          existingTypeByCode[c] = t;
          if (n) existingByName[n] = c;
        }
        var sec = (r[3] || '').toString().trim();
        existingRowData[rowIdx] = { name: n, type: t, sector: sec };
      });
    }

    var synced         = 0;
    var updated        = 0;
    var pendingUpdates = [];
    var toAppend       = [];

    Object.keys(incomingNorm).forEach(function(name) {
      var obj  = incomingNorm[name];
      var code = _cleanCode(obj.code);
      if (!code || code === '000000' || !name) return;

      var normalName = name;
      var newType    = obj.type || '주식';
      var newSector  = obj.sector || '기타';

      if (existingByCode[code]) {
        var rowIdx   = existingByCode[code];
        var existing = existingRowData[rowIdx] || { name: '', type: '', sector: '' };
        var nameChanged = existing.name !== normalName;
        var typeChanged = newType && existing.type !== newType;
        var sectorChanged = newSector && existing.sector !== newSector;
        if (nameChanged) pendingUpdates.push({ row: rowIdx, col: 2, val: normalName });
        if (typeChanged) pendingUpdates.push({ row: rowIdx, col: 3, val: newType });
        if (sectorChanged) pendingUpdates.push({ row: rowIdx, col: 4, val: newSector });
        if (nameChanged || typeChanged || sectorChanged) updated++;
        return;
      }

      if (existingByName[normalName]) {
        var oldCode   = existingByName[normalName];
        var oldRowIdx = existingByCode[oldCode];
        if (oldRowIdx) {
          pendingUpdates.push({ row: oldRowIdx, col: 1, val: code });
          if (newType) pendingUpdates.push({ row: oldRowIdx, col: 3, val: newType });
          if (newSector) pendingUpdates.push({ row: oldRowIdx, col: 4, val: newSector });
          delete existingByCode[oldCode];
          existingByCode[code]       = oldRowIdx;
          existingByName[normalName] = code;
          updated++;
          return;
        }
      }

      var inheritedType = existingTypeByCode[code] || newType || '주식';
      toAppend.push([code, normalName, inheritedType, newSector || '기타']);
      synced++;
    });

    // 배치 실행: col별 묶음 setValues
    if (pendingUpdates.length > 0) {
      var byCol = {};
      pendingUpdates.forEach(function(u) {
        if (!byCol[u.col]) byCol[u.col] = [];
        byCol[u.col].push(u);
      });
      Object.keys(byCol).forEach(function(col) {
        var updates = byCol[col].sort(function(a, b) { return a.row - b.row; });
        var i = 0;
        while (i < updates.length) {
          var start = updates[i].row;
          var vals  = [updates[i].val];
          while (i + 1 < updates.length && updates[i + 1].row === updates[i].row + 1) {
            i++;
            vals.push(updates[i].val);
          }
          cs.getRange(start, parseInt(col), vals.length, 1).setValues(vals.map(function(v){ return [v]; }));
          i++;
        }
      });
    }
    if (toAppend.length > 0) {
      cs.getRange(cs.getLastRow() + 1, 1, toAppend.length, 4).setValues(toAppend);
    }

    if (synced > 0 || updated > 0) SpreadsheetApp.flush();
    return jsonOk({ synced: synced, updated: updated, total: Object.keys(existingByCode).length });
  } catch(err) {
    return jsonError('syncCodes 실패: ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  죽은 코드 정리 — 보유현황에 없는 종목코드 제거
//  ✅ v9.2: new Set() → 객체 방식으로 변경 (GAS ES5 호환)
// ════════════════════════════════════════════════════════════════════
function cleanDeadCodes() {
  var ss = getss();
  var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
  var hs = ss.getSheetByName(CONFIG.SHEET_HOLD);
  if (!cs) { Logger.log('종목코드 시트 없음'); return; }

  // 보유현황 시트의 현재 코드 목록 (객체로 관리 — GAS ES5 Set 미지원)
  var activeCodes = {};
  if (hs && hs.getLastRow() > 1) {
    hs.getRange(2, 1, hs.getLastRow() - 1, 1).getValues().forEach(function(r) {
      var c = _cleanCode(r[0]);
      if (c && c !== '000000') activeCodes[c] = true;
    });
  }

  if (Object.keys(activeCodes).length === 0) {
    Logger.log('⚠️ 보유현황 데이터 없음 — HTML에서 한 번 접속 후 재실행하세요');
    return;
  }

  var lastRow = cs.getLastRow();
  if (lastRow < 2) { Logger.log('종목코드 시트 데이터 없음'); return; }

  var rows     = cs.getRange(2, 1, lastRow - 1, 3).getValues();
  var toDelete = [];
  var removed  = [];

  rows.forEach(function(r, i) {
    var c = _cleanCode(r[0]);
    var n = (r[1] || '').toString().trim();
    if (c && c !== '000000' && !activeCodes[c]) {
      toDelete.push(i + 2);
      removed.push(c + ' ' + n);
    }
  });

  // 역순 삭제 (행 번호 밀림 방지)
  toDelete.reverse().forEach(function(rowIdx) {
    cs.deleteRow(rowIdx);
  });

  if (toDelete.length > 0) SpreadsheetApp.flush();

  var msg = '✅ 죽은 코드 정리 완료 — 제거: ' + toDelete.length + '개' +
            (removed.length > 0 ? ' / ' + removed.join(', ') : '');
  Logger.log(msg);
}

// ════════════════════════════════════════════════════════════════════
//  가격이력 종목명 오류 수정
// ════════════════════════════════════════════════════════════════════
function fixPriceHistoryNames() {
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) { Logger.log('가격이력 시트 데이터 없음'); return; }

  var codeToName = {};
  var cs = ss.getSheetByName(CONFIG.SHEET_CODES);
  if (cs && cs.getLastRow() > 1) {
    cs.getRange(2, 1, cs.getLastRow() - 1, 2).getValues().forEach(function(r) {
      var c = _cleanCode(r[0]);
      var n = (r[1] || '').toString().trim();
      if (c && n) codeToName[c] = n;
    });
  }

  var lastRow = ph.getLastRow();
  var data    = ph.getRange(2, 1, lastRow - 1, 3).getValues();
  var fixed   = 0;

  data.forEach(function(r, i) {
    var code    = _cleanCode(r[1]);
    var nameVal = (r[2] || '').toString().trim();
    if (!nameVal || !isNaN(Number(nameVal))) {
      var correctName = codeToName[code] || '';
      if (correctName) {
        ph.getRange(i + 2, 3).setValue(correctName);
        fixed++;
      }
    }
  });

  if (fixed > 0) SpreadsheetApp.flush();
  var msg = '✅ 가격이력 종목명 보정 완료: ' + fixed + '건 수정';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  가격이력 시트 마이그레이션 (구버전 → 신버전, 1회 실행)
// ════════════════════════════════════════════════════════════════════
function migratePriceHistory() {
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph) { Logger.log('가격이력 시트 없음 — 마이그레이션 불필요'); return; }
  var lastRow = ph.getLastRow();
  if (lastRow < 2) { Logger.log('데이터 없음 — 마이그레이션 불필요'); return; }
  var header = ph.getRange(1, 1, 1, 4).getValues()[0];
  if (header[1] === '종목코드' && header[2] === '종목명' && header[3] === '가격') {
    // ✅ v9.1 버그수정: 신버전 감지 후 return (불필요한 재변환 방지)
    Logger.log('✅ 이미 신버전 구조입니다 — 마이그레이션 불필요');
    try { SpreadsheetApp.getUi().alert('✅ 이미 신버전 구조입니다. 마이그레이션이 필요하지 않습니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
    return;
  }
  var data       = ph.getRange(2, 1, lastRow - 1, 4).getValues();
  var codeToName = {}, nameToCode = {};
  var cs         = ss.getSheetByName(CONFIG.SHEET_CODES);
  if (cs && cs.getLastRow() > 1) {
    cs.getRange(2, 1, cs.getLastRow() - 1, 2).getValues().forEach(function(r) {
      var c = (r[0]||'').toString().trim(); var n = (r[1]||'').toString().trim();
      if (c && n) { codeToName[c] = n; nameToCode[n] = c; }
    });
  }
  var newRows = data.map(function(row) {
    var date       = (row[0]||'').toString().trim();
    var codeOrName = (row[1]||'').toString().trim();
    var oldPrice   = parseFloat(row[2]) || 0;
    var refName    = (row[3]||'').toString().trim();
    var isCode     = /^\d{6}$/.test(codeOrName);
    var code       = isCode ? codeOrName : (nameToCode[codeOrName] || '');
    var name       = isCode ? (codeToName[codeOrName] || refName || codeOrName) : codeOrName;
    return [date, code, name, oldPrice];
  });
  ph.clearContents();
  ph.getRange(1,1,1,4).setValues([['날짜','종목코드','종목명','가격']]);
  ph.getRange(1,1,1,4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  ph.setColumnWidth(1,100); ph.setColumnWidth(2,100); ph.setColumnWidth(3,200); ph.setColumnWidth(4,100);
  if (newRows.length > 0) ph.getRange(2, 1, newRows.length, 4).setValues(newRows);
  SpreadsheetApp.flush();
  try { SpreadsheetApp.getUi().alert('✅ 마이그레이션 완료!\n' + newRows.length + '행이 신버전 구조로 변환됐습니다.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════
//  초기 설정
// ════════════════════════════════════════════════════════════════════
function initSheet() {
  var ss = getss();
  if (!ss) { try { SpreadsheetApp.getUi().alert('스프레드시트에서 실행하세요.'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); } return; }

  var cs = ss.getSheetByName(CONFIG.SHEET_CODES) || ss.insertSheet(CONFIG.SHEET_CODES);
  cs.clearContents();
  cs.getRange(1,1,1,3).setValues([['종목코드','종목명(참고)','구분']]);
  cs.getRange(1,1,1,3).setBackground('#0d1117').setFontColor('#10b981').setFontWeight('bold');

  var ps = ss.getSheetByName(CONFIG.SHEET_PRICES) || ss.insertSheet(CONFIG.SHEET_PRICES);
  ps.clearContents();
  ps.getRange(1,1,1,4).setValues([['종목코드','종가','종목명','갱신일시']]);
  ps.getRange(1,1,1,4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  ps.setColumnWidth(1,90); ps.setColumnWidth(2,90); ps.setColumnWidth(3,200); ps.setColumnWidth(4,160);

  var snap = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT) || ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
  if (snap.getLastRow() === 0) {
    snap.getRange(1,1,1,8).setValues([['날짜','종목코드','종목명','수량','매수원금','평가금액','손익','수익률(%)']]);
    snap.getRange(1,1,1,8).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  }

  var ph = ss.getSheetByName(CONFIG.SHEET_PH) || ss.insertSheet(CONFIG.SHEET_PH);
  if (ph.getLastRow() === 0) {
    ph.getRange(1,1,1,4).setValues([['날짜','종목코드','종목명','가격']]);
    ph.getRange(1,1,1,4).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  }

  try {
    SpreadsheetApp.getUi().alert(
      '✅ 초기화 완료!\n\n다음 단계:\n' +
      '1. [📊 포트폴리오] → [🔄 종가 갱신]\n' +
      '2. [📊 포트폴리오] → [⏰ 자동 트리거 등록] (1회만)'
    );
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}
// ════════════════════════════════════════════════════════════════════
//  메뉴
// ════════════════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 포트폴리오')
    // ── 초기 설정 (처음 1회) ──
    .addItem('⚙️ 초기 설정 (처음만)', 'initSheet')
    .addItem('⏰ 자동 트리거 등록 (1회만)', 'setupTrigger')
    .addSeparator()
    // ── 종가 갱신 ──
    .addItem('🔄 종가 갱신 (GOOGLEFINANCE)', 'updatePrices')
    .addItem('📅 오늘 가격이력 저장', 'saveDailyPriceHistory')
    .addSeparator()
    // ── 과거 소급채우기 ──
    .addItem('📆 소급채우기 시작 (범위 지정)', 'backfillRangePrompt')
    .addItem('▶️ 소급채우기 이어서', 'backfillResume')
    .addItem('📊 소급채우기 진행상황', 'backfillStatus')
    .addSeparator()
    // ── 유지보수 ──
    .addItem('🧹 죽은 코드 정리', 'cleanDeadCodes')
    .addItem('🔧 가격이력 종목명 보정', 'fixPriceHistoryNames')
    .addToUi();
}

// ════════════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════════════
function calcMissing(allCodesParam, returnedCodes) {
  if (!allCodesParam) return [];
  return allCodesParam.split(',').map(function(c){ return c.trim(); })
    .filter(function(c){ return c && returnedCodes.indexOf(c) === -1; });
}
function today() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}
// ── 날짜 정규화: 어떤 형식이든 YYYY-MM-DD 문자열로 변환
// 'Fri Dec 26 2025', Date 객체, '2025-12-26' 모두 처리
function _normalizeDate(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var s = raw.toString().trim();
  // 이미 YYYY-MM-DD 형식
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // 'Fri Dec 26 2025 ...' 형식 → new Date() 파싱
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
  return s.slice(0, 10); // 최후 fallback
}
function jsonOk(extra) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ status: 'ok' }, extra || {})))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonError(msg) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
// 네이버 증권에서 배당 데이터 스크래핑
// 사용법: =GET_KR_DIVIDEND("005930", 0) → 가장 최근 연도 배당금
//         =GET_KR_DIVIDEND("005930", 1) → 1년 전 배당금

function GET_KR_DIVIDEND(code, yearOffset) {
  try {
    var url = 'https://finance.naver.com/item/main.naver?code=' + code;
    var options = {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.naver.com',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var html = response.getContentText('euc-kr');

    var divIdx = html.indexOf('주당배당금');
    if (divIdx === -1) return 'N/A';

    var section = html.substring(divIdx, divIdx + 1000);

    var matches = [];
    var re = /<td[^>]*class="[^"]*num[^"]*"[^>]*>\s*([\d,]+|-)\s*<\/td>/g;
    var m;
    while ((m = re.exec(section)) !== null) {
      var val = m[1].replace(/,/g, '');
      matches.push(val === '-' ? 0 : parseInt(val) || 0);
    }

    if (matches.length === 0) {
      var re2 = />\s*([\d,]+)\s*</g;
      var section2 = html.substring(divIdx, divIdx + 500);
      while ((m = re2.exec(section2)) !== null) {
        var v = m[1].replace(/,/g, '');
        if (v.length > 0 && v.length <= 6) {
          matches.push(parseInt(v) || 0);
        }
      }
    }

    if (matches.length === 0) return 'N/A';

    var offset = yearOffset || 0;
    if (offset >= matches.length) return 'N/A';
    return matches[offset];

  } catch(e) {
    return 'N/A';
  }
}
