let _editorRefDate = '';
let _editorItemMap = {};
let _editorManualHistory = {};
let _editorGasLastDates = {};
let _editorSectionPage = { fund: 1, noprice: 1 };
const EDITOR_PAGE_SIZE = 5;
let _applyPricesRunning = false; // ★ 중복 클릭 방지 플래그
let _editorLoadSeq = 0; // ★ 날짜 변경 시 이전 로딩 결과 무시용
let _editorHistoryTargets = [];
let _fundUnitConfigs = [];
let _fundUnitItems = [];
let _fundUnitDrafts = {};
let _fundUnitBusy = false;
let _fundUnitsStatus = '';
let _editorMode = 'price';
let _fundNavPasteTimer = 0;
const FUND_NAV_CHANGE_WARNING_RATE = 0.20;
const FUND_NAV_IMPORT_GUIDE = {
  F00002: {
    name: 'KB 밸류포커스 소득공제 S-T', provider: 'KB_VALUE_ST', classCode: 'AQ018', standardCode: 'KR5223AQ0185', className: 'S-T',
    warning: '주의: C(2K04), C-E(2K09)는 다른 클래스입니다.',
    links: [
      ['금융투자협회에서 조회', 'https://dis.kofia.or.kr/websquare/index.jsp?w2xPath=/wq/fundann/DISFundStdPrice.xml&divisionId=MDIS01004001000000&serviceId=SDIS01004001000'],
      ['FunETF에서 확인', 'https://www.funetf.co.kr/product/fund/view/KR5223AQ0185'],
    ],
  },
  F00003: {
    name: '피델리티 월드Big4 S', provider: 'FIDELITY_BIG4_S', classCode: 'AP399', standardCode: 'KR5235AP3996', className: 'S', warning: '',
    links: [
      ['금융투자협회에서 조회', 'https://dis.kofia.or.kr/websquare/index.jsp?w2xPath=/wq/fundann/DISFundStdPrice.xml&divisionId=MDIS01004001000000&serviceId=SDIS01004001000'],
      ['FunETF에서 확인', 'https://www.funetf.co.kr/product/fund/view/KR5235AP3996'],
      ['FundDoctor에서 확인', 'https://www.funddoctor.co.kr/afn/fund/fprofile.jsp?fund_cd=KR5235AP3996'],
    ],
  },
};
let _fundNavImportState = { code: 'F00002', filename: '', pasteText: '', payload: null, preview: null, parseError: '' };

function _fundNavHeader(value) { return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase(); }

function _fundNavDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && typeof XLSX !== 'undefined') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  let text = String(value ?? '').trim().replace(/[./]/g, '-');
  if (/^\d{2}-\d{2}-\d{2}$/.test(text)) text = `20${text}`;
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : text;
}

function _parseFundNavPaste(text, code) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const matrix = lines.map(line => line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map(row => row.map(cell => cell.trim()));
  return _parseFundNavMatrix(matrix, code);
}

function _fundNavNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim().replace(/,/g, '').replace(/\s*원$/, '').trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? Number(text) : NaN;
}

function _parseFundNavMatrix(matrix, code) {
  if (!FUND_NAV_IMPORT_GUIDE[code] || !Array.isArray(matrix)) throw new Error('가져올 펀드를 선택하세요.');
  const dateHeaders = new Set(['일자','기준일','기준일자','날짜','기준가격일','date']);
  const navHeaders = new Set(['기준가격','기준가','기준가격(원)','nav','기준가격(1000좌)']);
  let headerRow = -1, dateCol = -1, navCol = -1;
  matrix.slice(0, 30).some((row, rowIndex) => {
    const normalized = (row || []).map(_fundNavHeader);
    dateCol = normalized.findIndex(value => dateHeaders.has(value));
    navCol = normalized.findIndex(value => navHeaders.has(value) && !value.includes('수정'));
    if (dateCol >= 0 && navCol >= 0) { headerRow = rowIndex; return true; }
    return false;
  });
  if (headerRow < 0) throw new Error('일자와 기준가격 컬럼을 찾지 못했습니다. 수정기준가는 사용할 수 없습니다.');
  const rows = [], clientErrors = [];
  matrix.slice(headerRow + 1).forEach((row, offset) => {
    if (!(row || []).some(cell => String(cell ?? '').trim())) return;
    const rowNumber = headerRow + offset + 2;
    const date = _fundNavDate(row?.[dateCol]);
    const nav = _fundNavNumber(row?.[navCol]);
    if (!/^(?:\d{2}|\d{4})[./-]\d{2}[./-]\d{2}$/.test(String(row?.[dateCol] ?? '').trim()) && !String(row?.[navCol] ?? '').trim()) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) clientErrors.push({ rowNumber, reason: '잘못된 날짜' });
    if (!(nav > 0)) clientErrors.push({ rowNumber, reason: '기준가격은 0보다 큰 숫자여야 합니다.' });
    rows.push({ rowNumber, date, nav: Number.isFinite(nav) ? nav : null });
  });
  if (!rows.length) throw new Error('기준가격 데이터가 없습니다.');
  const warnings = [];
  rows.filter(row => row.nav > 0).sort((a,b) => a.date.localeCompare(b.date)).forEach((row, index, sorted) => {
    if (!index) return;
    const rate = Math.abs(row.nav / sorted[index - 1].nav - 1);
    if (rate >= FUND_NAV_CHANGE_WARNING_RATE) warnings.push({ rowNumber: row.rowNumber, date: row.date, rate });
  });
  return { rows, clientErrors, warnings, sourceText: matrix.flat().map(value => String(value ?? '')).join(' | ').slice(0, 500000) };
}

function _buildFundNavTemplateRows(code) {
  const guide = FUND_NAV_IMPORT_GUIDE[code];
  if (!guide) throw new Error('양식을 만들 펀드를 선택하세요.');
  return {
    input: [['일자', '기준가격']],
    guide: [
      ['펀드명', guide.name], ['F코드', code], ['정확한 클래스', guide.className],
      ['KOFIA', guide.classCode], ['표준코드', guide.standardCode], [], ['사용방법'],
      ['1', '시스템에서 금융투자협회 또는 참고 사이트를 연다.'],
      ['2', `${guide.classCode} 또는 ${guide.standardCode}로 정확한 ${guide.className} 클래스를 확인한다.`],
      ['3', '기간별 일자와 기준가격을 복사한다.'], ['4', 'NAV입력 시트 A2/B2부터 붙여넣는다.'],
      ['5', '파일을 저장한다.'], ['6', '기준가격 가져오기에서 업로드한다.'],
      ['7', '미리보기의 펀드·기간·NAV를 확인한다.'], ['8', '검증된 NAV를 반영한다.'],
      ...(guide.warning ? [[], ['주의', guide.warning]] : []),
    ],
  };
}

function downloadFundNavTemplate(code) {
  if (typeof XLSX === 'undefined') { showToast('SheetJS 라이브러리 로드 후 다시 시도하세요.', 'warn'); return; }
  const rows = _buildFundNavTemplateRows(code);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows.input), 'NAV입력');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows.guide), '사용방법');
  XLSX.writeFile(workbook, `${code}_NAV_입력양식.xlsx`);
  showToast(`${code} NAV 입력양식 다운로드 완료`, 'ok');
}

function _renderFundNavImportResult(preview) {
  if (!preview) return '';
  const details = [...(preview.errors || []), ...(preview.conflicts || []).map(item => ({ rowNumber:item.rowNumber, reason:`${item.date}: 기존 ${Number(item.existingNav).toLocaleString()} / 입력 ${Number(item.uploadedNav).toLocaleString()} 충돌` }))];
  return `<div class="fund-nav-import-result" role="status">
    <b>미리보기 결과</b><div class="fund-nav-import-counts">
    <span>총 ${Number(preview.total || 0)}건</span><span>정상 인식 ${Number(preview.recognized || 0)}건</span>
    <span>신규 ${preview.candidates?.length || 0}건</span><span>기존 동일 ${preview.identical?.length || 0}건</span>
    <span>기존값 충돌 ${preview.conflicts?.length || 0}건</span><span>오류 ${preview.errors?.length || 0}건</span>
    <span>파일 중복 ${preview.duplicates?.length || 0}건</span><span>0좌 제외 ${preview.zeroUnits?.length || 0}건</span></div>
    <p>저장 예정 기간: ${_escapeHtml(preview.from || '없음')} ~ ${_escapeHtml(preview.to || '없음')} · 최초 기준일 ${_escapeHtml(preview.firstDate || preview.from || '없음')} · 최신 기준일 ${_escapeHtml(preview.lastDate || preview.to || '없음')}</p>
    ${details.length ? `<details><summary>오류/충돌 상세</summary>${details.slice(0,50).map(item => `<div>${Number(item.rowNumber)}행: ${_escapeHtml(item.reason)}</div>`).join('')}</details>` : ''}
    ${(_fundNavImportState.payload?.warnings || []).length ? `<p class="fund-nav-import-warning">NAV 20% 이상 변동 경고 ${_fundNavImportState.payload.warnings.length}건</p>` : ''}
    <button type="button" class="fund-action fund-action-primary" data-fund-action="import-nav" ${!preview.canSave || _fundUnitBusy ? 'disabled' : ''}>검증된 기준가 저장 및 재계산</button></div>`;
}

