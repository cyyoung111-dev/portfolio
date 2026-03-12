// ── 배당 관리 상수
const FREQ_OPTIONS = ['-', '월배당', '분기', '반기', '연간'];
const MONTHS_OPTIONS = {
  '-':    [],
  '월배당': [1,2,3,4,5,6,7,8,9,10,11,12],
  '분기':  [[1,4,7,10],[2,5,8,11],[3,6,9,12]],
  '반기':  [[1,7],[2,8],[3,9],[4,10],[5,11],[6,12]],
  '연간':  [1,2,3,4,5,6,7,8,9,10,11,12],
};

// ── 공통 인라인 메시지 헬퍼 (계좌·섹터·종목 관리 탭 공용)
function showMgmtMsg(id, text, isError) {
  const el = $el(id);
  if(!el) { if(isError) showToast(text, 'error'); return; }
  el.textContent = text;
  el.style.display = 'block';
  if(isError) {
    el.style.background = 'rgba(239,68,68,.13)';
    el.style.color = 'var(--red-lt)';
    el.style.border = '1px solid rgba(239,68,68,.28)';
  } else {
    el.style.background = 'rgba(16,185,129,.13)';
    el.style.color = 'var(--green)';
    el.style.border = '1px solid rgba(16,185,129,.28)';
  }
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, isError ? 3500 : 1800);
}

// ★ 배당 주기 버튼 클릭 핸들러 (buildDivMgmt에서 onclick으로 호출)
function _dvPickFreq(key, freq) {
  // 1. hidden input 값 갱신
  const freqInp = $el('dv_freq_' + key);
  if (freqInp) freqInp.value = freq;

  // 2. 버튼 active 상태 토글
  const grp = $el('dv_freq_grp_' + key);
  if (grp) {
    grp.querySelectorAll('button').forEach(btn => {
      btn.className = _fBtnClass(btn.textContent === freq);
    });
  }

  // 3. MONTHS_OPTIONS에 따라 지급월 자동 채움
  const monthsOpt = MONTHS_OPTIONS[freq];
  const monthsInp = $el('dv_months_' + key);
  if (monthsInp && monthsOpt !== undefined) {
    if (freq === '-') {
      monthsInp.value = '';
    } else if (Array.isArray(monthsOpt) && Array.isArray(monthsOpt[0])) {
      // 2D 배열 (분기·반기): 첫 번째 옵션 자동 선택
      monthsInp.value = monthsOpt[0].join(',');
    } else if (Array.isArray(monthsOpt)) {
      monthsInp.value = monthsOpt.join(',');
    }
  }
}

function buildDivMgmt() {
  const container = $el('divMgmtBody');
  if(!container) return;

  // 보유 종목 기준으로 배당 데이터 표시
  const names = [...new Set(rawHoldings.filter(h=>!h.fund).map(h=>h.name))];

  let h = '';
  names.forEach(name => {
    const d = DIVDATA[name] || { perShare:0, freq:'-', months:[], note:'' };
    const _fk = name.replace(/\s/g,'_');
    const freqOpts = FREQ_OPTIONS.map(f =>
      `<button type="button" onclick="_dvPickFreq('${_fk}','${f}')" class="${_fBtnClass(d.freq===f)}">${f}</button>`
    ).join('');

    h += `<div style="border-bottom:1px solid rgba(255,255,255,.06);padding:10px 2px">
      <div style="font-size:.72rem;font-weight:700;color:var(--text);margin-bottom:6px">${name}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center">
        <div>
          <div class="lbl-62-muted-3">주당 배당금 (원)</div>
          <input type="number" id="dv_amt_${name.replace(/\s/g,'_')}"
            value="${d.perShare}"
            class="input-full-73"
          />
        </div>
        <div>
          <div class="lbl-62-muted-3">지급 주기</div>
          <input type="hidden" id="dv_freq_${_fk}" value="${d.freq}"/>
          <div id="dv_freq_grp_${_fk}" style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px">${freqOpts}</div>
        </div>
        <div>
          <div class="lbl-62-muted-3">지급 월</div>
          <input type="text" id="dv_months_${name.replace(/\s/g,'_')}"
            value="${d.months.join(',')}"
            placeholder="예: 4 또는 4,10"
            class="input-full-73"
          />
        </div>
      </div>
      ${d.note ? `<div class="lbl-60-muted-mt">📝 ${d.note}</div>` : ''}
    </div>`;
  });

  container.innerHTML = h || '<div style="color:var(--muted);font-size:.75rem;padding:20px;text-align:center">보유 종목이 없어요</div>';
}

function applyDivChanges() {
  const names = [...new Set(rawHoldings.filter(h=>!h.fund).map(h=>h.name))];
  let changed = 0;
  names.forEach(name => {
    const key = name.replace(/\s/g,'_');
    const amtEl   = $el('dv_amt_'   + key);
    const freqEl  = $el('dv_freq_'  + key);
    const monthsEl= $el('dv_months_'+ key);
    if(!amtEl) return;
    const perShare = parseInt(amtEl.value) || 0;
    const freq     = freqEl?.value || '-';
    const months   = monthsEl?.value
      ? monthsEl.value.split(',').map(m=>parseInt(m.trim())).filter(m=>m>0&&m<=12)
      : [];
    DIVDATA[name] = { ...( DIVDATA[name]||{} ), perShare, freq, months, note: DIVDATA[name]?.note || '' };
    changed++;
  });
  // 배당 뷰 즉시 갱신
  if(currentView === 'div') renderView();
  saveHoldings();
  showToast(`${changed}개 종목 배당 정보 저장 완료`, 'ok');
  buildDivMgmt();
}

