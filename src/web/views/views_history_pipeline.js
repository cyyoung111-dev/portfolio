// ════════════════════════════════════════════════════════════════
//  views_history_pipeline.js — 히스토리 데이터 로딩/가공 파이프라인
//  의존: views_history_state.js, views_history_render.js, views_history_benchmark.js
// ════════════════════════════════════════════════════════════════

const HISTORY_INTEGRITY_CACHE_KEY = 'portfolio.historyIntegrity.v4';
const HISTORY_INTEGRITY_LEGACY_CACHE_KEYS = ['portfolio.historyIntegrity.v1', 'portfolio.historyIntegrity.v2', 'portfolio.historyIntegrity.v3'];
const HISTORY_INTEGRITY_CACHE_MAX_CHARS = 120000;
function _historySnapshotSignature(snapshot, dateRevision) {
  return [dateRevision, snapshot.date, snapshot.costAmt ?? snapshot.cost ?? '', snapshot.evalAmt ?? snapshot.total ?? snapshot.eval ?? '', snapshot.pnl ?? ''].join('|');
}
function _readHistoryIntegrityCache() {
  try {
    HISTORY_INTEGRITY_LEGACY_CACHE_KEYS.forEach(key => sessionStorage.removeItem(key));
    const parsed = JSON.parse(sessionStorage.getItem(HISTORY_INTEGRITY_CACHE_KEY) || '{}') || {};
    const sanitized = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, _historyDiagnosticSummary(value)]).filter(([, value]) => !!value));
    if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) _writeHistoryIntegrityCache(sanitized);
    return sanitized;
  } catch (_) {
    try { sessionStorage.removeItem(HISTORY_INTEGRITY_CACHE_KEY); } catch (_) {}
    return {};
  }
}
function _writeHistoryIntegrityCache(cache) {
  try {
    HISTORY_INTEGRITY_LEGACY_CACHE_KEYS.forEach(key => sessionStorage.removeItem(key));
    const entries = Object.entries(cache || {}).map(([key, value]) => [key, _historyDiagnosticSummary(value)]).filter(([, value]) => !!value).slice(-800);
    let serialized = JSON.stringify(Object.fromEntries(entries));
    while (entries.length && serialized.length > HISTORY_INTEGRITY_CACHE_MAX_CHARS) {
      entries.shift();
      serialized = JSON.stringify(Object.fromEntries(entries));
    }
    sessionStorage.setItem(HISTORY_INTEGRITY_CACHE_KEY, serialized);
    return true;
  } catch (_) { return false; /* 캐시를 사용할 수 없어도 현재 조회는 계속합니다. */ }
}
function _isRepairableHistoryDiagnostic(item) {
  if (!item || !['PARTIAL', 'MISMATCH', 'NO_SNAPSHOT'].includes(item.status)) return false;
  if (typeof item.repairable === 'boolean') return item.repairable;
  return !item.sourceDataErrors?.length && !item.conflictKeys?.length;
}
function _historyDiagnosticSummary(item) {
  if (!item || !item.date || !['VALID', 'SOURCE_INCOMPLETE', 'UNCHECKED', 'PARTIAL', 'MISMATCH', 'CONFLICT', 'NO_SNAPSHOT', 'PRICE_SUSPICIOUS'].includes(String(item.status || ''))) return null;
  const rawDuplicateSummary = item.duplicateSummary && typeof item.duplicateSummary === 'object' ? item.duplicateSummary : null;
  const duplicateSummary = rawDuplicateSummary ? {
    groups: Math.max(0, Number(rawDuplicateSummary.groups) || 0),
    exactDuplicate: Math.max(0, Number(rawDuplicateSummary.exactDuplicate) || 0),
    singleExpectedMatch: Math.max(0, Number(rawDuplicateSummary.singleExpectedMatch) || 0),
    manualProtected: Math.max(0, Number(rawDuplicateSummary.manualProtected) || 0),
    unresolvedConflict: Math.max(0, Number(rawDuplicateSummary.unresolvedConflict) || 0),
    sourceIncomplete: Math.max(0, Number(rawDuplicateSummary.sourceIncomplete) || 0),
  } : undefined;
  return {
    date: item.date,
    status: item.status,
    repairable: _isRepairableHistoryDiagnostic(item),
    ...(duplicateSummary ? { duplicateSummary } : {}),
  };
}
function _cachedHistoryDiagnostics(snapshots, dateRevisions, cache) {
  const knownStatuses = new Set(['VALID', 'SOURCE_INCOMPLETE', 'UNCHECKED', 'PARTIAL', 'MISMATCH', 'CONFLICT', 'NO_SNAPSHOT', 'PRICE_SUSPICIOUS']);
  return (snapshots || []).map(snapshot => {
    if (!dateRevisions || !Object.prototype.hasOwnProperty.call(dateRevisions, snapshot.date)) return null;
    const dateRevision = String(dateRevisions[snapshot.date] ?? '');
    if (!/^\d+$/.test(dateRevision)) return null;
    const cached = cache?.[_historySnapshotSignature(snapshot, dateRevision)];
    return cached && cached.date === snapshot.date && knownStatuses.has(String(cached.status || '')) ? cached : null;
  }).filter(Boolean);
}
function _historyIntegrityRevisionDecision(expectedRevision, diagnosisRevision, retryAttempt) {
  if (String(expectedRevision || '') === String(diagnosisRevision || '')) return 'apply';
  return Number(retryAttempt || 0) < 1 ? 'retry' : 'discard';
}
function _restoreOrClearDiscardedHistoryView(requestId, chartWrap, tableWrap, coverageEl) {
  if (requestId !== __histState.loadRequestId) return null;
  if (_restoreSuccessfulHistoryView()) return true;
  chartWrap.innerHTML = '';
  if (tableWrap) tableWrap.innerHTML = '';
  if (coverageEl) coverageEl.innerHTML = '';
  __histState.snapshots = [];
  __histState.integrityDiagnostics = [];
  __histState.rangeDiagnosisFailed = null;
  __histState.missingSnapshotDates = [];
  return false;
}