function _renderFundNavImporter() {
  const guide = FUND_NAV_IMPORT_GUIDE[_fundNavImportState.code];
  return `<section class="fund-nav-import"><h4>기준가격 가져오기</h4>
    <label>펀드 선택<select data-fund-nav-target><option value="F00002" ${_fundNavImportState.code === 'F00002' ? 'selected' : ''}>F00002 · KB 밸류포커스 소득공제 S-T</option><option value="F00003" ${_fundNavImportState.code === 'F00003' ? 'selected' : ''}>F00003 · 피델리티 월드Big4 S</option></select></label>
    <div class="fund-nav-guide"><b>${_escapeHtml(guide.name)}</b><dl><dt>F코드</dt><dd>${_fundNavImportState.code}</dd><dt>provider</dt><dd>${guide.provider}</dd><dt>클래스</dt><dd>${guide.className}</dd><dt>KOFIA</dt><dd>${guide.classCode}</dd><dt>표준코드</dt><dd>${guide.standardCode}</dd></dl>
    <div class="fund-nav-code-row"><span><small>KOFIA</small><b>${guide.classCode}</b></span><button type="button" class="fund-action fund-action-utility" data-fund-action="copy-nav-code" data-fund-code="${guide.classCode}">복사</button></div>
    <div class="fund-nav-code-row"><span><small>표준코드</small><b>${guide.standardCode}</b></span><button type="button" class="fund-action fund-action-utility" data-fund-action="copy-nav-code" data-fund-code="${guide.standardCode}">복사</button></div>
    <div class="fund-nav-links">${guide.links.map(([label,url]) => `<a href="${_escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${_escapeHtml(label)}</a>`).join('')}</div>
    <button type="button" class="btn-ghost-sm" data-fund-action="download-nav-template" data-fund-code="${_fundNavImportState.code}">NAV 입력양식.xlsx 다운로드</button>
    <p>검색어: ${guide.classCode} · ${guide.standardCode} · ${_escapeHtml(guide.name)}</p><p>참고 사이트는 정확한 클래스 자료 확보용이며 자동 NAV provider로 사용하지 않습니다.</p>
    ${guide.warning ? `<p class="fund-nav-import-warning">${_escapeHtml(guide.warning)}</p>` : ''}</div>
    <p>사이트의 일자/기준가격을 입력양식 A2/B2부터 붙여넣은 뒤 업로드하세요. 기존 xlsx/xls/csv도 계속 인식합니다.</p>
    <p><b>선택한 펀드:</b> ${_fundNavImportState.code} / ${_escapeHtml(guide.name)} / ${guide.classCode}</p>
    <label class="fund-nav-paste">웹사이트 표 붙여넣기<textarea data-fund-nav-paste rows="7" placeholder="기준일    펀드규모(억원)    수정기준가    기준가    과표기준가">${_escapeHtml(_fundNavImportState.pasteText || '')}</textarea></label>
    <p>헤더의 '기준가' 열만 사용하며 수정기준가·과표기준가는 평가에 사용하지 않습니다.</p>
    <label class="fund-nav-file">파일 선택<input type="file" accept=".xlsx,.xls,.csv" data-fund-nav-file ${_fundUnitBusy ? 'disabled' : ''}></label>
    ${_fundNavImportState.filename ? `<p>파일: ${_escapeHtml(_fundNavImportState.filename)}</p>` : ''}${_fundNavImportState.parseError ? `<p class="fund-nav-import-warning">${_escapeHtml(_fundNavImportState.parseError)}</p>` : ''}
    ${_renderFundNavImportResult(_fundNavImportState.preview)}</section>`;
}

function _captureFundUnitDrafts(force) {
  document.querySelectorAll('[data-fund-field]').forEach(input => {
    if (!force && input.dataset.fundDirty !== 'true') return;
    const code = input.dataset.fundCode;
    if (!_fundUnitDrafts[code]) _fundUnitDrafts[code] = {};
    _fundUnitDrafts[code][input.dataset.fundField] = input.value;
  });
}

function _renderFundUnitsEditor(items) {
  const options = [
    ['HANWHA_2045_CRPE', '한화 LIFEPLUS 적격 TDF 2045 C-RPe'],
    ['KB_VALUE_ST', 'KB 밸류포커스 소득공제 S-T'],
    ['FIDELITY_BIG4_S', '피델리티 월드Big4 S'],
  ];
  const today = _kstTodayStr();
  const renderFund = item => {
      const code = item.code;
      const history = _fundUnitConfigs.filter(c => c.code === code).sort((a,b) => b.startDate.localeCompare(a.startDate));
      const current = history.find(config => config.startDate <= today) || null;
      const latest = history[0] || null;
      const draft = _fundUnitDrafts[code] || {};
      const provider = draft.provider ?? current?.provider ?? latest?.provider ?? '';
      const units = draft.units ?? current?.units ?? latest?.units ?? '';
      const startDate = draft.startDate ?? today;
      return `<fieldset><legend>${_escapeHtml(item.name)} (${_escapeHtml(code)})</legend>
        <label>정확한 클래스 <select data-fund-code="${code}" data-fund-field="provider"><option value="">선택하세요</option>${options.map(([id,label]) => `<option value="${id}" ${provider === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>전체 좌수 <input type="number" min="0" step="any" data-fund-code="${code}" data-fund-field="units" value="${_escapeHtml(String(units))}"></label>
        <label>적용 시작일 <input type="date" data-fund-code="${code}" data-fund-field="startDate" value="${_escapeHtml(startDate)}"></label>
        <button type="button" class="fund-action fund-action-primary" data-fund-action="save" data-fund-code="${code}" ${_fundUnitBusy ? 'disabled' : ''}>${_fundUnitBusy ? '저장 중...' : '좌수 저장'}</button>
        ${history.length ? `<div class="fund-units-history"><b>좌수 변경 이력</b><div class="fund-units-history-head"><span>날짜</span><span>좌수</span><span>펀드명</span><span>상태</span></div>${history.map(config => {
          const status = config.startDate === item.currentConfigStartDate
            ? (Number(config.units) === 0 ? '현재 적용 · 자동평가 중단' : '현재 적용')
            : (config.startDate > today ? '예약' : '이전');
          return `<div><span>${_escapeHtml(config.startDate)}</span><span>${Number(config.units).toLocaleString(undefined,{maximumFractionDigits:12})}좌</span><span>${_escapeHtml(item.name)}</span><em>${status}</em></div>`;
        }).join('')}</div>` : '<p>등록된 좌수 이력이 없습니다.</p>'}
      </fieldset>`;
    };
  const currentItems = items.filter(item => item.currentHolding);
  const pastItems = items.filter(item => !item.currentHolding);
  return `<section class="editor-price-section fund-units-panel"><h4>펀드 좌수 자동 평가</h4>
    <p>종목코드별 전체 좌수 × 일별 기준가격 ÷ 1,000. 좌수 변경은 변경일부터 새 이력을 추가하세요. 0좌부터 자동 평가는 중단하며 기존 기록은 보존합니다.</p>
    ${currentItems.length ? `<div class="fund-units-group"><h5>현재 보유 펀드</h5>${currentItems.map(renderFund).join('')}</div>` : ''}
    ${pastItems.length ? `<div class="fund-units-group"><h5>과거 보유 / 전량 매도 펀드</h5>${pastItems.map(renderFund).join('')}</div>` : ''}
    ${_renderFundNavImporter()}
    <p>기존 가격·수동 입력·스냅샷은 보존합니다. 아래 기간의 미작성 평가금액만 채웁니다.</p>
    <label>시작일 <input type="date" data-fund-code="range" data-fund-field="from" value="${_escapeHtml(_fundUnitDrafts.range?.from || _kstTodayStr().slice(0,4) + '-01-01')}"></label>
    <label>종료일 <input type="date" data-fund-code="range" data-fund-field="to" value="${_escapeHtml(_fundUnitDrafts.range?.to || _kstTodayStr())}"></label>
    <button type="button" class="btn-ghost-sm" data-fund-action="fill" ${_fundUnitBusy ? 'disabled' : ''}>기간 평가금액 채우기</button>
    <p role="status">${_escapeHtml(_fundUnitsStatus)}</p></section>`;
}

async function _loadFundUnitsEditor() {
  if (!GSHEET_API_URL) return;
  try {
    const result = await requestGsheetActionJson('getFundUnits', {}, { timeoutMs: 20000, retry: 0 });
    if (result?.status !== 'ok' || !Array.isArray(result?.funds)) throw new Error(result?.message || 'GAS v9.89 재배포가 필요합니다.');
    _fundUnitConfigs = result.configs || [];
    _fundUnitItems = result.funds;
    buildEditorUI();
  } catch (error) { _fundUnitsStatus = error.message; buildEditorUI(); }
}

async function handleFundUnitAction(action, code) {
  if (_fundUnitBusy) return;
  if (action === 'copy-nav-code') {
    const value = code;
    const button = document.querySelector(`[data-fund-action="copy-nav-code"][data-fund-code="${value}"]`);
    try {
      await navigator.clipboard.writeText(value);
      if (button) { button.textContent = '복사됨'; setTimeout(() => { if (button.isConnected) button.textContent = '복사'; }, 1400); }
      showToast(`${value} 복사 완료`, 'ok');
    } catch (_) { showToast('복사하지 못했습니다.', 'warn'); }
    return;
  }
  if (action === 'download-nav-template') { downloadFundNavTemplate(code); return; }
  if (!GSHEET_API_URL) { showToast('구글시트를 먼저 연결하세요.', 'warn'); return; }
  _captureFundUnitDrafts(true);
  _fundUnitBusy = true;
  try {
    if (action === 'import-nav') {
      if (!_fundNavImportState.preview?.canSave || !_fundNavImportState.payload) throw new Error('먼저 파일을 검증하세요.');
      const guide = FUND_NAV_IMPORT_GUIDE[_fundNavImportState.code];
      const data = { code: _fundNavImportState.code, provider: guide.provider, classCode: guide.classCode, rows: _fundNavImportState.payload.rows, sourceText: _fundNavImportState.payload.sourceText };
      const result = await requestGsheetFormJson('importFundNav', { data: JSON.stringify(data) }, { timeoutMs: 300000, retry: 0 });
      if (result?.status !== 'ok') throw new Error(result?.message || 'NAV import 실패');
      const imported = result.importResult || {}, evaluation = result.evaluation || {};
      _fundUnitsStatus = `NAV 반영 완료 · 신규 ${Number(imported.saved || 0)}건 · 기존 동일 ${imported.identical?.length || 0}건 · 0좌 제외 ${imported.zeroUnits?.length || 0}건 · 재계산 ${evaluation.from || '없음'} ~ ${evaluation.to || '없음'} · 가격이력 ${Number(evaluation.prices || 0)}건 · 스냅샷 ${Number(evaluation.snapshots || 0)}건`;
      _fundNavImportState = { ..._fundNavImportState, preview: { ...imported, candidates: [], canSave: false } };
      _editorHistoryCache.clear();
    } else if (action === 'save') {
      const draft = _fundUnitDrafts[code];
      if (!draft?.provider || !draft.startDate || draft.units === '' || !Number.isFinite(Number(draft.units)) || Number(draft.units) < 0) throw new Error('클래스·적용일·좌수를 입력하세요.');
      _fundUnitsStatus = '저장 중...'; buildEditorUI();
      const result = await requestGsheetFormJson('saveFundUnits', { data: JSON.stringify({ ...draft, code }) }, { timeoutMs: 60000, retry: 0 });
      if (result?.status !== 'ok') throw new Error(result?.message || '좌수 저장 실패');
      _fundUnitConfigs = result.configs || [];
      _fundUnitItems = result.funds || _fundUnitItems;
      _fundUnitsStatus = '좌수가 저장되었습니다. 과거 기간은 기간 평가금액 채우기를 실행하세요.';
    } else if (action === 'fill') {
      const from = _fundUnitDrafts.range?.from;
      const to = _fundUnitDrafts.range?.to;
      if (!from || !to || from > to || to > _kstTodayStr()) throw new Error('조회 기간을 확인하세요.');
      if (!_fundUnitConfigs.length) throw new Error('좌수를 먼저 저장하세요.');
      let saved = 0;
      let missing = 0;
      let lastDate = '';
      for (let start = from; start <= to;) {
        const end = _kstDateOffset(start, 30) < to ? _kstDateOffset(start, 30) : to;
        _fundUnitsStatus = `${start} ~ ${end} 반영 중 · 누적 ${saved}건`;
        buildEditorUI();
        const result = await requestGsheetFormJson('refreshFundValuations', { from: start, to: end }, { timeoutMs: 120000, retry: 0 });
        if (result?.status !== 'ok') throw new Error(result?.message || `${start} 반영 실패. 저장된 이전 구간은 유지됩니다.`);
        saved += Number(result.saved || 0);
        missing += (result.missingHoldings || []).length;
        if (result.lastDate > lastDate) lastDate = result.lastDate;
        start = _kstDateOffset(end, 1);
      }
      _editorHistoryCache.clear();
      _fundUnitsStatus = `가격이력 ${saved}건 추가 · 최신 공시 적용일 ${lastDate || '없음'}${missing ? ` · 거래이력 없어 스냅샷 보류 ${missing}건` : ''}. 기존 기록은 보존했습니다.`;
      await loadEditorPricesByDate($el('editorDate')?.value || _kstTodayStr());
      recomputeRows(); saveHoldings(); renderSummary();
    }
  } catch (error) { _fundUnitsStatus = action === 'save' ? `저장 실패: ${error.message}` : error.message; showToast(_fundUnitsStatus, 'warn', 7000); }
  finally { _fundUnitBusy = false; buildEditorUI(); }
}

function openFundUnitsEditor() {
  _editorMode = 'fund-units';
  _fundUnitDrafts = {};
  _fundNavImportState = { code: 'F00002', filename: '', pasteText: '', payload: null, preview: null, parseError: '' };
  _openEditorModal();
  _loadFundUnitsEditor();
}

async function handleFundNavImportTarget(code) {
  if (!FUND_NAV_IMPORT_GUIDE[code]) return;
  _fundNavImportState = { code, filename: '', pasteText: '', payload: null, preview: null, parseError: '' };
  buildEditorUI();
}

async function handleFundNavImportFile(file) {
  if (!file || _fundUnitBusy) return;
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { _fundNavImportState.parseError = 'xlsx, xls, csv 파일만 지원합니다.'; buildEditorUI(); return; }
  _fundUnitBusy = true;
  _fundNavImportState = { ..._fundNavImportState, filename: file.name, payload: null, preview: null, parseError: '' };
  buildEditorUI();
  try {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS 라이브러리 로드 후 다시 시도하세요.');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const parsed = _parseFundNavMatrix(matrix, _fundNavImportState.code);
    const guide = FUND_NAV_IMPORT_GUIDE[_fundNavImportState.code];
    const data = { code: _fundNavImportState.code, provider: guide.provider, classCode: guide.classCode, rows: parsed.rows, sourceText: parsed.sourceText };
    const result = await requestGsheetFormJson('previewFundNavImport', { data: JSON.stringify(data) }, { timeoutMs: 120000, retry: 0 });
    if (result?.status !== 'ok') throw new Error(result?.message || 'NAV import 검증 실패');
    _fundNavImportState = { ..._fundNavImportState, payload: parsed, preview: result };
  } catch (error) { _fundNavImportState = { ..._fundNavImportState, parseError: error.message, payload: null, preview: null }; showToast(error.message, 'warn', 7000); }
  finally { _fundUnitBusy = false; buildEditorUI(); }
}

async function _previewFundNavParsed(parsed) {
  if (!GSHEET_API_URL) throw new Error('구글시트를 먼저 연결하세요.');
  const guide = FUND_NAV_IMPORT_GUIDE[_fundNavImportState.code];
  const data = { code: _fundNavImportState.code, provider: guide.provider, classCode: guide.classCode, rows: parsed.rows, sourceText: parsed.sourceText };
  const result = await requestGsheetFormJson('previewFundNavImport', { data: JSON.stringify(data) }, { timeoutMs: 120000, retry: 0 });
  if (result?.status !== 'ok') throw new Error(result?.message || 'NAV import 검증 실패');
  _fundNavImportState = { ..._fundNavImportState, payload: parsed, preview: result, parseError: '' };
}

function handleFundNavPasteInput(value) {
  _fundNavImportState = { ..._fundNavImportState, pasteText: value, filename: '', payload: null, preview: null, parseError: '' };
  clearTimeout(_fundNavPasteTimer);
  _fundNavPasteTimer = setTimeout(async () => {
    if (!String(value || '').trim()) { buildEditorUI(); return; }
    _fundUnitBusy = true;
    try { await _previewFundNavParsed(_parseFundNavPaste(value, _fundNavImportState.code)); }
    catch (error) { _fundNavImportState = { ..._fundNavImportState, parseError: error.message, payload: null, preview: null }; }
    finally { _fundUnitBusy = false; buildEditorUI(); }
  }, 350);
}

function openEditor() {
  _editorMode = 'price';
  _openEditorModal();
}

function _openEditorModal() {
  const isFundUnits = _editorMode === 'fund-units';
  const title = $el('priceEditorTitle');
  const description = $el('priceEditorDescription');
  const dateRow = $el('editorDateRow');
  const applyBtn = $el('pe-panel-price-footer');
  if (title) title.textContent = isFundUnits ? '좌수 설정' : '현재가 편집';
  if (description) description.textContent = isFundUnits
    ? '펀드 좌수와 적용 시작일을 등록해 일별 평가금액을 자동 반영합니다'
    : '자동 조회가 안 되는 종목의 현재가를 수동 보정합니다';
  if (dateRow) dateRow.style.display = isFundUnits ? 'none' : 'flex';
  if (applyBtn) applyBtn.style.display = isFundUnits ? 'none' : '';
  buildEditorUI();
  _resetEditorApplyButton();
  // ★ 날짜 입력란 오늘 날짜로 초기화
  const editorDateEl = $el('editorDate');
  if (editorDateEl && !editorDateEl.value) {
    editorDateEl.value = _kstTodayStr(); // ★ KST 기준 오늘 날짜
  }
  if (editorDateEl) {
    _editorRefDate = editorDateEl.value || '';
    if (!editorDateEl._editorDateBound) {
      editorDateEl._editorDateBound = true;
      editorDateEl.addEventListener('change', async () => {
        await loadEditorPricesByDate(editorDateEl.value);
      });
    }
  }
  $el('priceEditor').classList.add('open');
  if (!isFundUnits && editorDateEl?.value) loadEditorPricesByDate(editorDateEl.value);
}

function _resetEditorApplyButton() {
  const applyBtn = $el('pe-panel-price-footer')
                || $el('priceEditor')?.querySelector('.btn-apply-prices');
  if (!applyBtn) return;
  if (!applyBtn.dataset.baseHtml) applyBtn.dataset.baseHtml = applyBtn.innerHTML;
  applyBtn.disabled = false;
  applyBtn.innerHTML = applyBtn.dataset.baseHtml;
  applyBtn.style.background = '';
}

function closeEditor() {
  $el('priceEditor').classList.remove('open');
  editedPrices = {};
  _editorManualHistory = {};
  _editorGasLastDates = {};
  _editorSectionPage = { fund: 1, noprice: 1 };
}

function _setEditorSectionPage(section, page, totalPages) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const next = Math.max(1, Math.min(safeTotal, Number(page) || 1));
  _editorSectionPage[section] = next;
  buildEditorUI();
}

