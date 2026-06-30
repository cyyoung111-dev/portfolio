// ════════════════════════════════════════════════════════════════
//  domain/portfolio/portfolio_service.js
//  data.js에서 분리한 포트폴리오 도메인 계산/조회 서비스
// ════════════════════════════════════════════════════════════════

// ── 계좌+종목별 평균매수단가 계산 (FIFO 누적 방식)
function calcRealizedPnl() {
  const sorted = [...rawTrades].sort((a,b) => (a.date||'').localeCompare(b.date||''));
  const costMap = {}; // acct||name → { qty, totalCost }
  let totalPnl = 0, totalCost = 0;

  sorted.forEach(t => {
    if (!t.name || !t.acct || !t.tradeType) return;
    const key = t.acct + '||' + t.name;
    if (!costMap[key]) costMap[key] = { qty: 0, totalCost: 0 };
    if (t.tradeType === 'buy') {
      costMap[key].qty       += (t.qty || 0);
      costMap[key].totalCost += (t.qty || 0) * (t.price || 0);
    } else if (t.tradeType === 'sell') {
      const avgCost = costMap[key].qty > 0 ? costMap[key].totalCost / costMap[key].qty : 0;
      const sellQty = Math.min(t.qty || 0, costMap[key].qty);
      const pnl = (t.price - avgCost) * sellQty;
      totalPnl  += pnl;
      totalCost += avgCost * sellQty;
      costMap[key].qty       -= sellQty;
      costMap[key].totalCost -= sellQty * avgCost;
      if (costMap[key].qty <= 0) { costMap[key].qty = 0; costMap[key].totalCost = 0; }
    }
  });
  const pct = totalCost > 0 ? (totalPnl / totalCost * 100) : 0;
  return { totalPnl, totalCost, pct };
}

// ── 거래이력: 필터·정렬 적용 리스트 반환
function _getFilteredTrades() {
  const { acct: filterAcct, name: filterName, type: filterType } = _tradeFilter;
  const query = _normalizeSearchText(filterName || '');
  const hasFilter = !!(filterAcct || query || filterType === 'buy' || filterType === 'sell');
  let list = hasFilter
    ? rawTrades.filter(t => {
      if (filterAcct && t.acct !== filterAcct) return false;
      if (query) {
        const ep = getEP(t.name);
        const targets = [t.name, t.code, ep?.code, ep?.sector, getEPType(ep, t.assetType || t.type || ''), t.memo];
        if (!targets.some(value => _searchIncludes(value, query))) return false;
      }
      if (filterType === 'buy' && t.tradeType !== 'buy') return false;
      if (filterType === 'sell' && t.tradeType !== 'sell') return false;
      return true;
    })
    : [...rawTrades];
  const { key, dir } = _tradeSort;
  list.sort((a, b) => {
    let va, vb;
    if (key === 'date')  { va = a.date || a.buyDate || ''; vb = b.date || b.buyDate || ''; return dir * va.localeCompare(vb); }
    if (key === 'name')  { va = a.name || ''; vb = b.name || ''; return dir * va.localeCompare(vb, 'ko'); }
    if (key === 'acct')  { va = a.acct || ''; vb = b.acct || ''; return dir * va.localeCompare(vb, 'ko'); }
    if (key === 'qty')   { return dir * ((a.qty || 0) - (b.qty || 0)); }
    if (key === 'price') { return dir * ((a.price || 0) - (b.price || 0)); }
    return 0;
  });
  return list;
}

