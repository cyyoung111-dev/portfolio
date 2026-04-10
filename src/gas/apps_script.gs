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
  if (params.action === 'getBenchmark')                   return handleGetBenchmark(params.benchmark || '', params.from || '', params.to || '');
  if (params.action === 'saveManualPrice')                return handleSaveManualPrice(params.date || '', params.name || '', params.price || '0', params.keepLatest || '');
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
  var sourceMode = _getPriceSourceMode();
  var prices = {};
  var gfItems = items.slice();

  if (sourceMode === 'krx_first') {
    try {
      var krxPrices = fetchPricesKrx(items, dateStr);
      Object.keys(krxPrices).forEach(function(code) { prices[code] = krxPrices[code]; });
      gfItems = items.filter(function(item) { return !(prices[item.code] && prices[item.code].price > 0); });
      Logger.log('[price-source] krx_first: KRX ' + Object.keys(krxPrices).length + '건, GF fallback 대상 ' + gfItems.length + '건');
    } catch (e) {
      Logger.log('⚠️ KRX 조회 실패, GOOGLEFINANCE로 fallback: ' + e.message);
      gfItems = items.slice();
    }
  }

  if (gfItems.length === 0) return prices;

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

  var formulas = gfItems.map(function(item) {
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

  gfItems.forEach(function(item, i) {
    var val   = values[i][0];
    var str   = String(val || '');
    var price = (val && val !== '-' && !str.startsWith('#')) ? Math.round(parseFloat(val)) : 0;
    if (price > 0) prices[item.code] = { price: price, name: item.name, officialName: item.name, source: 'GOOGLEFINANCE' };
  });

  return prices;
}

function fetchPricesKrx(items, dateStr) {
  if (!items || items.length === 0) return {};
  var cfg = _getKrxApiConfig();
  var ymd = (dateStr || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return {};

  if (!cfg.apiKey) {
    Logger.log('ℹ️ KRX AUTH_KEY 미설정: KRX OTP/CSV 조회 시도');
    return fetchPricesKrxViaOtp(items, dateStr);
  }

  var wanted = {};
  items.forEach(function(item) { wanted[item.code] = item; });
  var out = {};
  ['KOSPI', 'KOSDAQ', 'ETF'].forEach(function(market) {
    try {
      var pack = _fetchKrxDailyOutBlockWithFallback(market, ymd, cfg.apiKey, 7);
      var rows = pack.rows;
      if (pack.usedYmd !== ymd) Logger.log('ℹ️ ' + market + ' ' + ymd + ' 휴일/무데이터 → 직전 거래일 ' + pack.usedYmd + ' 사용');
      (rows || []).forEach(function(r) {
        var code = _cleanCode(r.ISU_CD || r.ISU_SRT_CD || '');
        if (!wanted[code]) return;
        var p = _parseKrxNumber(r.TDD_CLSPRC);
        if (!(p > 0)) return;
        out[code] = {
          price: p,
          name: wanted[code].name,
          officialName: (r.ISU_NM || wanted[code].name || code),
          source: 'KRX'
        };
      });
    } catch (e) {
      Logger.log('⚠️ KRX OpenAPI 조회 실패(' + market + '): ' + e.message);
    }
  });
  if (Object.keys(out).length === 0) {
    Logger.log('ℹ️ KRX OpenAPI 결과 없음: OTP/CSV fallback 시도');
    return fetchPricesKrxViaOtp(items, dateStr);
  }
  return out;
}

function fetchPricesKrxViaOtp(items, dateStr) {
  var ymd = (dateStr || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return {};
  var wanted = {};
  items.forEach(function(item) { wanted[item.code] = item; });
  if (Object.keys(wanted).length === 0) return {};

  var headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; AppsScript)',
    'Referer': 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader'
  };
  var otpResp = UrlFetchApp.fetch('https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd', {
    method: 'post',
    payload: {
      locale: 'ko_KR',
      mktId: 'ALL',
      trdDd: ymd,
      share: '1',
      money: '1',
      csvxls_isNo: 'false',
      name: 'fileDown',
      url: 'dbms/MDC/STAT/standard/MDCSTAT01501'
    },
    headers: headers,
    muteHttpExceptions: true
  });
  if (otpResp.getResponseCode() >= 400) {
    Logger.log('⚠️ KRX OTP 발급 실패 HTTP ' + otpResp.getResponseCode());
    return {};
  }
  var otp = (otpResp.getContentText() || '').trim();
  if (!otp || otp.length < 8) {
    Logger.log('⚠️ KRX OTP 응답 비정상: ' + otp);
    return {};
  }

  var csvResp = UrlFetchApp.fetch('https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd', {
    method: 'post',
    payload: { code: otp },
    headers: headers,
    muteHttpExceptions: true
  });
  if (csvResp.getResponseCode() >= 400) {
    Logger.log('⚠️ KRX CSV 다운로드 실패 HTTP ' + csvResp.getResponseCode());
    return {};
  }
  var text = csvResp.getContentText('EUC-KR');
  var rows = Utilities.parseCsv(text);
  if (!rows || rows.length < 2) return {};

  var header = rows[0];
  var idxCode = _findCsvIndex(header, ['단축코드', '종목코드', 'ISU_SRT_CD']);
  var idxName = _findCsvIndex(header, ['한글 종목약명', '종목명', 'ISU_ABBRV']);
  var idxClose = _findCsvIndex(header, ['종가', 'TDD_CLSPRC', '종가(원)']);
  if (idxCode < 0 || idxClose < 0) {
    Logger.log('⚠️ KRX CSV 컬럼 해석 실패: ' + header.join('|'));
    return {};
  }

  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i] || [];
    var code = _cleanCode(r[idxCode]);
    if (!wanted[code]) continue;
    var p = _parseKrxNumber(r[idxClose]);
    if (!(p > 0)) continue;
    out[code] = {
      price: p,
      name: wanted[code].name,
      officialName: idxName >= 0 ? (r[idxName] || wanted[code].name || code) : (wanted[code].name || code),
      source: 'KRX_OTP'
    };
  }
  Logger.log('[price-source] KRX OTP/CSV 조회 결과 ' + Object.keys(out).length + '건');
  return out;
}

function _parseKrxNumber(v) {
  var s = (v || '').toString().replace(/[,\s]/g, '').trim();
  if (!s || s === '-' || s === '0') return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

function _findCsvIndex(header, candidates) {
  if (!Array.isArray(header)) return -1;
  for (var i = 0; i < candidates.length; i++) {
    var target = candidates[i];
    for (var j = 0; j < header.length; j++) {
      if ((header[j] || '').toString().trim() === target) return j;
    }
  }
  return -1;
}

function _getKrxApiConfig() {
  var props = PropertiesService.getScriptProperties();
  var endpoint = (props.getProperty('krx_api_endpoint') || '').trim();
  var bld = (props.getProperty('krx_api_bld') || 'dbms/MDC/STAT/standard/MDCSTAT01501').trim();
  var apiKey = _getKrxAuthKey();
  return { endpoint: endpoint, bld: bld, apiKey: apiKey };
}

function _getKrxAuthKey() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('krx_auth_key') || props.getProperty('krx_api_key') || '').trim();
}

function configureKrxAuthKeyPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var current = _getKrxAuthKey();
  var resp = ui.prompt(
    'KRX AUTH_KEY 설정',
    'KRX Open API AUTH_KEY를 입력하세요.\n삭제하려면 "-" 입력',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var input = (resp.getResponseText() || '').trim();
  var props = PropertiesService.getScriptProperties();
  if (input === '-') {
    props.deleteProperty('krx_auth_key');
    ui.alert('✅ krx_auth_key 삭제 완료');
    return;
  }
  if (!input) {
    ui.alert(current ? '변경 없음' : '⚠️ AUTH_KEY가 비어 있습니다.');
    return;
  }
  props.setProperty('krx_auth_key', input);
  ui.alert('✅ krx_auth_key 저장 완료');
}

function configureKrxApiPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');
  ui.alert('안내', '이제 endpoint/BLD 입력은 필수가 아닙니다.\n메뉴의 "🔑 KRX AUTH_KEY 설정"만 입력해서 사용하세요.', ui.ButtonSet.OK);
}

function _extractKrxRows(json) {
  if (!json) return [];
  if (Array.isArray(json.OutBlock_1)) return json.OutBlock_1;
  if (Array.isArray(json.output)) return json.output;
  if (json.data && Array.isArray(json.data)) return json.data;
  if (json.response && Array.isArray(json.response.body)) return json.response.body;
  return [];
}

function _pickKrxCode(r) {
  if (!r) return '';
  return (r.ISU_SRT_CD || r.code || r.shrt_code || r.symbol || '').toString().trim();
}

function _pickKrxClose(r) {
  if (!r) return 0;
  return r.TDD_CLSPRC || r.clsprc || r.close || r.price || r.end_price || 0;
}

function importKrxClosesFromSettings() {
  return importKrxClosesPrompt();
}