// ── 구글 시트 URL 관리

function saveGsheetUrlFromUI() {
  const raw = $el('gsheetUrlInput')?.value?.trim();
  if(!raw) { showToast('URL을 입력해주세요', 'warn'); return; }

  // Apps Script 배포 URL은 /exec 엔드포인트여야 호출 가능
  // 공유용 기본 URL(/edit 등)을 붙여넣은 경우에도 최대한 자동 보정
  let val = raw;
  if (!raw.includes('/exec')) {
    const s = raw.replace(/\/+$/, '');
    if (s.includes('/macros/s/')) val = s + '/exec';
  }

  if(!val.startsWith('https://script.google.com/macros/s/')) {
    showToast('올바른 Apps Script 웹앱 URL이 아닙니다', 'error');
    return;
  }
  if(!val.includes('/exec')) {
    showToast('웹앱 배포 URL(/exec)을 입력해주세요', 'warn');
    return;
  }

  const inp = $el('gsheetUrlInput');
  if (inp && inp.value !== val) inp.value = val;
  saveGsheetUrl(val);
  // ★ 매번 $el()로 새로 찾음 — refreshAll()이 renderGsheetView()를 호출해 DOM을 재생성하므로
  //    함수 시작 시점에 참조한 res는 재렌더링 후 무효화됨
  function setRes(msg, color) {
    const el = $el('gsheetTestResult');
    if (!el) return;
    el.style.color = color || 'var(--muted)';
    el.textContent = msg;
    // ★ [개선] 렌더링 후에도 메시지가 유지되도록 localStorage에 저장
    // renderGsheetView()가 innerHTML을 통째로 교체해도 복원됨
    try {
      localStorage.setItem('pf_gsheet_test_result', JSON.stringify({ msg, color: color || 'var(--muted)' }));
    } catch(e) {}
  }
  updateGsheetBadge();

  (async () => {
    // 1단계 — 설정 복원
    setRes('⏳ [1/3] 설정 복원 중... (GS 연결 확인)', 'var(--amber)');
    let restored = false;
    try {
      restored = await loadSettings(function(msg) {
        setRes('⏳ [1/3] ' + msg, 'var(--amber)');
      });
      if (restored) {
        try { refreshAll(); _mgmtRefresh(); } catch(e){}
        // ★ refreshAll()이 DOM 재생성 후 gsheetTestResult가 새 엘리먼트로 교체됨
        //    → 다음 tick에서 setRes() 호출해야 새 엘리먼트에 메시지가 써짐
        await new Promise(r => setTimeout(r, 50));
        setRes('✅ [1/3] 설정 복원 완료', 'var(--green-lt)');
      } else {
        const reason = await _diagnoseGsheetGetSettings();
        setRes(`⚠️ [1/3] 설정 복원 실패 — ${reason}`, 'var(--red-lt)');
        return;
      }
    } catch(e) {
      setRes('❌ [1/3] 설정 복원 오류: ' + e.message, 'var(--red-lt)');
      return;
    }

    // 2단계 — 종목코드 동기화
    await new Promise(r => setTimeout(r, 300));
    setRes('⏳ [2/3] 종목코드 동기화 중...', 'var(--amber)');
    let syncResult = null;
    try {
      syncResult = await syncCodesToGsheet();
    } catch(e) {
      setRes('❌ [2/3] 종목코드 동기화 오류: ' + e.message, 'var(--red-lt)');
      return;
    }

    // 3단계 — 최종 결과 표시
    if (syncResult) {
      const { synced = 0, updated = 0, removed = 0, total = 0 } = syncResult;
      const parts = [];
      if (synced  > 0) parts.push(`신규 ${synced}개`);
      if (updated > 0) parts.push(`수정 ${updated}개`);
      if (removed > 0) parts.push(`삭제 ${removed}개`);
      const codeMsg = parts.length
        ? `종목코드 ${parts.join(' · ')} (총 ${total}개)`
        : `종목코드 ${total}개`;
      const dateStr = fmtDateDot(_kstTodayStr()); // ★ KST 기준 오늘 날짜
      setRes(`✅ 연결 성공! ${codeMsg} · 기준일: ${dateStr}`, 'var(--green-lt)');
    } else {
      setRes('⚠️ [3/3] 종목코드 동기화 실패 — 전송할 코드가 없거나 GS 응답 오류', 'var(--amber)');
    }
  })();
}

