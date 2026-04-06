// ════════════════════════════════════════════════════════════════
//  settings_sync.js — GAS 종목코드·보유현황·거래이력 동기화
//  의존: settings.js, data.js
// ════════════════════════════════════════════════════════════════
function _normalizeSyncCode(code) {
  if (typeof normalizeStockCode === 'function') return normalizeStockCode(code);
  return String(code || '').trim();
}

async function syncIssuesToGsheet(source, issues) {
  if (!GSHEET_API_URL || !Array.isArray(issues) || issues.length === 0) return null;
  try {
    const body = 'action=saveSyncIssues'
      + '&source=' + encodeURIComponent(source || 'unknown')
      + '&data=' + encodeURIComponent(JSON.stringify(issues));
    const res = await fetchWithTimeout(GSHEET_API_URL, 15000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) { console.warn('[saveSyncIssues] HTTP', res.status); return null; }
    const data = await res.json();
    if (data.status !== 'ok') { console.warn('[saveSyncIssues] GAS 오류:', data); return null; }
    return data;
  } catch (e) {
    console.warn('[saveSyncIssues]', e.message);
    return null;
  }
}

// ── 구글시트 종목코드 목록 로드
let _gsheetCodeList = []; // [{code, name}]

async function loadGsheetCodeList() {
  if (!GSHEET_API_URL) return;
  try {
    const url = GSHEET_API_URL + '?action=getCodeList';
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.codes)) {
      _gsheetCodeList = data.codes
        .map(item => ({
          code: _normalizeSyncCode(item?.code),
          name: String(item?.name || '').trim(),
          type: String(item?.type || '').trim(),
          sector: String(item?.sector || '').trim(),
        }))
        .filter(item => item.code && item.name);

      // ⚠️ STOCK_CODE는 건드리지 않음 — HTML 직접 입력이 항상 우선
      // GSheet 코드는 _gsheetCodeList에만 보관, lookupNameByCode()에서 3순위 참고용으로만 사용
    }
  } catch(e) {
  }
}