function importKrxClosesPrompt() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');
  var ss = getss();
  var wantedByMarket = _buildWantedByMarketFromCodeSheet(ss);
  var seedStart = Utilities.formatDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), CONFIG.TIMEZONE, 'yyyyMMdd');
  var seedEnd = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd');
  var rangeResp = ui.prompt(
    'KRX 기간 불러오기',
    '기간을 입력하세요. (예: 20260401~20260408)\n빈값이면 최근 7일(' + seedStart + '~' + seedEnd + ')',
    ui.ButtonSet.OK_CANCEL
  );
  if (rangeResp.getSelectedButton() !== ui.Button.OK) return;
  var rangeText = (rangeResp.getResponseText() || '').trim();
  var startYmd = seedStart;
  var endYmd = seedEnd;
  if (rangeText) {
    var m = rangeText.match(/^(\d{8})\s*~\s*(\d{8})$/);
    if (!m) throw new Error('형식 오류: YYYYMMDD~YYYYMMDD');
    startYmd = m[1]; endYmd = m[2];
  }
  var overwrite = ui.alert(
    '가격이력 덮어쓰기',
    '조회한 KRX 종가를 가격이력(해당 기간/종목)에 덮어쓸까요?\nYES=덮어쓰기, NO=종가데이터 시트만 갱신',
    ui.ButtonSet.YES_NO
  ) === ui.Button.YES;
  return _runKrxImport(startYmd, endYmd, wantedByMarket, overwrite);
}

function _runKrxImport(startYmd, endYmd, wantedByMarket, overwriteHistory) {
  var ss = getss();
  var authKey = _getKrxAuthKey();
  if (!authKey) throw new Error('krx_auth_key가 비어 있습니다. 메뉴에서 AUTH_KEY를 먼저 설정하세요.');
  if (startYmd > endYmd) throw new Error('시작일이 종료일보다 늦습니다.');

  var outSheet = ss.getSheetByName('종가데이터') || ss.insertSheet('종가데이터');
  _clearKrxCloseOutputSheet(outSheet);
  var rows = [];
  var dayList = _buildDateRangeYmd(startYmd, endYmd);
  var fallbackCount = 0;

  dayList.forEach(function(ymd) {
    ['KOSPI', 'KOSDAQ', 'ETF'].forEach(function(market) {
      var wanted = wantedByMarket[market];
      if (!wanted || Object.keys(wanted).length === 0) return;
      try {
        var pack = _fetchKrxDailyOutBlockWithFallback(market, ymd, authKey, 7);
        if (!pack.rows || pack.rows.length === 0) return;
        if (pack.usedYmd !== ymd) fallbackCount++;
        var added = _collectFilteredKrxRows(rows, pack.rows, wanted, ymd, market);
        Logger.log('[KRX-IMPORT] ' + ymd + ' ' + market + ' 매칭 ' + added + '건' + (pack.usedYmd !== ymd ? (' (기준 ' + pack.usedYmd + ')') : ''));
      } catch (e) {
        Logger.log('⚠️ [KRX-IMPORT] ' + ymd + ' ' + market + ' 실패: ' + e.message);
      }
    });
  });
  if (rows.length > 0) {
    outSheet.getRange(2, 1, rows.length, 5).setValues(rows);
    outSheet.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0');
  }
  if (overwriteHistory) _overwritePriceHistoryFromKrxRows(ss, rows);
  var msg = '✅ KRX 불러오기 완료\n기간: ' + startYmd + ' ~ ' + endYmd + '\n저장 행수: ' + rows.length +
    '\n휴일 대체(전일 종가) 적용: ' + fallbackCount + '회' +
    (overwriteHistory ? '\n가격이력 덮어쓰기: 적용' : '\n가격이력 덮어쓰기: 미적용');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _overwritePriceHistoryFromKrxRows(ss, rows) {
  if (!rows || rows.length === 0) return;
  var byDate = {};
  rows.forEach(function(r) {
    var ymd = (r[0] || '').toString();
    if (!/^\d{8}$/.test(ymd)) return;
    var dateStr = ymd.slice(0,4) + '-' + ymd.slice(4,6) + '-' + ymd.slice(6,8);
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push({ code: r[1], name: r[2], price: r[4], source: 'KRX' });
  });
  Object.keys(byDate).forEach(function(dateStr) {
    batchUpsertPriceHistory(ss, dateStr, byDate[dateStr]);
  });
}

function _readKrxImportRequestFromSettings(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEET_SETTINGS) || ss.insertSheet(CONFIG.SHEET_SETTINGS);
  var startYmd = _normalizeYmd(sh.getRange('B1').getDisplayValue());
  var endYmd = _normalizeYmd(sh.getRange('B2').getDisplayValue());
  if (!startYmd || !endYmd) throw new Error('설정!B1/B2에 시작일/종료일(YYYYMMDD)을 입력하세요.');
  if (startYmd > endYmd) throw new Error('시작일이 종료일보다 늦습니다. (B1 <= B2)');

  var last = sh.getLastRow();
  if (last < 3) throw new Error('설정!B3:C에 종목코드/시장구분을 입력하세요.');
  var rows = sh.getRange(3, 2, last - 2, 2).getValues();
  var wantedByMarket = { KOSPI: {}, KOSDAQ: {}, ETF: {} };
  var inputCount = 0;

  rows.forEach(function(r) {
    var code = _cleanCode(r[0]);
    var market = _normalizeMarketType(r[1]);
    if (!code || !market) return;
    if (!wantedByMarket[market]) return;
    wantedByMarket[market][code] = true;
    inputCount++;
  });
  if (inputCount === 0) throw new Error('유효한 대상 없음: C열 시장구분은 KOSPI/KOSDAQ/ETF만 허용됩니다.');
  return { startYmd: startYmd, endYmd: endYmd, wantedByMarket: wantedByMarket };
}

function _buildWantedByMarketFromCodeSheet(ss) {
  var items = getCodeItems(ss);
  if (!items || items.length === 0) throw new Error('종목코드 시트에 유효 종목이 없습니다.');
  var wantedByMarket = { KOSPI: {}, KOSDAQ: {}, ETF: {} };
  items.forEach(function(item) {
    var t = (item.type || '').toString();
    if (/펀드|TDF/i.test(t)) return;
    // 시장 정보가 없는 경우를 위해 3개 시장 모두 조회 대상으로 넣고,
    // 실제 응답에서 일치하는 시장의 코드만 매칭/적재한다.
    wantedByMarket.KOSPI[item.code] = true;
    wantedByMarket.KOSDAQ[item.code] = true;
    wantedByMarket.ETF[item.code] = true;
  });
  return wantedByMarket;
}

function _normalizeMarketType(v) {
  var raw = (v || '').toString().trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'KOSPI' || raw === '코스피' || raw === '유가증권') return 'KOSPI';
  if (raw === 'KOSDAQ' || raw === '코스닥' || raw === 'KOSDAQ시장') return 'KOSDAQ';
  if (raw === 'ETF' || raw === 'ETP') return 'ETF';
  return '';
}

function _buildDateRangeYmd(startYmd, endYmd) {
  var out = [];
  var d = _ymdToDate(startYmd);
  var e = _ymdToDate(endYmd);
  while (d.getTime() <= e.getTime()) {
    out.push(Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyyMMdd'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function _ymdToDate(ymd) {
  var y = parseInt(ymd.slice(0, 4), 10);
  var m = parseInt(ymd.slice(4, 6), 10) - 1;
  var d = parseInt(ymd.slice(6, 8), 10);
  return new Date(y, m, d);
}

function _normalizeYmd(v) {
  var s = (v || '').toString().replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(s)) return '';
  return s;
}

function _getKrxEndpointByMarket(market) {
  if (market === 'KOSPI') return 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd';
  if (market === 'KOSDAQ') return 'https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd';
  if (market === 'ETF') return 'https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd';
  throw new Error('지원하지 않는 시장구분: ' + market);
}

function _fetchKrxDailyOutBlock(market, ymd, authKey) {
  var endpoint = _getKrxEndpointByMarket(market);
  var url = endpoint + '?basDd=' + encodeURIComponent(ymd);
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { AUTH_KEY: authKey },
    muteHttpExceptions: true
  });
  var status = resp.getResponseCode();
  if (status >= 400) throw new Error('HTTP ' + status + ' (' + market + ')');
  var raw = resp.getContentText() || '{}';
  var json = JSON.parse(raw);
  var list = json.OutBlock_1;
  if (!Array.isArray(list)) return [];
  return list;
}

function _fetchKrxDailyOutBlockWithFallback(market, ymd, authKey, maxLookback) {
  var days = maxLookback || 7;
  var cur = ymd;
  for (var i = 0; i <= days; i++) {
    var rows = _fetchKrxDailyOutBlock(market, cur, authKey);
    if (rows && rows.length > 0) return { rows: rows, usedYmd: cur };
    cur = _prevYmd(cur);
  }
  return { rows: [], usedYmd: ymd };
}

function _prevYmd(ymd) {
  var d = _ymdToDate(ymd);
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyyMMdd');
}

function _collectFilteredKrxRows(accRows, apiRows, wantedMap, ymd, market) {
  var added = 0;
  apiRows.forEach(function(r) {
    var code = _cleanCode(r.ISU_CD || r.ISU_SRT_CD || '');
    if (!code || !wantedMap[code]) return;
    var close = _parseKrxNumber(r.TDD_CLSPRC);
    if (!(close > 0)) return;
    accRows.push([ymd, code, (r.ISU_NM || '').toString().trim(), market, close]);
    added++;
  });
  return added;
}

