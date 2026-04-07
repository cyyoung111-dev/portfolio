// ════════════════════════════════════════════════════════════════
//  core_log.js — 공통 로그 포맷 유틸
// ════════════════════════════════════════════════════════════════

function _logPrefix(scope) {
  return `[${scope || 'APP'}]`;
}

function logInfo(scope, ...args) {
  console.info(_logPrefix(scope), ...args);
}

function logWarn(scope, ...args) {
  console.warn(_logPrefix(scope), ...args);
}

function logError(scope, ...args) {
  console.error(_logPrefix(scope), ...args);
}
