// ════════════════════════════════════════════════════════════════
//  views_history_benchmark.js — 히스토리 비교지수 로딩 계층
//  의존: views_history.js (_normalizeHistDate), settings fetch helper
// ════════════════════════════════════════════════════════════════

function _historyBuildUrl(action, params) {
  if (!GSHEET_API_URL || !action) return '';
  const query = new URLSearchParams();
  query.set('action', action);
  const entries = Object.entries(params || {});
  entries.forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    query.set(k, String(v));
  });
  return `${GSHEET_API_URL}?${query.toString()}`;
}

async function _historyRequestJson(action, params, options) {
  const opts = options || {};
  const retry = Number.isFinite(opts.retry) ? Math.max(0, opts.retry) : 0;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(1000, opts.timeoutMs) : 15000;
  const delayMs = Number.isFinite(opts.delayMs) ? Math.max(0, opts.delayMs) : 180;
  const url = _historyBuildUrl(action, params);
  if (!url) return null;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      return await res.json();
    } catch (_) {
      if (attempt < retry) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function _loadBenchmarkBundle(types, fromDate, toDate) {
  const seriesMap = {};
  const metaMap = {};
  const errorMap = {};
  const failedTypes = [];
  if (!types.length) return { seriesMap, metaMap, errorMap, failedTypes };

  const data = await _historyRequestJson(
    'getBenchmarks',
    { benchmarks: types.join(','), from: fromDate, to: toDate },
    { timeoutMs: 45000, retry: 0 }
  );
  const requestError = !data
    ? 'GAS 응답이 없거나 일괄 조회 시간이 초과되었습니다.'
    : data.status === 'error'
      ? String(data.message || '비교지수 일괄 조회 실패')
      : '';
  for (const type of types) {
    const rawPoints = Array.isArray(data?.series?.[type]) ? data.series[type] : [];
    const points = rawPoints
      .map(point => ({ date: _normalizeHistDate(point.date || ''), value: parseFloat(point.value || 0) }))
      .filter(point => point.date && point.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    seriesMap[type] = points;
    metaMap[type] = String(data?.symbols?.[type] || '').trim();
    if (!points.length) {
      failedTypes.push(type);
      errorMap[type] = requestError || String(data?.errors?.[type] || '선택 기간의 데이터를 찾지 못했습니다.');
    }
  }
  return { seriesMap, metaMap, errorMap, failedTypes };
}

async function _fetchBenchmarkSeriesWithRetry(type, fromDate, toDate, maxRetry) {
  const retry = Number.isFinite(maxRetry) ? Math.max(0, maxRetry) : 0;
  let lastError = '';
  for (let attempt = 0; attempt <= retry; attempt++) {
    const payload = await _fetchBenchmarkSeries(type, fromDate, toDate);
    if (Array.isArray(payload?.points) && payload.points.length > 0) return payload;
    if (payload?.error) lastError = payload.error;
    if (attempt < retry) await new Promise(r => setTimeout(r, 180));
  }
  return { points: [], symbol: '', error: lastError || `${type} 데이터를 불러오지 못했습니다.` };
}

async function _fetchBenchmarkSeries(type, fromDate, toDate) {
  if (!GSHEET_API_URL || !type || !fromDate || !toDate) return { points: [], symbol: '' };
  const data = await _historyRequestJson(
    'getBenchmark',
    { benchmark: type, from: fromDate, to: toDate },
    // VKOSPI는 KRX의 날짜별 응답을 병렬 취합하므로 최초 조회에 더 긴 시간을 허용합니다.
    { timeoutMs: type === 'VKOSPI' ? 45000 : 15000, retry: 0 }
  );
  if (!data) return { points: [], symbol: '', error: 'GAS 응답이 없거나 조회 시간이 초과되었습니다.' };
  if (data.status === 'error') return { points: [], symbol: '', error: (data.message || '비교지수 조회 실패').toString() };
  const arr = Array.isArray(data.points) ? data.points : [];
  const points = arr
    .map(p => ({ date: _normalizeHistDate(p.date || ''), value: parseFloat(p.value || 0) }))
    .filter(p => p.date && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, symbol: (data.symbol || '').toString().trim() };
}
