// ════════════════════════════════════════════════════════════════
//  views_history_legacy_guard.js — 히스토리 뷰 레거시 전역 호환 가드
// ════════════════════════════════════════════════════════════════

// 과거 버전에서 참조하던 전역 방어 (캐시된 스크립트 혼재 시 ReferenceError 방지)
if (typeof window.realEstatePnl === 'undefined') window.realEstatePnl = 0;
var realEstatePnl = window.realEstatePnl || 0;

// mode 전역은 더 이상 사용하지 않음 (히스토리 상태는 _histState로 관리)