async function _diagnoseGsheetGetSettings() {
  if (!GSHEET_API_URL) return 'URL 미설정';
  try {
    const data = await requestGsheetActionJson('getSettings', {}, { timeoutMs: 10000, retry: 0 });
    if (!data) return 'JSON 파싱 실패(응답 포맷 확인)';
    if (data.status !== 'ok') return data.message || 'status!=ok';
    if (!data.settings) return 'settings 필드 누락(getSettings 구현/배포 확인)';
    return '원인 미상(콘솔 로그 확인)';
  } catch (e) {
    return e?.message || '요청 예외';
  }
}

async function saveGsheetAccessTokenFromUI() {
  if (!GSHEET_API_URL) { showToast('먼저 Apps Script 웹앱 URL을 저장해주세요', 'warn'); return; }
  const input = $el('gsheetAccessTokenInput');
  const token = String(input?.value || '').trim();
  if (!token) { showToast('GAS에서 설정한 접근 토큰을 입력해주세요', 'warn'); return; }
  if (token.length < 24) { showToast('접근 토큰은 24자 이상을 권장합니다', 'warn', 5000); return; }
  const previous = getGsheetAccessToken();
  saveGsheetAccessToken(token);
  const status = $el('gsheetAccessTokenStatus');
  if (status) { status.style.color = 'var(--amber)'; status.textContent = '접근 토큰 검증 중...'; }
  const data = await requestGsheetActionJson('getSettings', {}, { timeoutMs: 10000, retry: 0 });
  if (!data || data.status !== 'ok') {
    saveGsheetAccessToken(previous);
    if (status) { status.style.color = 'var(--red-lt)'; status.textContent = '검증 실패 · 이전 토큰을 복원했습니다. GAS 토큰과 입력값을 확인하세요.'; }
    showToast('접근 토큰 검증 실패', 'error', 5000);
    return;
  }
  if (input) input.value = '';
  window.GAS_API_KEY_STATUS = data.settings?.apiKeyStatus || window.GAS_API_KEY_STATUS || {};
  if (status) { status.style.color = 'var(--green-lt)'; status.textContent = '접근 토큰 검증 완료 · 이 브라우저에만 저장됨'; }
  showToast('GAS 접근 토큰 저장 및 검증 완료', 'ok');
  renderView(true);
}

