// ════════════════════════════════════════════════════════════════
//  settings_tabsync.js — 탭별 수동 재동기화 UI/동작
//  의존: settings.js(공유 상태/저장 함수)
// ════════════════════════════════════════════════════════════════

function _tabSyncText(tabId) {
  const info = TAB_SYNC_STATUS[tabId];
  if (!GSHEET_API_URL) return { text: '재동기화 설정 필요', color: 'var(--muted)' };
  if (!info || !info.ts) return { text: '동기화 기록 없음', color: 'var(--muted)' };
  const t = new Date(info.ts);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const base = `${hh}:${mm}`;
  if (info.state === 'ok') return { text: `✅ 마지막 동기화 ${base}`, color: 'var(--green)' };
  if (info.state === 'syncing') return { text: `⏳ 동기화 중... (${base})`, color: 'var(--amber)' };
  return { text: `⚠️ 마지막 동기화 실패 ${base}`, color: 'var(--red-lt)' };
}

function renderTabSyncPanel(tabId) {
  const st = _tabSyncText(tabId);
  const disabled = !GSHEET_API_URL ? 'disabled' : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:10px">
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:.70rem;font-weight:700;color:var(--text)">🔄 수동 재동기화</div>
      <span id="sync-badge-${tabId}" style="font-size:.68rem;color:${st.color}">${st.text}</span>
    </div>
    <button data-sync-tab="${tabId}" id="sync-btn-${tabId}" class="btn-purple-sm" ${disabled}>🔄 재동기화</button>
  </div>`;
}

function _setTabSyncStatus(tabId, state, msg) {
  TAB_SYNC_STATUS[tabId] = { state, msg: msg || '', ts: Date.now() };
  lsSave(TAB_SYNC_STATUS_KEY, TAB_SYNC_STATUS);
  const badge = $el('sync-badge-' + tabId);
  if (badge) {
    const st = _tabSyncText(tabId);
    badge.textContent = msg || st.text;
    badge.style.color = st.color;
  }
}

async function manualSyncByTab(tabId) {
  if (TAB_SYNC_BUSY[tabId]) return;
  if (!GSHEET_API_URL) {
    _setTabSyncStatus(tabId, 'fail', '⚠️ 재동기화 설정 필요');
    showToast('재동기화 설정 후 사용해주세요', 'warn');
    return;
  }
  TAB_SYNC_BUSY[tabId] = true;
  const btn = $el('sync-btn-' + tabId);
  if (btn) btn.disabled = true;
  _setTabSyncStatus(tabId, 'syncing', '⏳ 동기화 중...');

  let ok = false;
  try {
    if (tabId === 'div') {
      const r1 = await persistDividendSettings(true);
      ok = !!r1;
    } else if (tabId === 'asset') {
      const r1 = await persistRealEstateSettings(true);
      ok = !!r1;
    } else {
      // ★ 기초정보 탭: 로컬 데이터 있으면 로컬→GAS, 없으면 GAS→로컬
      const hasLocalData = EDITABLE_PRICES.length > 0 || rawTrades.length > 0;
      if (hasLocalData) {
        // 로컬 데이터 있음 → GAS에 업로드
        const r0 = await saveSettings(true);
        const r1 = await syncCodesToGsheet();
        await syncHoldingsToGsheet();
        await syncTradesToGsheet();
        ok = !!(r0 || r1);
        if (ok) {
          try { refreshAll(); } catch(e) {}
          try { if (typeof buildStockMgmt  === 'function') buildStockMgmt();  } catch(e) {}
          try { if (typeof buildSectorMgmt === 'function') buildSectorMgmt(); } catch(e) {}
          try { if (typeof buildAcctMgmt   === 'function') buildAcctMgmt();   } catch(e) {}
        }
      } else {
        // 로컬 데이터 없음 (새 기기) → GAS에서 불러오기
        const loaded = await loadSettings();
        if (loaded) {
          try { refreshAll(); } catch(e) {}
          try { if (typeof buildStockMgmt  === 'function') buildStockMgmt();  } catch(e) {}
          try { if (typeof buildSectorMgmt === 'function') buildSectorMgmt(); } catch(e) {}
          try { if (typeof buildAcctMgmt   === 'function') buildAcctMgmt();   } catch(e) {}
          ok = true;
        }
      }
    }
  } catch (e) {
    ok = false;
  } finally {
    TAB_SYNC_BUSY[tabId] = false;
    if (btn) btn.disabled = false;
  }

  if (ok) {
    _setTabSyncStatus(tabId, 'ok');
    showToast('재동기화 완료', 'ok');
  } else {
    _setTabSyncStatus(tabId, 'fail');
    showToast('재동기화 실패', 'error');
  }
}