async function loadHistoryChart(retryAttempt = 0) {
  const loadStartedAt = performance.now();
  const requestId = ++__histState.loadRequestId;
  const queryBtn = $el('btn-history-query');
  const statusEl = $el('histStatusMsg');
  const chartWrap = $el('histChartWrap');
  const tableWrap = $el('histTableWrap');
  const coverageEl = $el('histCoveragePanel');
  if (!chartWrap) return;

  if (!GSHEET_API_URL) {
    _setHistoryStatus(statusEl, 'no_api');
    chartWrap.innerHTML = '';
    if (tableWrap) tableWrap.innerHTML = '';
    if (coverageEl) coverageEl.innerHTML = '';
    return;
  }

  if (queryBtn) {
    queryBtn.disabled = true;
    queryBtn.setAttribute('aria-busy', 'true');
    const label = queryBtn.querySelector('span');
    if (label) label.textContent = '조회 중';
  }
  _setHistoryStatus(statusEl, 'loading', { step: 1, total: 2, message: '거래·확정가격·NAV 원자료 조회 중...' });

  try {
    const startMonth = String($el('histStartMonth')?.value || '').trim();
    // ★ [버그수정] var → const (async 함수 내 var 호이스팅 리스크 제거)
    const rangeDays = parseInt($el('histRangeSelect')?.value || '365', 10);
    let fromStr = '';
    if (/^\d{4}-\d{2}$/.test(startMonth)) fromStr = `${startMonth}-01`;
    else if (rangeDays > 0) {
      // ★ [버그수정] new Date() 로컬 타임존 → _kstNow() + _kstDateOffset() 으로 교체
      //   settings_fetch.js getDateStr()과 동일한 패턴 — KST 기준으로 통일
      const todayStr = _kstTodayStr();
      fromStr = _kstDateOffset(todayStr, -rangeDays);
    }
    const historyStartedAt = performance.now();
    const data = await _historyRequestJson('getHistorySource', { from: fromStr }, { timeoutMs: 45000, retry: 0, preserveError: true });
    const getHistoryMs = performance.now() - historyStartedAt;
    if (requestId !== __histState.loadRequestId) return;
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      if (retryAttempt && _restoreOrClearDiscardedHistoryView(requestId, chartWrap, tableWrap, coverageEl) !== false) return;
      _setHistoryStatus(statusEl, 'empty_data');
      return;
    }

    snapshots = snapshots
      .map(s => ({ ...s, date: _normalizeHistDate(s.date || '') }))
      .filter(s => !!s.date)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!snapshots.length) {
      if (retryAttempt && _restoreOrClearDiscardedHistoryView(requestId, chartWrap, tableWrap, coverageEl) !== false) return;
      _setHistoryStatus(statusEl, 'empty_range');
      return;
    }

    const sourceRecomputed = data.sourceMode === 'SOURCE_RECOMPUTED';
    // GAS 원자료에서 평가금액·원가·손익을 동일 기준으로 계산했으므로 브라우저 거래원가로 덮어쓰지 않습니다.
    // 이전 Snapshot 화면에만 client-side 원가 보정 로직을 적용합니다.
    if (!sourceRecomputed) snapshots = _mergeTradeBasedCost(snapshots);
    const integritySourceRevision = sourceRecomputed ? '' : String(data.integritySourceRevision || '');
    const integrityDateRevisions = data.integrityDateRevisions || {};
    const integrityCache = integritySourceRevision ? _readHistoryIntegrityCache() : {};
    let integrityDiagnostics = _cachedHistoryDiagnostics(snapshots, integrityDateRevisions, integrityCache);
    const cachedDiagnosticByDate = new Map(integrityDiagnostics.map(item => [item.date, item]));
    snapshots = snapshots.map(snapshot => ({ ...snapshot,
      integrityStatus: sourceRecomputed ? 'VALID' : (cachedDiagnosticByDate.get(snapshot.date)?.status || 'UNCHECKED') }));
    // 정합성 진단은 보호 정보를 보강하는 후속 단계입니다. 저장 Snapshot 자체는 먼저 표시해
    // 첫 조회에서도 전체 기간 진단이 그래프의 초기 표시를 막지 않게 합니다.
    const initialMode = _getHistMode();
    const initialSnapshots = _selectHistorySnapshots(snapshots, initialMode);
    const initialRenderStartedAt = performance.now();
    if (!retryAttempt) {
      _drawHistoryChart(chartWrap, initialSnapshots, initialMode, { portfolioSnapshots: snapshots });
      _drawHistoryTable(tableWrap, snapshots);
    }
    const initialRenderMs = performance.now() - initialRenderStartedAt;
    // 날짜 존재 검사와 별개로, 급등락 후보는 GAS 원자료 계산값과 read-only 비교합니다.
    const suspiciousDates = Object.keys(_buildHistoryDiagnostics(snapshots));
    const cachedDates = new Set(integrityDiagnostics.map(item => item.date));
    const datesToDiagnose = sourceRecomputed ? [] : snapshots.filter(snapshot => !cachedDates.has(snapshot.date));
    let rangeDiagnosisFailed = null;
    const integrityStartedAt = performance.now();
    try {
      if (datesToDiagnose.length) {
        const integrity = await requestGsheetFormJson('diagnoseSnapshotIntegrityRange', {
          from: datesToDiagnose[0].date,
          to: datesToDiagnose[datesToDiagnose.length - 1].date,
          dates: datesToDiagnose.map(snapshot => snapshot.date).join(','),
          candidates: suspiciousDates.join(',')
        }, { timeoutMs: 120000, retry: 0, preserveError: true });
        if (requestId !== __histState.loadRequestId) return;
        if (!integrity) throw Object.assign(new Error('기간 진단 응답이 없습니다.'), { errorCode: 'INVALID_RESPONSE' });
        if (integrity.status === 'error') throw Object.assign(new Error(integrity.message || '기간 진단 오류'), integrity);
        if (!Array.isArray(integrity.diagnostics)) throw Object.assign(new Error('기간 진단 응답 계약 오류'), { errorCode: 'INVALID_RESPONSE' });
        const revisionDecision = _historyIntegrityRevisionDecision(integritySourceRevision, integrity.integritySourceRevision, retryAttempt);
        if (revisionDecision === 'retry') return await loadHistoryChart(retryAttempt + 1);
        if (revisionDecision === 'discard') throw Object.assign(new Error('조회 중 원자료가 변경되었습니다. 다시 조회해 주세요.'), { errorCode: 'REVISION_CHANGED' });
        integrityDiagnostics = integrityDiagnostics.concat(integrity.diagnostics);
        integrity.diagnostics.forEach(item => {
          const snapshot = snapshots.find(candidate => candidate.date === item.date);
          if (snapshot && integritySourceRevision === String(integrity.integritySourceRevision || '')) {
            integrityCache[_historySnapshotSignature(snapshot, String(integrityDateRevisions[snapshot.date] || '0'))] = _historyDiagnosticSummary(item);
          }
        });
        if (integritySourceRevision && integritySourceRevision === String(integrity.integritySourceRevision || '')) _writeHistoryIntegrityCache(integrityCache);
      }
    } catch (error) {
      if (error?.errorCode === 'REVISION_CHANGED') throw error;
      rangeDiagnosisFailed = { errorCode: error?.errorCode || 'SERVER_ERROR', phase: error?.phase || '', failedDate: error?.failedDate || '',
        processedDates: Number(error?.processedDates || 0), totalDates: Number(error?.totalDates || snapshots.length),
        lastCompletedDate: error?.lastCompletedDate || '', elapsedMs: Number(error?.elapsedMs || error?.performanceSoFar?.totalMs || 0) };
      console.warn('Snapshot integrity range diagnosis failed:', error);
    }
    const diagnosticByDate = new Map(integrityDiagnostics.map(item => [item.date, item]));
    snapshots = snapshots.map(snapshot => ({ ...snapshot,
      integrityStatus: sourceRecomputed ? 'VALID' : (diagnosticByDate.get(snapshot.date)?.status || 'UNCHECKED') }));
    __histState.integrityDiagnostics = integrityDiagnostics;
    __histState.rangeDiagnosisFailed = rangeDiagnosisFailed;
    const mode = _getHistMode();
    const tableSnapshots = _selectHistorySnapshots(snapshots, mode);
    const graphSnapshots = tableSnapshots;
    const graphStartDate = graphSnapshots[0]?.date || '';
    const graphEndDate = graphSnapshots[graphSnapshots.length - 1]?.date || '';
    // 변화율은 그래프 양 끝점을 사용하고, MDD는 그 사이의 모든 일별 스냅샷을 유지합니다.
    const portfolioRangeSnapshots = snapshots.filter(snapshot =>
      (!graphStartDate || snapshot.date >= graphStartDate)
      && (!graphEndDate || snapshot.date <= graphEndDate)
    );
    const coverage = _analyzeHistoryCoverage(snapshots, mode);
    const latestSnapshotDate = snapshots[snapshots.length-1].date || '';
    const latestDate = _fmtHistDateCompact(latestSnapshotDate);
    const snapshotGap = _getHistorySnapshotGap(latestSnapshotDate);
    const benchmarkTypes = Array.from(new Set(
      _getHistBenchmarks()
        .map(v => String(v || '').toUpperCase().trim())
        .filter(v => HIST_BENCHMARK_TYPES.includes(v))
    ));
    _setHistoryStatus(statusEl, 'loading', {
      step: 2,
      total: 2,
      message: benchmarkTypes.length ? `비교지수 ${benchmarkTypes.length}개 조회 중...` : '그래프 작성 중...'
    });
    const benchBundle = await _loadBenchmarkBundle(
      benchmarkTypes,
      snapshots[0].date,
      snapshots[snapshots.length - 1].date
    );
    if (requestId !== __histState.loadRequestId) return;
    const benchSeriesMap = benchBundle.seriesMap;
    const benchMetaMap = benchBundle.metaMap;
    const missing = benchBundle.failedTypes;
    const modeUnit = mode === 'day' ? '일' : (mode === 'week' ? '주' : '개월');
    const baseMsg = `그래프 ${tableSnapshots.length}${modeUnit} · ${sourceRecomputed ? '원자료 자동 재구성' : '원본'} ${snapshots.length}일 · 평가 기준 ${latestDate}`;
    const benchMsg = benchmarkTypes.length === 0
      ? '비교지수 없음'
      : `비교지수 ${benchmarkTypes.length - missing.length}/${benchmarkTypes.length}개 로드`;
    const missingMsg = missing.length
      ? ` (실패: ${missing.join(', ')} · ${Array.from(new Set(missing.map(type => benchBundle.errorMap?.[type]).filter(Boolean))).join(' / ')})`
      : '';

    // 두 비동기 조회가 모두 최신 요청으로 확인된 뒤 한 번에 화면 상태를 교체합니다.
    // 백그라운드 현재가 갱신이나 실패한 재조회가 마지막 정상 그래프·경고를 지우지 않습니다.
    __histState.snapshots = snapshots;
    __histState.missingSnapshotDates = sourceRecomputed ? [] : coverage.missing.map(item => item.targetDate);
    _renderHistoryDateDetail(snapshots);
    _renderHistoryCoverage(coverageEl, coverage, mode, sourceRecomputed);
    if (sourceRecomputed) _renderHistorySourceCoverage(coverageEl, data.sourceSummary, snapshots);
    else {
      _renderHistoryIntegrityWarnings(coverageEl, integrityDiagnostics, rangeDiagnosisFailed, snapshots.length);
      _renderHistoryNavWarnings(coverageEl, snapshots);
    }
    _setHistoryStatus(statusEl, 'summary_benchmark', { baseMsg, benchMsg, missingMsg, snapshotGap });

    _drawHistoryChart(chartWrap, graphSnapshots, mode, {
      types: benchmarkTypes,
      seriesMap: benchSeriesMap,
      metaMap: benchMetaMap,
      portfolioSnapshots: portfolioRangeSnapshots
    });
    _drawHistoryTable(tableWrap, snapshots);
    console.info('History chart performance', { getHistoryMs: Math.round(getHistoryMs),
      integrityMs: Math.round(performance.now() - integrityStartedAt), totalMs: Math.round(performance.now() - loadStartedAt),
      renderMs: Math.round(initialRenderMs), diagnosedDates: datesToDiagnose.length, cachedDates: snapshots.length - datesToDiagnose.length });
    _captureSuccessfulHistoryView();
    // 특정일 상세는 그래프 조회와 분리합니다. 날짜 input 변경 시에만 별도 요청합니다.

  } catch(e) {
    if (requestId === __histState.loadRequestId) {
      if (retryAttempt || e?.errorCode === 'REVISION_CHANGED') _restoreOrClearDiscardedHistoryView(requestId, chartWrap, tableWrap, coverageEl);
      _setHistoryStatus(statusEl, 'error', { message: e.message });
    }
  } finally {
    if (requestId === __histState.loadRequestId && queryBtn) {
      queryBtn.disabled = false;
      queryBtn.removeAttribute('aria-busy');
      const label = queryBtn.querySelector('span');
      if (label) label.textContent = '조회';
    }
  }
}