// ── 배당 탭 진입 시 자동 GS fetch (버튼 클릭 없이 조용히 갱신)
async function _autoFetchDiv(area) {
  const codeItems = EDITABLE_PRICES.filter(ep => {
    const holding = rawHoldings.find(h => h.name === ep.name && !h.fund);
    return holding && ep.code;
  });
  if (!codeItems.length) return;

  const codes = codeItems.map(ep => ep.code).join(',');
  try {
    const url  = GSHEET_API_URL + '?action=dividend&codes=' + encodeURIComponent(codes);
    const res  = await fetchWithTimeout(url, 40000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.status !== 'ok' || !data.dividends) return;

    const codeToName = {};
    EDITABLE_PRICES.filter(ep => ep.code).forEach(ep => { codeToName[ep.code] = ep.name; });

    let changed = false;
    Object.entries(data.dividends).forEach(([code, obj]) => {
      const name = codeToName[code];
      if (!name) return;
      const prev = DIVDATA[name] || {};
      if (obj.perShare > 0) {
        DIVDATA[name] = {
          ...prev,
          perShare: obj.perShare,
          freq:     obj.freq    || '-',
          months:   (obj.months && obj.months.length > 0) ? obj.months : (prev.months || []),
          note:     'GOOGLEFINANCE 자동갱신',
        };
      } else {
        // 배당 없음 → perShare만 0, 기존 freq/months 보존
        DIVDATA[name] = {
          ...prev,
          perShare: 0,
          note:     prev.note && !prev.note.startsWith('GOOGLEFINANCE') ? prev.note : 'GOOGLEFINANCE: 배당내역 없음',
        };
      }
      changed = true;
    });

    if (changed) {
      saveHoldings();
      // 현재 배당 탭이 열려 있으면 재렌더
      if (currentView === 'div') renderDivView(area, true); // ★ skipFetch=true로 재귀 방지
    }
  } catch(e) {
    // 자동 fetch 실패 시 조용히 무시 (수동 버튼으로 재시도 가능)
    console.warn('_autoFetchDiv 실패:', e.message);
  }
}

// ── 배당금 Claude API 자동 조회
async function startDivFetch() {
  const btn    = $el('divFetchBtn');
  const status = $el('divFetchStatus');

  // 구글시트 연동 여부 확인
  if (!GSHEET_API_URL) {
    status.style.color = 'var(--amber)';
    status.textContent = '⚠️ 구글시트 미연동 — 배당금을 수동으로 입력해주세요. (✏️ 현재가 편집 → 📡 종가 자동 조회 탭에서 연동)';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ 조회 중...';
  status.style.color = 'var(--amber)';
  status.textContent = '구글시트 GOOGLEFINANCE로 배당 내역 조회 중... (약 10~20초)';

  // 보유 종목 코드 목록 (펀드 제외, 코드 있는 것만)
  const codeItems = EDITABLE_PRICES.filter(ep => {
    const holding = rawHoldings.find(h => h.name === ep.name && !h.fund);
    return holding && ep.code;
  });

  if (codeItems.length === 0) {
    status.style.color = 'var(--amber)';
    status.textContent = '⚠️ 조회 가능한 종목코드가 없습니다. 종목코드를 먼저 등록해주세요.';
    btn.disabled = false;
    btn.textContent = '🔄 배당금 불러오기';
    return;
  }

  const codes = codeItems.map(ep => ep.code).join(',');

  try {
    const url = GSHEET_API_URL + '?action=dividend&codes=' + encodeURIComponent(codes);
    const res = await fetchWithTimeout(url, 40000); // 배당 조회는 더 오래 걸림
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.status !== 'ok' || !data.dividends) throw new Error(data.message || '응답 오류');

    // 코드 → 이름 역매핑
    const codeToName = {};
    EDITABLE_PRICES.filter(ep => ep.code).forEach(ep => { codeToName[ep.code] = ep.name; });

    let updated = 0, skipped = 0;
    Object.entries(data.dividends).forEach(([code, obj]) => {
      const name = codeToName[code];
      if (!name) return;
      if (!DIVDATA[name]) DIVDATA[name] = {};
      if (obj.perShare > 0) {
        // GAS 배당 데이터 확인 → 전체 갱신
        DIVDATA[name].perShare = obj.perShare;
        DIVDATA[name].freq     = obj.freq || '-';
        DIVDATA[name].months   = (obj.months && obj.months.length > 0) ? obj.months : (DIVDATA[name].months || []);
        DIVDATA[name].note     = 'GOOGLEFINANCE 최근 13개월 기준';
        updated++;
      } else {
        // GAS 배당 없음 → perShare만 0으로, 기존 freq/months/note는 보존
        DIVDATA[name].perShare = 0;
        if (!DIVDATA[name].note || DIVDATA[name].note.startsWith('GOOGLEFINANCE')) {
          DIVDATA[name].note = 'GOOGLEFINANCE: 배당내역 없음 (수동입력 가능)';
        }
        skipped++;
      }
    });

    status.style.color = 'var(--green-lt)';
    status.textContent = '✅ ' + updated + '개 종목 배당 조회 완료' + (skipped > 0 ? ' (' + skipped + '개 배당없음)' : '') + ' · 확인 후 저장하세요';
    saveHoldings();
    // ★ 상단 요약 숫자 + 테이블 전체 갱신 (skipFetch=true로 재귀 방지)
    const _area = $el('view-area');
    renderDivView(_area, true);

  } catch(e) {
    status.style.color = 'var(--red)';
    status.textContent = '❌ 조회 실패: ' + e.message + ' — 구글시트 연동 및 배포 상태를 확인해주세요.';
  }

  btn.disabled = false;
  btn.textContent = '🔄 배당금 불러오기';
}

// ── 종목 관리 탭
// ── 섹터 관리