function syncHoldingsFromTrades() {
  if (rawTrades.length === 0) return;

  // 레거시 데이터 자동 마이그레이션
  migrateLegacyTrades();

  // ── Step 1: 매수/매도 분리하여 보유 수량·평균단가 계산
  const map = {};
  const sorted = [...rawTrades].sort((a,b) => (a.date||'').localeCompare(b.date||''));

  sorted.forEach(t => {
    if (!t.name || !t.acct) return;
    const key = t.acct + '||' + t.name;
    if (!map[key]) {
      const _ep = getEP(t.name);
      const epType = getEPType(_ep, t.assetType);
      // ★ [계좌별 taxType] 계좌 기준으로 taxType 결정 (종목 단위 아님)
      const acctTax = (typeof getAcctTaxType === 'function') ? getAcctTaxType(t.acct) : '일반';
      map[key] = { acct: t.acct, name: t.name, type: epType, taxType: acctTax, qty: 0, totalCost: 0, fund: !!t.fund };
    }
    if (t.tradeType === 'buy') {
      map[key].qty       += (t.qty || 0);
      map[key].totalCost += (t.qty || 0) * (t.price || 0);
    } else if (t.tradeType === 'sell') {
      const avgCost = map[key].qty > 0 ? map[key].totalCost / map[key].qty : 0;
      const sellQty = Math.min(t.qty || 0, map[key].qty);
      map[key].qty       -= sellQty;
      map[key].totalCost -= sellQty * avgCost;
      if (map[key].qty < 0.0001) { map[key].qty = 0; map[key].totalCost = 0; }
    }
  });

  // ── Step 2: rawHoldings 재생성
  const newH = Object.values(map).filter(m => m.qty > 0).map(m => ({
    acct: m.acct, type: m.type, name: m.name, qty: m.qty,
    cost: m.qty > 0 ? Math.round(m.totalCost / m.qty) : 0,
    ...(m.fund ? {fund: true} : {})
  }));
  if (newH.length > 0) {
    rawHoldings.length = 0;
    newH.forEach(h => rawHoldings.push(h));
  }

  // ── Step 3: 거래이력 종목을 EDITABLE_PRICES에 자동 등록
  // 우선순위: EDITABLE_PRICES에 없는 종목만 추가, 있으면 절대 덮어쓰지 않음
  if (typeof EDITABLE_PRICES !== 'undefined') {
    rawTrades.forEach(t => {
      if (!t.name || getEP(t.name)) return;
      const code = t.code || STOCK_CODE[t.name] || '';
      // sector는 '기타'로 — 사용자가 기초정보 관리탭에서 직접 설정해야 함
      epPush(t.name, code, t.assetType);
      if (code) STOCK_CODE[t.name] = code;
    });
  }

  // ── Step 4: fund 항목을 fundDirect에 초기 등록 (미등록 시 computeRows에서 null 처리됨)
  if (typeof fundDirect !== 'undefined') {
    newH.forEach(h => {
      if (!h.fund || !h.name || fundDirect[h.name]) return;
      fundDirect[h.name] = { eval: h.cost, cost: h.cost, type: h.type || 'TDF' };
    });
  }
}

function computeRows(holdings) {
  return holdings.map(h => {
    const nn = normName(h.name);
    const ep = getEP(nn);
    const code = normalizeStockCode(ep?.code || STOCK_CODE[nn] || STOCK_CODE[h.name] || '');
    const sector = (ep && ep.sector && ep.sector !== 'mixed') ? ep.sector : '기타';
    // ★ [환율 연동] 통화 정보 (기본 KRW)
    const currency = (ep?.currency || 'KRW').toUpperCase();
    const fxRate   = currency !== 'KRW' ? (exchangeRates[currency] || 0) : 1;
    const hasFx    = currency !== 'KRW' && fxRate > 0;

    if (h.fund) {
      const fd = fundDirect[h.name];
      if (!fd) return null;
      const codePrice = code && savedPrices[code];
      const namePrice = savedPrices[nn] || savedPrices[h.name];
      const evalPrice = (codePrice > 0)
        ? codePrice
        : (namePrice > 0 && namePrice !== fd.cost)
          ? namePrice
        : (fd.eval > 0 ? fd.eval : fd.cost);
      const evalAmt = evalPrice;
      // ★ [계좌별 taxType] 펀드/TDF도 계좌 기준으로 taxType 결정 (이전에 누락됐던 버그 수정)
      const fundTaxType = (typeof getAcctTaxType === 'function') ? getAcctTaxType(h.acct) : '일반';
      return {...h, qty:1, cost:fd.cost, evalAmt, costAmt:fd.cost, pnl:evalAmt-fd.cost, price:evalPrice, pct:fd.cost>0?(evalAmt-fd.cost)/fd.cost*100:0, sector, code:code || '', currency:'KRW', fxRate:1, taxType: fundTaxType};
    }
    // ★ 가격 우선순위: ① 코드 키 ② 이름 키(하위호환) ③ 취득단가
    const pRaw = (code && savedPrices[code]) || savedPrices[nn] || savedPrices[h.name] || h.cost;
    // ★ [환율 연동] 외화 종목 현재가는 원화로 환산
    // pRaw: GAS에서 받은 외화 단가 → fxRate 곱해 원화로 환산
    // h.cost: syncHoldingsFromTrades()에서 t.price(이미 원화)로 채워짐 → 환율 곱하면 이중 환산 버그
    const priceKrw = hasFx ? Math.round(pRaw * fxRate) : pRaw;
    const evalAmt  = priceKrw * h.qty;
    const costAmt  = h.cost * h.qty;  // ★ h.cost는 이미 원화 — fxRate 곱하지 않음
    const type = getEPType(ep, h.type);
    // ★ [계좌별 taxType] 계좌 기준으로 taxType 결정
    const taxType = (typeof getAcctTaxType === 'function') ? getAcctTaxType(h.acct) : '일반';
    return {
      ...h, name:nn, type, taxType, sector, code,
      price:    priceKrw,
      priceRaw: pRaw,
      evalAmt, costAmt,
      pnl:  evalAmt - costAmt,
      pct:  costAmt > 0 ? (evalAmt - costAmt) / costAmt * 100 : 0,
      currency, fxRate,
    };
  }).filter(Boolean);
}

function recomputeRows() {
  rows.length = 0;
  computeRows(rawHoldings).forEach(r => rows.push(r));
}