function _renderHistoryDateDetail(snapshots) {
  const wrap = $el('histDateDetail');
  if (!wrap) return;
  const list = Array.isArray(snapshots) ? snapshots : [];
  const selected = String($el('histDetailDate')?.value || __histState.detailDate || '');
  if (!selected) {
    wrap.innerHTML = '<div style="font-size:.65rem;color:var(--muted);margin:-4px 0 10px">날짜를 선택하면 해당 일자의 평가금액·매입원가·손익·수익률을 표시합니다.</div>';
    return;
  }
  __histState.detailDate = selected;
  const exact = list.find(item => _histDateKey(item.date || '') === selected);
  if (!exact) {
    const before = [...list].reverse().find(item => _histDateKey(item.date || '') < selected);
    const after = list.find(item => _histDateKey(item.date || '') > selected);
    const nearby = [before && `직전 ${_fmtHistDateCompact(before.date)}`, after && `직후 ${_fmtHistDateCompact(after.date)}`].filter(Boolean).join(' · ');
    wrap.innerHTML = `<div style="margin:-2px 0 12px;padding:10px 12px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2));font-size:.68rem;color:var(--text)">
      ⚠️ ${_escapeHtml(selected)} 평가 가능한 원자료 손익이 없습니다.${nearby ? ` <span style="color:var(--muted)">${_escapeHtml(nearby)}</span>` : ''}
    </div>`;
    return;
  }
  const evalAmt = Number(exact.evalAmt || exact.total || exact.eval || 0);
  const costAmt = Number(exact.costAmt || exact.cost || 0);
  const pnl = evalAmt - costAmt;
  const pct = costAmt > 0 ? pnl / costAmt * 100 : 0;
  const color = pnl >= 0 ? 'var(--green)' : 'var(--red-lt)';
  const navWarning = exact.navInputRequired
    ? `<div style="font-size:.65rem;color:var(--amber);margin-top:7px">⚠️ ${_escapeHtml((exact.navInputRequiredCodes || []).join(', '))} NAV 미입력 · 직전 확정 NAV를 사용한 임시 손익입니다.</div>` : '';
  const item = (label, value, valueColor = 'var(--text)') => `<div style="padding:8px 10px;border-radius:8px;background:var(--s1);border:1px solid var(--border)"><div style="font-size:.61rem;color:var(--muted)">${label}</div><div style="font-size:.82rem;font-weight:700;color:${valueColor};font-variant-numeric:tabular-nums">${value}</div></div>`;
  wrap.innerHTML = `<div style="margin:-2px 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--s2)">
    <div style="font-size:.70rem;font-weight:700;color:var(--text);margin-bottom:7px">${_escapeHtml(_fmtHistDateCompact(selected))} 원자료 기반 평가</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">
      ${item('평가금액', _fmtKrw(evalAmt))}${item('매입원가', _fmtKrw(costAmt), 'var(--muted)')}${item('손익', `${pSign(pnl)}${_fmtKrw(pnl)}`, color)}${item('수익률', `${pSign(pnl)}${pct.toFixed(1)}%`, color)}
    </div>
    <div style="font-size:.61rem;color:var(--muted);margin-top:7px">확정 가격이력·펀드 NAV·좌수·환율·거래원장으로 재구성한 손익이며 기존 Snapshot 중복과 무관합니다.</div>${navWarning}
    <div id="histDateItems" style="margin-top:10px"></div>
  </div>`;
}