function _clearKrxCloseOutputSheet(sh) {
  sh.clearContents();
  sh.getRange(1, 1, 1, 5).setValues([['날짜', '종목코드', '종목명', '시장구분', '종가']]);
  sh.getRange(1, 1, 1, 5).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
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
    if (p && p.price > 0) phItems.push({ code: item.code, name: item.name, price: p.price, source: (p.source || 'GOOGLEFINANCE') });
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
      var qty = parseFloat(r.qty) || 0;
      var costAmt = parseFloat(r.costAmt) || 0;
      var evalAmt = parseFloat(r.evalAmt) || 0;
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      return [normDate, r.code||'', r.name||'', qty,
              costUnit, costAmt, evalUnit, evalAmt, r.pnl||0,
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

    var snapLastCol = Math.max(8, sh.getLastColumn());
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, snapLastCol).getValues();
    var dateItemMap = {};
    data.forEach(function(row) {
      var date = (row[0] || '').toString().trim();
      var code = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name = (row[2] || '').toString().trim();
      var qty  = parseFloat(row[3]) || 0;
      var isNewFormat = row.length >= 10;
      var cost = parseFloat(isNewFormat ? row[5] : row[4]) || 0;
      var evalAmt = parseFloat(isNewFormat ? row[7] : row[5]) || 0;
      if (!date) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      // ★ 같은 날짜/같은 종목(코드 우선) 중복 행 방어: 마지막/더 큰 수량 행을 대표값으로 사용
      //    일부 동기화 이슈로 같은 종목이 중복 저장되면 단순합산 시 평가금액이 2배로 튈 수 있음
      var itemKey = code ? ('C:' + code) : ('N:' + name);
      if (!itemKey || itemKey === 'N:') return;
      if (!dateItemMap[date]) dateItemMap[date] = {};
      var prev = dateItemMap[date][itemKey];
      if (!prev) {
        dateItemMap[date][itemKey] = { qty: qty, costAmt: cost, evalAmt: evalAmt };
      } else {
        var pickNew = (qty > prev.qty) || (qty === prev.qty && evalAmt >= prev.evalAmt);
        if (pickNew) dateItemMap[date][itemKey] = { qty: qty, costAmt: cost, evalAmt: evalAmt };
      }
    });

    var history = Object.keys(dateItemMap).sort().map(function(date) {
      var rows = Object.keys(dateItemMap[date]).map(function(k){ return dateItemMap[date][k]; });
      var ev = Math.round(rows.reduce(function(s, r){ return s + (parseFloat(r.evalAmt) || 0); }, 0));
      var co = Math.round(rows.reduce(function(s, r){ return s + (parseFloat(r.costAmt) || 0); }, 0));
      var qt = rows.reduce(function(s, r){ return s + (parseFloat(r.qty) || 0); }, 0);
      var pnl = ev - co;
      var pct = co > 0 ? parseFloat(((pnl / co) * 100).toFixed(2)) : 0;
      var evalUnit = qt > 0 ? parseFloat((ev / qt).toFixed(2)) : 0;
      var costUnit = qt > 0 ? parseFloat((co / qt).toFixed(2)) : 0;
      return { date: date, evalAmt: ev, costAmt: co, qty: qt, evalUnit: evalUnit, costUnit: costUnit, pnl: pnl, pct: pct };
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

    // ★ 오늘 가격이력 값이 있어도 KRX 우선으로 재검증/갱신
    //    (가능하면 KRX 값으로 확정, 실패분만 GF fallback)
    if (reqCodes.length > 0) {
      var codeNameMap = {};
      getCodeItems(ss).forEach(function(item) { codeNameMap[item.code] = item.name; });
      var targetItems = reqCodes.map(function(c){ return { code: c, name: codeNameMap[c] || c }; });
      var krxPrices = {};
      try { krxPrices = fetchPricesKrx(targetItems, todayStr); } catch(e) { Logger.log('⚠️ handleGetPricesCompat KRX 실패: ' + e.message); }
      var gfNeed = targetItems.filter(function(it){ return !(krxPrices[it.code] && krxPrices[it.code].price > 0); });
      var gfPrices = gfNeed.length > 0 ? fetchPricesGoogleFinance(gfNeed, todayStr, ss) : {};
      var newPriceItems = [];
      var stillMissing  = [];
      var sourceByCode = {};
      reqCodes.forEach(function(code) {
        var val = (krxPrices[code] && krxPrices[code].price > 0) ? krxPrices[code]
                 : ((gfPrices[code] && gfPrices[code].price > 0) ? gfPrices[code] : null);
        if (val && val.price > 0) {
          var nextPrice = val.price;
          prices[code] = nextPrice;
          sourceByCode[code] = val.source || 'UNKNOWN';
          if (!phPrices[code] || Number(phPrices[code]) !== Number(nextPrice)) {
            newPriceItems.push({ code: code, name: codeNameMap[code] || code, price: nextPrice, source: (val.source || 'UNKNOWN') });
          }
        } else {
          if (!prices[code]) stillMissing.push(code);
        }
      });
      if (newPriceItems.length > 0) batchUpsertPriceHistory(ss, todayStr, newPriceItems);

      // ★ KRX/GF 모두 실패한 종목은 가격이력 시트에서 가장 최근 날짜 값으로 fallback
      if (stillMissing.length > 0) {
        var latestPrices = getLatestPriceHistory(ss, stillMissing);
        stillMissing.forEach(function(code) {
          if (latestPrices[code] && latestPrices[code] > 0) {
            prices[code] = latestPrices[code];
          }
        });
      }
      _updateTodaySnapshotSource(ss, todayStr, sourceByCode);
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

    var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
    var data     = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var reqCodes = codesParam ? codesParam.split(',').map(function(c){ return c.trim(); }).filter(Boolean) : null;
    var reqAliasToCanonical = reqCodes ? _buildCodeAliasMap(reqCodes) : null;
    var dateMap  = {};

    data.forEach(function(row) {
      var date  = _normalizeDate(row[0]);
      var code  = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var savedAt = _normalizeDatetime(row[4]);
      var key   = code || name;
      if (!date || !key || price <= 0) return;
      if (fromStr && date < fromStr) return;
      if (toStr   && date > toStr)   return;
      if (reqAliasToCanonical && !reqAliasToCanonical[key]) return;
      var outKey = reqAliasToCanonical ? (reqAliasToCanonical[key] || key) : key;
      if (!dateMap[date]) dateMap[date] = {};
      var prev = dateMap[date][outKey];
      if (!prev) {
        dateMap[date][outKey] = { price: price, savedAt: savedAt };
      } else {
        // 같은 날짜/키 중 수동입력(savedAt 있음) 값 우선
        if (prev.savedAt && !savedAt) return;
        if (!prev.savedAt && savedAt) {
          dateMap[date][outKey] = { price: price, savedAt: savedAt };
          return;
        }
        dateMap[date][outKey] = { price: price, savedAt: savedAt };
      }
    });

    // dateMap 키에서 직접 추출 — O(n), 중복 없음
    var allDates = Object.keys(dateMap).sort();

    var pricesByCode = {};
    allDates.forEach(function(date) {
      Object.keys(dateMap[date]).forEach(function(key) {
        if (!pricesByCode[key]) pricesByCode[key] = [];
        var entry = dateMap[date][key];
        pricesByCode[key].push({ date: date, price: entry.price, savedAt: entry.savedAt || '' });
      });
    });

    return jsonOk({ dates: allDates, prices: pricesByCode });
  } catch(err) {
    return jsonError('getPriceHistory 실패: ' + err.message);
  }
}

function handleGetBenchmark(benchmark, fromStr, toStr) {
  try {
    var ss = getss();
    var fromDate = _normalizeDate(fromStr || '') || '2024-01-01';
    var toDate = _normalizeDate(toStr || '') || today();
    if (fromDate > toDate) {
      var t = fromDate; fromDate = toDate; toDate = t;
    }

    var map = {
      KOSPI: ['INDEXKRX:KOSPI', 'KRX:KOSPI', 'INDEXKRX:KOSPI200'],
      KOSDAQ: ['INDEXKRX:KOSDAQ', 'KRX:KOSDAQ', 'INDEXKRX:KQ11'],
      SP500: ['INDEXSP:.INX', 'INDEXSP:INX', 'SP:SPX'],
      NASDAQ: ['INDEXNASDAQ:.IXIC', 'INDEXNASDAQ:IXIC', 'NASDAQ:IXIC'],
      NASDAQ100: ['INDEXNASDAQ:NDX', 'NASDAQ:NDX']
    };
    var key = (benchmark || '').toString().trim().toUpperCase();
    var symbols = map[key];
    if (!symbols) return jsonError('지원하지 않는 비교지수: ' + benchmark);

    var points = [];
    var usedSymbol = '';
    for (var i = 0; i < symbols.length; i++) {
      var candidate = symbols[i];
      points = _readBenchmarkPoints(ss, candidate, fromDate, toDate);
      if (points.length > 0) {
        usedSymbol = candidate;
        break;
      }
    }
    return jsonOk({ benchmark: key, symbol: usedSymbol, points: points });
  } catch(err) {
    return jsonError('getBenchmark 실패: ' + err.message);
  }
}

function _readBenchmarkPoints(ss, symbol, fromDate, toDate) {
  var tmp = ss.getSheetByName(CONFIG.SHEET_TMP) || ss.insertSheet(CONFIG.SHEET_TMP);
  tmp.clearContents();

  var fs = fromDate.split('-');
  var ts = toDate.split('-');
  var formula = '=GOOGLEFINANCE("' + symbol + '","close",DATE(' + fs[0] + ',' + parseInt(fs[1],10) + ',' + parseInt(fs[2],10) + '),DATE(' + ts[0] + ',' + parseInt(ts[1],10) + ',' + parseInt(ts[2],10) + '))';
  tmp.getRange(1, 1).setFormula(formula);
  SpreadsheetApp.flush();
  Utilities.sleep(1600);

  var lastRow = tmp.getLastRow();
  if (lastRow < 2) {
    tmp.clearContents();
    return [];
  }
  var data = tmp.getRange(2, 1, lastRow - 1, 2).getValues();
  var points = data.map(function(r) {
    var d = _normalizeDate(r[0]);
    var v = parseFloat(r[1]) || 0;
    return { date: d, value: v };
  }).filter(function(p) { return p.date && p.value > 0; });
  tmp.clearContents();
  return points;
}

// ════════════════════════════════════════════════════════════════════
//  saveManualPrice — 펀드·TDF NAV 수동 입력
// ════════════════════════════════════════════════════════════════════
function handleSaveManualPrice(dateStr, name, priceStr, keepLatestParam) {
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
      // ★ 종목명: 종목코드 시트 → 설정 시트 EDITABLE_PRICES 순으로 찾기
      // 펀드·TDF는 종목코드 시트에 없고 설정에만 있으므로 두 곳 모두 확인
      var codeItems = getCodeItems(ss);
      saveName = '';
      for (var ci = 0; ci < codeItems.length; ci++) {
        if (codeItems[ci].code === saveCode) { saveName = codeItems[ci].name; break; }
      }
      if (!saveName) {
        // 종목코드 시트에 없으면 설정 시트 EDITABLE_PRICES에서 찾기
        try {
          var settingsMap = _readSettingsMap();
          var epList = settingsMap.EDITABLE_PRICES;
          if (Array.isArray(epList)) {
            for (var ei = 0; ei < epList.length; ei++) {
              var epCode = epList[ei].code ? epList[ei].code.toString().trim().toUpperCase() : '';
              if (epCode === saveCode.toUpperCase()) { saveName = epList[ei].name || ''; break; }
            }
          }
        } catch(e) { /* 찾기 실패해도 빈 문자열로 진행 */ }
      }
    } else {
      saveCode = '';
      saveName = name;
    }

    var savedAt = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    upsertPriceHistory(ss, dateStr, saveCode, saveName, price, savedAt, 'MANUAL');

    var keepLatestRaw = (keepLatestParam || '').toString().trim();
    var keepLatest = keepLatestRaw
      ? /^1|true|y|yes$/i.test(keepLatestRaw)
      : _isManualKeepLatestEnabled();
    var pruned = 0;
    if (keepLatest) pruned = _pruneManualPriceHistoryKeepLatest(ss, saveCode, saveName);

    // ★ 수동 현재가 저장 직후, 해당 기준일 스냅샷도 즉시 재작성
    //   → 다른 기기에서도 동일 평가단가/평가금액이 보이도록 맞춤
    _rebuildSnapshotForDateFromHistory(ss, dateStr, saveCode, saveName);

    return jsonOk({ saved: true, date: dateStr, name: name, price: price, keepLatest: keepLatest, pruned: pruned });
  } catch(err) {
    return jsonError('saveManualPrice 실패: ' + err.message);
  }
}

