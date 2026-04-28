// ════════════════════════════════════════════════════════════════
//  settings_net.js — 설정 네트워크 유틸
//  의존: settings.js(상단 공용 상태), core_storage.js
// ════════════════════════════════════════════════════════════════

// AbortSignal.timeout 미지원 브라우저 대응
function fetchWithTimeout(url, ms, options) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(tid));
}

function buildGsheetActionUrl(action, params) {
  if (!GSHEET_API_URL || !action) return '';
  const q = new URLSearchParams();
  q.set('action', action);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    q.set(k, String(v));
  });
  return `${GSHEET_API_URL}?${q.toString()}`;
}

async function requestJsonWithPolicy(url, opts) {
  if (!url) return null;
  const o = opts || {};
  const timeoutMs = Number.isFinite(o.timeoutMs) ? Math.max(1000, o.timeoutMs) : 15000;
  const retry = Number.isFinite(o.retry) ? Math.max(0, o.retry) : 0;
  const delayMs = Number.isFinite(o.delayMs) ? Math.max(0, o.delayMs) : 180;
  const fetchOptions = o.fetchOptions || {};
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs, fetchOptions);
      return await res.json();
    } catch (_) {
      if (i < retry) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function requestGsheetActionJson(action, params, opts) {
  const url = buildGsheetActionUrl(action, params);
  return requestJsonWithPolicy(url, opts);
}

function saveGsheetUrl(url) {
  GSHEET_API_URL = url.trim();
  lsSave(GSHEET_KEY, GSHEET_API_URL);
}
