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
  let lastError = null;
  const startedAt = Date.now();
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs, fetchOptions);
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        error.errorCode = 'SERVER_ERROR';
        throw error;
      }
      try { return await res.json(); }
      catch (error) { error.errorCode = 'INVALID_RESPONSE'; throw error; }
    } catch (error) {
      lastError = error;
      if (i < retry) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  if (o.preserveError) {
    const errorCode = lastError?.name === 'AbortError' ? 'CLIENT_TIMEOUT' : (lastError?.errorCode || 'SERVER_ERROR');
    const reason = errorCode === 'CLIENT_TIMEOUT' ? `요청 timeout (${timeoutMs}ms)` : `${errorCode === 'INVALID_RESPONSE' ? '응답 파싱' : '네트워크/서버'} 오류`;
    return { status: 'error', errorCode, message: reason, elapsedMs: Date.now() - startedAt, action: o.action || '' };
  }
  return null;
}

async function requestGsheetActionJson(action, params, opts) {
  const accessToken = String(lsGet('gsheet_access_token', '') || '').trim();
  if (accessToken) return requestGsheetFormJson(action, params, opts);
  const url = buildGsheetActionUrl(action, params);
  return requestJsonWithPolicy(url, { ...(opts || {}), action });
}

async function requestGsheetFormJson(action, params, opts) {
  const o = opts || {};
  const targetUrl = String(o.targetUrl || GSHEET_API_URL || '').trim();
  if (!targetUrl || !action) return null;
  const form = new URLSearchParams();
  form.set('action', action);
  const accessToken = String(lsGet('gsheet_access_token', '') || '').trim();
  if (accessToken) form.set('accessToken', accessToken);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    form.set(k, String(v));
  });
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    ...(o.fetchOptions || {}),
  };
  return requestJsonWithPolicy(targetUrl, { ...o, action, fetchOptions });
}

function saveGsheetUrl(url) {
  GSHEET_API_URL = url.trim();
  lsSave(GSHEET_KEY, GSHEET_API_URL);
}

function getGsheetAccessToken() {
  return String(lsGet('gsheet_access_token', '') || '').trim();
}

function saveGsheetAccessToken(token) {
  const normalized = String(token || '').trim();
  if (normalized) lsSave('gsheet_access_token', normalized);
  else lsRemove('gsheet_access_token');
  return normalized;
}