function _rebuildSnapshotForDateFromHistory(ss, dateStr, targetCode, targetName) {
  try {
    var holdSh = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!holdSh || holdSh.getLastRow() < 2) return;
    var holdCols = Math.max(5, holdSh.getLastColumn());
    var holdData = holdSh.getRange(2, 1, holdSh.getLastRow() - 1, holdCols).getValues();
    var prices = getPriceHistoryRow(ss, dateStr);
    var sourceMap = _getPriceSourceByDate(ss, dateStr);
    var snapRows = [];

    holdData.forEach(function(row) {
      var code = _cleanCode(row[0]) || (row[0] || '').toString().trim();
      var name = (row[1] || '').toString().trim();
      if (targetCode || targetName) {
        var codeMatch = targetCode && code === targetCode;
        var nameMatch = targetName && name === targetName;
        if (!(codeMatch || nameMatch)) return;
      }
      var qty = parseFloat(row[2]) || 0;
      var isNewHoldFormat = row.length >= 7;
      var costAmt = parseFloat(isNewHoldFormat ? row[4] : row[3]) || 0;
      if (!name || qty <= 0) return;
      var price = (code && prices[code]) ? prices[code] : 0;
      var evalAmt = price > 0 ? Math.round(price * qty) : costAmt;
      var pnl = evalAmt - costAmt;
      var pct = costAmt > 0 ? parseFloat(((pnl / costAmt) * 100).toFixed(2)) : 0;
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      var src = (code && sourceMap[code]) ? sourceMap[code] : 'UNKNOWN';
      snapRows.push([dateStr, code, name, qty, costUnit, costAmt, evalUnit, evalAmt, pnl, pct, src]);
    });
    if (snapRows.length > 0) writeSnapshotRows(ss, dateStr, snapRows, true);
  } catch (e) {
    Logger.log('⚠️ 수동저장 후 스냅샷 재작성 실패(' + dateStr + '): ' + e.message);
  }
}

function _getPriceSourceByDate(ss, dateStr) {
  var out = {};
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return out;
    var data = ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(6, ph.getLastColumn())).getValues();
    data.forEach(function(r) {
      var d = _normalizeDate(r[0]);
      if (d !== dateStr) return;
      var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
      var src = (r[5] || '').toString().trim();
      if (code && src) out[code] = src;
    });
  } catch (e) {
    Logger.log('⚠️ 가격소스 조회 실패(' + dateStr + '): ' + e.message);
  }
  return out;
}

function _isManualKeepLatestEnabled() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('manual_keep_latest') || 'false') === 'true';
}

function _getPriceSourceMode() {
  var props = PropertiesService.getScriptProperties();
  var mode = (props.getProperty('price_source_mode') || 'google').toLowerCase();
  if (mode !== 'krx_first') mode = 'google';
  return mode;
}

function _priceSourceModeLabel() {
  var mode = _getPriceSourceMode();
  return mode === 'krx_first'
    ? '📡 가격소스: KRX 우선 (GF 보조)'
    : '📡 가격소스: GOOGLEFINANCE 전용';
}

function togglePriceSourceMode() {
  var props = PropertiesService.getScriptProperties();
  var next = _getPriceSourceMode() === 'krx_first' ? 'google' : 'krx_first';
  props.setProperty('price_source_mode', next);
  var msg = '⚙️ 가격소스 모드: ' + (next === 'krx_first' ? 'KRX 우선 (GF fallback)' : 'GOOGLEFINANCE 전용');
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert(
      msg +
      '\n※ 과거 거래일 종가 정확도는 KRX 우선이 일반적으로 유리합니다.' +
      '\n※ KRX 조회 실패 시 GOOGLEFINANCE로 자동 fallback 됩니다.'
    );
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function toggleManualKeepLatestOption() {
  var props = PropertiesService.getScriptProperties();
  var next = !_isManualKeepLatestEnabled();
  props.setProperty('manual_keep_latest', next ? 'true' : 'false');
  var msg = '⚙️ 수동가격 최신값만 유지 옵션: ' + (next ? 'ON' : 'OFF');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _pruneManualPriceHistoryKeepLatest(ss, code, name) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) return 0;

  var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
  var data = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
  var key = _cleanCode(code) || (name || '').toString().trim();
  if (!key) return 0;

  var matches = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowCode = _cleanCode(row[1]) || (row[1] || '').toString().trim();
    var rowName = (row[2] || '').toString().trim();
    var rowKey = rowCode || rowName;
    if (rowKey !== key) continue;

    var savedAt = _normalizeDatetime(row[4]);
    if (!savedAt) continue; // 수동입력(savedAt 있음)만 정리
    var date = _normalizeDate(row[0]);
    matches.push({ rowNo: i + 2, savedAt: savedAt, date: date });
  }
  if (matches.length <= 1) return 0;

  matches.sort(function(a, b) {
    var ak = (a.savedAt || a.date || '') + '#' + _pad(a.rowNo);
    var bk = (b.savedAt || b.date || '') + '#' + _pad(b.rowNo);
    return ak.localeCompare(bk);
  });

  var keepRow = matches[matches.length - 1].rowNo;
  var toDelete = matches
    .filter(function(m){ return m.rowNo !== keepRow; })
    .map(function(m){ return m.rowNo; })
    .sort(function(a,b){ return b-a; }); // 아래서부터 삭제

  toDelete.forEach(function(rowNo){ ph.deleteRow(rowNo); });
  SpreadsheetApp.flush();
  return toDelete.length;
}

