// 시장데이터 provider 정규화 계층.
// Toss endpoint/응답 필드는 공식 인증 후 설정으로 주입하며 코드에 추측하지 않는다.
const MARKET_PRICE_TYPE = 'REGULAR_CLOSE';
const MARKET_PRICE_STATUS = Object.freeze({ CONFIRMED:'CONFIRMED', FALLBACK:'FALLBACK', NEEDS_REVIEW:'NEEDS_REVIEW' });

// Portfolio 가격과 Briefing 관측이 공유하는 최소 시장데이터 contract입니다.
// 저장소(MARKET_MASTER/가격이력)는 합치지 않고 provider가 전달한 의미만 정규화합니다.
function normalizeMarketDatum(input, meta = {}) {
  const symbol = String(input?.symbol || input?.seriesId || input?.code || meta.symbol || meta.seriesId || '');
  const marketDate = String(input?.marketDate || input?.tradingDate || input?.sourceDate || input?.date || meta.marketDate || meta.tradingDate || '').slice(0, 10);
  const value = Number(input?.value ?? input?.closePrice ?? input?.price ?? input?.close ?? input?.current);
  const receivedAtValue = input?.receivedAt || meta.receivedAt || new Date().toISOString();
  const observedAtValue = input?.observedAt || input?.timestamp || input?.dateTime || meta.observedAt || null;
  const receivedAt = Number.isFinite(Date.parse(receivedAtValue)) ? new Date(Date.parse(receivedAtValue)).toISOString() : null;
  const observedAt = observedAtValue && Number.isFinite(Date.parse(observedAtValue)) ? new Date(Date.parse(observedAtValue)).toISOString() : null;
  const valid = Boolean(symbol) && /^\d{4}-\d{2}-\d{2}$/.test(marketDate) && Number.isFinite(value) && value > 0 && receivedAt;
  return {
    symbol, seriesId: String(input?.seriesId || meta.seriesId || symbol),
    marketDate, tradingDate: marketDate, sourceDate: String(input?.sourceDate || marketDate),
    value: valid ? value : null, closePrice: valid ? value : null,
    market: input?.market || meta.market || 'UNKNOWN', session: input?.session || meta.session || 'UNKNOWN',
    currency: input?.currency || meta.currency || null, source: input?.source || meta.source || 'UNKNOWN',
    status: input?.status || meta.status || (valid ? 'PARTIAL' : 'NEEDS_REVIEW'),
    finality: input?.finality || meta.finality || null,
    observedAt, receivedAt, timestampQuality: observedAt ? 'OBSERVED' : 'RECEIVE_ONLY',
    fallback: Boolean(input?.fallback ?? meta.fallback), valid,
  };
}

function normalizeMarketPrice(input, meta = {}) {
  const datum = normalizeMarketDatum(input, meta);
  if (!datum.valid) {
    return { symbol: datum.symbol, marketDate: datum.marketDate, status: MARKET_PRICE_STATUS.NEEDS_REVIEW, source: datum.source };
  }
  return { marketDate: datum.marketDate, symbol: datum.symbol, market: datum.market, closePrice: datum.closePrice,
    currency: datum.currency || 'KRW', source: datum.source,
    priceType: MARKET_PRICE_TYPE, status: meta.status || input?.status || MARKET_PRICE_STATUS.CONFIRMED,
    sourceDate: datum.sourceDate, fallback: datum.fallback,
    observedAt: datum.observedAt, receivedAt: datum.receivedAt, timestampQuality: datum.timestampQuality,
    fetchedAt: input?.fetchedAt || meta.fetchedAt || datum.receivedAt };
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

const MarketDataProvider = { MARKET_PRICE_TYPE, MARKET_PRICE_STATUS, normalizeMarketDatum, normalizeMarketPrice, resolveMarketPrice, carryForwardRegularClose, applyStockSplit, applyReverseSplit };
if (typeof module !== 'undefined' && module.exports) module.exports = MarketDataProvider;
if (typeof globalThis !== 'undefined') globalThis.MarketDataProvider = MarketDataProvider;
