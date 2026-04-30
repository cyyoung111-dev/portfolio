// ── views_tradegroup.js
// 종목별 거래내역 그룹 뷰 (renderTradeGroupView)
// tgToggle, goToTradeGroup
// ─────────────────────────────────────────────────────────────

let _tgFilter      = { name: '' };
let _tgFilterTimer = null;
let _tgFilterComposing = false;

function _tgFilterDebounce() {
  if (_tgFilterComposing) return;
  clearTimeout(_tgFilterTimer);
  _tgFilterTimer = setTimeout(() => {
    const area = document.querySelector('[data-view="tradegroup"]') || document.getElementById('main-area');
    if (area) renderTradeGroupView(area);
    else renderView();
    const inp = document.getElementById('tgFilterName');
    if (inp) { const v = inp.value; inp.focus(); inp.setSelectionRange(v.length, v.length); }
  }, 120);
}


function tgFilterCompStart() { _tgFilterComposing = true; }
function tgFilterCompEnd() {
  _tgFilterComposing = false;
  _tgFilterDebounce();
}

function renderTradeGroupView(area) {
  const nameList = [...new Set(rawTrades.map(t => t.name).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'));
  const filtered = _tgFilter.name
    ? nameList.filter(n => n.includes(_tgFilter.name))
    : nameList;

  function calcGroup(name) {
    const trades = rawTrades
      .filter(t => t.name === name)
      .sort((a,b) => (a.date||'').localeCompare(b.date||''));
    let qty = 0, totalCost = 0, realizedPnl = 0, buyCount = 0, sellCount = 0;
    trades.forEach(t => {
      if (t.tradeType === 'buy') {
        qty       += (t.qty || 0);
        totalCost += (t.qty || 0) * (t.price || 0);
        buyCount++;
      } else if (t.tradeType === 'sell') {
        const avgCost = qty > 0 ? totalCost / qty : 0;
        const sellQty = Math.min(t.qty || 0, qty);
        realizedPnl  += (t.price - avgCost) * sellQty;
        totalCost    -= sellQty * avgCost;
        qty          -= sellQty;
        sellCount++;
      }
    });
    const avgCost = qty > 0 ? totalCost / qty : 0;
    const ep      = getEP(name);
    const code    = (ep && ep.code) || '';
    const sector  = (ep && ep.sector) || '기타';
    const type    = getEPType(ep, trades[0]?.assetType || '주식');
    return { trades, qty, avgCost, realizedPnl, buyCount, sellCount, code, sector, type };
  }

  area.innerHTML = `
  <div class="p-0-4">
    <div class="flex-between-mb14">
      <div>
        <h3 class="h3-section">📊 종목별 거래내역</h3>
        <p class="mt-3-muted-72">종목 클릭 → 거래 상세 펼치기</p>
      </div>
      <input id="tgFilterName" placeholder="🔍 종목명 검색" value="${_tgFilter.name}"
        oninput="_tgFilter.name=this.value; _tgFilterDebounce()" oncompositionstart="tgFilterCompStart()" oncompositionend="tgFilterCompEnd()"
        style="background:var(--s2);border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--text);font-size:.75rem;width:150px"/>
    </div>

    ${rawTrades.length === 0 ? `
    <div class="info-box-blue-lg">
      <div class="emoji-lg">📋</div>
      <div class="txt-blue-700">거래 이력이 없어요</div>
      <div class="txt-muted-75">거래 이력 탭에서 먼저 거래를 입력해주세요</div>
    </div>` : filtered.length === 0 ? `
    <div class="empty-msg">검색 결과가 없어요</div>
    ` : `
    <div class="flex-col-gap8">
      ${filtered.map(name => {
        const g         = calcGroup(name);
        const isHolding = g.qty > 0;
        const pnlColor  = g.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)';
        const pnlSign   = g.realizedPnl >= 0 ? '+' : '';
        // ★ 현재단가/평가금액/매입금액 계산
        const ep         = getEP(name);
        const epCode     = (ep && ep.code) || '';
        const curPrice   = savedPrices[epCode] || savedPrices[name] || null;
        const evalAmt    = curPrice != null ? curPrice * g.qty : null;
        const costAmt    = g.avgCost * g.qty;
        return `
        <div class="tg-group" style="background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <!-- 종목 요약 헤더 (클릭으로 토글) -->
          <div onclick="tgToggle(this)" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none">
            <span style="font-size:.65rem;color:var(--muted);transform:rotate(0deg);transition:transform .2s;display:inline-block" class="tg-arrow">▶</span>
            <div style="flex:1;min-width:0">
              <div class="flex-ac-g8-wrap">
                <span class="tg-name" style="font-weight:700;font-size:.85rem">${name}</span>
                ${g.code ? `<span style="display:block;font-size:.65rem;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:1px">${g.code}</span>` : ''}
                <span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:var(--c-purple2-10);color:var(--purple-lt)">${g.type}</span>
                <span style="font-size:.65rem;padding:2px 6px;border-radius:4px;background:var(--c-muted-10);color:var(--muted)">${g.sector}</span>
                ${isHolding
                  ? `<span style="font-size:.65rem;padding:2px 7px;border-radius:10px;background:rgba(74,222,128,.12);color:var(--green-lt);font-weight:600">보유중 ${g.qty.toLocaleString()}주</span>`
                  : `<span style="font-size:.65rem;padding:2px 7px;border-radius:10px;background:var(--c-muted-10);color:var(--muted)">청산완료</span>`}
              </div>
              <div style="display:flex;gap:14px;margin-top:4px;font-size:.70rem;color:var(--muted);flex-wrap:wrap">
                <span>매수 <b class="c-text">${g.buyCount}</b>건</span>
                <span>매도 <b class="c-text">${g.sellCount}</b>건</span>
                ${isHolding ? `<span>주식수 <b class="c-text">${g.qty.toLocaleString()}</b></span>` : ''}
                ${isHolding ? `<span>매입단가 <b class="c-text">${Math.round(g.avgCost).toLocaleString()}</b></span>` : ''}
                ${isHolding ? `<span>매입금액 <b class="c-text">${Math.round(costAmt).toLocaleString()}</b></span>` : ''}
                ${isHolding && curPrice != null ? `<span>현재단가 <b style="color:var(--cyan)">${curPrice.toLocaleString()}</b></span>` : ''}
                ${isHolding && evalAmt != null ? `<span>평가금액 <b style="color:var(--cyan)">${Math.round(evalAmt).toLocaleString()}</b></span>` : ''}
                ${g.sellCount > 0 ? `<span>실현손익 <b style="color:${pnlColor}">${pnlSign}${Math.round(g.realizedPnl).toLocaleString()}</b></span>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-shrink:0" onclick="event.stopPropagation()">
              <span style="font-size:.70rem;color:var(--muted);white-space:nowrap;margin-right:4px">${g.trades.length}건</span>
              <button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'buy')" title="매수 추가" class="btn-buy-sm">＋ 매수</button>
              <button data-bname="${name}" onclick="tgAuditStock(this.dataset.bname)" title="계좌/거래 대조" class="btn-edit-sm">🧪 검증</button>
              ${isHolding ? `<button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'sell')" title="매도 추가" class="btn-sell-sm">－ 매도</button>` : ''}
            </div>
          </div>

          <!-- 거래 상세 테이블 (기본 숨김) -->
          <div class="tg-detail" style="display:none;border-top:1px solid var(--border);overflow-x:auto">
            <div style="padding:8px 12px 0;text-align:right;font-size:.65rem;color:var(--muted)">(단위:원)</div>
            <table style="width:100%;border-collapse:collapse;font-size:.72rem;min-width:400px">
              <thead>
                <tr style="background:var(--s2);border-bottom:1px solid var(--border)">
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">날짜</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:center">구분</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">계좌</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">수량</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">단가</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">금액</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:right">손익</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:left">메모</th>
                  <th style="padding:8px 12px;font-size:.68rem;font-weight:600;color:var(--muted);text-align:center">수정</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  let runQty = 0, runCost = 0;
                  return g.trades.map(t => {
                    const isBuy  = t.tradeType === 'buy';
                    const isSell = t.tradeType === 'sell';
                    const price  = t.price || 0;
                    const qty    = t.qty   || 0;
                    const amount = price * qty;
                    let pnlCell  = '';
                    if (isBuy) {
                      runQty  += qty;
                      runCost += qty * price;
                    } else if (isSell) {
                      const avg = runQty > 0 ? runCost / runQty : 0;
                      const pnl = (price - avg) * Math.min(qty, runQty);
                      const pct = avg > 0 ? ((price - avg) / avg * 100) : 0;
                      const pc  = pnl >= 0 ? 'var(--green)' : 'var(--red)';
                      const ps  = pnl >= 0 ? '+' : '';
                      pnlCell   = `<div style="color:${pc};font-weight:600">${ps}${Math.round(pnl).toLocaleString()}</div>
                                   <div style="font-size:.65rem;color:${pc}">${ps}${pct.toFixed(1)}%</div>`;
                      runCost  -= Math.min(qty, runQty) * avg;
                      runQty   -= Math.min(qty, runQty);
                    }
                    return `<tr style="border-bottom:1px solid var(--border);background:${isSell?'rgba(239,68,68,.03)':'transparent'}">
                      <td style="padding:7px 12px;text-align:center;color:var(--muted);white-space:nowrap;font-size:.72rem">${fmtDateDot(t.date)||'⚠️없음'}</td>
                      <td style="padding:7px 12px;text-align:center">
                        ${isSell ? `<span class="trade-badge-sell">📉 매도</span>` : `<span class="trade-badge-hold">📈 매수</span>`}
                      </td>
                      <td style="padding:7px 12px;text-align:center;white-space:nowrap;font-size:.72rem">
                        <span class="adot" style="background:${ACCT_COLORS[t.acct]||'var(--muted)'}"></span>${t.acct}
                      </td>
                      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;font-size:.78rem">${qty.toLocaleString()}</td>
                      <td style="padding:7px 12px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:.78rem;color:${isSell?'var(--red-lt)':'var(--green-lt)'}">
                        ${price.toLocaleString()}
                      </td>
                      <td style="padding:7px 12px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:.78rem">${amount.toLocaleString()}</td>
                      <td style="padding:7px 12px;text-align:right">
                        ${pnlCell || '<span style="color:var(--muted)">-</span>'}
                      </td>
                      <td style="padding:7px 12px;text-align:left;color:var(--muted);font-size:.70rem">${t.memo||''}</td>
                      <td style="padding:7px 12px;text-align:center">
                        <button onclick="editTrade('${t.id}')" class="btn-edit-sm">✏️</button>
                      </td>
                    </tr>`;
                  }).join('');
                })()}
              </tbody>
            </table>
            <!-- 이 종목 거래 추가 버튼 -->
            <div style="display:flex;gap:8px;padding:9px 12px;border-top:1px solid var(--border);background:var(--s2)">
              <button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'buy')" class="btn-buy-lg">📈 매수 추가</button>
              ${isHolding ? `<button data-bname="${name}" onclick="openAddTrade({name:this.dataset.bname},'sell')" class="btn-sell-lg">📉 매도 추가</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>`;
}