// ════════════════════════════════════════════════════════════════════
//  내부 — 가격이력 시트 특정 날짜 행 읽기
// ════════════════════════════════════════════════════════════════════
function getPriceHistoryRow(ss, dateStr) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return {};
    var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var result = {};
    var legacyToCanonical = {};
    getCodeItems(ss).forEach(function(item) {
      var canonical = item.code;
      var legacy = _legacyDigitsCode(item.code);
      if (legacy && canonical && legacy !== canonical) legacyToCanonical[legacy] = canonical;
    });
    data.forEach(function(row) {
      if (_normalizeDate(row[0]) !== dateStr) return;
      var code  = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (key && price > 0) {
        var existing = result[key];
        // 같은 날짜에서 수동입력 행(savedAt 있음) 우선
        if (!(existing && existing._savedAt && !(_normalizeDatetime(row[4])))) {
          var savedAt = _normalizeDatetime(row[4]);
          result[key] = { _price: price, _savedAt: savedAt };
          if (code && legacyToCanonical[code]) result[legacyToCanonical[code]] = { _price: price, _savedAt: savedAt };
        }
      }
    });
    Object.keys(result).forEach(function(k) { result[k] = result[k]._price; });
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
    var readCols = ph.getLastColumn() >= 5 ? 5 : 4;
    var data   = ph.getRange(2, 1, ph.getLastRow() - 1, readCols).getValues();
    var codeAliasToCanonical = _buildCodeAliasMap(codes);
    // code → { date, price } 최신값 유지
    var latest = {};
    data.forEach(function(row) {
      var date  = _normalizeDate(row[0]);
      var code  = _cleanCode(row[1]) || (row[1] || '').toString().trim();
      var name  = (row[2] || '').toString().trim();
      var price = parseFloat(row[3]) || 0;
      var key   = code || name;
      if (!date || !key || price <= 0) return;
      var outKey = codeAliasToCanonical[key];
      if (!outKey) return;
      var savedAt = _normalizeDatetime(row[4]);
      if (!latest[outKey] || date > latest[outKey].date) {
        latest[outKey] = { date: date, price: price, savedAt: savedAt };
      } else if (date === latest[outKey].date) {
        // 같은 날짜라면 수동입력(savedAt 있음) 값 우선
        if (!latest[outKey].savedAt && savedAt) {
          latest[outKey] = { date: date, price: price, savedAt: savedAt };
        }
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
      ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
      ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100); ph.setColumnWidth(6,140);
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
        toUpdate.push({ row: existingMap[key], price: item.price, source: (item.source || '') });
      } else {
        toAppend.push([dateStr, cleanedCode, cleanedName, item.price, (item.savedAt || ''), (item.source || '')]);
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
      toUpdate.forEach(function(u) { ph.getRange(u.row, 6).setValue(u.source || ''); });
    }
    if (toAppend.length > 0) {
      ph.getRange(ph.getLastRow() + 1, 1, toAppend.length, 6).setValues(toAppend);
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
function upsertPriceHistory(ss, dateStr, code, name, price, savedAt, source) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph) {
      ph = ss.insertSheet(CONFIG.SHEET_PH);
      ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
      ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      ph.setColumnWidth(1,100); ph.setColumnWidth(2,100);
      ph.setColumnWidth(3,200); ph.setColumnWidth(4,100); ph.setColumnWidth(6,140);
    }
    var cleanedCode = _cleanCode(code);
    var rawName     = (name || '').toString().trim();
    var cleanedName = (rawName && isNaN(Number(rawName))) ? rawName : '';
    var matchKey    = cleanedCode || cleanedName;
    var lastRow     = ph.getLastRow();
    if (lastRow > 1) {
      var data = ph.getRange(2, 1, lastRow - 1, Math.max(6, ph.getLastColumn())).getValues();
      for (var i = 0; i < data.length; i++) {
        var rowDate = _normalizeDate(data[i][0]);
        var rowCode = data[i][1].toString().trim();
        var rowName = data[i][2].toString().trim();
        var rowKey  = rowCode || rowName;
        if (rowDate === dateStr && rowKey === matchKey) {
          // ★ 수동저장(savedAt 있음)이면 항상 덮어씌움
          // ★ 기존 행이 자동조회(savedAt 없음)였어도 수동저장으로 업그레이드
          ph.getRange(i + 2, 4).setValue(price);
          ph.getRange(i + 2, 5).setValue(savedAt || '');
          ph.getRange(i + 2, 6).setValue(source || '');
          SpreadsheetApp.flush();
          return;
        }
      }
    }
    ph.getRange(ph.getLastRow() + 1, 1, 1, 6).setValues([[dateStr, cleanedCode, cleanedName, price, (savedAt || ''), (source || '')]]);
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
      sh.setColumnWidth(6,100); sh.setColumnWidth(7,120);
    }
    sh.clearContents();
    sh.getRange(1,1,1,7).setValues([['종목코드','종목명','수량','매수단가','매수원금','자산유형','계좌']]);
    sh.getRange(1,1,1,7).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
    if (holdings.length > 0) {
      var rows = holdings.map(function(h) {
        var qty = parseFloat(h.qty) || 0;
        var costAmt = parseFloat(h.costAmt) || 0;
        var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
        return [h.code||'', h.name||'', qty, costUnit, costAmt, h.assetType||'주식', h.acct||''];
      });
      sh.getRange(2, 1, rows.length, 7).setValues(rows);
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

    // ★ 최근 7일 보정: KRX로 저장되지 않은 건만 KRX 기준으로 재확정
    _repairRecentNonKrxHistory(ss, todayStr, items, 7);

    var existing = getPriceHistoryRow(ss, todayStr);
    var prices   = {};
    var priceSources = {};
    Object.keys(existing).forEach(function(k){ prices[k] = existing[k]; });

    // ★ 자동 트리거: KRX 우선 확정, 실패분만 GF fallback
    var krxPrices = {};
    try { krxPrices = fetchPricesKrx(items, todayStr); } catch(e) { Logger.log('⚠️ saveDailyPriceHistory KRX 실패: ' + e.message); }
    var gfNeedItems = items.filter(function(item){ return !(krxPrices[item.code] && krxPrices[item.code].price > 0); });
    var gfPrices = gfNeedItems.length > 0 ? fetchPricesGoogleFinance(gfNeedItems, todayStr, ss) : {};
    var newPriceRows = [];
    items.forEach(function(item) {
      var p = (krxPrices[item.code] && krxPrices[item.code].price > 0) ? krxPrices[item.code] : gfPrices[item.code];
      if (p && p.price > 0) {
        prices[item.code] = p.price;
        priceSources[item.code] = p.source || 'UNKNOWN';
        if (!existing[item.code] || Number(existing[item.code]) !== Number(p.price)) {
          newPriceRows.push({ code: item.code, name: item.name, price: p.price, source: (p.source || 'UNKNOWN') });
        }
      }
    });
    if (newPriceRows.length > 0) batchUpsertPriceHistory(ss, todayStr, newPriceRows);

    var holdSh = ss.getSheetByName(CONFIG.SHEET_HOLD);
    if (!holdSh || holdSh.getLastRow() < 2) {
      Logger.log('⚠️ 보유현황 시트 없음 — HTML에서 한 번 접속하면 자동 동기화됩니다'); return;
    }
    var holdCols = Math.max(5, holdSh.getLastColumn());
    var holdData = holdSh.getRange(2, 1, holdSh.getLastRow() - 1, holdCols).getValues();

    var snapRows = [];
    holdData.forEach(function(row) {
      var code    = (row[0] || '').toString().trim();
      var name    = (row[1] || '').toString().trim();
      var qty     = parseFloat(row[2]) || 0;
      var isNewHoldFormat = row.length >= 7;
      var costAmt = parseFloat(isNewHoldFormat ? row[4] : row[3]) || 0;
      if (!name || qty <= 0) return;
      var price   = (code && prices[code]) ? prices[code] : 0;
      var evalAmt = price > 0 ? Math.round(price * qty) : costAmt;
      var pnl     = evalAmt - costAmt;
      var pct     = costAmt > 0 ? parseFloat(((pnl / costAmt) * 100).toFixed(2)) : 0;
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      snapRows.push([todayStr, code, name, qty, costUnit, costAmt, evalUnit, evalAmt, pnl, pct, (priceSources[code] || 'UNKNOWN')]);
    });

    if (snapRows.length === 0) { Logger.log('스냅샷 저장할 데이터 없음'); return; }
    writeSnapshotRows(ss, todayStr, snapRows, true);
    SpreadsheetApp.flush();
  } catch(err) {
    Logger.log('❌ saveDailyPriceHistory 실패: ' + err.message);
  }
}

function _repairRecentNonKrxHistory(ss, todayStr, items, daysBack) {
  try {
    var ph = ss.getSheetByName(CONFIG.SHEET_PH);
    if (!ph || ph.getLastRow() < 2) return;
    var byCode = {};
    items.forEach(function(it){ byCode[it.code] = it; });
    var recentDateSet = {};
    var td = new Date(todayStr + 'T00:00:00');
    var n = daysBack || 7;
    for (var i = 1; i <= n; i++) {
      var d = new Date(td);
      d.setDate(d.getDate() - i);
      recentDateSet[Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd')] = true;
    }

    var data = ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(6, ph.getLastColumn())).getValues();
    var targets = {};
    data.forEach(function(r) {
      var dateStr = _normalizeDate(r[0]);
      if (!recentDateSet[dateStr]) return;
      var code = _cleanCode(r[1]);
      if (!code || !byCode[code]) return;
      var src = (r[5] || '').toString().trim().toUpperCase();
      if (src === 'KRX' || src === 'KRX_OTP') return;
      if (!targets[dateStr]) targets[dateStr] = {};
      targets[dateStr][code] = true;
    });

    var fixedTotal = 0;
    Object.keys(targets).forEach(function(dateStr) {
      var subset = Object.keys(targets[dateStr]).map(function(code){ return byCode[code]; }).filter(Boolean);
      if (subset.length === 0) return;
      var krxMap = fetchPricesKrx(subset, dateStr);
      var rows = [];
      subset.forEach(function(item) {
        var p = krxMap[item.code];
        if (p && p.price > 0) rows.push({ code: item.code, name: item.name, price: p.price, source: (p.source || 'KRX') });
      });
      if (rows.length > 0) {
        batchUpsertPriceHistory(ss, dateStr, rows);
        fixedTotal += rows.length;
      }
    });
    if (fixedTotal > 0) {
      Logger.log('✅ 최근 ' + n + '일 비-KRX 가격이력 보정 완료: ' + fixedTotal + '건');
    } else {
      Logger.log('ℹ️ 최근 ' + n + '일 비-KRX 보정 대상 없음');
    }
  } catch (e) {
    Logger.log('⚠️ 최근 비-KRX 보정 실패: ' + e.message);
  }
}

