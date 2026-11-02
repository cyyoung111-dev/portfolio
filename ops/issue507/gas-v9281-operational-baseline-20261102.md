# 운영 GAS 게시 v9.281 확인 및 v9.282 전환 사전점검

상태: **읽기 전용 감사 결과 확보, 배포·복구·writer gate 상태 확인 미완료**.

## 2026-11-02 21:12 KST 감사 증거

- 실행: https://github.com/cyyoung111-dev/portfolio/actions/runs/41442800080
- 실행 브랜치: `main`, HEAD `62b1c79603c273793621f4d91b97dd51f7a81134`.
- 사전 contract: PASS. Apps Script REST에서 확인한 운영 웹앱 deployment `versionNumber=336`; 게시 소스 `gasVersion=9.281`, Git blob `ebe697563e94cf49e514037353260fce70ae1d57`. GAS 프로젝트 HEAD도 같은 소스.
- 저장소 `src/gas/apps_script.gs`: v9.282, Git blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`.
- 감사 상태: `BLOCKED` (exit 2); 런타임 `getWriterGateStatus` 조회 **0회**, GAS 배포/금융 원본 쓰기/텔레그램 전송 **0건**. v9.281 코드를 안전한 writer gate 지원판으로 오인하지 않는 정상 동작.
- `versionNumber=336`은 Apps Script deployment 개정번호이며 v9.281/9.282 같은 코드 버전 문자열이 아님.
- 프런트엔드 `EXPECTED_GAS_VERSION=9.282`이나 호환 목록에 9.281 포함. 버전 차이만으로 모든 웹 동작이 실패한다는 근거는 없음.

## 본 PR의 제한된 변경

`scripts/audit-published-gas-gate-readonly.mjs`는 **정확한 v9.281 원본 전체 blob**에만 `APPROVED_LEGACY_V9281_NO_GATE_AUDIT` 분류명을 추가하며, `status=BLOCKED`, `releaseAuthorized=false`, `publishedSourceApproved=false`, 런타임 API 호출 0회를 유지한다. 기존 승인 v9.282의 정확한 전체 blob에만 writer gate runtime GET 가능 조건을 유지. v9.283/변조/파일 추가/불명 버전은 전처럼 차단.

`scripts/check-published-gas-gate-readonly.mjs`에 실제 기록과 같은 v9.281 소스, HEAD 드리프트, 런타임 호출 0건 회귀를 추가. **이 PR은 배포 또는 실제 재감사를 실행하지 않음**.

## 다음 운영 순서 — 승인 게이트

1. 이미 확인된 v9.281 baseline을 Issue #860에 보존. 미확인 writer gate OPEN/DRAINING을 추정하지 않음.
2. **완료**: [GAS 수동 dry-run #41446204818](https://github.com/cyyoung111-dev/portfolio/actions/runs/41446204818), `main` SHA `62b1c79603c273793621f4d91b97dd51f7a81134`, `dry_run=true`, `approve_9282=false`, `approve_9283=false`. `validate=success`, `deploy=success`는 dry-run 검증 job의 성공이지 실배포가 아님. GAS 프로젝트 HEAD와 게시 소스 모두 승인 v9.281이며 deployment 개정번호 336 유지. `approved:true`는 소스 해시 승인만 뜻하고 writer gate 활성화나 v9.282 전환 승인이 아님. 로그에 실제 프로젝트·버전·deployment 무변경 명시.
3. 서비스 중단/기존 실행·다중 배포·외부 Sheets writer 격리·Snapshot 원본 백업·v9.282 gate 최초 bootstrap·forward-recovery 계획을 실제 독립 증빙. 특히 v9.281이 기존 writer gate가 없는 배포이므로 신규 gate로 바뀐 뒤 구 v9.281 deployment에 자동 rollback하지 않음.
4. 3단계 추가 확인과 사용자의 **별도 명시적 v9.282 운영 배포 승인**이 있기 전까지 `dry_run=false` 또는 `approve_9282=true` 실행 금지. GAS v9.283 / 06:45 수집 / KRX 거래대금 배포도 금지.
5. 나중에 승인된 운영 배포를 마친 경우에만 `gas-published-gate-readonly-audit` 재실행, 게시 v9.282 전체 소스 SHA·정확한 writer gate 상태·NH/텔레그램/가격·Snapshot 읽기 확인. 이후 금융 복구/원본 수정은 또 다른 독립 승인.

참고: Issue #507, Issue #860, `DEPLOYMENT.md`, `ops/issue507/activation-boundary.md`.

**실행 권한 분리:** read-only 조사 및 코드 병합은 GAS 운영 배포 승인이나 원본 금융 데이터 수정 승인으로 해석하지 않는다.
