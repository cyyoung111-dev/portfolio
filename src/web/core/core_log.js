// ════════════════════════════════════════════════════════════════
//  core_log.js — 공통 로그 포맷 유틸
// ════════════════════════════════════════════════════════════════

function _logPrefix(scope) {
  return `[${scope || 'APP'}]`;
}

function sanitizeLogValue(value) {
  const token = typeof getGsheetAccessToken === 'function' ? getGsheetAccessToken() : '';
  const gasUrl = typeof GSHEET_API_URL === 'string' ? GSHEET_API_URL : '';
  const redact = text => {
    let safe = String(text || '').replace(/([?&](?:accessToken|token|apiKey|authKey)=)[^&\s]+/gi, '$1[숨김]');
    if (token) safe = safe.split(token).join('[접근 토큰 숨김]');
    if (gasUrl) safe = safe.split(gasUrl).join('[GAS URL 숨김]');
    return safe;
  };
  if (value instanceof Error) return redact(value.message);
  return typeof value === 'string' ? redact(value) : value;
}
function _safeLogArgs(args) { return args.map(sanitizeLogValue); }
function logInfo(scope, ...args) { console.info(_logPrefix(scope), ..._safeLogArgs(args)); }
function logWarn(scope, ...args) { console.warn(_logPrefix(scope), ..._safeLogArgs(args)); }
function logError(scope, ...args) { console.error(_logPrefix(scope), ..._safeLogArgs(args)); }