function _updateTodaySnapshotSource(ss, dateStr, sourceByCode) {
  try {
    if (!sourceByCode || Object.keys(sourceByCode).length === 0) return;
    var snap = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (!snap || snap.getLastRow() < 2) return;
    var cols = Math.max(11, snap.getLastColumn());
    var data = snap.getRange(2, 1, snap.getLastRow() - 1, cols).getValues();
    var updates = [];
    for (var i = 0; i < data.length; i++) {
      var d = _normalizeDate(data[i][0]);
      if (d !== dateStr) continue;
      var code = _cleanCode(data[i][1]);
      var nextSrc = sourceByCode[code];
      if (!nextSrc) continue;
      if ((data[i][10] || '').toString().trim() === nextSrc) continue;
      updates.push({ row: i + 2, src: nextSrc });
    }
    updates.forEach(function(u) { snap.getRange(u.row, 11).setValue(u.src); });
  } catch (e) {
    Logger.log('⚠️ 스냅샷 소스 업데이트 실패: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  단일 날짜 가격/스냅샷 복구
//  예: repairPriceAndSnapshotForDate('2026-04-08')
// ════════════════════════════════════════════════════════════════════
function repairPriceAndSnapshotForDate(dateStr) {
  try {
    var normDate = _normalizeDate(dateStr);
    if (!normDate) throw new Error('유효한 날짜가 아닙니다: ' + dateStr);
    var ss = getss();

    var tradeSh = ss.getSheetByName(CONFIG.SHEET_TRADES);
    if (!tradeSh || tradeSh.getLastRow() < 2) throw new Error('거래이력 시트가 없습니다');
    var tradeData = tradeSh.getRange(2, 1, tradeSh.getLastRow() - 1, 8).getValues();

    var nameToCode = {};
    getCodeItems(ss).forEach(function(item){ nameToCode[item.name] = item.code; });
    tradeData.forEach(function(row) {
      var name = (row[3]||'').toString().trim();
      var code = (row[4]||'').toString().trim();
      if (name && code && !nameToCode[name]) nameToCode[name] = code;
    });

    var holdAtDate = calcHoldingsAtDate(tradeData, normDate, nameToCode);
    if (Object.keys(holdAtDate).length === 0) {
      Logger.log('[repair] 보유 종목 없음: ' + normDate);
      return;
    }

    var codeItems = Object.keys(holdAtDate)
      .map(function(k){ return holdAtDate[k]; })
      .filter(function(h){ return h.code && h.qty > 0; })
      .map(function(h){ return { code: h.code, name: h.name }; });

    var gfResult = fetchPricesGoogleFinance(codeItems, normDate, ss);
    var prices = {};
    var priceSources = {};
    Object.keys(gfResult).forEach(function(code) {
      var val = gfResult[code];
      prices[code] = val.price || val;
      priceSources[code] = val.source || 'GOOGLEFINANCE';
    });

    var phItems = Object.keys(holdAtDate)
      .map(function(k){ return holdAtDate[k]; })
      .filter(function(h){ return h.code && h.qty > 0 && prices[h.code] > 0; })
      .map(function(h){ return { code: h.code, name: h.name, price: prices[h.code], source: (priceSources[h.code] || 'UNKNOWN') }; });
    if (phItems.length > 0) batchUpsertPriceHistory(ss, normDate, phItems);

    var snapRows = [];
    Object.keys(holdAtDate).forEach(function(k) {
      var h = holdAtDate[k];
      if (h.qty <= 0) return;
      var price   = (h.code && prices[h.code]) ? prices[h.code] : 0;
      var evalAmt = price > 0 ? Math.round(price * h.qty) : h.costAmt;
      var pnl     = evalAmt - h.costAmt;
      var pct     = h.costAmt > 0 ? parseFloat(((pnl / h.costAmt) * 100).toFixed(2)) : 0;
      var costUnit = h.qty > 0 ? parseFloat((h.costAmt / h.qty).toFixed(2)) : 0;
      var evalUnit = h.qty > 0 ? parseFloat((evalAmt / h.qty).toFixed(2)) : 0;
      snapRows.push([normDate, h.code, h.name, h.qty, costUnit, h.costAmt, evalUnit, evalAmt, pnl, pct, (priceSources[h.code] || 'UNKNOWN')]);
    });
    if (snapRows.length > 0) writeSnapshotRows(ss, normDate, snapRows, true);

    Logger.log('[repair] 완료: ' + normDate + ' · 가격 ' + phItems.length + '건 · 스냅샷 ' + snapRows.length + '건');
  } catch (err) {
    Logger.log('❌ repairPriceAndSnapshotForDate 실패: ' + err.message);
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════
//  최근 날짜 가격 이상치 점검 (GF 대비)
//  예: detectPriceAnomalyDates(7, 8) // 최근 7일, 8% 이상 차이
// ════════════════════════════════════════════════════════════════════
function detectPriceAnomalyDates(days, thresholdPct) {
  var maxDays = Math.max(1, parseInt(days || 7, 10));
  var threshold = Math.max(1, parseFloat(thresholdPct || 8));
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) {
    Logger.log('[anomaly] 가격이력 시트 데이터 없음');
    return [];
  }

  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
  var byDate = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
    var name = (r[2] || '').toString().trim();
    var price = parseFloat(r[3]) || 0;
    var key = code || name;
    if (!d || !key || price <= 0) return;
    if (!byDate[d]) byDate[d] = {};
    byDate[d][key] = { code: code, name: name || key, price: price };
  });

  var dates = Object.keys(byDate).sort().reverse().slice(0, maxDays);
  var anomalies = [];

  dates.forEach(function(d) {
    var map = byDate[d];
    var items = Object.keys(map)
      .map(function(k){ return map[k]; })
      .filter(function(i){ return i.code; })
      .map(function(i){ return { code: i.code, name: i.name }; });
    if (items.length === 0) return;

    var gf = fetchPricesGoogleFinance(items, d, ss);
    Object.keys(map).forEach(function(k) {
      var row = map[k];
      if (!row.code || !(gf[row.code] && gf[row.code].price > 0)) return;
      var gfPrice = parseFloat(gf[row.code].price) || 0;
      if (gfPrice <= 0) return;
      var diffPct = Math.abs((row.price - gfPrice) / gfPrice * 100);
      if (diffPct >= threshold) {
        anomalies.push({
          date: d,
          code: row.code,
          name: row.name,
          hist: row.price,
          gf: gfPrice,
          diffPct: +diffPct.toFixed(2)
        });
      }
    });
  });

  var summary = '[anomaly] 최근 ' + dates.length + '일 점검, 이상치 ' + anomalies.length + '건';
  Logger.log(summary);
  anomalies.slice(0, 30).forEach(function(a) {
    Logger.log(a.date + ' ' + a.code + ' ' + a.name + ' hist=' + a.hist + ' gf=' + a.gf + ' diff=' + a.diffPct + '%');
  });
  try {
    var logGuide = '\n실행 로그: 확장 프로그램 > Apps Script > 실행(Executions) > detectPriceAnomalyDates';
    SpreadsheetApp.getUi().alert(summary + (anomalies.length ? logGuide : ''));
  } catch(e) {}
  return anomalies;
}

// ════════════════════════════════════════════════════════════════════
//  특정 일자 가격 이상치 점검 + 복구 여부 확인
//  예: detectPriceAnomalyForDate('2026-04-08', 8)
// ════════════════════════════════════════════════════════════════════
function detectPriceAnomalyForDate(dateStr, thresholdPct) {
  var targetDate = _normalizeDate(dateStr || '');
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error('유효한 일자를 입력하세요. 예) 2026-04-08');
  }
  var threshold = Math.max(1, parseFloat(thresholdPct || 8));
  var ss = getss();
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) {
    Logger.log('[anomaly/date] 가격이력 시트 데이터 없음');
    return { date: targetDate, threshold: threshold, anomalies: [], summary: '[anomaly/date] 가격이력 시트 데이터 없음' };
  }

  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 4).getValues();
  var map = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    if (d !== targetDate) return;
    var code = _cleanCode(r[1]) || (r[1] || '').toString().trim();
    var name = (r[2] || '').toString().trim();
    var price = parseFloat(r[3]) || 0;
    var key = code || name;
    if (!key || price <= 0) return;
    map[key] = { code: code, name: name || key, price: price };
  });

  var items = Object.keys(map)
    .map(function(k){ return map[k]; })
    .filter(function(i){ return i.code; })
    .map(function(i){ return { code: i.code, name: i.name }; });

  if (items.length === 0) {
    var noDataSummary = '[anomaly/date] ' + targetDate + ' 가격이력 데이터 없음';
    Logger.log(noDataSummary);
    return { date: targetDate, threshold: threshold, anomalies: [], summary: noDataSummary };
  }

  var gf = fetchPricesGoogleFinance(items, targetDate, ss);
  var anomalies = [];
  Object.keys(map).forEach(function(k) {
    var row = map[k];
    if (!row.code || !(gf[row.code] && gf[row.code].price > 0)) return;
    var gfPrice = parseFloat(gf[row.code].price) || 0;
    if (gfPrice <= 0) return;
    var diffPct = Math.abs((row.price - gfPrice) / gfPrice * 100);
    if (diffPct >= threshold) {
      anomalies.push({
        date: targetDate,
        code: row.code,
        name: row.name,
        hist: row.price,
        gf: gfPrice,
        diffPct: +diffPct.toFixed(2)
      });
    }
  });

  var summary = '[anomaly/date] ' + targetDate + ' 점검, 이상치 ' + anomalies.length + '건 (기준 ' + threshold + '%)';
  Logger.log(summary);
  anomalies.slice(0, 50).forEach(function(a) {
    Logger.log(a.date + ' ' + a.code + ' ' + a.name + ' hist=' + a.hist + ' gf=' + a.gf + ' diff=' + a.diffPct + '%');
  });
  return { date: targetDate, threshold: threshold, anomalies: anomalies, summary: summary };
}

