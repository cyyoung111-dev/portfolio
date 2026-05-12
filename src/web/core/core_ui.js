// 필터 버튼 클래스 헬퍼
function _fBtnClass(active) { return active ? 'f-btn active' : 'f-btn'; }

function _escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 토스트 알림 헬퍼 (alert 대체)
// type: 'ok' | 'error' | 'warn' | 'info'
function showToast(msg, type='info', duration=3200) {
  const container = $el('toast-container');
  if (!container) { alert(msg); return; }
  const icons = {ok:'✅', error:'❌', warn:'⚠️', info:'💡'};
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = icons[type] || 'ℹ️';

  const message = document.createElement('span');
  message.className = 'toast-msg';
  message.textContent = String(msg ?? '');

  t.append(icon, message);
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), {once:true});
  }, duration);
}


// 날짜 표시 포맷 통일: YYYY.MM.DD
function fmtDateDot(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})[.-](\d{2})[.-](\d{2})(.*)$/);
  if (!m) return raw;
  return `${m[1]}.${m[2]}.${m[3]}${m[4] || ''}`;
}
