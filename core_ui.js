// 필터 버튼 클래스 헬퍼
function _fBtnClass(active) { return active ? 'f-btn active' : 'f-btn'; }

// 토스트 알림 헬퍼 (alert 대체)
// type: 'ok' | 'error' | 'warn' | 'info'
function showToast(msg, type='info', duration=3200) {
  const container = $el('toast-container');
  if (!container) { alert(msg); return; }
  const icons = {ok:'✅', error:'❌', warn:'⚠️', info:'💡'};
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    t.addEventListener('animationend', () => t.remove(), {once:true});
  }, duration);
}