function detectPriceAnomalyPromptAndMaybeRepair() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var rangeResp = ui.prompt(
    '기간 지정 이상치 점검',
    '조회 기간을 입력하세요. 예: 2026-04-01~2026-04-08 (하루만 점검 시 같은 날짜 입력)',
    ui.ButtonSet.OK_CANCEL
  );
  if (rangeResp.getSelectedButton() !== ui.Button.OK) return;

  var rawRange = (rangeResp.getResponseText() || '').trim();
  if (!rawRange) {
    ui.alert('조회 기간을 입력해 주세요. 예: 2026-04-01~2026-04-08');
    return;
  }
  var rangeParts = rawRange.split('~');
  var fromDate = _normalizeDate((rangeParts[0] || '').trim());
  var toDate = _normalizeDate((rangeParts[1] || rangeParts[0] || '').trim());
  if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    ui.alert('유효한 기간 형식이 아닙니다. 예: 2026-04-01~2026-04-08');
    return;
  }
  if (fromDate > toDate) {
    var tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }

  var thresholdResp = ui.prompt(
    '이상치 기준(%)',
    '차이율 임계값을 입력하세요. (기본 8)',
    ui.ButtonSet.OK_CANCEL
  );
  if (thresholdResp.getSelectedButton() !== ui.Button.OK) return;
  var threshold = parseFloat((thresholdResp.getResponseText() || '').trim());
  if (!(threshold > 0)) threshold = 8;

  var ss = getss();
  var targetDates = _listPriceHistoryDatesInRange(ss, fromDate, toDate);
  var allAnomalies = [];
  targetDates.forEach(function(d) {
    var one = detectPriceAnomalyForDate(d, threshold);
    if (one.anomalies && one.anomalies.length) {
      allAnomalies = allAnomalies.concat(one.anomalies);
    }
  });

  var summary = '[anomaly/range] ' + fromDate + '~' + toDate + ' 점검일 ' + targetDates.length + '일, 이상치 ' + allAnomalies.length + '건';
  Logger.log(summary);

  var logGuide = '\n실행 로그: 확장 프로그램 > Apps Script > 실행(Executions) > detectPriceAnomalyPromptAndMaybeRepair';
  if (!allAnomalies.length) {
    ui.alert(summary + '\n이상치가 없어 업데이트를 건너뜁니다.' + logGuide);
    return;
  }

  var ask = ui.alert(
    '이상치 발견',
    summary + '\n이상 항목을 해당일 GOOGLEFINANCE 값으로 가격이력에 반영할까요?' + logGuide,
    ui.ButtonSet.YES_NO
  );
  if (ask !== ui.Button.YES) {
    ui.alert('업데이트를 취소했습니다. 필요 시 메뉴에서 다시 실행해 주세요.');
    return;
  }

  var byDate = {};
  allAnomalies.forEach(function(a) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push({
      code: a.code,
      name: a.name,
      price: a.gf,
      savedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      source: 'GOOGLEFINANCE'
    });
  });

  var updatedRows = 0;
  Object.keys(byDate).sort().forEach(function(d) {
    batchUpsertPriceHistory(ss, d, byDate[d]);
    updatedRows += byDate[d].length;
  });

  var syncAsk = ui.alert(
    '가격이력 업데이트 완료',
    '총 ' + updatedRows + '건 반영했습니다.\n해당 일자 스냅샷도 재생성할까요?',
    ui.ButtonSet.YES_NO
  );
  if (syncAsk === ui.Button.YES) {
    Object.keys(byDate).sort().forEach(function(d) { repairPriceAndSnapshotForDate(d); });
    ui.alert('✅ 스냅샷 재생성 완료\n점검 기간: ' + fromDate + '~' + toDate);
    return;
  }
  ui.alert('✅ 가격이력 업데이트 완료\n점검 기간: ' + fromDate + '~' + toDate + '\n(스냅샷 재생성은 건너뜀)');
}

function _listPriceHistoryDatesInRange(ss, fromDate, toDate) {
  var ph = ss.getSheetByName(CONFIG.SHEET_PH);
  if (!ph || ph.getLastRow() < 2) return [];
  var rows = ph.getRange(2, 1, ph.getLastRow() - 1, 1).getValues();
  var seen = {};
  rows.forEach(function(r) {
    var d = _normalizeDate(r[0]);
    if (!d || d < fromDate || d > toDate) return;
    seen[d] = true;
  });
  return Object.keys(seen).sort();
}

// ════════════════════════════════════════════════════════════════════
//  트리거 등록
// ════════════════════════════════════════════════════════════════════
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (
      fn === 'saveDailyPriceHistory' || fn === 'cleanDeadCodes' ||
      fn === 'runCodeNormalize1550' || fn === 'runEvalPriceUpdate1620'
    ) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runCodeNormalize1550').timeBased().everyDays(1).atHour(15).nearMinute(50).create();
  ScriptApp.newTrigger('runEvalPriceUpdate1620').timeBased().everyDays(1).atHour(16).nearMinute(20).create();
  Logger.log('트리거 등록 완료: 매일 15:50 runCodeNormalize1550 → 16:20 runEvalPriceUpdate1620');
  try { SpreadsheetApp.getUi().alert('✅ 트리거 등록 완료!\n15:50 종목코드 보정 → 16:20 평가단가 업데이트'); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function _ensureDailyTriggers(autoFix) {
  var hasClean = false;
  var hasSave = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runCodeNormalize1550') hasClean = true;
    if (fn === 'runEvalPriceUpdate1620') hasSave = true;
  });

  if (autoFix) {
    if (!hasClean) {
      ScriptApp.newTrigger('runCodeNormalize1550').timeBased().everyDays(1).atHour(15).nearMinute(50).create();
      hasClean = true;
    }
    if (!hasSave) {
      ScriptApp.newTrigger('runEvalPriceUpdate1620').timeBased().everyDays(1).atHour(16).nearMinute(20).create();
      hasSave = true;
    }
  }
  return { hasClean: hasClean, hasSave: hasSave };
}