function clearGsheetAccessTokenFromUI() {
  saveGsheetAccessToken('');
  showToast('이 브라우저의 GAS 접근 토큰을 삭제했습니다', 'warn');
  renderView(true);
}

function clearGsheetUrl() {
  saveGsheetUrl('');
  const inp = $el('gsheetUrlInput');
  if(inp) inp.value = '';
  const res = $el('gsheetTestResult');
  if (res) {
    res.style.color = 'var(--muted)';
    res.textContent = '연동 해제됨. 구글시트 연동 시 자동 조회가 활성화됩니다.';
  }
  // ★ [개선] 연동 해제 시 저장된 결과 메시지도 삭제
  try { localStorage.removeItem('pf_gsheet_test_result'); } catch(e) {}
  updateGsheetBadge();
}

function updateGsheetBadge() {
  // 메인 헤더 뱃지 업데이트 (있는 경우)
  const badge = $el('gsheetBadge');
  if(badge) badge.style.display = GSHEET_API_URL ? 'inline' : 'none';
}

let _mgmtGsheetSyncTimer = null;
function queueMgmtGsheetSync(immediate) {
  if (!GSHEET_API_URL) return;
  clearTimeout(_mgmtGsheetSyncTimer);
  const delay = immediate ? 0 : 1200;
  _mgmtGsheetSyncTimer = setTimeout(async () => {
    // Settings 저장이 끝나기 전에 별도 시트 동기화를 시작하면 사용자는 일부 성공 로그만 보고
    // 기초정보도 저장된 것으로 오인할 수 있습니다. 일반 설정 저장 결과를 먼저 확인합니다.
    const settingsSaved = await saveSettings(true);
    let codesSaved = false;
    try { codesSaved = !!(await syncCodesToGsheet()); } catch (e) { console.warn('syncCodesToGsheet 실패:', e); }
    try { await syncHoldingsToGsheet(); } catch (e) { console.warn('syncHoldingsToGsheet 실패:', e); }
    try { await syncTradesToGsheet(); } catch (e) { console.warn('syncTradesToGsheet 실패:', e); }
    if (!settingsSaved || !codesSaved) {
      console.warn('[기초정보 GAS 저장 실패]', { settingsSaved, codesSaved });
      if (typeof showToast === 'function') {
        showToast('⚠️ 기초정보의 GAS 저장에 실패했습니다. 연결 상태와 GAS 배포 버전을 확인해주세요.', 'warn', 6000);
      }
    }
  }, delay);
}

// ── 기초정보 관리 공통 헬퍼
// 데이터 변경 후 차트·요약 갱신. stocks탭에서는 renderView() 스킵 (인수인계 핵심 패턴)
function _mgmtRefresh() {
  recomputeRows();
  renderSummary();
  if (typeof shouldRenderCharts !== 'function' || shouldRenderCharts(currentView)) renderDonut();
  if(currentView !== 'stocks') renderView();
  // 거래수정 팝업이 열려있으면 종목 버튼 목록 갱신
  if($el('tradeEditOverlay') && $el('tradeEditOverlay').style.display !== 'none') {
    if(typeof _refreshTeCodeList === 'function') {
      _refreshTeCodeList($el('te-name')?.value, $el('te-code')?.value);
    }
  }
}

// ── 계좌 관리 (기초정보 관리 탭)

function _isCurrentEditorHolding(item) {
  const itemName = normName(item?.name || '');
  const itemCode = normalizeStockCode(item?.code || '');
  return rawHoldings.some(holding => {
    if (!(Number(holding?.qty) > 0)) return false;
    const holdingName = normName(holding?.name || '');
    const holdingCode = normalizeStockCode(holding?.code || STOCK_CODE[holdingName] || STOCK_CODE[holding?.name] || '');
    return (itemCode && holdingCode === itemCode) || (itemName && holdingName === itemName);
  });
}

