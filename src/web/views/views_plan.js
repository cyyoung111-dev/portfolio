// ════════════════════════════════════════════════════════════════
//  views_plan.js — 투자 계획 탭
//  목표비중 관리 · 매수여력 계산기 · 세금 시뮬레이터 · 자산 시뮬레이터
//  의존: data.js, portfolio_service.js, core_ui.js, core_color.js
// ════════════════════════════════════════════════════════════════

// ── 상태
const PLAN_KEY = 'pf_plan_settings';
function _planNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function _formatPlanTableMoney(value) {
  const amount = Math.round(Number(value) || 0);
  if (amount === 0) return { compact: '0원', full: '0원' };
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  let compact;
  if (abs >= 100000000) {
    const eok = Math.floor(abs / 100000000);
    const man = Math.round((abs % 100000000) / 10000);
    compact = `${sign}${eok.toLocaleString()}억${man ? ` ${man.toLocaleString()}만` : ''}원`;
  } else if (abs >= 10000) {
    compact = `${sign}${Math.round(abs / 10000).toLocaleString()}만원`;
  } else compact = `${amount.toLocaleString()}원`;
  return { compact, full: `${amount.toLocaleString()}원` };
}

let _planSettings = (function() {
  try {
    const s = lsGet(PLAN_KEY, {});
    return {
      cash:          _planNumber(s.cash, 0),         // 현재 보유 현금 (원)
      // ★ [한국 세제 반영] ISA 비과세 유형: general(일반형 200만) | special(서민형/농어민 400만)
      isaExemptType: s.isaExemptType || 'general',
      // ★ [정확한 배당 추적] 세금 계산 귀속연도 (기본값: 올해)
      taxYear:       s.taxYear       || null,
      isaJoinDate: s.isaJoinDate || '', isaMaturityDate: s.isaMaturityDate || '',
      isaContributionLimit: _planNumber(s.isaContributionLimit, 0),
      isaContributionUsed: _planNumber(s.isaContributionUsed, 0),
      simMonthly:    _planNumber(s.simMonthly, 500000),     // 월 추가 투자금
      simYears:      _planNumber(s.simYears, 10),            // 시뮬레이션 기간 (년)
      simReturn:     _planNumber(s.simReturn, 7),            // 연 수익률 가정 %
      retireMonthlyExpense: _planNumber(s.retireMonthlyExpense, 3000000), // 은퇴 후 월 생활비 목표
      retireYears:          _planNumber(s.retireYears, 30),                // 은퇴자금 지속 기간(참고)
      retireReturn:         _planNumber(s.retireReturn, 4),                // 목표 도달 연 수익률 가정 %
      retirePostReturn:     _planNumber(s.retirePostReturn, 3),
      retireInflation:      _planNumber(s.retireInflation, 2),
      retireCurrentAge:     _planNumber(s.retireCurrentAge, 40),
      retireTargetAge:      _planNumber(s.retireTargetAge, 60),
      retireExtraExpense:   _planNumber(s.retireExtraExpense, 0),
      retireOtherIncome:    _planNumber(s.retireOtherIncome, 0),
      retireLoanMode:       s.retireLoanMode === 'payoff' ? 'payoff' : 'maintain',
      retireWithdrawalRate: _planNumber(s.retireWithdrawalRate, 4),        // 안전 인출률 %
      pensionStartAge: s.pensionStartAge === undefined ? null : _planNumber(s.pensionStartAge, null),
      annualPensionWithdrawal: s.annualPensionWithdrawal === undefined ? null : _planNumber(s.annualPensionWithdrawal, null),
      pensionWithdrawalYears: s.pensionWithdrawalYears === undefined ? null : _planNumber(s.pensionWithdrawalYears, null),
      pensionReturnRate: s.pensionReturnRate === undefined ? null : _planNumber(s.pensionReturnRate, null),
      pensionTaxRate: s.pensionTaxRate === undefined ? null : _planNumber(s.pensionTaxRate, null),
    };
  } catch(e) { return { cash:0, isaExemptType:'general', simMonthly:500000, simYears:10, simReturn:7, retireMonthlyExpense:3000000, retireYears:30, retireReturn:4, retireWithdrawalRate:4 }; }
})();

function _savePlanSettings() {
  lsSave(PLAN_KEY, _planSettings);
}