function _renderHistorySourceCoverage(el, summary, snapshots) {
  if (!el || !summary) return;
  const complete = Number(summary.completeDates || 0);
  const missing = Number(summary.unavailableDates || 0);
  const carried = Number(summary.carriedFundItems || 0);
  const samples = Array.isArray(summary.unavailableSamples) ? summary.unavailableSamples : [];
  const sampleText = samples.slice(0, 5).map(item => `${item.date}: ${item.reason}`).join(' · ');
  const warning = missing > 0;
  const explanation = carried > 0
    ? `펀드 ${carried}건은 해당일 NAV가 없어 직전 확정 공시일 NAV × 해당일 좌수로 평가했습니다. 당일 NAV 확정을 뜻하지 않으며 추후 공시되면 자동 재계산됩니다.`
    : '확인된 NAV는 해당 평가일 좌수로 재계산합니다.';
  el.insertAdjacentHTML('afterbegin', `<div style="margin:0 0 10px;padding:10px 12px;border:1px solid ${warning ? 'var(--c-amber-35,var(--border))' : 'var(--border)'};border-radius:9px;background:var(--s2);font-size:.67rem;line-height:1.55">
    <b style="color:${warning ? 'var(--amber)' : 'var(--green)'}">원자료 기준 자동 손익 · 계산 완료 ${complete}일${missing ? ` · 원자료 부족 ${missing}일 제외` : ''}</b><br>
    <span style="color:var(--muted)">기존 Snapshot 대신 거래·확정가격·펀드 NAV·환율로 재구성했습니다. ${_escapeHtml(explanation)}</span>
    ${missing ? `<br><span style="color:var(--amber)">제외일 예시: ${_escapeHtml(sampleText)}${missing > samples.length ? ' 외 추가 날짜' : ''}</span>` : ''}
  </div>`);
}

