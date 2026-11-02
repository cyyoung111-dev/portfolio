# NH 야간선물 06:45 수집 — GAS v9.283 릴리스 후보 (검토 전용)

기준: 2026-11-02 KST. 관련 [Issue #826](https://github.com/cyyoung111-dev/portfolio/issues/826), [PR #836](https://github.com/cyyoung111-dev/portfolio/pull/836).

## 목적과 순서

NH PLUG의 **06:00 기준값**을 06:45 KST에 수집하고 07:40 장전 브리핑을 유지합니다. 단순 GitHub cron만 수정하면 현재 중앙 GAS의 `handleGetNhNightProxy`와 `_nhProxyNightReference_`가 07:30 이전 호출을 거부하므로 운영할 수 없습니다.

이번 PR의 `scripts/prepare-nh-0645-gas-release-9283.mjs`는 현재 승인된 **v9.282 전체 GAS 원문을 검증한 다음 메모리에서만** 다음 v9.283 후보를 생성합니다.

1. 조회시간 조건 2개만 시작 07:30 → 06:45로 변경. 종료 08:00 유지
2. GAS 헤더 및 `gasVersion` 응답 9개, `ISSUE507_GATE_API_VERSION`만 v9.283으로 갱신
3. 기존 writer gate releaseId, 555개 진입점 보호, F00001 복구·Snapshot·이력·NH 인증/캐시 정책은 유지
4. `vm`에서 실제 GAS 함수로 06:44 거절, 06:45 허용, 07:40 캐시 사용 및 08:00 거절 검증. **실 NH 조회가 아니라 합성 응답 사용**

## 안전한 실제 적용 선행조건

- v9.282가 실제 GAS에 **운영 배포되어 있는지** 먼저 읽기 전용으로 확인. 준비 소스가 v9.282라는 이유만으로 현재 배포본이 v9.282라고 간주하지 않습니다.
- v9.283의 전체 소스 고정 해시·릴리스 매니페스트·웹/API/운영 소비자 버전 및 정식 배포 허용목록을 별도 릴리스 PR에서 일관되게 갱신하고 독립 리뷰/전체 CI를 통과해야 합니다.
- writer gate releaseId 및 rollback safety, GAS `portfolio-production-gas` 환경 승인·deployment ID·HTTP 실제 버전 확인, 프로덕션 소스 드리프트 검증이 필수입니다.
- v9.282 이전 무계측 배포나 금지된 초기 writer gate 활성화 상태에서는 **무인 forward/rollback을 시작하지 않습니다**.
- **운영 GAS가 06:45 요청을 허용한다는 실증 후**에만 #836의 조기 캡처 cron과 Artifact·07:38 감사 변경을 병합할 수 있습니다.
- 운영 점검은 06:45~07:35 KST NH 수집/Artifact와 07:40 Telegram `SENT`을 각각 검증해야 합니다. GitHub 예약 실행 지연/누락 리스크는 남습니다.

**본 후보는 v9.283의 정식 릴리스·배포 또는 금융 원본 수정 승인이 아닙니다.** 현재 `src/gas/apps_script.gs`, 웹 버전, 배포 키/토큰, 텔레그램 및 PR #836의 운영 일정은 그대로입니다.
