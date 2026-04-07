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

function saveGsheetUrl(url) {
  GSHEET_API_URL = url.trim();
  lsSave(GSHEET_KEY, GSHEET_API_URL);
}