function _renderHistoryNavWarnings(el, snapshots) {
  if (!el) return;
  const pending = [];
  (snapshots || []).forEach(snapshot => {
    (snapshot.navInputRequiredCodes || []).forEach(code => pending.push({ code, date: snapshot.date }));
  });
  if (!pending.length) return;
  const unique = Array.from(new Map(pending.map(item => [`${item.code}|${item.date}`, item])).values());
  const first = unique[0];
  const labels = unique.slice(0, 12).map(item => `${item.code} ${item.date}`).join(', ');
  const more = unique.length > 12 ? ` 외 ${unique.length - 12}건` : '';
  el.insertAdjacentHTML('afterbegin', `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:10px 12px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2))">
    <div style="font-size:.67rem;line-height:1.55"><b style="color:var(--amber)">⚠️ NAV 미확정 ${unique.length}건</b><br><span>${_escapeHtml(labels + more)}</span><br><span style="color:var(--muted)">표시된 날짜의 손익은 직전 확정 NAV를 사용한 임시 평가입니다.</span></div>
    <button type="button" class="btn-ghost-sm" data-history-action="open-fund-nav" data-fund-code="${_escapeHtml(first.code)}" data-fund-date="${_escapeHtml(first.date)}">${_escapeHtml(first.code)} ${_escapeHtml(first.date)} 입력</button>
  </div>`);
}

function _renderHistoryIntegrityWarnings(el, diagnostics, rangeDiagnosisFailed, totalDates) {
  if (!el) return;
  if (rangeDiagnosisFailed) {
    const failure = rangeDiagnosisFailed === true ? { errorCode: 'SERVER_ERROR' } : rangeDiagnosisFailed;
    const labels = { CLIENT_TIMEOUT: '기간 정합성 진단 시간초과', SERVER_ERROR: '정합성 진단 서버 오류', RUNTIME_ERROR: '정합성 진단 실행 오류',
      INVALID_RESPONSE: '정합성 진단 응답 오류', SOURCE_DATA_ERROR: '정합성 원자료 조회 오류', RANGE_TOO_LARGE: '정합성 진단 범위 초과' };
    const progress = failure.totalDates ? `${failure.totalDates}일 중 ${failure.processedDates || 0}일 처리` : '';
    const detail = [progress, failure.lastCompletedDate && `마지막 완료: ${failure.lastCompletedDate}`, failure.failedDate && `실패 날짜: ${failure.failedDate}`,
      failure.phase && `단계: ${failure.phase}`, `오류코드: ${failure.errorCode || 'SERVER_ERROR'}`, failure.elapsedMs && `경과: ${failure.elapsedMs}ms`].filter(Boolean).join(' · ');
    el.insertAdjacentHTML('afterbegin', `<div style="margin:0 0 10px;padding:10px 12px;border:1px solid var(--red);border-radius:9px;background:var(--c-red-08,var(--s2));font-size:.67rem;line-height:1.55"><b style="color:var(--red-lt)">❌ ${_escapeHtml(labels[failure.errorCode] || labels.SERVER_ERROR)}</b><br>${detail ? `<span>${_escapeHtml(detail)}</span><br>` : ''}<span style="color:var(--muted)">미검증 날짜는 저장 Snapshot으로 표시하며, 확인된 오류 상태만 계산에서 제외합니다.</span></div>`);
    return;
  }
  const invalid = (diagnostics || []).filter(item => item && item.status !== 'VALID');
  if (!invalid.length) {
    el.insertAdjacentHTML('afterbegin', `<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 데이터 정합성 검증 ${Number(totalDates || diagnostics?.length || 0)}일 정상</div>`);
    return;
  }
  const labels = { PARTIAL: 'Snapshot 부분 누락', MISMATCH: '저장값과 원자료 불일치',
    SOURCE_INCOMPLETE: '원자료 부족으로 검증 불가', CONFLICT: '중복/충돌 존재', NO_SNAPSHOT: '날짜 Snapshot 누락',
    PRICE_SUSPICIOUS: '가격 원자료 이상 후보', UNCHECKED: '미검증' };
  const counts = invalid.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  const summary = Object.entries(counts).map(([status, count]) => `${labels[status] || status} ${count}일`).join(' · ');
  const repairable = invalid.filter(_isRepairableHistoryDiagnostic);
  const validCount = (diagnostics || []).filter(item => item?.status === 'VALID').length;
  const blockingCount = invalid.filter(item => HISTORY_BLOCKING_INTEGRITY_STATUSES.includes(item.status)).length;
  const conflictSummary = invalid.reduce((acc, item) => {
    const d = item?.duplicateSummary || {};
    acc.manualProtected += Number(d.manualProtected || 0);
    acc.unresolved += Number(d.unresolvedConflict || 0);
    acc.exact += Number(d.exactDuplicate || 0);
    acc.expectedMatch += Number(d.singleExpectedMatch || 0);
    return acc;
  }, { manualProtected: 0, unresolved: 0, exact: 0, expectedMatch: 0 });
  const conflictDetail = (conflictSummary.manualProtected || conflictSummary.unresolved || conflictSummary.exact || conflictSummary.expectedMatch)
    ? `<br><span style="color:var(--muted)">충돌 분류 · MANUAL 보호 ${conflictSummary.manualProtected}그룹 · 미해결 ${conflictSummary.unresolved}그룹 · 동일중복 ${conflictSummary.exact}그룹 · 원자료 일치 자동판정 ${conflictSummary.expectedMatch}그룹</span>`
    : '';
  el.insertAdjacentHTML('afterbegin', `<div style="margin:0 0 10px;padding:10px 12px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2));font-size:.67rem;line-height:1.55"><b style="color:var(--amber)">⚠️ 데이터 정합성 검증 요약</b><br>검증 ${diagnostics.length}일 중 정상 ${validCount}일 · ${_escapeHtml(summary)}${conflictDetail}<br><span style="color:var(--muted)">${blockingCount ? `확인된 Snapshot 오류 ${blockingCount}일만 손익선과 계산에서 제외합니다.` : '원자료 부족·미검증 날짜의 저장 Snapshot은 손익 계산에 사용합니다.'}</span>${repairable.length ? `<br><button type="button" class="btn-ghost-sm" data-history-action="repair-integrity">검증 가능한 오류 Snapshot 복구 (${repairable.length})</button>` : ''}</div>`);
}