// ── 종목코드 GSheet 자동 등록
async function syncCodesToGsheet() {
  if (!GSHEET_API_URL) return;
  try {
    // ★ EDITABLE_PRICES 기준으로 {name: {code, type, sector}} 구조 전송
    // type/sector를 함께 보내야 GAS에서 유형 컬럼을 덮어쓰지 않음
    const codeMap = {};
    EDITABLE_PRICES.forEach(i => {
      if (!i.name) return;
      codeMap[i.name] = {
        code:   _normalizeSyncCode(i.code),
        type:   i.assetType || i.type || '주식',
        sector: i.sector    || '기타',
      };
    });
    // 중요: 기초정보(EDITABLE_PRICES)만 동기화해 GS 데이터가 자동으로 흔들리지 않도록 유지
    if (Object.keys(codeMap).length === 0) { console.warn('[syncCodes] 전송할 코드 없음'); return null; }
    const body = 'action=syncCodes&codes=' + encodeURIComponent(JSON.stringify(codeMap));
    const res = await fetchWithTimeout(GSHEET_API_URL, 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[GSheet 동기화] HTTP', res.status); return null; }
    const data = await res.json();
    if (data.status !== 'ok') { console.warn('[GSheet 동기화] 응답 오류', data); return null; }
    return data; // { synced, updated, removed, total }
  } catch(e) {
    console.warn('[GSheet 동기화] 예외:', e);
    return null;
  }
}

// ★ v8.1 — 보유현황 GSheet 동기화 (트리거 자동 스냅샷을 위해 필요)
// rawHoldings(수량·원금)를 GSheet 보유현황 시트에 저장
async function syncHoldingsToGsheet() {
  if (!GSHEET_API_URL) return;
  try {
    // rows에서 종목별 합산 데이터 추출 (계좌 합산 기준)
    const holdMap = {};
    rawHoldings.forEach(h => {
      if (!h.name || h.qty <= 0) return;
      const ep   = getEP(h.name);
      const code = ep?.code || STOCK_CODE[h.name] || '';
      const key  = h.name;
      if (!holdMap[key]) holdMap[key] = { code, name: h.name, qty: 0, costAmt: 0, assetType: getEPType(ep, h.type), accts: [] };
      if (h.acct && !holdMap[key].accts.includes(h.acct)) holdMap[key].accts.push(h.acct);
      holdMap[key].qty     += h.qty;
      holdMap[key].costAmt += (h.qty * (h.cost || 0));
    });
    // ★ fundDirect(TDF/펀드) 항목 추가 — qty 개념 없으므로 qty=1, costAmt=cost로 저장
    Object.entries(fundDirect).forEach(([name, fd]) => {
      if (!name || !fd || fd.cost <= 0) return;
      if (holdMap[name]) return; // rawHoldings에 이미 있으면 중복 스킵
      holdMap[name] = { code: '', name, qty: 1, costAmt: fd.cost || 0, assetType: fd.type || 'TDF' };
    });
    // accts 배열 → acct 문자열로 변환 (쉼표 연결)
    Object.values(holdMap).forEach(h => { h.acct = (h.accts||[]).join(','); delete h.accts; });
    const holdings = Object.values(holdMap).filter(h => h.qty > 0);
    if (holdings.length === 0) return;

    const body = 'action=syncHoldings&data=' + encodeURIComponent(JSON.stringify(holdings));
    const res  = await fetchWithTimeout(GSHEET_API_URL, 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[보유현황 동기화] HTTP', res.status); return; }
    const data = await res.json();
    if (data.status === 'ok') console.warn('[보유현황 동기화] ✅', data.synced + '개');
  } catch(e) {
    console.warn('[보유현황 동기화]', e.message);
  }
}

// ★ v8.2 — 거래이력 GSheet 동기화 (backfillMonth 소급 계산용)
async function syncTradesToGsheet() {
  if (!GSHEET_API_URL || rawTrades.length === 0) return;
  try {
    const unmatchedTrades = [];
    const trades = rawTrades
      .filter(t => t.name && t.tradeType && t.date)
      .map(t => {
        const tCode = _normalizeSyncCode(t.code || '');
        const epByCode = tCode ? getEPByCode(tCode) : null;
        const epByName = getEP(t.name);
        const ep = epByCode || epByName;
        if (!ep) {
          unmatchedTrades.push({ date: t.date || '', name: t.name || '', code: tCode || '' });
        }
        // ★ 기초정보 우선: 거래이력 코드가 달라도 EDITABLE_PRICES 기준 코드로 정규화
        const baseCode = ep?.code || STOCK_CODE[ep?.name || t.name] || '';
        const code = _normalizeSyncCode(baseCode || t.code || '');
        return {
          date:      t.date,
          tradeType: t.tradeType,
          acct:      t.acct      || '',
          // ★ 코드가 같은데 이름이 다르면 기초정보 이름으로 통일
          name:      ep?.name || t.name,
          code:      code,
          qty:       t.qty       || 0,
          price:     t.price     || 0,
          assetType: getEPType(ep, t.assetType || '주식'),
          memo:      t.memo      || '',
        };
      });
    if (trades.length === 0) return;
    if (unmatchedTrades.length > 0) {
      const uniq = Array.from(new Set(unmatchedTrades.map(t => `${t.name}|${t.code}`)));
      console.warn('[거래이력 동기화] 기초정보 미매칭 거래 포함:', unmatchedTrades);
      if (typeof showToast === 'function') {
        showToast(`⚠️ 기초정보 미매칭 거래 ${uniq.length}건 포함 (동기화 전 기초정보 점검 권장)`, 'warn');
      }
      syncIssuesToGsheet('syncTradesToGsheet', unmatchedTrades).catch(()=>{});
    }

    const body = 'action=syncTrades&data=' + encodeURIComponent(JSON.stringify(trades));
    const res  = await fetchWithTimeout(GSHEET_API_URL, 30000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!res.ok) { console.warn('[거래이력 동기화] HTTP', res.status); return; }
    const data = await res.json();
    if (data.status === 'ok') console.warn('[거래이력 동기화] ✅', data.synced + '건');
  } catch(e) {
    console.warn('[거래이력 동기화]', e.message);
  }
}

async function lookupNameByCode(code) {
  if (!code) return '';
  const trimCode = _normalizeSyncCode(code);
  // 1. EDITABLE_PRICES 역방향 검색 (최우선)
  const epItem = getEPByCode(trimCode);
  if (epItem) return epItem.name;
  // 2. 로컬 STOCK_CODE 역방향 검색
  const localEntry = Object.entries(STOCK_CODE).find(([n,c]) => _normalizeSyncCode(c) === trimCode);
  if (localEntry) return localEntry[0];
  // 3. GSheet 캐시 검색
  const gItem = _gsheetCodeList.find(item => item.code === trimCode);
  if (gItem) return gItem.name;
  // 4. GSheet API 조회 (GOOGLEFINANCE name)
  if (!GSHEET_API_URL) return '';
  try {
    const url = GSHEET_API_URL + '?action=name&code=' + encodeURIComponent(trimCode);
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return '';
    const data = await res.json();
    return data.name || data.officialName || '';
  } catch(e) { return ''; }
}
