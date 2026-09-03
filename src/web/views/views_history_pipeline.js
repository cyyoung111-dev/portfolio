// ════════════════════════════════════════════════════════════════
//  views_history_pipeline.js — 히스토리 데이터 로딩/가공 파이프라인
//  의존: views_history_state.js, views_history_render.js, views_history_benchmark.js
// ════════════════════════════════════════════════════════════════

async function loadHistoryChart() {
  const requestId = ++__histState.loadRequestId;
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

  _setHistoryStatus(statusEl, 'loading');
  chartWrap.innerHTML = '';
  if (tableWrap) tableWrap.innerHTML = '';
  if (coverageEl) coverageEl.innerHTML = '';

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
    const data = await _historyRequestJson('getHistory', { from: fromStr }, { timeoutMs: 15000, retry: 0 });
    if (requestId !== __histState.loadRequestId) return;
    if (!data || data.status === 'error') throw new Error(data?.message || '응답 오류');

    let snapshots = Array.isArray(data.snapshots) ? data.snapshots : (Array.isArray(data) ? data : []);
    if (!snapshots.length) {
      _setHistoryStatus(statusEl, 'empty_data');
      return;
    }

    snapshots = snapshots
      .map(s => ({ ...s, date: _normalizeHistDate(s.date || '') }))
      .filter(s => !!s.date)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (!snapshots.length) {
      _setHistoryStatus(statusEl, 'empty_range');
      return;
    }

    // 거래이력 기반 원가 재계산값이 있으면 우선 적용
    snapshots = _mergeTradeBasedCost(snapshots);
    __histState.snapshots = snapshots;
    _renderHistoryDateDetail(snapshots);
    const mode = _getHistMode();
    const tableSnapshots = mode === 'day'
      ? snapshots
      : (mode === 'week' ? _filterWeeklyFriday(snapshots) : _filterMonthEnd(snapshots));
    const graphSnapshots = tableSnapshots;
    const graphStartDate = graphSnapshots[0]?.date || '';
    const graphEndDate = graphSnapshots[graphSnapshots.length - 1]?.date || '';
    // 변화율은 그래프 양 끝점을 사용하고, MDD는 그 사이의 모든 일별 스냅샷을 유지합니다.
    const portfolioRangeSnapshots = snapshots.filter(snapshot =>
      (!graphStartDate || snapshot.date >= graphStartDate)
      && (!graphEndDate || snapshot.date <= graphEndDate)
    );
    const coverage = mode === 'day'
      ? { missing: [], first: snapshots[0].date, last: snapshots[snapshots.length - 1].date }
      : _analyzeHistoryCoverage(snapshots, mode);
    __histState.missingSnapshotDates = coverage.missing.map(item => item.targetDate);
    _renderHistoryCoverage(coverageEl, coverage, mode);

    const latestSnapshotDate = snapshots[snapshots.length-1].date || '';
    const latestDate = _fmtHistDateCompact(latestSnapshotDate);
    const snapshotGap = _getHistorySnapshotGap(latestSnapshotDate);
    _setHistoryStatus(statusEl, 'summary', {
      graphCount: graphSnapshots.length,
      tableCount: tableSnapshots.length,
      mode,
      latestDate,
      snapshotGap
    });

    const benchmarkTypes = Array.from(new Set(
      _getHistBenchmarks()
        .map(v => String(v || '').toUpperCase().trim())
        .filter(v => HIST_BENCHMARK_TYPES.includes(v))
    ));
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
    const baseMsg = `그래프 ${tableSnapshots.length}${modeUnit} · 원본 ${snapshots.length}일 · 최근: ${latestDate}`;
    const benchMsg = benchmarkTypes.length === 0
      ? '비교지수 없음'
      : `비교지수 ${benchmarkTypes.length - missing.length}/${benchmarkTypes.length}개 로드`;
    const missingMsg = missing.length
      ? ` (실패: ${missing.join(', ')} · ${Array.from(new Set(missing.map(type => benchBundle.errorMap?.[type]).filter(Boolean))).join(' / ')})`
      : '';
    _setHistoryStatus(statusEl, 'summary_benchmark', { baseMsg, benchMsg, missingMsg, snapshotGap });

    _drawHistoryChart(chartWrap, graphSnapshots, mode, {
      types: benchmarkTypes,
      seriesMap: benchSeriesMap,
      metaMap: benchMetaMap,
      portfolioSnapshots: portfolioRangeSnapshots
    });
    _drawHistoryTable(tableWrap, snapshots);
    // 특정일 상세는 그래프 조회와 분리합니다. 날짜 input 변경 시에만 별도 요청합니다.

  } catch(e) {
    _setHistoryStatus(statusEl, 'error', { message: e.message });
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
      ⚠️ ${_escapeHtml(selected)} 손익 스냅샷이 없습니다.${nearby ? ` <span style="color:var(--muted)">${_escapeHtml(nearby)}</span>` : ''}
    </div>`;
    return;
  }
  const evalAmt = Number(exact.evalAmt || exact.total || exact.eval || 0);
  const costAmt = Number(exact.costAmt || exact.cost || 0);
  const pnl = evalAmt - costAmt;
  const pct = costAmt > 0 ? pnl / costAmt * 100 : 0;
  const color = pnl >= 0 ? 'var(--green)' : 'var(--red-lt)';
  const item = (label, value, valueColor = 'var(--text)') => `<div style="padding:8px 10px;border-radius:8px;background:var(--s1);border:1px solid var(--border)"><div style="font-size:.61rem;color:var(--muted)">${label}</div><div style="font-size:.82rem;font-weight:700;color:${valueColor};font-variant-numeric:tabular-nums">${value}</div></div>`;
  wrap.innerHTML = `<div style="margin:-2px 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--s2)">
    <div style="font-size:.70rem;font-weight:700;color:var(--text);margin-bottom:7px">${_escapeHtml(_fmtHistDateCompact(selected))} 저장 스냅샷</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">
      ${item('평가금액', _fmtKrw(evalAmt))}${item('매입원가', _fmtKrw(costAmt), 'var(--muted)')}${item('손익', `${pSign(pnl)}${_fmtKrw(pnl)}`, color)}${item('수익률', `${pSign(pnl)}${pct.toFixed(1)}%`, color)}
    </div>
    <div style="font-size:.61rem;color:var(--muted);margin-top:7px">GAS 손익 스냅샷 합계 기준이며, 상단 기준일 업데이트로 현재 화면 가격을 바꾸지 않습니다.</div>
    <div id="histDateItems" style="margin-top:10px"></div>
  </div>`;
}

async function _loadHistoryDateItems(date) {
  const wrap = $el('histDateItems');
  if (!wrap || !date) return;
  wrap.innerHTML = '<div style="font-size:.65rem;color:var(--muted)">⏳ 종목별 스냅샷 불러오는 중...</div>';
  const data = await _historyRequestJson('getHistoryDetail', { date }, { timeoutMs: 15000, retry: 1 });
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

function _renderHistoryCoverage(el, coverage, mode) {
  if (!el) return;
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
    const coverageHtml = mode === 'day'
      ? '<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 저장된 일별 스냅샷을 그대로 표시합니다.</div>'
      : '<div style="font-size:.64rem;color:var(--green);margin:-2px 0 8px">✅ 선택 기간의 스냅샷 주기가 연속적입니다.</div>';
    el.innerHTML = coverageHtml + resultHtml;
    return;
  }
  const labels = missing.slice(0, 6).map(item => item.label).join(', ');
  const more = missing.length > 6 ? ` 외 ${missing.length - 6}개` : '';
  const repairResult = __histState.repairResult;
  const resultHtml = repairResult
    ? `<div style="flex-basis:100%;padding-top:7px;border-top:1px solid var(--border);font-size:.65rem;color:${repairResult.failed.length ? 'var(--amber)' : 'var(--green)'}">
        ${repairResult.failed.length
          ? `⚠️ 복구 결과: 성공 ${repairResult.repaired}개 · 실패 ${repairResult.failed.length}개<br><span style="color:var(--muted)">${_escapeHtml(repairResult.failed.map(item => `${item.date || '날짜 없음'}: ${item.message}`).join(' / '))}</span>`
          : `✅ 누락 스냅샷 ${repairResult.repaired}개를 복구했습니다.`}
      </div>`
    : '';
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px;padding:9px 11px;border:1px solid var(--c-amber-35,var(--border));border-radius:9px;background:var(--c-amber-08,var(--s2))">
    <div style="min-width:0;font-size:.67rem;color:var(--text);line-height:1.55">
      <b style="color:var(--amber)">⚠️ ${mode === 'week' ? '주간' : '월간'} 스냅샷 ${missing.length}개 누락</b><br>
      <span style="color:var(--muted)">${_escapeHtml(labels + more)} · 오늘까지 금요일/월말 영업일 기준으로 복구합니다.<br>장기간 누락은 16:20 평가단가 자동 트리거 중단 또는 실행 오류일 수 있으며, 보완 실행 시 트리거도 점검합니다.</span>
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
  let repaired = 0;
  const failed = [];
  let automationRestored = false;
  try {
    // 과거 가격 조회는 날짜별로 GOOGLEFINANCE 계산을 수행할 수 있습니다. 여러 날짜를 한
    // 요청에 묶으면 GAS 실행 제한에 걸려 전부 실패하므로 날짜별 요청으로 성공분을 보존합니다.
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const data = await requestGsheetFormJson('repairSnapshots', { data: JSON.stringify({ dates: [date] }) }, { timeoutMs: 120000, retry: 0 });
      if (!data || data.status === 'error') {
        failed.push({ date, message: data?.message || 'GAS 응답이 없거나 처리 시간이 초과되었습니다.' });
        if (btn) btn.textContent = `⏳ ${i + 1}/${dates.length}`;
        continue;
      }
      repaired += Array.isArray(data.repaired) ? data.repaired.length : 0;
      if (Array.isArray(data.failed)) failed.push(...data.failed);
      automationRestored = automationRestored || !!data.automationRestored;
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
    const currentBtn = document.querySelector('[data-history-action="repair-gaps"]');
    if (currentBtn) { currentBtn.disabled = false; currentBtn.textContent = '🛠️ 다시 시도'; }
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
