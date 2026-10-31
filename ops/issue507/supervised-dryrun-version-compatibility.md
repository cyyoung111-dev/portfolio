# Issue #507 — 감독형 복구 읽기 전용 진단 버전 계약

## 문제

`scripts/issue507-supervised-repair-dryrun-readonly.mjs`는 현재 운영 v9.281와 검토된 v9.282 `getAutomationStatus` 응답을 **v9.244만 허용하는 조건**으로 거절했습니다. CI는 v9.244 합성 응답으로 통과해 이를 발견하지 못했습니다.

## 안전 범위

- 독립 조회한 **고정 v9.281 원문**(`reference/gas-v9.281.gs`)과 **승인 후보 v9.282 원문**(`src/gas/apps_script.gs`) 모두 `_getAutomationStatusData` / `handleGetAutomationStatus`가 일치하는 gasVersion을 반환하며, `handleDiagnoseSnapshotIntegrityRange`는 `strictReadonly === '1'` 계약을 지원합니다.
- 따라서 명시적 허용목록은 정확히 `9.244`, `9.281`, `9.282`로 제한하고, **응답 최상위 gasVersion과 automation.gasVersion이 같아야** 합니다.
- 목록 조회 전/후 버전이 다르면 같은 데이터 원천의 연속 관측이 아니므로 `QUEUE_CHANGED`로 실패합니다. 보고서의 gasVersion은 실제 응답을 반영하며, 임의의 v9.244로 고정하지 않습니다.
- 9.283 이상 새 버전, 누락 및 엇갈린 gasVersion은 별도 검증 없이는 거부합니다.
- synthetic end-to-end에서 9.281/9.282 각각 인증/5개 요청/읽기 전용 및 0건 금융 변경과 중간 버전 변경 차단을 검증합니다.

**운영 실행은 수행하지 않습니다.** `workflow_dispatch`의 운영 읽기 전용 job은 계속 `main`+manual 및 `portfolio-production-gas` 환경으로 제한됩니다. GAS 생산소스, Apps Script 속성/트리거, 금융 Snapshot 39행 및 F00002 경고, NH·Telegram 전송/토큰 처리 변경 없음.

이 PR 병합은 GAS v9.282 운영 배포나 F00001 금융 원본 쓰기를 허용하지 않습니다. #507