// ── 메인 렌더
function renderPlanView(area) {
  const totalEval = rows.reduce((sum, row) => sum + (row.evalAmt || 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + (row.costAmt || 0), 0);
  const tabs = [
    ['overview','현황'], ['buy','매수계획'], ['tax','세금'], ['retirement','은퇴'], ['simulation','시뮬레이션'], ['export','내보내기'],
  ];
  const hashTab = location.hash.match(/^#plan-(overview|buy|tax|retirement|simulation|export)$/)?.[1];
  const activeTab = hashTab || area._activePlanTab || 'overview';
  const panel = (id, html) => `<section class="plan-tab-panel${id===activeTab?' is-active':''}" data-plan-panel="${id}"${id===activeTab?'':' hidden'}>${html}</section>`;
  const viewHtml = `<div data-view-section="plan" class="plan-view">
    <nav class="plan-subtabs" aria-label="투자계획 하위 탭" role="tablist">
      ${tabs.map(([id,label]) => `<button type="button" role="tab" data-plan-tab="${id}" aria-selected="${id===activeTab}" class="plan-subtab${id===activeTab?' is-active':''}">${label}</button>`).join('')}
    </nav>
    ${panel('overview', _buildPlanCashflowOverview())}
    ${panel('buy', _buildWeightSection(totalEval) + _buildBuyingPowerSection(totalEval))}
    ${panel('tax', _buildTaxSection(totalCost))}
    ${panel('retirement', _buildRetirementSection(totalEval))}
    ${panel('simulation', _buildSimSection(totalEval))}
    ${panel('export', _buildExportSection(totalEval, totalCost))}
  </div>`;
  const template = document.createElement('template');
  template.innerHTML = viewHtml.trim();
  area.replaceChildren(template.content);
  area._activePlanTab = activeTab;
  _bindPlanEvents(area, totalEval, totalCost);
}

function _activatePlanTab(area, tab) {
  if (!['overview','buy','tax','retirement','simulation','export'].includes(tab)) return;
  area._activePlanTab = tab;
  area.querySelectorAll('[data-plan-tab]').forEach(button => {
    const active = button.dataset.planTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  area.querySelectorAll('[data-plan-panel]').forEach(panel => {
    const active = panel.dataset.planPanel === tab;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  history.replaceState(null, '', `#plan-${tab}`);
}


// ════════════════════════════════════
// ⓪ 엑셀 내보내기
// ════════════════════════════════════

// 기능별 렌더러는 views_plan_*.js에서 로드됩니다. 계산식은 plan_calculations.js에만 유지합니다.

function _bindPlanEvents(area, totalEval, totalCost) {
  // ★ [통일] number-comma 서식은 event_delegation.js 전역 리스너로 통합됨 (로컬 중복 제거)

  // ★ [정확한 배당 추적] 귀속연도 변경 시 재계산
  area.querySelector('#plan-tax-year')?.addEventListener('change', function() {
    _planSettings.taxYear = parseInt(this.value, 10) || null;
    _savePlanSettings();
    renderView(true);
  });

  if (area._planClickHandler) area.removeEventListener('click', area._planClickHandler);
  area._planClickHandler = function(e) {
    const tab = e.target.closest('[data-plan-tab]')?.dataset?.planTab;
    if (tab) { _activatePlanTab(area, tab); return; }
    const action = e.target.closest('[data-plan-action]')?.dataset?.planAction;
    // ★ [한국 세제 반영] ISA 비과세 유형 선택
    const isaType = e.target.closest('[data-plan-isa-type]')?.dataset?.planIsaType;

    if (isaType) {
      _planSettings.isaExemptType = isaType;
      _savePlanSettings();
      renderView(true);
      return;
    }

    if (action === 'export-excel') {
      exportPortfolioExcel();
      return;
    }

    if (action === 'open-dividend') {
      switchView('div');
      return;
    }

    if (action === 'open-property') {
      switchView('asset');
      return;
    }

    if (action === 'save-weights') {
      const inputs = [...area.querySelectorAll('[data-plan-weight]')];
      const targetTotal = inputs.reduce((sum, inp) => sum + Math.max(0, parseFloat(inp.value) || 0), 0);
      if (targetTotal > 100.000001) {
        showToast('목표 비중 합계가 100%를 초과하여 저장할 수 없습니다', 'error', 5000);
        return;
      }
      inputs.forEach(inp => {
        const name = inp.dataset.planWeight;
        const ep   = getEP(name);
        if (ep) ep.targetWeight = parseFloat(inp.value) || 0;
      });
      // ★ saveHoldings: localStorage 저장 + GAS syncCodes/Holdings/Trades
      saveHoldings();
      // ★ saveSettings도 호출 — GSheet 연동 모드에서 EDITABLE_PRICES(targetWeight 포함)를 GAS에 저장
      // REMOTE_ONLY_KEYS로 인해 lsSave(EDITABLES_KEY)가 차단되는 경우를 대비
      if (typeof saveSettings === 'function') saveSettings(true);
      showToast('목표 비중 저장 완료', 'ok');
      renderView(true);
    }

    if (action === 'calc-buying-power') {
      const raw = ($el('plan-cash-input')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.cash = parseInt(raw) || 0;
      _savePlanSettings();
      renderView(true);
    }

    if (action === 'save-foreign-tax') {
      _planSettings.foreignTaxAdjustment = _planNumber(($el('foreign-tax-adjustment')?.value || '').replace(/,/g, ''), 0);
      _savePlanSettings();
      renderView(true);
      return;
    }

    if (action === 'save-isa-settings') {
      _planSettings.isaJoinDate = $el('isa-join-date')?.value || '';
      _planSettings.isaMaturityDate = $el('isa-maturity-date')?.value || '';
      _planSettings.isaContributionLimit = _planNumber(($el('isa-contribution-limit')?.value || '').replace(/,/g, ''), 0);
      _planSettings.isaContributionUsed = _planNumber(($el('isa-contribution-used')?.value || '').replace(/,/g, ''), 0);
      _savePlanSettings();
      showToast('ISA 정보 저장 완료', 'ok');
      renderView(true);
      return;
    }

    if (action === 'save-retirement') {
      const rawExpense = ($el('retire-monthly-expense')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.retireMonthlyExpense = _planNumber(parseInt(rawExpense, 10), 0);
      _planSettings.retireWithdrawalRate = _planNumber(parseFloat($el('retire-withdrawal-rate')?.value || '4'), 4);
      _planSettings.retireYears          = _planNumber(parseInt($el('retire-years')?.value || '30', 10), 30);
      _planSettings.retireReturn         = _planNumber(parseFloat($el('retire-return')?.value || '4'), 4);
      _planSettings.retireCurrentAge     = _planNumber($el('retire-current-age')?.value, 40);
      _planSettings.retireTargetAge      = _planNumber($el('retire-target-age')?.value, 60);
      _planSettings.retireInflation      = _planNumber($el('retire-inflation')?.value, 2);
      _planSettings.retirePostReturn     = _planNumber($el('retire-post-return')?.value, 3);
      _planSettings.retireExtraExpense   = _planNumber(($el('retire-extra-expense')?.value || '').replace(/,/g, ''), 0);
      _planSettings.retireOtherIncome    = _planNumber(($el('retire-other-income')?.value || '').replace(/,/g, ''), 0);
      _planSettings.retireLoanMode       = $el('retire-loan-mode')?.value === 'payoff' ? 'payoff' : 'maintain';
      const optionalNumber = id => { const value = $el(id)?.value?.replace?.(/,/g, '').trim(); return value ? _planNumber(value, null) : null; };
      _planSettings.pensionStartAge = optionalNumber('pension-start-age');
      _planSettings.annualPensionWithdrawal = optionalNumber('pension-annual-withdrawal');
      _planSettings.pensionWithdrawalYears = optionalNumber('pension-withdrawal-years');
      _planSettings.pensionReturnRate = optionalNumber('pension-return-rate');
      _planSettings.pensionTaxRate = optionalNumber('pension-tax-rate');
      _savePlanSettings();
      showToast('은퇴 포트폴리오 기준 저장 완료', 'ok');
      renderView(true);
      return;
    }

    if (action === 'run-sim') {
      const raw     = ($el('sim-monthly')?.value || '').replace(/[^0-9]/g, '');
      _planSettings.simMonthly = _planNumber(parseInt(raw, 10), 0);
      _planSettings.simYears   = _planNumber(parseInt($el('sim-years')?.value || '10', 10), 10);
      _planSettings.simReturn  = _planNumber(parseFloat($el('sim-rate')?.value || '7'), 7);
      _savePlanSettings();
      renderView(true);
    }
  };
  area.addEventListener('click', area._planClickHandler);
}
