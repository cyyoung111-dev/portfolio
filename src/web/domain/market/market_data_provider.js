// 시장데이터 provider 정규화 계층.
// Toss endpoint/응답 필드는 공식 인증 후 설정으로 주입하며 코드에 추측하지 않는다.
const MARKET_PRICE_TYPE = 'REGULAR_CLOSE';
const MARKET_PRICE_STATUS = Object.freeze({ CONFIRMED:'CONFIRMED', FALLBACK:'FALLBACK', NEEDS_REVIEW:'NEEDS_REVIEW' });

function normalizeMarketPrice(input, meta = {}) {
  const price = Number(input?.closePrice ?? input?.price);
  const marketDate = String(input?.marketDate || input?.date || '').slice(0, 10);
  const symbol = String(input?.symbol || input?.code || '');
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate) || !Number.isFinite(price) || price <= 0) {
    return { symbol, marketDate, status: MARKET_PRICE_STATUS.NEEDS_REVIEW, source: meta.source || input?.source || 'UNKNOWN' };
  }
  return { marketDate, symbol, market: input?.market || meta.market || 'UNKNOWN', closePrice: price,
    currency: input?.currency || meta.currency || 'KRW', source: meta.source || input?.source || 'UNKNOWN',
    priceType: MARKET_PRICE_TYPE, status: meta.status || input?.status || MARKET_PRICE_STATUS.CONFIRMED,
    fetchedAt: input?.fetchedAt || meta.fetchedAt || new Date().toISOString() };
}

function resolveMarketPrice(primary, fallback, stored) {
  for (const candidate of [primary, fallback, stored]) {
    const normalized = candidate && normalizeMarketPrice(candidate, { source: candidate.source });
    if (normalized && normalized.status !== MARKET_PRICE_STATUS.NEEDS_REVIEW) {
      if (candidate !== primary && normalized) normalized.status = MARKET_PRICE_STATUS.FALLBACK;
      return normalized;
    }
  }
  return null; // 실패는 빈 값이 아니라 호출부에서 기존 값을 보존하도록 null로 명시
}

function carryForwardRegularClose(history, targetDate) {
  return (history || []).filter(item => item?.status === MARKET_PRICE_STATUS.CONFIRMED &&
    item.priceType === MARKET_PRICE_TYPE && item.marketDate < targetDate)
    .sort((a, b) => b.marketDate.localeCompare(a.marketDate))[0] || null;
}

function applyStockSplit(position, action) {
  const ratio = Number(action?.ratio);
  if (!position || !Number.isFinite(ratio) || ratio <= 0) throw new Error('분할비율은 0보다 큰 숫자여야 합니다.');
  const qty = Number(position.qty) || 0;
  const cost = Number(position.cost) || 0;
  return { ...position, qty: qty * ratio, cost: cost / ratio, costAmt: Number(position.costAmt) || qty * cost };
}

function applyReverseSplit(position, action) {
  const ratio = Number(action?.ratio);
  if (!position || !Number.isFinite(ratio) || ratio <= 0) throw new Error('병합비율은 0보다 큰 숫자여야 합니다.');
  const qty = Number(position.qty) || 0;
  const cost = Number(position.cost) || 0;
  return { ...position, qty: qty / ratio, cost: cost * ratio, costAmt: Number(position.costAmt) || qty * cost };
}