async function repairHistoryIntegritySnapshots() {
  const targets = (__histState.integrityDiagnostics || []).filter(_isRepairableHistoryDiagnostic);
  if (!targets.length || !confirm(`${targets.length}일의 검증 가능한 Snapshot을 원자료로 재작성할까요?`)) return;
  const operationId = `history-integrity-${Date.now()}`;
  const failed = []; let repaired = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      const result = await requestGsheetFormJson('rewriteSnapshotDate', { date: target.date, operationId, finalize: i === targets.length - 1 ? '1' : '' }, { timeoutMs: 120000, retry: 0 });
      if (result?.status === 'error' || result?.after?.status !== 'VALID') throw new Error(result?.message || `재작성 후 상태: ${result?.after?.status || 'UNKNOWN'}`);
      repaired++;
    } catch (error) {
      failed.push({ date: target.date, message: error.message });
      break;
    }
  }
  showToast(`Snapshot 복구 성공 ${repaired}일${failed.length ? ` · 실패 ${failed.length}일` : ''}`, failed.length ? 'warn' : 'ok');
  await loadHistoryChart();
}

async function _loadHistoryDateItems(date) {
  const wrap = $el('histDateItems');
  if (!wrap || !date) return;
  wrap.innerHTML = '<div style="font-size:.65rem;color:var(--muted)">⏳ 종목별 스냅샷 불러오는 중...</div>';
  const data = await _historyRequestJson('getHistorySourceDetail', { date }, { timeoutMs: 15000, retry: 1 });
  if (!data || data.status === 'error') {
    wrap.innerHTML = `<div style="font-size:.65rem;color:var(--red-lt)">❌ 종목별 상세 조회 실패${data?.message ? ` · ${_escapeHtml(data.message)}` : ''}</div>`;
    return;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    wrap.innerHTML = '<div style="font-size:.65rem;color:var(--muted)">종목별 스냅샷 행이 없습니다.</div>';
    return;
  }
  const num = value => Math.round(Number(value || 0)).toLocaleString();
  const rows = items.map(item => {
    const pnl = Number(item.pnl || 0);
    const color = pnl >= 0 ? 'var(--green)' : 'var(--red-lt)';
    return `<tr>
      <td>${_escapeHtml(item.name || '-')}</td><td class="mono">${_escapeHtml(item.code || '-')}</td>
      <td class="num">${num(item.qty)}</td><td class="num">${num(item.costUnit)}</td><td class="num">${num(item.evalUnit)}</td>
      <td class="num">${num(item.costAmt)}</td><td class="num">${num(item.evalAmt)}</td>
      <td class="num" style="color:${color}">${pSign(pnl)}${num(pnl)}</td>
      <td class="num" style="color:${color}">${pSign(pnl)}${Number(item.pct || 0).toFixed(1)}%</td>
      <td>${_escapeHtml(item.source || '-')}</td></tr>`;
  }).join('');
  wrap.innerHTML = `<div style="font-size:.68rem;font-weight:700;color:var(--text);margin-bottom:6px">종목별 상세 · ${items.length}개</div>
    <div class="tbl-wrap"><table><thead><tr><th>종목명</th><th>종목코드</th><th class="num">수량</th><th class="num">매입단가</th><th class="num">평가단가</th><th class="num">매입금액</th><th class="num">평가금액</th><th class="num">손익</th><th class="num">수익률</th><th>가격소스</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function _renderHistoryCoverage(el, coverage, mode, sourceRecomputed) {
  if (!el) return;
  if (sourceRecomputed) {
    const missing = Array.isArray(coverage?.missing) ? coverage.missing : [];
    // 원자료 부족일은 기존 Snapshot 저장 버튼으로 복구할 수 없습니다.
    // 혼동을 막기 위해 read-only 계산에서는 Snapshot 수기 복구 UI를 노출하지 않습니다.
    el.innerHTML = missing.length
      ? `<div style="font-size:.66rem;color:var(--amber);margin:-2px 0 8px">⚠️ 선택 기간에 원자료로 재구성할 수 없는 날짜 후보 ${missing.length}개가 있습니다. 확인된 가격·NAV·환율을 다시 확보하면 자동 재계산됩니다.</div>`
      : '<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 선택 기간의 원자료 기반 평가일이 연결되어 있습니다.</div>';
    return;
  }
  const missing = Array.isArray(coverage?.missing) ? coverage.missing : [];
  const repairResult = __histState.repairResult;
  const resultHtml = repairResult
    ? `<div style="padding-top:7px;${missing.length ? 'flex-basis:100%;border-top:1px solid var(--border);' : ''}font-size:.65rem;color:${repairResult.failed.length ? 'var(--amber)' : 'var(--green)'}">
        ${repairResult.failed.length
          ? `⚠️ 복구 결과: 성공 ${repairResult.repaired}개 · 실패 ${repairResult.failed.length}개<br><span style="color:var(--muted)">${_escapeHtml(repairResult.failed.map(item => `${item.date || '날짜 없음'}: ${item.message}`).join(' / '))}</span>`
          : `✅ 누락 스냅샷 ${repairResult.repaired}개를 복구했습니다.`}
      </div>`
    : '';
  if (!missing.length) {
    const coverageHtml = '<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 선택 기간의 스냅샷 누락이 없습니다.</div>';
    el.innerHTML = coverageHtml + resultHtml;
    return;
  }
  const labels = missing.slice(0, 6).map(item => item.label).join(', ');
  const more = missing.length > 6 ? ` 외 ${missing.length - 6}개` : '';
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:9px 11px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2))">
    <div style="min-width:0;font-size:.67rem;color:var(--text);line-height:1.55">
      <b style="color:var(--amber)">⚠️ ${mode === 'day' ? '일별' : (mode === 'week' ? '주간' : '월간')} 스냅샷 ${missing.length}개 누락</b><br>
      <span style="color:var(--muted)">${_escapeHtml(labels + more)} · ${mode === 'day' ? '오늘과 주말을 제외한 평일 후보(휴장일이 포함될 수 있음)' : '오늘까지 금요일/월말 영업일'} 기준으로 복구합니다.<br>날짜마다 별도 요청하므로 누락일이 많거나 Google Finance 응답이 늦으면 오래 걸릴 수 있습니다. 장기간 누락은 16:20 평가단가 자동 트리거 중단 또는 실행 오류일 수 있으며, 보완 실행 시 트리거도 점검합니다.</span>
    </div>
    <button type="button" class="btn-ghost-sm" data-history-action="repair-gaps" ${__histState.repairInProgress ? 'disabled' : ''}>${__histState.repairInProgress ? '⏳ 복구 중...' : '🛠️ 누락 보완'}</button>
    ${resultHtml}
  </div>`;
}

