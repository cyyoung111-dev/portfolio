// 공용 DOM/Storage 유틸
const $el = id => document.getElementById(id);

// GS 연동 시 핵심 데이터는 로컬스토리지 대신 GSheet를 단일 소스로 사용
const REMOTE_ONLY_KEYS = new Set([
  'pf_v6_acct_colors', 'pf_v6_acct_order', 'pf_v6_sector_colors',
  'pf_v6_loan', 'pf_v6_realestate', 'pf_v6_loan_schedule', 'pf_v6_re_value_hist',
  'pf_v6_funddirect', 'pf_v6_divdata', 'pf_v6_holdings', 'pf_v6_stockcodes',
  'pf_v6_editables', 'pf_v6_trades'
]);

function _isRemoteOnlyKey(key) {
  if (!key) return false;
  if (!REMOTE_ONLY_KEYS.has(key)) return false;
  try {
    return !!localStorage.getItem('gsheet_api_url');
  } catch (e) {
    return false;
  }
}

const lsSave   = (key, val) => {
  if (_isRemoteOnlyKey(key)) return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
};
const lsGet    = (key, def) => {
  if (_isRemoteOnlyKey(key)) return def;
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) : def; } catch(e) { return def; }
};
const lsRemove = (key) => {
  if (_isRemoteOnlyKey(key)) return;
  try { localStorage.removeItem(key); } catch(e) {}
};