function checkDailyAutomationStatus() {
  var ss = getss();
  var trig = _ensureDailyTriggers(false);
  var autoFixed = false;
  if (!trig.hasClean || !trig.hasSave) {
    try {
      trig = _ensureDailyTriggers(true);
      autoFixed = true;
    } catch(e) {
      Logger.log('⚠️ checkDailyAutomationStatus 자동복구 실패: ' + e.message);
    }
  }
  var snapLast = '-';
  var phLast = '-';

  var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
  if (snapSh && snapSh.getLastRow() > 1) {
    var snapVal = snapSh.getRange(snapSh.getLastRow(), 1).getValue();
    snapLast = _normalizeDate(snapVal) || (snapVal || '').toString();
  }
  var phSh = ss.getSheetByName(CONFIG.SHEET_PH);
  if (phSh && phSh.getLastRow() > 1) {
    var phVal = phSh.getRange(phSh.getLastRow(), 1).getValue();
    phLast = _normalizeDate(phVal) || (phVal || '').toString();
  }

  var msg = '⏰ 자동화 상태 점검\n\n'
    + 'runCodeNormalize1550(15:50) 트리거: ' + (trig.hasClean ? '정상' : '없음') + '\n'
    + 'runEvalPriceUpdate1620(16:20) 트리거: ' + (trig.hasSave ? '정상' : '없음') + '\n\n'
    + '스냅샷 마지막 날짜: ' + snapLast + '\n'
    + '가격이력 마지막 날짜: ' + phLast + '\n\n'
    + (!trig.hasClean || !trig.hasSave
      ? '⚠️ 트리거가 누락되어 있습니다. [자동 트리거 등록]을 다시 실행하세요.'
      : (autoFixed
          ? '✅ 트리거 누락을 자동 복구했습니다.'
          : '✅ 트리거는 등록되어 있습니다. 누락 일자는 [소급채우기]로 복구할 수 있습니다.'));
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function runCodeNormalize1550() {
  cleanDeadCodes();
}

function runEvalPriceUpdate1620() {
  saveDailyPriceHistory();
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
  var existingPhDates = {};
  if (!overwrite) {
    var snapSh = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT);
    if (snapSh && snapSh.getLastRow() > 1) {
      snapSh.getRange(2, 1, snapSh.getLastRow() - 1, 1).getValues().forEach(function(r) {
        existingDates[(r[0]||'').toString().trim()] = true;
      });
    }
    var phSh = ss.getSheetByName(CONFIG.SHEET_PH);
    if (phSh && phSh.getLastRow() > 1) {
      phSh.getRange(2, 1, phSh.getLastRow() - 1, 1).getValues().forEach(function(r) {
        var d = _normalizeDate(r[0]);
        if (d) existingPhDates[d] = true;
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
      : tradingDays.filter(function(d){ return !existingDates[d] || !existingPhDates[d]; });

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
        var priceSources = {};
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
            priceSources[code] = val.source || 'GOOGLEFINANCE';
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
          var costUnit = h.qty > 0 ? parseFloat((h.costAmt / h.qty).toFixed(2)) : 0;
          var evalUnit = h.qty > 0 ? parseFloat((evalAmt / h.qty).toFixed(2)) : 0;
          snapRows.push([dateStr, h.code, h.name, h.qty, costUnit, h.costAmt, evalUnit, evalAmt, pnl, pct, (priceSources[h.code] || 'UNKNOWN')]);
        });

        if (snapRows.length > 0) {
          writeSnapshotRows(ss, dateStr, snapRows, overwrite);
          // ★ 가격이력 시트도 함께 저장 — 프론트 과거 날짜 조회용
          var phItems = Object.keys(holdAtDate)
            .map(function(k){ return holdAtDate[k]; })
            .filter(function(h){ return h.code && h.qty > 0 && prices[h.code] > 0; })
            .map(function(h){ return { code: h.code, name: h.name, price: prices[h.code], source: (priceSources[h.code] || 'UNKNOWN') }; });
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
    var header = [['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스']];
    var colSize = header[0].length;
    var toNewSnapshotRow = function(r) {
      if (!Array.isArray(r)) return ['', '', '', 0, 0, 0, 0, 0, 0, 0, ''];
      if (r.length >= 11) return r.slice(0, 11);
      if (r.length === 10) return r.concat(['']);
      var qty = parseFloat(r[3]) || 0;
      var costAmt = parseFloat(r[4]) || 0;
      var evalAmt = parseFloat(r[5]) || 0;
      var pnl = parseFloat(r[6]) || (evalAmt - costAmt);
      var pct = parseFloat(r[7]) || (costAmt > 0 ? parseFloat(((pnl / costAmt) * 100).toFixed(2)) : 0);
      var costUnit = qty > 0 ? parseFloat((costAmt / qty).toFixed(2)) : 0;
      var evalUnit = qty > 0 ? parseFloat((evalAmt / qty).toFixed(2)) : 0;
      return [r[0] || '', r[1] || '', r[2] || '', qty, costUnit, costAmt, evalUnit, evalAmt, pnl, pct, (r[10] || '')];
    };
    newRows = (newRows || []).map(toNewSnapshotRow);

    if (!sh) {
      sh = ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
      sh.getRange(1,1,1,colSize).setValues(header);
      sh.getRange(1,1,1,colSize).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (newRows.length > 0) sh.getRange(2, 1, newRows.length, colSize).setValues(newRows);
      return;
    }

    if (sh.getLastRow() > 1) {
      var existing = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(8, sh.getLastColumn())).getValues().map(toNewSnapshotRow);
      var kept     = existing.filter(function(r){ return _normalizeDate(r[0]) !== dateStr; });
      if (!overwrite && kept.length < existing.length) return;
      var combined = _dedupeSnapshotRows(kept.concat(newRows));
      sh.clearContents();
      sh.getRange(1,1,1,colSize).setValues(header);
      sh.getRange(1,1,1,colSize).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
      if (combined.length > 0) sh.getRange(2, 1, combined.length, colSize).setValues(combined);
    } else {
      if (newRows.length > 0) sh.getRange(sh.getLastRow() + 1, 1, newRows.length, colSize).setValues(newRows);
    }
  } catch(err) {
    Logger.log('❌ writeSnapshotRows 실패: ' + err.message);
    throw err;
  }
}

function _dedupeSnapshotRows(rows) {
  var seen = {};
  var out = [];
  (rows || []).forEach(function(r) {
    if (!Array.isArray(r)) return;
    var date = _normalizeDate(r[0]);
    if (!date) return;
    var code = _cleanCode(r[1]) || (r[2] || '').toString().trim();
    var key = date + '|' + code;
    if (seen[key]) return;
    seen[key] = true;
    var row = r.slice(0, 11);
    row[0] = date;
    out.push(row);
  });
  return out;
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
    var numCols  = Math.max(sh.getLastColumn(), 6);
    var data     = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
    var holdings = data
      .filter(function(r){ return r[1]; })
      .map(function(r) {
        var isNewFormat = r.length >= 7;
        return {
          code:      (r[0] || '').toString(),
          name:      (r[1] || '').toString(),
          qty:       parseFloat(r[2]) || 0,
          costAmt:   parseFloat(isNewFormat ? r[4] : r[3]) || 0,
          assetType: (isNewFormat ? r[5] : r[4] || '주식').toString(),
          acct:      (isNewFormat ? r[6] : r[5] || '').toString(),
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
function _parseJsonParam(dataJson, label) {
  var parsed;
  try { parsed = JSON.parse(decodeURIComponent(dataJson)); } catch(e) {
    try { parsed = JSON.parse(dataJson); } catch(e2) { throw new Error(label + ' 파싱 실패'); }
  }
  if (!parsed || Object.prototype.toString.call(parsed) !== '[object Object]') throw new Error(label + ' 객체 형식 필요');
  return parsed;
}

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
  ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
  ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  ph.setColumnWidth(1,100); ph.setColumnWidth(2,100); ph.setColumnWidth(3,200); ph.setColumnWidth(4,100);
  if (newRows.length > 0) ph.getRange(2, 1, newRows.length, 5).setValues(newRows.map(function(r){ return [r[0], r[1], r[2], r[3], '']; }));
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
    snap.getRange(1,1,1,11).setValues([['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스']]);
    snap.getRange(1,1,1,11).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  }

  var ph = ss.getSheetByName(CONFIG.SHEET_PH) || ss.insertSheet(CONFIG.SHEET_PH);
  if (ph.getLastRow() === 0) {
    ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
    ph.getRange(1,1,1,6).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');
  }

  try {
    SpreadsheetApp.getUi().alert(
      '✅ 초기화 완료!\n\n다음 단계:\n' +
      '1. [📊 포트폴리오] → [🔄 종가 갱신]\n' +
      '2. [📊 포트폴리오] → [⏰ 자동 트리거 등록] (1회만)'
    );
  } catch(e) { Logger.log('UI 알림 실패: ' + e.message); }
}

function clearPriceAndSnapshotRows() {
  var ss = getss();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch(e) { ui = null; }
  if (!ui) throw new Error('스프레드시트 UI 환경에서 실행하세요.');

  var ans = ui.alert(
    '가격이력/스냅샷 데이터 삭제',
    '제목행(1행)은 유지하고 2행 이하 데이터만 모두 삭제합니다.\n계속할까요?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var deleted = 0;
  var ph = ss.getSheetByName(CONFIG.SHEET_PH) || ss.insertSheet(CONFIG.SHEET_PH);
  if (ph.getLastRow() === 0) ph.getRange(1,1,1,6).setValues([['날짜','종목코드','종목명','가격','입력일시','가격소스']]);
  if (ph.getLastRow() > 1) {
    deleted += ph.getLastRow() - 1;
    ph.getRange(2, 1, ph.getLastRow() - 1, Math.max(1, ph.getLastColumn())).clearContent();
  }

  var snap = ss.getSheetByName(CONFIG.SHEET_SNAPSHOT) || ss.insertSheet(CONFIG.SHEET_SNAPSHOT);
  if (snap.getLastRow() === 0) snap.getRange(1,1,1,11).setValues([['날짜','종목코드','종목명','수량','매수단가','매수원금','평가단가','평가금액','손익','수익률(%)','평가단가소스']]);
  if (snap.getLastRow() > 1) {
    deleted += snap.getLastRow() - 1;
    snap.getRange(2, 1, snap.getLastRow() - 1, Math.max(1, snap.getLastColumn())).clearContent();
  }
  var msg = '✅ 삭제 완료 (총 ' + deleted + '행)';
  Logger.log(msg);
  ui.alert(msg);
}
// ════════════════════════════════════════════════════════════════════
//  메뉴
// ════════════════════════════════════════════════════════════════════
function onOpen() {
  // 트리거가 실수로 삭제된 경우 자동 복구(중복 생성 없음)
  try { _ensureDailyTriggers(true); } catch(e) { Logger.log('트리거 자동복구 실패: ' + e.message); }
  var manualKeepLabel = _isManualKeepLatestEnabled()
    ? '🧷 수동가격 최신값만 유지: ON'
    : '🧷 수동가격 최신값만 유지: OFF';
  var priceSourceLabel = _priceSourceModeLabel();

  SpreadsheetApp.getUi()
    .createMenu('📊 포트폴리오')
    // ── 초기 설정 (처음 1회) ──
    .addItem('⚙️ 초기 설정 (처음만)', 'initSheet')
    .addItem('⏰ 자동 트리거 등록 (1회만)', 'setupTrigger')
    .addSeparator()
    // ── 종가 갱신 ──
    .addItem('🔄 종가 갱신 (소스설정 반영)', 'updatePrices')
    .addItem('🗓️ KRX 불러오기/덮어쓰기(기간 팝업)', 'importKrxClosesPrompt')
    .addItem('📅 오늘 가격이력 저장', 'saveDailyPriceHistory')
    .addItem(priceSourceLabel, 'togglePriceSourceMode')
    .addItem('🔑 KRX AUTH_KEY 설정', 'configureKrxAuthKeyPrompt')
    .addItem(manualKeepLabel, 'toggleManualKeepLatestOption')
    .addItem('🔎 자동화 상태 점검', 'checkDailyAutomationStatus')
    .addSeparator()
    // ── 과거 소급채우기 ──
    .addItem('📆 소급채우기 시작 (범위 지정)', 'backfillRangePrompt')
    .addItem('▶️ 소급채우기 이어서', 'backfillResume')
    .addItem('📊 소급채우기 진행상황', 'backfillStatus')
    .addSeparator()
    // ── 유지보수 ──
    .addItem('🧹 죽은 코드 정리', 'cleanDeadCodes')
    .addItem('🔧 가격이력 종목명 보정', 'fixPriceHistoryNames')
    .addItem('🗑️ 가격이력/스냅샷 데이터 삭제(헤더 유지)', 'clearPriceAndSnapshotRows')
    .addItem('🩺 최근 가격 이상치 점검', 'detectPriceAnomalyDates')
    .addItem('🩹 기간 지정 점검 후 업데이트/복구', 'detectPriceAnomalyPromptAndMaybeRepair')
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

// ★ savedAt(날짜+시간) 정규화 — Date 객체 또는 임의 문자열 → 'yyyy-MM-dd HH:mm:ss'
function _normalizeDatetime(raw) {
  if (!raw) return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  var s = raw.toString().trim();
  // 이미 yyyy-MM-dd HH:mm:ss 형식
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  // 'Thu Apr 02 2026 04:31:48 GMT+0900 ...' 형식 등 → new Date() 파싱
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  } catch(e) {}
  return s; // 최후 fallback — 원본 반환
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
