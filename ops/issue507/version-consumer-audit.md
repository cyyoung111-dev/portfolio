# Issue #507 — GAS v9.282 버전 의존성 사전 감사

기준 main: `4a0dc910099a214cef18e213aeeccaaf06720b5c` (PR #785 병합).

현재 운영 코드는 GAS **v9.281**이며 새 **v9.282는 릴리스 프리뷰만** 생성합니다.

Codex 보완: `SUPPORTED_GAS_VERSION = new Set([...])`처럼 `gasVersion` 비교 위치와 멀리 떨어진 버전 허용 목록 및 다중 행 선언도 수집합니다. `scripts/issue507-deferred-source-audit-readonly.mjs`의 생산 허용목록을 필수 회귀로 검사하고, CLI에서 **전체 경로·줄번호·분류·허용목록 이름**을 출력합니다. 서비스 버전과 단일 프론트엔드 설정만 바꿔도 완료되는 구조가 아닙니다. GitHub 코드 검색에서 NAV 수집, Snapshot 백필, NH 지수, 배당, 거래원장 관련 여러 실행 스크립트가 `reply.gasVersion === '9.281'` 계약을 사용하고 있음을 확인했습니다.

## 독립 코드 감사

`node scripts/audit-issue507-version-consumers.mjs`는 로컬 저장소의 `src/web/**/*.js`, `scripts/**/*.{js,mjs,cjs}`에서 `gasVersion`·`EXPECTED_GAS_VERSION`과 결합한 `'9.281'` 사용을 수집합니다. 경로·줄번호·운영지원/웹/테스트 구분만 출력합니다. 현재 승인된 GAS v9.281 전체 소스와 v9.282 리뷰 전용 후보의 상태를 별도로 확인합니다.

사전 식별한 중요한 버전 고정 사용처는 다음과 같습니다.

- 웹 설정 버전: `src/web/features/settings/settings_fetch.js`
- `scripts/collect-kb-fund-nav.mjs`
- `scripts/run-issue507-backlog.mjs`
- `scripts/run-incomplete-close-resume.mjs`
- `scripts/run-historical-checkpoint-reconcile.mjs`
- `scripts/run-dividend-source-refresh.mjs`
- `scripts/nh-index-probe.mjs`
- `scripts/nhplug-gas-held-universe-readonly-bridge.mjs`

위 하나라도 예상 버전 검사 또는 필수 버전 허용 목록에서 9.281 항목이 사라지면 조용히 성공시키지 않고 감사 계약을 다시 검토하도록 CI가 실패합니다. 신규 가상 운영 스크립트를 추가했을 때 누락을 검출하는 합성 변이도 검사합니다.

## 현재 결론 및 적용 경계

- `BLOCKED_LIVE_RELEASE`는 **이번 PR의 정상적인 안전 진단 결과**입니다. 이 검사는 실제 배포가 가능하다는 승인이 아닙니다.
- 향후 실제 v9.282 릴리스 PR은 위 버전 고정 경로 전체, 기타 발견된 운영 지원 스크립트, 웹 기대값, GAS 승인 source blob, 문서와 트리거의 정합성을 묶어 검증해야 합니다.
- **아직 해결되지 않은 선행 위험:** 초기화되지 않은 writer gate가 모든 HTTP/수동/트리거 호출을 차단하는 서비스 중단, 비계측 구버전 배포 및 외부 Sheets writer 접근, 모든 계정/버전 실행 종료의 독립 증빙, 39행 최신 실운영 재검산, 별도 금융 쓰기 승인.
- PR은 감사 스크립트, 합성 검증 및 문서만 변경합니다. `src/gas/apps_script.gs`, 웹 버전, production deployment 설정/해시, Google Properties, 금융 원본, NH 토큰 및 Telegram 전송은 변경하지 않습니다.

실제 운영 통합·금융 원본 복구는 별도 승인이 있어야 합니다.
