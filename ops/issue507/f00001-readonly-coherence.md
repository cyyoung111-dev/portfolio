# Issue #507 — F00001 2026-10-30 운영 읽기 전용 일관성 검증

## 목적
기존 `issue-507-fund-snapshot-evidence-readonly.yml`의 실제 2026-10-31 07:43 KST 증빙에서는 Snapshot 39행, F00001 평가/출처 차이, F00002 입력 대기 경고가 확인됐습니다. 그러나 그 보고는 GAS 버전과 원천이 진단 중 변하지 않았음을 독립적으로 입증하지 못하며, 과거 성공을 현재 복구 허가로 볼 수 없습니다.

## 신규 안전조건
- `getAutomationStatus` / `diagnoseSnapshotIntegrityRange(dates=2026-10-30, strictReadonly=1)`을 원래 5개 읽기 요청의 **시작과 끝**에 각각 실행합니다.
- 인증된 GAS 응답은 검토된 버전 `9.281`, `9.282`로만 제한하며, top-level `gasVersion`과 `automation.gasVersion` 일치를 요구합니다. 운영 버전 미확인·미지원이면 진단을 중단합니다.
- strict digest(64자 SHA-256 형식), source revision, 단일 날짜 진단 응답을 모두 요구하고 실행 전후 일치하지 않으면 **결과를 게시하지 않습니다**. digest와 revision의 실제 값, 투자 코드별 금액·수량·금융 원본은 출력하지 않습니다.
- 결과에는 `gasVersionVerified`, `sourceStableWithinRun=true`, `liveWriteAuthorized=false`만 추가하고 기존 F00001/F00002 진단·39행 확인 로직을 보존합니다.
- 버전 변경, digest 변경, revision 변경, source proof 누락을 합성 회귀로 차단합니다.

## 실제 운영 진단 실행 경계
1. GitHub [Actions: issue-507-fund-snapshot-evidence-readonly](https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue-507-fund-snapshot-evidence-readonly.yml)에서 **main**을 선택하고 `Run workflow`로 수동 실행합니다. 기존 읽기 전용 워크플로 자체는 변경하지 않습니다.
2. `portfolio-production-gas` 환경의 별도 승인 및 환경 변수/토큰 보관 정책은 그대로 유지합니다. 출처를 검증하지 못하면 진행하지 않습니다.
3. 실행 로그에서 `gasVersionVerified`, `sourceStableWithinRun`, `expectedRows/storedRows=39`, `scopedRepairReview`, F00002 `NAV_MISSING`를 확인합니다. `reviewOnlyCandidate`는 금융 쓰기 승인과 다릅니다.
4. 실제 운영 GAS v9.282 배포, 외부 writer/트리거 종료 및 quiescence, 최신 native 백업·readback, F00001 한 행 G:K 금융 원본 쓰기는 모두 **별도 승인**이 필요합니다.

이 문서는 수동 실행을 설명할 뿐 GitHub 배포·워크플로 발동·금융 데이터 수정을 수행하지 않습니다.