async function repairHistorySnapshotGaps() {
  const dates = Array.from(new Set(__histState.missingSnapshotDates || [])).filter(Boolean);
  if (!dates.length || !GSHEET_API_URL) return;
  if (!confirm(`${dates.length}개의 누락 스냅샷을 가격이력과 거래이력으로 복구할까요?\n처리 중에는 화면을 닫지 마세요.`)) return;
  const btn = document.querySelector('[data-history-action="repair-gaps"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 복구 중...'; }
  __histState.repairInProgress = true;
  __histState.repairResult = null;
  __histState.repairProgress = { current: 0, total: dates.length, date: dates[0], status: '대기' };
  const showProgress = () => {
    const panel = $el('histCoveragePanel');
    if (!panel || !__histState.repairProgress) return;
    let progress = panel.querySelector('[data-history-repair-progress]');
    if (!progress) {
      progress = document.createElement('div');
      progress.dataset.historyRepairProgress = '';
      progress.className = 'hist-repair-progress';
      panel.appendChild(progress);
    }
    const p = __histState.repairProgress;
    progress.textContent = `날짜별 진행 상태 ${p.current}/${p.total} · ${p.date || '-'} · ${p.status}`;
  };
  showProgress();
  let repaired = 0;
  const failed = [];
  let automationRestored = false;
  try {
    // 과거 가격 조회는 날짜별로 GOOGLEFINANCE 계산을 수행할 수 있습니다. 여러 날짜를 한
    // 요청에 묶으면 GAS 실행 제한에 걸려 전부 실패하므로 날짜별 요청으로 성공분을 보존합니다.
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      __histState.repairProgress = { current: i + 1, total: dates.length, date, status: '복구 중' };
      showProgress();
      const data = await requestGsheetFormJson('repairSnapshots', { data: JSON.stringify({ dates: [date] }) }, { timeoutMs: 120000, retry: 0 });
      if (!data || data.status === 'error') {
        const message = data?.message || 'GAS 응답이 없거나 처리 시간이 초과되었습니다.';
        failed.push({ date, message });
        __histState.repairProgress.status = `실패: ${message}`;
        showProgress();
        if (btn) btn.textContent = `⏳ ${i + 1}/${dates.length}`;
        continue;
      }
      repaired += Array.isArray(data.repaired) ? data.repaired.length : 0;
      if (Array.isArray(data.failed)) failed.push(...data.failed);
      automationRestored = automationRestored || !!data.automationRestored;
      __histState.repairProgress.status = '성공';
      showProgress();
      if (btn) btn.textContent = `⏳ ${i + 1}/${dates.length}`;
    }
    __histState.repairResult = { repaired, failed };
    showToast(`스냅샷 ${repaired}개 복구 완료${failed.length ? ` · 실패 ${failed.length}개 (화면에서 사유 확인)` : ''}${automationRestored ? ' · 자동 트리거 복구' : ''}`, failed.length ? 'warn' : 'ok');
    await loadHistoryChart();
  } catch (e) {
    __histState.repairResult = { repaired, failed: [...failed, { date: '', message: e.message || '알 수 없는 오류' }] };
    showToast(`스냅샷 복구 중 오류: ${e.message || '알 수 없는 오류'}`, 'error');
    await loadHistoryChart();
  } finally {
    __histState.repairInProgress = false;
    __histState.repairProgress = null;
    const currentBtn = document.querySelector('[data-history-action="repair-gaps"]');
    if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = '🛠️ 다시 시도'; }
  }
}