function tgToggle(header) {
  const group  = header.closest('.tg-group');
  const detail = group.querySelector('.tg-detail');
  const arrow  = header.querySelector('.tg-arrow');
  const open   = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
}

// 거래이력 탭 → 종목명 클릭 시 종목별 거래 뷰로 이동 + 해당 종목 자동 펼치기
function goToTradeGroup(name) {
  _tgFilter.name = name;
  switchView('tradegroup');
  requestAnimationFrame(() => {
    document.querySelectorAll('.tg-group').forEach(g => {
      const title = g.querySelector('.tg-name');
      if (title && title.textContent.trim() === name) {
        const detail = g.querySelector('.tg-detail');
        const arrow  = g.querySelector('.tg-arrow');
        if (detail && detail.style.display === 'none') {
          detail.style.display = 'block';
          if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
      }
    });
  });
}


function tgAuditStock(name) {
  const target = String(name || '').trim();
  if (!target) return;

  const byAcctTrades = {};
  rawTrades
    .filter(t => (t.name || '').trim() === target)
    .forEach(t => {
      const acct = t.acct || '(미지정)';
      const row = byAcctTrades[acct] || (byAcctTrades[acct] = { buyQty: 0, sellQty: 0, netQty: 0, buyAmt: 0 });
      const q = Number(t.qty || 0);
      const p = Number(t.price || 0);
      if (t.tradeType === 'buy') {
        row.buyQty += q;
        row.buyAmt += q * p;
        row.netQty += q;
      } else if (t.tradeType === 'sell') {
        row.sellQty += q;
        row.netQty -= q;
      }
    });

  const byAcctHoldings = {};
  rawHoldings
    .filter(h => (h.name || '').trim() === target)
    .forEach(h => {
      byAcctHoldings[h.acct || '(미지정)'] = Number(h.qty || 0);
    });

  const accts = Array.from(new Set([...Object.keys(byAcctTrades), ...Object.keys(byAcctHoldings)])).sort((a,b)=>a.localeCompare(b,'ko'));
  const lines = accts.map(acct => {
    const t = byAcctTrades[acct] || { buyQty: 0, sellQty: 0, netQty: 0, buyAmt: 0 };
    const hQty = byAcctHoldings[acct] || 0;
    const diff = Math.round((hQty - t.netQty) * 10000) / 10000;
    return `${acct} | 매수 ${t.buyQty.toLocaleString()} / 매도 ${t.sellQty.toLocaleString()} / 순수량 ${t.netQty.toLocaleString()} | 보유 ${hQty.toLocaleString()} | 차이 ${diff.toLocaleString()}`;
  });

  const msg = [`[${target}] 계좌별 대조`, ...lines, '', '※ 차이가 0이 아니면 해당 계좌 거래 내역 점검 필요'].join('\n');
  alert(msg);
}
