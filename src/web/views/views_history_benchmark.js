// ════════════════════════════════════════════════════════════════
//  views_history_benchmark.js — 히스토리 비교지수 로딩 계층
//  의존: views_history.js (_normalizeHistDate), settings fetch helper
// ════════════════════════════════════════════════════════════════

async function _loadBenchmarkBundle(types, fromDate, toDate) {
  const seriesMap = {};
  const metaMap = {};
  const failedTypes = [];
  // ★ GAS 제약 대응: 병렬 Promise.all 대신 직렬 큐
  for (const type of types) {
    const payload = await _fetchBenchmarkSeriesWithRetry(type, fromDate, toDate, 1);
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const symbol = payload?.symbol || '';
    seriesMap[type] = points;
    metaMap[type] = symbol;
    if (points.length === 0) failedTypes.push(type);
  }
  return { seriesMap, metaMap, failedTypes };
}

async function _fetchBenchmarkSeriesWithRetry(type, fromDate, toDate, maxRetry) {
  const retry = Number.isFinite(maxRetry) ? Math.max(0, maxRetry) : 0;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const payload = await _fetchBenchmarkSeries(type, fromDate, toDate);
    if (Array.isArray(payload?.points) && payload.points.length > 0) return payload;
    if (attempt < retry) await new Promise(r => setTimeout(r, 180));
  }
  return { points: [], symbol: '' };
}

async function _fetchBenchmarkSeries(type, fromDate, toDate) {
  if (!GSHEET_API_URL || !type || !fromDate || !toDate) return { points: [], symbol: '' };
  try {
    const url = GSHEET_API_URL
      + '?action=getBenchmark'
      + '&benchmark=' + encodeURIComponent(type)
      + '&from=' + encodeURIComponent(fromDate)
      + '&to=' + encodeURIComponent(toDate);
    const res = await fetchWithTimeout(url, 15000);
    const data = await res.json();
    if (!data || data.status === 'error') return { points: [], symbol: '' };
    const arr = Array.isArray(data.points) ? data.points : [];
    const points = arr
      .map(p => ({ date: _normalizeHistDate(p.date || ''), value: parseFloat(p.value || 0) }))
      .filter(p => p.date && p.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return { points, symbol: (data.symbol || '').toString().trim() };
  } catch(_) {
    return { points: [], symbol: '' };
  }
}
