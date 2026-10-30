// ════════════════════════════════════════════════════════════════
//  views_history_benchmark.js — 히스토리 비교지수 로딩 계층
//  의존: views_history.js (_normalizeHistDate), settings fetch helper
// ════════════════════════════════════════════════════════════════

async function _historyRequestJson(action, params, options) {
  if (!GSHEET_API_URL || !action || typeof requestGsheetActionJson !== 'function') return null;
  return requestGsheetActionJson(action, params, options);
}

async function _loadBenchmarkBundle(types, fromDate, toDate) {
  const seriesMap = {};
  const metaMap = {};
  const errorMap = {};
  const failedTypes = [];
  if (!types.length) return { seriesMap, metaMap, errorMap, failedTypes, warningMsg:'' };

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
      .map(point => ({
        date:_normalizeHistDate(point.date||''),value:parseFloat(point.value||0),
        source:String(point.source||data?.seriesMeta?.[type]?.source||'SOURCE_NOT_TAGGED'),
        sourceDate:_normalizeHistDate(point.sourceDate||point.date||'')
      }))
      .filter(point => point.date && point.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    seriesMap[type] = points;
    metaMap[type] = String(data?.symbols?.[type] || '').trim();
    if (!points.length) {
      failedTypes.push(type);
      errorMap[type] = requestError || String(data?.errors?.[type] || '선택 기간의 데이터를 찾지 못했습니다.');
    }
  }
  // KRX-derived public daily series is an explicit, separate index reference.
  // No source can be relabeled as NH. Ignore any EOD cache row published before
  // the Korean regular-session close; retain only actual KRX-official GAS rows.
  const domesticTypes=types.filter(type=>['KOSPI','KOSDAQ','KOSPI200'].includes(type));
  if(domesticTypes.length && typeof DomesticIndexEod!=='undefined'){
    try {
      const derived=await DomesticIndexEod.loadSeries(domesticTypes,fromDate,toDate);
      for(const type of domesticTypes){
        const krxOnly=seriesMap[type].filter(p=>p.source==='KRX_OFFICIAL'
          &&data?.seriesMeta?.[type]?.confirmedClose===true);
        const byDate=new Map(krxOnly.map(p=>[p.date,p]));
        for(const p of derived.seriesMap[type]||[])byDate.set(p.date,p);
        const verified=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
        seriesMap[type]=verified;
        if(verified.length){
          metaMap[type]='FDR_KRX_CACHE:'+DomesticIndexEod.SYMBOLS[type];
          const pos=failedTypes.indexOf(type);if(pos>=0)failedTypes.splice(pos,1);
          delete errorMap[type];
        }else{
          const pos=failedTypes.indexOf(type);if(pos<0)failedTypes.push(type);
          errorMap[type]=derived.errors[type]||'검증된 국내 지수 종가가 없습니다.';
        }
      }
    } catch(error) {
      // Do not erase a successfully validated KRX official series if the
      // independent public source is temporarily unavailable.
      for(const type of domesticTypes){
        seriesMap[type]=seriesMap[type].filter(p=>p.source==='KRX_OFFICIAL'
          &&data?.seriesMeta?.[type]?.confirmedClose===true);
        if(!seriesMap[type].length){
          if(!failedTypes.includes(type))failedTypes.push(type);
          errorMap[type]='국내 지수 공개 종가 조회 실패';
        }
      }
    }
  }
  const warningMsg = types.some(type => type === 'KOSPI' || type === 'KOSDAQ') ? String(data?.errors?.KRX_OFFICIAL || '').slice(0,350) : '';
  return { seriesMap, metaMap, errorMap, failedTypes, warningMsg };
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
    .map(p => ({
      date:_normalizeHistDate(p.date||''),value:parseFloat(p.value||0),
      source:String(p.source||data?.seriesMeta?.source||'SOURCE_NOT_TAGGED'),
      sourceDate:_normalizeHistDate(p.sourceDate||p.date||'')
    }))
    .filter(p => p.date && p.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, symbol: (data.symbol || '').toString().trim() };
}
