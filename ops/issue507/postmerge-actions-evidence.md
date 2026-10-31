# Issue #507 — PR #787/#788 병합 후 Actions 운영 이력 독립 감사

## 배경

- PR #787 `main` 병합: `c2298b9ad69b806cffd8eb4ba0115ac10098858a`
- PR #788 `main` 병합: `7a46531e6a27927389f576b78243d0c44ebedcc4`
- v9.282 운영 GAS 배포와 금융 원본 쓰기는 별도 승인 대상.
- GitHub 연결 API로는 `push` / `workflow_run` 실행을 SHA별 조회할 수 없어, 병합 성공/PR CI만으로 **실제 운영 배포 여부는 미확인**.

## 새 읽기 전용 증빙

`.github/workflows/issue507-postmerge-actions-readonly.yml`은 PR 또는 수동 실행 시 `GITHUB_TOKEN`에 **actions:read / contents:read** 권한만 부여합니다. 배포 환경·GAS 토큰·Google 인증·Sheets/NH/Telegram 비밀값은 주입하지 않습니다.

`scripts/audit-issue507-postmerge-actions.mjs`는 GitHub의 **GET** API만 사용합니다.

1. merge commit 2건의 실제 `commit.committer.date` 취득, 더 이른 병합 시점에서 10분 앞선 시각부터 현재까지 조사.
2. `quality-check.yml`의 push 실행을 merge SHA별로 조회하고, `gas-deploy.yml`의 모든 실행을 시간창에 따라 전수 조회(최대 1,000개 실행/워크플로; 초과하면 불완전으로 판단).
3. 각 GAS 실행의 `deploy` 잡·`Deploy GAS` 단계 상태를 **`jobs?filter=all`로 모든 rerun attempt에 걸쳐** 확인. 최초 attempt의 배포 후 재실행이 skipped되어도 첫 배포를 누락하지 않음. attempt 목록 불연속이나 조회 누락은 `UNVERIFIED`로 판정. `pull_request` 검증 실행은 실제 배포 여부 집계에서 제외하고 제외 건수 별도 기록. `skipped`를 실행 성공과 절대 혼동하지 않음.
4. GitHub 이력 목록이 완전하고 해당 병합의 push-run이 모두 발견되며 모든 GAS 운영 deploy 잡이 `skipped`인 경우에만 `NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS`로 판정.
5. `Deploy GAS` 단계 성공은 실제 GAS 변경의 독립 증거가 아니므로 `DEPLOY_STEP_SUCCESS_REQUIRES_SOURCE_READBACK`으로 분류. 실패·취소·진행 중·API 오류·미확인 실행은 성공 처리하지 않음.

합성 회귀는 완료·실행·실패·취소·진행 중·누락·API 차단을 각기 검사하며 권한 상승이나 실데이터 쓰기를 수행하지 않습니다.

감사 스크립트는 상태가 불명확하더라도 **JSON 기록까지 성공하면 실행 성공**으로 표시하고 `status=DEPLOY_ATTEMPT_OR_GAP_UNVERIFIED` 등 명시적 경고를 출력합니다. 실제 현황 확인 실패는 `NO_GAS_DEPLOY_JOB_EXECUTED`로 절대 변환하지 않습니다. API 차단/응답 누락으로 증빙 자체가 불가능한 경우 워크플로가 실패합니다.

**해석 범위:** `NO_GAS_DEPLOY_JOB_EXECUTED_IN_SCOPED_ACTIONS`는 GitHub `gas-deploy.yml` 워크플로의 조사 기간 내 실행 결과에 한합니다. 다른 GAS 배포 경로, 직접 Apps Script 편집, 이미 게시된 GAS 버전, 실제 서비스/원장 상태까지 증명하지 않습니다. 해당 작업은 별도 운영 읽기 전용 검증이 필요합니다.

이 PR은 감사 도구만 추가합니다. 운영 GAS v9.281/후보 9.282, 웹, 555 writer gates, Snapshot 39행, F00002 경고, NH·Telegram 코드를 변경하지 않습니다. **병합·운영 배포·금융 원본 쓰기는 승인 범위 밖**입니다.

## 2026-10-31 KST 실제 확인된 병합 후 Actions 증빙

- PR #787 병합 `c2298b9`: `quality-check` push run **#41155500378** 성공. 후속 `gas-deploy` workflow_run **#41155538236**에서 `validate` 성공, `deploy` 실패. deploy 잡 **#124401586554** 원문 로그는 사전 read-only GAS source 상태 **HEAD v9.281 / published v9.281 / dataWrites 0**을 기록한 뒤 `Deploy GAS` 단계에서 **`GAS_9282_EXPLICIT_MANUAL_RELEASE_REQUIRED`**으로 중단. 해당 실행의 v9.282 운영 publish는 승인 검사 이전에 차단됨.
- PR #788 병합 `7a46531`: `quality-check` push run **#41156323956** 성공. 후속 `gas-deploy` workflow_run **#41156380907**는 `validate` 성공, **`deploy` skipped**. 새 `manual_only` 조건이 실제로 자동 배포 잡을 생략한 증거.
- 위 결과는 해당 GitHub Actions 기록에 한하며, 그 이후 직접 GAS 편집/다른 배포 파이프라인/사용자 실행 및 현재 운영 엔드포인트 버전을 **독립적으로 확인한 것이 아닙니다**.