function _renderFullHistoryRepairStatus(state, message) {
  const el = $el('histFullRepairStatus');
  if (!el) return;
  if (!state) {
    el.innerHTML = message ? `<div class="hist-repair-progress">${_escapeHtml(message)}</div>` : '';
    return;
  }
  const total = Number(state.total || 0);
  const checked = Number(state.checked || 0);
  const remaining = Math.max(0, total - checked);
  const fallbackMinutes = Math.ceil(remaining / 3);
  const color = state.done ? 'var(--green)' : 'var(--amber)';
  el.innerHTML = `<div class="hist-repair-progress" style="margin-bottom:8px;color:${color}">
    <b>${state.done ? '✅ GAS 스냅샷 시트 재작성 완료' : '⏳ GAS 스냅샷 시트 재작성 중'}</b>
    · 점검 ${checked}/${total} · 재작성 ${Number(state.repaired || 0)} · 일치 ${Number(state.unchanged || 0)} · 자료없음 ${Number(state.skipped || 0)} · 실패 ${Number(state.failed || 0)}
    ${!state.done && remaining > 0 ? ` · 화면 연결 중 연속 처리 · 화면을 닫으면 약 ${fallbackMinutes}분 이상 (분당 최대 3일)` : ''}
    ${state.lastDate ? ` · 최근 ${_escapeHtml(state.lastDate)}` : ''}${state.lastError ? `<br>⚠️ ${_escapeHtml(state.lastError)}` : ''}
  </div>`;
}

async function _pollFullHistorySnapshotRepair() {
  if (__histState.fullRepairPolling || !GSHEET_API_URL) return;
  __histState.fullRepairPolling = true;
  try {
    while (__histState.fullRepairPolling) {
      const data = await requestGsheetFormJson('continueSnapshotRepair', {}, { timeoutMs: 120000, retry: 0 });
      if (!data || data.status === 'error') throw new Error(data?.message || '진행상황 응답이 없습니다.');
      const state = data.repairState || null;
      _renderFullHistoryRepairStatus(state, state ? '' : '전체 재작성 기록이 없습니다.');
      if (!state || state.done) {
        __histState.fullRepairPolling = false;
        const btn = $el('btn-history-full-repair');
        if (btn) { btn.disabled = false; btn.textContent = '🧰 GAS 전체 재작성'; }
        if (state?.done) await loadHistoryChart();
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (e) {
    __histState.fullRepairPolling = false;
    _renderFullHistoryRepairStatus(null, `전체 재작성 진행상황 조회 실패: ${e.message || '알 수 없는 오류'}`);
    const btn = $el('btn-history-full-repair');
    if (btn) { btn.disabled = false; btn.textContent = '🧰 상태 다시 확인'; }
  }
}

async function startFullHistorySnapshotRepair() {
  if (!GSHEET_API_URL || __histState.fullRepairPolling) return;
  if (!confirm('연결된 GAS의 가격이력과 거래이력으로 스냅샷을 보완할까요?\n기존 수동 입력·누락된 종목·외화 기록을 보존하고, 쓰기 전 백업 시트를 만듭니다. 빈 계산 결과로 삭제하지 않습니다. 로컬 데이터만 바꾸는 기능이 아니며, 완료 후 구글시트 데이터를 다시 조회합니다.')) return;
  const btn = $el('btn-history-full-repair');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 재작성 시작 중'; }
  _renderFullHistoryRepairStatus(null, '전체 스냅샷 재작성을 시작하는 중입니다.');
  try {
    const data = await requestGsheetFormJson('startSnapshotRepair', {}, { timeoutMs: 120000, retry: 0 });
    if (!data || data.status === 'error') throw new Error(data?.message || 'GAS 응답이 없습니다.');
    _renderFullHistoryRepairStatus(data.repairState || null, data.alreadyRunning ? '기존 전체 재작성 작업을 계속 확인합니다.' : '전체 재작성을 시작했습니다.');
    if (data.alreadyRunning) showToast('이미 진행 중인 GAS 전체 재작성 작업의 상태를 이어서 확인합니다.', 'info');
    if (btn) btn.textContent = '⏳ 전체 재작성 중';
    await _pollFullHistorySnapshotRepair();
  } catch (e) {
    _renderFullHistoryRepairStatus(null, `전체 재작성 시작 실패: ${e.message || '알 수 없는 오류'}`);
    if (btn) { btn.disabled = false; btn.textContent = '🧰 GAS 전체 재작성'; }
  }
}

function _mergeTradeBasedCost(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return snapshots;
  if (!Array.isArray(rawTrades) || rawTrades.length === 0) return snapshots;

  const timeline = _buildCostTimelineFromTrades(snapshots.map(s => _histDateKey(s.date || '')));
  return snapshots.map(s => {
    const key = _histDateKey(s.date || '');
    const tradeCost = timeline[key];
    if (!Number.isFinite(tradeCost)) return s;
    return { ...s, costAmt: Math.round(tradeCost) };
  });
}

function _buildCostTimelineFromTrades(snapshotDateKeys) {
  const targets = [...new Set(snapshotDateKeys.filter(Boolean))].sort();
  const out = {};
  if (!targets.length) return out;

  const trades = rawTrades
    .filter(t => t && t.date && t.name)
    .map(t => ({
      date: _histDateKey(t.date || ''),
      tradeType: (t.tradeType || '').toLowerCase(),
      qty: parseFloat(t.qty || 0),
      price: parseFloat(t.price || 0),
      name: (t.name || '').trim(),
      acct: (t.acct || '').trim(),
    }))
    .filter(t => t.date && t.name && t.qty > 0 && t.price >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const posMap = {}; // key -> { qty, totalCost }
  const posKey = t => `${t.acct}||${t.name}`;
  const totalCost = () => Object.values(posMap).reduce((s, p) => s + (p.totalCost || 0), 0);

  let ti = 0;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    while (ti < trades.length && trades[ti].date <= target) {
      const t = trades[ti++];
      const key = posKey(t);
      if (!posMap[key]) posMap[key] = { qty: 0, totalCost: 0 };
      const p = posMap[key];
      if (t.tradeType === 'buy') {
        p.qty += t.qty;
        p.totalCost += t.qty * t.price;
      } else if (t.tradeType === 'sell') {
        const avg = p.qty > 0 ? p.totalCost / p.qty : 0;
        const sellQty = Math.min(t.qty, p.qty);
        p.qty -= sellQty;
        p.totalCost -= avg * sellQty;
        if (p.qty <= 0) {
          p.qty = 0;
          p.totalCost = 0;
        }
      }
    }
    out[target] = Math.max(0, totalCost());
  }
  return out;
}
