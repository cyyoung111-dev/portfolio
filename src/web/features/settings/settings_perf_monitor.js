// Opt-in isolated Apps Script performance collector under the SAME Google account.
// Never transmit the original financial GAS token, positions, prices, IDs or URLs.
// No Financial GAS server changes and no Cloudflare account required.
(function () {
  'use strict';
  const CONSENT = 'pf_perf_isolated_consent_v1';
  const PERF_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxv2UEdFW5ipjFxddbUyW7F3h6xj3cPkZVlLfSqGglabtjVdGuCJ0QsEHYHxwOasC7n7Q/exec';
  const ALLOWED = new Set([
    'load.initial-restore', 'load.initial-prices', 'load.full-update',
    'price.poll-network', 'price.poll-render', 'price.poll-total',
    'network.getBootstrap', 'network.getSettings',
    'network.getPrices', 'network.getPriceHistory'
  ]);
  const CAP = 40;
  let queue = [], sequence = 0, revision = 0, sending = false, timer = null;
  let retryAfter = 0;
  let connectionIdentity = null;
  const getConsent = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch (_) { return false; } };
  const setConsent = value => { try { localStorage.setItem(CONSENT, value ? '1' : '0'); } catch (_) {} };
  // Permanently retire Cloudflare settings and pending batches from PR #896.
  for (const oldKey of ['pf_perf_remote_consent_v1','pf_perf_remote_endpoint_v1',
    'pf_perf_remote_queue_v1','pf_perf_gas_consent_v1']) {
    try { localStorage.removeItem(oldKey); } catch (_) {}
  }
  function pftelemetry_gasReady() {
    return !!(typeof GSHEET_API_URL !== 'undefined' && String(GSHEET_API_URL || '').trim()
      && PERF_ENDPOINT.startsWith('https://script.google.com/macros/s/')
      && typeof getGsheetAccessToken === 'function' && getGsheetAccessToken()
      && typeof requestGsheetFormJson === 'function'
      && typeof crypto !== 'undefined' && crypto.subtle
      && typeof TextEncoder !== 'undefined');
  }
  function pftelemetry_enabled() { return getConsent() && pftelemetry_gasReady(); }
  async function pftelemetry_deriveToken() {
    if (!pftelemetry_gasReady()) return '';
    const token = getGsheetAccessToken();
    // Only a purpose-specific SHA256 derivative leaves this device; original
    // finance GAS accessToken must NEVER be sent to a second deployment.
    const input = new TextEncoder().encode('portfolio-telemetry:v1|' + token);
    const hash = await crypto.subtle.digest('SHA-256', input);
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function pftelemetry_guardConnection() {
    const url = typeof GSHEET_API_URL === 'undefined' ? '' : String(GSHEET_API_URL || '').trim();
    const generation = typeof getGsheetConnectionGeneration === 'function'
      ? getGsheetConnectionGeneration() : 0;
    const current = url + '|generation:' + String(generation);
    if (connectionIdentity === null) { connectionIdentity = current; return true; }
    if (current === connectionIdentity) return true;
    connectionIdentity = current;
    // A changed workbook or credential invalidates both old queued samples and
    // old device consent. Never transfer timing data across GAS connections.
    pftelemetry_stop();
    return false;
  }
  function pftelemetry_device() {
    try {
      if (typeof navigator !== 'undefined' && navigator.userAgentData &&
          typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile ? 'mobile' : 'desktop';
      }
      return window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
    } catch (_) { return 'unknown'; }
  }
  function pftelemetry_schedule(delayMs) {
    if (timer || !pftelemetry_enabled()) return;
    timer = setTimeout(() => { timer = null; void pftelemetry_flush(); }, delayMs);
  }
  function pftelemetry_record(entry) {
    if (!pftelemetry_guardConnection() || !pftelemetry_enabled() || !entry || !ALLOWED.has(entry.stage) || !Number.isInteger(entry.ms) ||
        entry.ms < 0 || entry.ms > 120000) return;
    queue.push({
      stage: entry.stage, ms: entry.ms, result: entry.result === 'error' ? 'error' : 'ok',
      localId: ++sequence
    });
    if (queue.length > CAP) queue.splice(0, queue.length - CAP);
    pftelemetry_schedule(25000); // Low priority; no extra request in the critical price path.
  }
  async function pftelemetry_flush() {
    if (!pftelemetry_guardConnection() || !pftelemetry_enabled() || sending || !queue.length) return false;
    if (Date.now() < retryAfter) {
      pftelemetry_schedule(Math.max(1000, retryAfter - Date.now()));
      return false;
    }
    const url = String(GSHEET_API_URL || '').trim();
    const generation = typeof getGsheetConnectionGeneration === 'function'
      ? getGsheetConnectionGeneration() : null;
    const batch = queue.slice(0, 8);
    const sentRevision = revision;
    sending = true;
    let delivered = false;
    try {
      const payload = {version: 1, device: pftelemetry_device(),
        samples: batch.map(e => ({stage:e.stage,ms:e.ms,result:e.result}))};
      const derived = await pftelemetry_deriveToken();
      // WebCrypto is asynchronous. Stop/switch can occur while digesting;
      // never upload a queued sample after device consent was revoked.
      if (!pftelemetry_guardConnection() || !pftelemetry_enabled()
          || revision !== sentRevision || String(GSHEET_API_URL || '').trim() !== url
          || (generation !== null && getGsheetConnectionGeneration() !== generation))
        return false;
      if (!/^[a-f0-9]{64}$/.test(derived)) return false;
      const response = await requestGsheetFormJson('appendPerformanceMetrics',
        {data: JSON.stringify(payload)},
        {targetUrl:PERF_ENDPOINT,accessTokenOverride:derived,timeoutMs:8000,retry:0,preserveError:true});
      const current = String(GSHEET_API_URL || '').trim() === url
        && (generation === null || getGsheetConnectionGeneration() === generation);
      // A stale response must not penalize a newly consented connection.
      if (!current || !pftelemetry_enabled() || revision !== sentRevision) return false;
      if (response?.status !== 'ok') {
        retryAfter = Date.now() + 300000;
        return false;
      }
      const sentIds = new Set(batch.map(e=>e.localId));
      queue = queue.filter(e=>!sentIds.has(e.localId));
      delivered = true;
      return true;
    } catch (_) {
      retryAfter = Date.now() + 300000;
      return false;
    } finally {
      sending = false;
      if (delivered && queue.length) pftelemetry_schedule(1500);
    }
  }
  function pftelemetry_stop() {
    revision++;
    setConsent(false);
    queue = [];
    retryAfter = 0;
    if (timer) { clearTimeout(timer); timer = null; }
  }
  // Immediate, in-memory diagnostic. No consent, GAS write or network call.
  // The opt-in standalone collector keeps its existing published allowlist.
  const LOCAL_STAGE_LABELS = Object.freeze({
    'load.initial-restore': '최초 데이터 복원',
    'load.initial-prices': '최초 자동 가격조회',
    'load.full-update': '전체 업데이트',
    'load.full-restore': '데이터 복원',
    'load.full-prices': '가격 재조회',
    'load.full-render': '화면 재계산',
    'network.getBootstrap': 'GAS 전체 복원',
    'network.getSettings': 'GAS 설정 조회',
    'network.getPrices': 'GAS 현재가 조회',
    'network.getPriceHistory': 'GAS 가격이력 조회',
    'price.poll-total': '현재가 총 소요',
    'price.poll-network': '현재가 네트워크',
    'price.poll-render': '현재가 화면 반영'
  });
  // Current-tab-only aggregates: successful samples form the quantiles;
  // errors remain visible as counts, never transformed to short timings.
  // The standalone collector has a narrower schema and is not changed.
  function pftelemetry_localStats(raw) {
    const grouped = new Map();
    (Array.isArray(raw) ? raw.slice(-60) : []).forEach(entry => {
      if (!entry || !Object.prototype.hasOwnProperty.call(LOCAL_STAGE_LABELS, entry.stage)
          || !Number.isFinite(entry.ms) || entry.ms < 0 || entry.ms > 120000
          || !['ok', 'error'].includes(entry.result)) return;
      let item = grouped.get(entry.stage);
      if (!item) {
        item = { latest: null, successes: [], failures: 0 };
        grouped.set(entry.stage, item);
      }
      item.latest = entry;
      if (entry.result === 'ok') item.successes.push(Math.round(entry.ms));
      else item.failures++;
    });
    return Object.entries(LOCAL_STAGE_LABELS).filter(([stage]) => grouped.has(stage))
      .map(([stage, label]) => {
        const item = grouped.get(stage);
        const sorted = item.successes.slice().sort((a,b) => a-b);
        // Require at least three successful runs. Match server nearest-rank
        // p95 and lower-middle median, not a made-up extrapolated percentile.
        const ready = sorted.length >= 3;
        return {
          stage, label, latestMs: Math.round(item.latest.ms),
          latestResult: item.latest.result, successes: sorted.length,
          failures: item.failures,
          medianMs: ready ? sorted[Math.floor((sorted.length-1)/2)] : null,
          p95Ms: ready ? sorted[Math.ceil(sorted.length*0.95)-1] : null
        };
      });
  }
  function pftelemetry_localDiagnosis(stats) {
    const full = stats.find(x => x.stage === 'load.full-update');
    const parts = ['load.full-restore','load.full-prices','load.full-render']
      .map(stage => stats.find(x => x.stage === stage));
    if (!full || full.successes < 3 || parts.some(x => !x || x.successes < 3))
      return '전체 업데이트와 복원·가격·화면 구간을 각각 정상 3회 이상 측정하면 병목 후보가 표시됩니다.';
    const slowest = parts.reduce((a,b) => a.medianMs >= b.medianMs ? a : b);
    return '병목 후보: ' + slowest.label + ' (정상 호출별 중앙값 기준 · 서로 다른 실행의 표본일 수 있습니다).';
  }
  function pftelemetry_localReport(stats) {
    if (!stats.length) return '';
    const device = pftelemetry_device();
    const rows = [
      '포트폴리오 조회시간 ('+(device === 'mobile' ? '모바일'
        : device === 'desktop' ? 'PC' : '기기 미확인')+')',
      '이 탭의 최근 최대 60개 측정값 · 정상 3회 이상인 구간만 중앙값/p95 산출',
      '단위: 밀리초(ms) · 성공 표본과 실패 건수는 분리'
    ];
    stats.forEach(x => rows.push(x.label+': 최근 '+x.latestMs+'ms ('+
      (x.latestResult === 'ok' ? '성공' : '실패')+'), 정상 '+x.successes+
      '건, 실패 '+x.failures+'건, 중앙값 '+
      (x.medianMs === null ? '미측정' : x.medianMs+'ms')+', p95 '+
      (x.p95Ms === null ? '미측정' : x.p95Ms+'ms')));
    rows.push(pftelemetry_localDiagnosis(stats));
    return rows.join('\n');
  }
  function pftelemetry_renderLocal() {
    const wrap = document.getElementById('perfLocalSummaryBody');
    if (!wrap) return;
    const stats = pftelemetry_localStats(window.__PF_LOOKUP_TIMES);
    if (!stats.length) {
      wrap.textContent = '이 탭의 측정값이 없습니다. 업데이트 또는 현재가 갱신 후 다시 눌러주세요.';
      return;
    }
    const note = document.createElement('p');
    note.textContent = pftelemetry_localDiagnosis(stats);
    note.style.margin = '6px 0';
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.fontVariantNumeric = 'tabular-nums';
    const header = document.createElement('tr');
    for (const name of ['구간', '최근', '중앙값', 'p95', '정상 / 실패']) {
      const cell = document.createElement('th');
      cell.textContent = name;
      header.appendChild(cell);
    }
    table.appendChild(header);
    const displayMs = n => n === null ? '3회 미만' : n.toLocaleString('ko-KR') + 'ms';
    stats.forEach(x => {
      const row = document.createElement('tr');
      for (const value of [x.label,
          x.latestMs.toLocaleString('ko-KR') + 'ms · '+
            (x.latestResult === 'error' ? '실패' : '성공'),
          displayMs(x.medianMs), displayMs(x.p95Ms),
          x.successes + ' / ' + x.failures]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.style.padding = '5px 7px';
        row.appendChild(cell);
      }
      table.appendChild(row);
    });
    wrap.replaceChildren(note, table);
  }
  function pftelemetry_renderSettingsHtml() {
    return '<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:12px">'
      + '<div style="font-size:.74rem;font-weight:700">PC·모바일 조회시간 자동 진단</div>'
      + '<p style="font-size:.66rem;color:var(--muted);margin:7px 0">새 계정 없이 기존 Google 계정의 독립 성능 수집기를 사용합니다. 기기 구분·조회 단계·소요시간·성공 여부만 7일간 전용 스크립트 저장소에 보관합니다. 금융 원본과 무관하며 기기별 동의가 필요합니다.</p>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + '<button id="perfLocalSummary" type="button" class="btn-ghost-sm">이 기기 최근 조회시간</button>'
      + '<button id="perfLocalCopy" type="button" class="btn-ghost-sm">측정 요약 복사</button>'
      + '<button id="perfGasEnable" type="button" class="btn-purple-sm">수집 시작·연결 확인</button>'
      + '<button id="perfGasSummary" type="button" class="btn-purple-sm">PC·모바일 비교</button>'
      + '<button id="perfGasStop" type="button" class="btn-ghost-sm">수집 중지</button></div>'
      + '<p id="perfGasStatus" role="status" style="font-size:.65rem;color:var(--muted);margin:7px 0">'
      + (pftelemetry_enabled() ? '수집 사용 중 (기기별 동의 저장)' : '수집 비활성화 · 수집 시작을 눌러 기기별 연결 확인')
      + '</p><div id="perfLocalSummaryBody" style="overflow-x:auto;font-size:.69rem;margin:8px 0"></div>'
      + '<p style="font-size:.61rem;color:var(--muted);margin:5px 0">현재 탭의 최근 최대 60개 측정값입니다. 정상 3회 이상일 때 중앙값·p95를 표시하고 실패 건수는 별도로 보입니다. 요약 복사는 조회시간만 복사하며 금융 자료를 포함하지 않습니다. 새로고침 후 기록은 초기화됩니다.</p>'
      + '<div id="perfGasSummaryBody" style="overflow-x:auto;font-size:.66rem"></div></div>';
  }
  function pftelemetry_status(message) {
    const el = document.getElementById('perfGasStatus');
    if (el) el.textContent = message;
  }
  async function pftelemetry_summaryRequest() {
    if (!pftelemetry_gasReady()) { pftelemetry_status('GAS 연결과 접근 토큰 설정이 필요합니다.'); return null; }
    const url=String(GSHEET_API_URL||'').trim();
    const generation=typeof getGsheetConnectionGeneration==='function' ? getGsheetConnectionGeneration() : null;
    try {
      const derived = await pftelemetry_deriveToken();
      if (!/^[a-f0-9]{64}$/.test(derived)) return null;
      const r = await requestGsheetFormJson('getPerformanceSummary',{},
        {targetUrl:PERF_ENDPOINT,accessTokenOverride:derived,timeoutMs:8000,retry:0,preserveError:true});
      if (url !== String(GSHEET_API_URL||'').trim() ||
          (generation !== null && getGsheetConnectionGeneration() !== generation)) return null;
      return r?.status === 'ok' ? r : null;
    } catch (_) { return null; }
  }
  function pftelemetry_renderSummary(response) {
    const wrap=document.getElementById('perfGasSummaryBody');
    if (!wrap) return;
    const groups = Array.isArray(response?.groups) ? response.groups : [];
    if (!groups.length) { wrap.textContent='최근 7일간 수집된 조회시간 없음'; return; }
    const table=document.createElement('table');
    table.style.width='100%';
    const head=document.createElement('tr');
    for (const col of ['기기','조회 단계','건수','중앙값','p95','실패율']) {
      const cell=document.createElement('th');cell.textContent=col;head.appendChild(cell);
    }
    table.appendChild(head);
    for (const g of groups) {
      if (!['mobile','desktop','unknown'].includes(g.device) || !ALLOWED.has(g.stage)) continue;
      const tr=document.createElement('tr');
      for (const value of [g.device,g.stage,g.count,g.medianMs+'ms',g.p95Ms+'ms',g.failureRatePct+'%']) {
        const td=document.createElement('td');td.textContent=String(value);td.style.padding='4px';tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    wrap.replaceChildren(table);
  }
  document.addEventListener('click', async e => {
    const id=e.target.closest?.('button')?.id;
    if (id === 'perfLocalSummary') { pftelemetry_renderLocal(); }
    else if (id === 'perfLocalCopy') {
      const summary = pftelemetry_localReport(pftelemetry_localStats(window.__PF_LOOKUP_TIMES));
      if (!summary) { pftelemetry_status('복사할 성능 측정값이 없습니다.'); return; }
      try {
        if (!navigator.clipboard?.writeText) throw Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(summary);
        pftelemetry_status('기기별 조회시간 요약 복사 완료 · 종목·계좌·가격 정보 없음');
      } catch (_) { pftelemetry_status('클립보드 접근 불가 · 이 기기 최근 조회시간을 확인해주세요.'); }
    }
    else if (id === 'perfGasStop') { pftelemetry_stop(); pftelemetry_status('수집 중지 · 대기 중인 로그 삭제'); }
    else if (id === 'perfGasEnable') {
      pftelemetry_guardConnection();
      if (!pftelemetry_gasReady()) { pftelemetry_status('GAS 연결·접근 토큰을 확인해 주세요.'); return; }
      const attemptRevision = revision;
      pftelemetry_status('GAS 성능 수집 지원 여부 확인 중');
      const r=await pftelemetry_summaryRequest();
      if (revision !== attemptRevision) return; // User pressed stop or changed connection.
      if (!r || r.enabled !== true) {
        pftelemetry_stop();
        pftelemetry_status('독립 성능 수집기 연결 또는 인증 확인 실패 · 수집 비활성화');
        return;
      }
      revision++;setConsent(true);
      pftelemetry_status('이 기기의 성능 로그 자동 수집 활성화');
    } else if (id === 'perfGasSummary') {
      pftelemetry_status('PC·모바일 최근 7일 기록 조회 중');
      const r=await pftelemetry_summaryRequest();
      if (!r) { pftelemetry_status('독립 성능 수집기 조회 실패 · 인증/연결 확인 필요'); return; }
      pftelemetry_renderSummary(r);pftelemetry_status('최근 7일 성능 집계 · 총 '+(r.sampleCount||0)+'건');
    }
  });
  document.addEventListener('visibilitychange',() => { if(document.hidden) void pftelemetry_flush(); });
  window.addEventListener('online',() => { void pftelemetry_flush(); });
  window.PortfolioPerfTelemetry=Object.freeze({record:pftelemetry_record,flush:pftelemetry_flush,renderSettingsHtml:pftelemetry_renderSettingsHtml,renderLocal:pftelemetry_renderLocal,enabled:pftelemetry_enabled});
  if (pftelemetry_enabled()) pftelemetry_schedule(60000);
})();