function buildEditorUI() {
  _captureFundUnitDrafts();
  _editorItemMap = {};
  // ① 펀드·TDF — 현재 보유수량이 있는 종목만 표시합니다.
  // 기초정보와 과거 가격이력은 보존하되 전량 매도 종목은 편집 대상에서 제외합니다.
  const fundItems = EDITABLE_PRICES.filter(item =>
    (item.fund || item.assetType === '펀드' || item.assetType === 'TDF')
    && _isCurrentEditorHolding(item)
  );

  if (_editorMode === 'fund-units') {
    $el('editorBody').innerHTML = _fundUnitItems.length
      ? _renderFundUnitsEditor(_fundUnitItems)
      : '<div class="empty-msg" style="padding:30px 0">기초정보·거래이력·기존 좌수 설정에 근거가 있는 F코드가 없습니다.</div>';
    return;
  }

  // ② 코드 있는 일반 종목 중 "실제 자동조회 실패" 대상만 노출
  // savedPrices 조회 시 코드 키 + 이름 키 모두 확인
  const nopriceCodes = new Set();
  const nopriceItems = [];
  const missingSet = new Set((Array.isArray(window._gsheetMissingCodes) ? window._gsheetMissingCodes : []).map(m => normalizeStockCode(m.code)));
  EDITABLE_PRICES.forEach(item => {
    // 펀드·TDF는 ①에서 처리
    if (item.fund || item.assetType === '펀드' || item.assetType === 'TDF') return;
    if (!item.code) return;
    const code = (typeof normalizeStockCode === 'function') ? normalizeStockCode(item.code) : item.code;
    const hasPrice = !!(savedPrices[code] || savedPrices[item.code] || savedPrices[item.name] || getCurrentPriceFromData(item.name));
    const isMissing = missingSet.has(code);
    if (!hasPrice && isMissing) {
      if (!_isCurrentEditorHolding(item)) return;
      nopriceCodes.add(code);
      nopriceItems.push(item);
    }
  });
  // ★ _gsheetMissingCodes: GAS 조회 실패 종목 중 EDITABLE_PRICES에 없는 것도 추가
  // 단, 기초정보에 이미 같은 이름 또는 같은 코드가 있으면 추가하지 않음
  if (Array.isArray(window._gsheetMissingCodes)) {
    window._gsheetMissingCodes.forEach(m => {
      const code = (typeof normalizeStockCode === 'function') ? normalizeStockCode(m.code) : m.code;
      if (nopriceCodes.has(code)) return; // 이미 목록에 있음
      // ★ 기초정보에 같은 코드 또는 같은 이름이 있으면 추가하지 않음
      const epByCode = EDITABLE_PRICES.find(i => i.code && normalizeStockCode(i.code) === code);
      const epByName = EDITABLE_PRICES.find(i => i.name === m.name);
      if (epByCode || epByName) return;
      if (!_isCurrentEditorHolding(m)) return;
      nopriceCodes.add(code);
      nopriceItems.push({ name: m.name, code: m.code, assetType: '주식' });
    });
  }

  const totalItems = [...fundItems, ...nopriceItems];
  _editorHistoryTargets = totalItems.map(item => ({
    name: item.name || '',
    code: item.code ? normalizeStockCode(item.code) : '',
  }));
  totalItems.forEach(item => {
    const nn = normName(item.name || '');
    _editorItemMap[item.name] = { code: item.code ? normalizeStockCode(item.code) : '', normName: nn };
    if (nn && !_editorItemMap[nn]) _editorItemMap[nn] = { code: item.code ? normalizeStockCode(item.code) : '', normName: nn };
  });

  if (totalItems.length === 0) {
    $el('editorBody').innerHTML =
      '<div class="empty-msg" style="padding:30px 0">' +
      '<div style="font-size:1.8rem;margin-bottom:8px">✅</div>' +
      '모든 종목의 현재가가 자동 조회되고 있어요.<br>' +
      '<span class="txt-muted-68">자동 조회가 안 되는 종목이 생기면 여기에 표시됩니다.</span>' +
      '</div>';
    return;
  }

  function renderRow(item, typeLabel) {
    const code = item.code ? normalizeStockCode(item.code) : '';
    const current = (code && savedPrices[code])
      || savedPrices[item.name]
      || savedPrices[normName(item.name)]
      || getCurrentPriceFromData(item.name);

    const rawDateLabel = (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
      || (current ? '매입단가' : '');
    const hasDate = !!(
      (code && savedPriceDates[code])
      || savedPriceDates[item.name]
      || savedPriceDates[normName(item.name)]
    );
    const displayLabel = _compactEditorPriceMetaLabel((hasDate && rawDateLabel === '실시간' && _editorRefDate)
      ? _editorRefDate.replace(/-/g,'.') + ' 조회값'
      : rawDateLabel);

    // 상태 색상
    let statusColor;
    if (hasDate && displayLabel.includes('저장')) statusColor = 'var(--green)';
    else if (hasDate) statusColor = 'var(--blue-lt,#60a5fa)';
    else if (current) statusColor = 'var(--muted)';
    else statusColor = 'var(--red)';

    // ★ 이력: 최신순 2건만 짧게 표시해 현재가 편집 카드가 가로로 터지지 않도록 함
    const historyKey = code || item.name;
    const historyRows = (
      _editorManualHistory[historyKey]
      || (code && _editorManualHistory[code])
      || _editorManualHistory[item.name]
      || _editorManualHistory[normName(item.name)]
      || []
    ).slice().reverse().slice(0, 2);
    const gasLast = _editorGasLastDates[historyKey]
      || (code && _editorGasLastDates[code])
      || _editorGasLastDates[item.name]
      || _editorGasLastDates[normName(item.name)]
      || null;
    const gasLastLabel = gasLast
      ? _formatEditorGasLastLabel(gasLast)
      : '';
    const historyLine = historyRows.length > 0
      ? historyRows.map((h, i) => {
          const d = (h.date || '').slice(5).replace('-','.');  // "04.01"
          const t = h.savedAt ? ' ' + h.savedAt.slice(11,16) : '';
          const p = Number(h.price).toLocaleString();
          return `<span class="editor-history-item" style="color:${i===0?'var(--gold)':'var(--muted)'};font-weight:${i===0?'600':'400'}">${d}${t} · ${p}</span>`;
        }).join('')
      : '';

    const safeId  = item.name.replace(/\s/g, '_');
    const safeName = item.name.replace(/'/g, "\\'");

    // ★ 한 줄 압축형 레이아웃
    return `<div class="editor-price-row">
      <!-- 1행: 종목명 + 입력칸 + 상태 -->
      <div class="editor-price-row-main">
        <div class="editor-price-main-title">
          <span class="editor-price-name">${item.name}</span>
          <span class="editor-price-code">${item.code ? item.code : ''}</span>
        </div>
        <input type="text" inputmode="numeric" data-format="number-comma" id="ep_${safeId}"
          value="${current ? Number(current).toLocaleString() : ''}"
          placeholder="현재가"
          data-editor-price-name="${_escapeHtml(item.name)}"
          class="editor-price-input"
        />
        <span id="ps_${safeId}" style="font-size:.65rem;color:${statusColor};flex-shrink:0;width:14px;text-align:center">✓</span>
      </div>
      <!-- 2행: 저장일시 + 이력 -->
      <div class="editor-price-row-sub">
        <span class="editor-price-type">${typeLabel}</span>
        <div class="editor-price-meta">
          ${displayLabel ? `<span class="editor-current-label" style="color:${statusColor}">${displayLabel}</span>` : ''}
          ${gasLastLabel ? `<span class="editor-gas-last">${_escapeHtml(gasLastLabel)}</span>` : ''}
          ${historyLine ? `<span class="editor-history-line">${historyLine}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderSection(sectionKey, title, items, typeLabelResolver) {
    const totalPages = Math.max(1, Math.ceil(items.length / EDITOR_PAGE_SIZE));
    const currentPage = Math.min(_editorSectionPage[sectionKey] || 1, totalPages);
    _editorSectionPage[sectionKey] = currentPage;
    const start = (currentPage - 1) * EDITOR_PAGE_SIZE;
    const pageItems = items.slice(start, start + EDITOR_PAGE_SIZE);

    let sectionHtml = '<section class="editor-price-section">';
    sectionHtml += `<div class="editor-price-section-title">${title}</div>`;
    sectionHtml += '<div class="editor-price-list">';
    pageItems.forEach(item => {
      sectionHtml += renderRow(item, typeLabelResolver(item));
    });
    sectionHtml += '</div>';
    if (totalPages > 1) {
      sectionHtml += `<div class="editor-price-pagination">
        <button class="editor-page-btn" data-editor-page-section="${_escapeHtml(sectionKey)}" data-page="${currentPage - 1}" data-total-pages="${totalPages}" ${currentPage <= 1 ? 'disabled' : ''}>이전</button>
        <span>${currentPage} / ${totalPages} 페이지</span>
        <button class="editor-page-btn" data-editor-page-section="${_escapeHtml(sectionKey)}" data-page="${currentPage + 1}" data-total-pages="${totalPages}" ${currentPage >= totalPages ? 'disabled' : ''}>다음</button>
      </div>`;
    }
    sectionHtml += '</section>';
    return sectionHtml;
  }

  let html = `<div class="editor-price-summary">총 ${totalItems.length}개 종목 · 섹션별 페이지로 이동해 입력하세요</div><div class="p-0-4">`;

  if (fundItems.length > 0) {
    html += renderSection('fund', `📦 펀드·TDF (${fundItems.length})`, fundItems, () => '펀드·TDF');
  }

  if (nopriceItems.length > 0) {
    html += renderSection('noprice', `⚠️ 자동 조회 실패 종목 (${nopriceItems.length})`, nopriceItems, item => item.assetType || '주식');
  }

  html += '</div>';
  $el('editorBody').innerHTML = html;
}

async function loadEditorPricesByDate(dateStr) {
  if (!dateStr) return;
  _editorRefDate = dateStr;
  const loadSeq = ++_editorLoadSeq;

  // 기존 로컬/저장 가격으로 먼저 그려서 편집창을 즉시 사용할 수 있게 합니다.
  // GAS 조회는 아래에서 백그라운드로 보강하되, 늦게 도착한 이전 날짜 응답은 무시합니다.
  buildEditorUI();

  if (!GSHEET_API_URL || typeof fetchFromGsheet !== 'function') {
    return;
  }

  const autoLabel = dateStr.replace(/-/g,'.') + ' 조회값';
  // 현재가와 과거 입력이력은 서로 독립된 GAS 요청이므로 동시에 시작합니다.
  // 기존 순차 호출은 현재가 조회가 끝난 뒤에야 이력 조회를 시작해 표시가 불필요하게 늦었습니다.
  const currentPromise = fetchFromGsheet(dateStr).then(results => {
    if (loadSeq !== _editorLoadSeq || _editorRefDate !== dateStr) return;
    if (results && Object.keys(results).length > 0) {
      const meta = (window._gsheetPriceMeta && typeof window._gsheetPriceMeta === 'object') ? window._gsheetPriceMeta : {};
      Object.entries(results).forEach(([key, price]) => {
        savedPrices[key] = price;
        const savedAt = meta[key]?.savedAt || '';
        const sourceDate = meta[key]?.sourceDate || '';
        const isFallback = !!meta[key]?.isFallback;
        if (savedAt) savedPriceDates[key] = savedAt.replace(/-/g,'.').slice(0,16) + ' 입력';
        else if (isFallback && sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 기준일 이전값';
        else if (sourceDate) savedPriceDates[key] = sourceDate.replace(/-/g,'.') + ' 조회값';
        else savedPriceDates[key] = autoLabel;
      });
      buildEditorUI();
    }
  }).catch(e => {
    console.warn('[loadEditorPricesByDate] fetchFromGsheet 실패, 수동입력값만 표시:', e.message);
  });

  // 현재가 조회를 기다리지 않고 이력이 도착하는 즉시 별도로 화면에 표시합니다.
  // GOOGLEFINANCE 조회가 느리거나 실패해도 GAS 저장 내역은 먼저 확인할 수 있습니다.
  const historyPromise = _fetchEditorPriceHistoryRaw(dateStr).then(rawHistory => {
    if (loadSeq !== _editorLoadSeq || _editorRefDate !== dateStr) return;

    const manual = _parseEditorManualPrices(rawHistory);
    Object.entries(manual).forEach(([key, obj]) => {
      savedPrices[key] = obj.price;
      if (obj.savedAt) {
        savedPriceDates[key] = obj.savedAt.replace(/-/g,'.').slice(0,16) + ' 저장';
      } else if (obj.date) {
        savedPriceDates[key] = obj.date.replace(/-/g,'.') + ' 저장';
      } else {
        savedPriceDates[key] = dateStr.replace(/-/g,'.') + ' 저장';
      }
    });

    _editorManualHistory = _parseEditorManualHistory(rawHistory);
    _editorGasLastDates = _parseEditorGasLastDates(rawHistory);
    buildEditorUI();
  });

  await Promise.allSettled([currentPromise, historyPromise]);
}

// ★ [개선] GAS getPriceHistory 공유 요청 — 1회만 호출
//   fetchEditorManualPrices / fetchEditorManualHistory 공통 베이스
const _editorHistoryCache = new Map();
const EDITOR_HISTORY_CACHE_MS = 30000;

async function _fetchEditorPriceHistoryRaw(dateStr) {
  try {
    if (!GSHEET_API_URL) return {};
    const targets = [];
    // 편집창에 실제 표시되는 종목만 요청합니다. 이전에는 전체 기초정보 종목을 전송해
    // 펀드·TDF 몇 개를 표시할 때도 불필요한 주식 이력까지 조회했습니다.
    _editorHistoryTargets.forEach(item => {
      if (item.code) targets.push(normalizeStockCode(item.code));
      // 구버전 가격이력에는 가상코드 대신 종목명만 저장된 행이 있으므로 이름도 함께 요청합니다.
      if (item.name) targets.push(item.name);
    });
    const uniqTargets = Array.from(new Set(targets.filter(Boolean)));
    if (uniqTargets.length === 0) return {};
    const cacheKey = `${dateStr}|${uniqTargets.join(',')}`;
    const cached = _editorHistoryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < EDITOR_HISTORY_CACHE_MS) return cached.promise;

    const promise = (async () => {
      const data = await requestGsheetActionJson(
        'getPriceHistory',
        { to: dateStr, codes: uniqTargets.join(',') },
        { timeoutMs: 20000, retry: 0 }
      );
      if (!data) throw new Error('가격이력 네트워크 응답 없음');
      if (data.status !== 'ok' || !data.prices) throw new Error(data.message || '가격이력 응답 오류');
      return data.prices; // { [key]: entries[] } 원본 반환
    })();
    _editorHistoryCache.set(cacheKey, { ts: Date.now(), promise });
    try {
      return await promise;
    } catch (e) {
      // 실패 결과를 30초간 재사용하면 일시 오류가 복구돼도 내역이 계속 비어 보입니다.
      _editorHistoryCache.delete(cacheKey);
      throw e;
    }
  } catch (e) {
    console.warn('[_fetchEditorPriceHistoryRaw]', e.message);
    return {};
  }
}

// ★ [개선] 공유 rawHistory에서 최신 수동입력값 추출 (구 fetchEditorManualPrices 역할)
function _parseEditorManualPrices(rawPrices) {
  const out = {};
  const byLatest = (a, b) => {
    const ak = (a?.savedAt || a?.date || '');
    const bk = (b?.savedAt || b?.date || '');
    return ak.localeCompare(bk);
  };
  Object.entries(rawPrices).forEach(([key, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const manualEntries = entries.filter(e => e && e.price > 0 && e.savedAt).sort(byLatest);
    const latest = manualEntries.length > 0
      ? manualEntries[manualEntries.length - 1]
      : null;
    if (!latest) return;
    out[key] = { price: Math.round(latest.price), savedAt: latest.savedAt || '', date: latest.date || '' };
  });
  return out;
}

// ★ [개선] 공유 rawHistory에서 최근 3건 이력 추출 (구 fetchEditorManualHistory 역할)
function _parseEditorManualHistory(rawPrices) {
  const out = {};
  const byLatest = (a, b) => {
    const ak = (a?.savedAt || a?.date || '');
    const bk = (b?.savedAt || b?.date || '');
    return ak.localeCompare(bk);
  };
  Object.entries(rawPrices).forEach(([key, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const manualOnly = entries
      .filter(e => e && e.price > 0 && e.savedAt)
      .sort(byLatest)
      .slice(-3)
      .map(e => ({
        date: e.date || '',
        price: Math.round(e.price),
        savedAt: e.savedAt || ''
      }));
    if (manualOnly.length > 0) out[key] = manualOnly;
  });
  return out;
}


function _parseEditorGasLastDates(rawPrices) {
  const out = {};
  const byLatest = (a, b) => {
    const ak = (a?.savedAt || a?.date || '');
    const bk = (b?.savedAt || b?.date || '');
    return ak.localeCompare(bk);
  };
  Object.entries(rawPrices || {}).forEach(([key, entries]) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const valid = entries
      .filter(e => e && e.price > 0 && (e.date || e.savedAt))
      .sort(byLatest);
    const latest = valid.length > 0 ? valid[valid.length - 1] : null;
    if (!latest) return;
    out[key] = {
      date: latest.date || '',
      savedAt: latest.savedAt || '',
      price: Math.round(latest.price),
      source: latest.source || ''
    };
  });
  return out;
}

function _formatEditorGasLastLabel(info) {
  if (!info) return '';
  const when = info.savedAt
    ? _compactEditorDateTime(info.savedAt)
    : _compactEditorDate(info.date || '');
  if (!when) return '';
  const price = info.price > 0 ? ` · ${Number(info.price).toLocaleString()}` : '';
  return `GAS ${when}${price}`;
}

function _compactEditorPriceMetaLabel(label) {
  if (!label) return '';
  return String(label)
    .replace(/(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/g, '$2.$3 $4')
    .replace(/(\d{4})[.-](\d{2})[.-](\d{2})/g, '$2.$3');
}

function _compactEditorDateTime(value) {
  const s = String(value || '').replace(/-/g,'.');
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[2]}.${m[3]} ${m[4]}` : _compactEditorDate(s);
}

function _compactEditorDate(value) {
  const s = String(value || '').replace(/-/g,'.');
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[2]}.${m[3]}` : s;
}

// ── 하위 호환: 외부에서 직접 호출하는 경우를 위한 래퍼 유지
async function fetchEditorManualPrices(dateStr) {
  const raw = await _fetchEditorPriceHistoryRaw(dateStr);
  return _parseEditorManualPrices(raw);
}

async function fetchEditorManualHistory(dateStr) {
  const raw = await _fetchEditorPriceHistoryRaw(dateStr);
  return _parseEditorManualHistory(raw);
}

function getCurrentPriceFromData(name) {
  // ★ 코드 키 우선 조회
  const code = getCode(normName(name));
  if (code && savedPrices[code]) return savedPrices[code];
  if(savedPrices[name]) return savedPrices[name];
  // Try to find in rows data
  if(typeof rows === 'undefined') return null;
  for(const r of rows) {
    if(r.name === name && r.price) return r.price;
  }
  return null;
}

function markChanged(name, val) {
  if(val) {
    editedPrices[name] = parseInt(val.replace(/,/g,''));
    const key = name.replace(/\s/g,'_');
    // ★ 카드형 상태 뱃지 업데이트
    const ps = $el('ps_' + key);
    if(ps) {
      ps.textContent = '✎ 미저장';
      ps.style.background = 'rgba(245,158,11,.15)';
      ps.style.color = 'var(--gold)';
      ps.style.border = '1px solid rgba(245,158,11,.3)';
    }
    _resetEditorApplyButton();
  }
}

async function _saveManualPriceWithRetry(target, maxRetry) {
  const retries = Number.isFinite(maxRetry) ? maxRetry : 1;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 접근 토큰이 설정된 브라우저에서는 공통 유틸이 인증 form POST로 전환합니다.
      const d = await requestGsheetActionJson(
        'saveManualPrice',
        { date: target.date, name: target.key, price: target.price },
        { timeoutMs: 30000, retry: 0 }
      );
      if (d && d.status === 'ok') {
        if (d.snapshotWarning) showToast('가격은 저장됐지만 스냅샷 갱신 실패: ' + d.snapshotWarning, 'warn', 8000);
        return { ok: true };
      }
      lastErr = new Error((d && d.message) ? d.message : 'status not ok');
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 700));
  }
  return { ok: false, err: lastErr };
}

async function _syncManualPricesToGsheet(gasSaveTargets, gasDate) {
  let gasFailedCount = 0;
  const gasFailedKeys = [];
  try {
    const batchPayload = gasSaveTargets.map(t => ({ key: t.key, price: t.price }));
    try {
      const d = await requestGsheetFormJson(
        'batchSaveManualPrices',
        { date: gasDate, data: JSON.stringify(batchPayload) },
        { timeoutMs: 60000, retry: 0 }
      );
      if (d && d.status === 'ok') {
        if (d.snapshotWarning) showToast('가격은 저장됐지만 스냅샷 갱신 실패: ' + d.snapshotWarning, 'warn', 8000);
        _editorHistoryCache.clear();
        if (typeof showToast === 'function') showToast(`☁️ GAS 동기화 완료 (${gasSaveTargets.length}건)`, 'ok');
        return;
      }
      console.info('[batchSaveManualPrices] 배치 응답 없음 → 건별 저장으로 전환');
    } catch(fetchErr) {
      console.info('[batchSaveManualPrices] 배치 요청 미완료 → 건별 저장으로 전환');
    }

    for (const target of gasSaveTargets) {
      const r = await _saveManualPriceWithRetry(target, 1);
      if (!r.ok) {
        gasFailedCount++;
        gasFailedKeys.push(target.key);
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch(e) {
    gasFailedCount = gasSaveTargets.length;
    gasFailedKeys.splice(0, gasFailedKeys.length, ...gasSaveTargets.map(t => t.key));
    console.warn('[_syncManualPricesToGsheet] GAS 저장 예외:', e.message);
  }

  if (gasFailedCount > 0 && typeof showToast === 'function') {
    const sample = gasFailedKeys.slice(0, 3).join(', ');
    console.warn(`[_syncManualPricesToGsheet] GAS 저장 최종 실패 ${gasFailedCount}건:`, gasFailedKeys);
    showToast(`⚠️ GAS 저장 실패 ${gasFailedCount}건${sample ? ' (' + sample + (gasFailedKeys.length > 3 ? ' 외' : '') + ')' : ''}`, 'warn');
  } else if (typeof showToast === 'function') {
    _editorHistoryCache.clear();
    showToast(`☁️ GAS 동기화 완료 (${gasSaveTargets.length}건)`, 'ok');
  }
}

async function applyPrices() {
  // ★ 중복 클릭 방지 — 저장 진행 중이면 무시
  if (_applyPricesRunning) {
    showToast('저장 중입니다. 잠시 기다려주세요.', 'warn');
    return;
  }
  if(Object.keys(editedPrices).length === 0) {
    closeEditor(); return;
  }
  _applyPricesRunning = true;
  const now = _kstNow(); // ★ KST 기준 현재 시각
  // ★ editorDate 입력값 우선, 없으면 오늘
  const editorDateRaw = $el('editorDate')?.value; // YYYY-MM-DD
  let dateStr;
  if (editorDateRaw) {
    const [y,m,d] = editorDateRaw.split('-');
    dateStr = `${y}.${m}.${d}`;
  } else {
    dateStr = `${now.getUTCFullYear()}.${String(now.getUTCMonth()+1).padStart(2,'0')}.${String(now.getUTCDate()).padStart(2,'0')}`;
  }
  const timeStr = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  // ★ GAS에 저장할 savedAt — 날짜+시간 (KST 기준)
  const savedAtDisplay = dateStr + ' ' + timeStr + ' 저장';

  const updatedCount = Object.keys(editedPrices).length;
  const gasSaveTargets = []; // GAS 저장 대상 목록

  // 로컬 저장 먼저 처리
  Object.keys(editedPrices).forEach(name => {
    const mappedCode = _editorItemMap[name]?.code || _editorItemMap[normName(name)]?.code || '';
    const code = mappedCode || getCode(normName(name));
    const key = code || name;
    savedPrices[key] = editedPrices[name];
    savedPriceDates[key] = savedAtDisplay;
    if (GSHEET_API_URL) {
      const gasDate = editorDateRaw || `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`; // ★ KST 기준
      gasSaveTargets.push({ name, key, date: gasDate, price: editedPrices[name] });
    }
  });

  // GAS 저장은 백그라운드로 진행합니다.
  // 로컬 저장/화면 반영을 먼저 끝내 기존처럼 빠르게 저장 버튼이 응답하도록 합니다.
  if (gasSaveTargets.length > 0 && GSHEET_API_URL) {
    const gasDate = editorDateRaw || `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}`;
    _syncManualPricesToGsheet(gasSaveTargets, gasDate);
  }

  recomputeRows();
  lastUpdated = dateStr;
  const _lbl = $el('price-updated-label');
  if (_lbl) setStatusLabel(`✅ 업데이트 완료 · <span class="c-gold">${lastUpdated}</span> · ${updatedCount}개 종목 반영`, 'ok');

  const fetchedDate = $el('quickDateInput')?.value || '';
  const todayStr = _kstTodayStr(); // ★ KST 기준 오늘 날짜
  const isToday = fetchedDate === todayStr;
  updateDateBadge(lastUpdated, isToday);

  saveHoldings();

  // ★ 저장 완료 피드백 — 버튼·본문에 표시 후 1.5초 뒤 닫힘
  const applyBtn = $el('pe-panel-price-footer')
                || $el('priceEditor')?.querySelector('.btn-apply-prices');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.innerHTML = `✅ 저장 완료 (${updatedCount}개)`;
    applyBtn.style.background = 'var(--green)';
  }
  const body = $el('editorBody');
  if (body) {
    const done = document.createElement('div');
    done.style.cssText = 'text-align:center;padding:18px 0 8px;font-size:.82rem;color:var(--green-lt);font-weight:600';
    done.innerHTML = `✅ ${updatedCount}개 종목 현재가가 저장되었습니다.<br><span style="font-size:.70rem;color:var(--muted)">${_escapeHtml(dateStr)} ${_escapeHtml(timeStr)} 기준 · GAS 동기화는 백그라운드 진행</span>`;
    body.prepend(done);
  }
  _applyPricesRunning = false;
  setTimeout(() => {
    closeEditor();
    renderView();
    renderSummary();
    if (typeof shouldRenderCharts !== 'function' || shouldRenderCharts(currentView)) renderDonut();
  }, 1500);
}


// ★ [통일] data-editor-price-name 입력 처리는 event_delegation.js의 전역 input 리스너로 통합됨
//   (기존: 이 파일에 별도 document.addEventListener('input', ...)가 있어서
//    event_delegation.js의 콤마 서식 리스너와 매 키 입력마다 동시에 실행 → 타이핑 지연 원인)
