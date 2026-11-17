# GAS 9.297 NAV 분리 운영 릴리스 — #734

## 목적
KB F00002 / 한화 F00001 보호된 자동 수집에서, 하나의 GAS 요청이 NAV·가격이력·Snapshot까지 갱신하며 `REJECTED_PARTIAL` 판정을 만들던 결합을 제거한다. `9.297`은 공식 NAV **한 번만** 원본 저장하고, Node 수집기가 정확한 날짜/가격 readback 후 기존 날짜별 평가/스냅샷 refresh를 별도 검증한다. 수동 NAV 업로드와 거래원장 변경 없음.

## 배포가 허용되는 조건
1. [#1348] 차기 GAS 9.297 후보는 v9.296 전체 소스 Blob `e7dfcc8a...`을 정확히 부모로 삼는다. `check-gas9297-release-gate.mjs`가 9.297 전체 소스 해시와 변경 함수 3개만 검증한다. 승인되지 않은 한 글자 변경도 거부한다.
2. 운영 게시 GAS **9.296** 및 V2 거래원장·PC UTF-8 해시 일치를 READ ONLY로 확인한다. `getTrades`, `getWriterGateStatus`, `getAutomationStatus`만 사용하며 금융 쓰기 없이 `activeCount=0`, 대기/복구 0을 입증한다. 재사용 가능한 오래된 증빙은 인정하지 않는다.
3. 모든 웹앱 배포 인벤토리의 전체 소스/버전·routable writer 분리를 입증한다. 불명확한 추가 배포·활성 Writer가 있으면 실배포 중단.
4. **명시적 수동 `workflow_dispatch`만** 허용한다. `candidate_version=9.297`, `dry_run=true`, `approve_9297=false`를 먼저 실행하여 동일한 인벤토리 및 Writer Gate 조건을 확인한다. dry-run에는 GAS content/version/deployment 또는 금융 원본 쓰기 0.
5. dry-run 성공과 재검토 후에만 별도 수동 승인으로 `dry_run=false`, `approve_9297=true` 배포. 정규 schedule/push/PR이 9.297 후보를 배포해서는 안 된다. 이전 소스 복구 경로와 실패 즉시 fail-closed 정책을 유지한다.

## 배포 직후 읽기 검증
- 실제 웹앱 `gasVersion=9.297` 확인; 부트스트랩, Writer Gate, 거래 338건과 같은 고정 건수를 가정하지 않고 현재 원장 개수/원시 해시/PC canonical digest를 대조한다. 거래원장·가격·NAV·Snapshot 자동 보정 금지
- `issue734-gas9297-release-readonly.mjs post`: 새 게시 버전, 활성 writer 0, 대기 0, 실 거래원장/해시 동등성을 확인한다
- KB와 한화 collector가 정확한 공식 NAV 원본을 한 번 저장하고, 이어서 평가/스냅샷을 별도로 완결/읽기 확인했는지는 **다음 실제 정규 수집**에서 따로 검증한다. postflight green만으로 수집 성공을 주장하지 않는다
- `NAV_SOURCE_UNPUBLISHED`는 장애가 아니며, 공식 공시 후 실제 대상일만 평가. 시간제한 회피·무제한 재시도·저장 ACK 미확정 상태에서 재import 금지

## 실패/복구
- Writer 충돌·미검증 저장·배포 읽기 불일치가 나오면 재호출로 덮어쓰지 않는다. 기존 GAS 버전/Deployment readback/rollback 기록 보존
- 원본 NAV가 저장됐지만 파생 갱신이 불완전하면, **읽기 전용**으로 날짜·펀드 코드별 상태를 확인하고 이미 존재하는 보호된 date-scoped refresh 경로만 사용한다
- 사용자가 별도로 거래를 수정하기 전에는 Issue #734 거래원장 338건과 수량·평균단가를 변경하지 않는다
- PC/Android 실제 화면·조회속도·새로고침·PWA 확인은 별도 실기 증빙; UI Pages 성공과 GAS 정상 수집은 독립적으로 판정한다

## 현재 경계
릴리스 준비 PR의 CI/정확한 소스 핀 검증은 **운영 배포 승인이 아니다**. GitHub 커넥터에서 workflow_dispatch 실행 기능이 제공되지 않으면 무단 push, rerun, API 우회로 배포하지 않는다.
