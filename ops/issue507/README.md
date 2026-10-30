# F00001 2026-10-30 단건 복구 준비

기준 main `ebe305b9789933e716c14c8cd0548f33b2b8cef8`, Issue #507, PR #781.
읽기 전용 실행 #41139760521(2026-10-31 07:43 KST)은 39행, F00001 평가 차이,
F00002 NAV_MISSING 및 입력대기 출처 경고를 확인했다. 이 과거 결과는 실행 시 승인 근거를 대체하지 않는다.

`f00001-snapshot-repair.gs`는 **미설치 유지보수 모듈**이다. 현재 `apps_script.gs`,
배포 승인 해시/버전, HTTP·메뉴·트리거는 변경하지 않는다. 병합으로 운영 실행되지 않는다.
운영 버전은 이번 작업에서 별도 조회하지 않았다. 실제 금융 원본 쓰기·백업 생성·GAS 배포는 실행하지 않았다.

운영 통합 후보·실행 종료 증빙·Process API 대안은 [runtime-integration.md](runtime-integration.md)를 따른다.
이제 기존 수기 확인서만으로 실행할 수 없고 통합 runtime gate의 drain 증명도 필수다.

## 승인 후 별도 적용 절차

1. 이 모듈의 운영 통합 및 별도 릴리스(버전/승인해시 포함)를 검토한다. 현재 배포기는 추가 SERVER_JS 파일을 거부하므로 무단 업로드하지 않는다.
2. **전체 앱의 HTTP 요청(특히 refreshFundValuations), 메뉴·트리거 신규 진입을 차단하고, 기존 모든 실행이 종료됐음을 실행 이력으로 독립 확인한다.** 수동 refresh는 외부 NAV 조회 동안 lease/stage가 없으므로 빈 lease 또는 ScriptLock 획득을 실행 종료 증거로 쓰지 않는다. 외부 Sheets API·수동 시트 편집을 포함한 비협조 writer도 운영자가 중지/접근 차단한다. ScriptLock은 다른 프로젝트/API의 쓰기를 막지 못하므로 이것은 실제 적용의 필수 전제다. 이 전제를 확인할 수 없다면 적용하지 않는다.
3. 위 차단을 유지한 채 운영자가 `issue507_f00001_quiescence_v1`에 JSON 확인서(`httpIngressBlocked`, `menuAndTriggersBlocked`, `inFlightExecutionsDrained`, `externalWritersBlocked` 모두 true, `observedAt`은 실제 확인 epoch milliseconds)를 별도로 기록한다. 모듈은 5분 이내의 확인서만 받고 없거나 만료되면 dry-run부터 차단한다. **확인서는 운영자 증언이며 모듈 자체의 진입 차단/실행 API 감사 기능이 아니다. 현재 운영은 이 절차를 수행하지 않았으므로 실행 자격이 없다.** 이후 `issue507F00001SnapshotRepair_(false)`로 잠금 안에서 최신 전체 39행 및 원천을 재검산한다. 금융값·코드·원문 오류·approvalBinding은 공개 로그/PR에 게시하지 않는다.
4. 사용자에게 그 최신 차이와 보존 범위를 제시하고 **금융 원본 쓰기 별도 승인**을 받는다. 운영자가 승인된 binding만 Script Property `issue507_f00001_approval_v1`에 설정한다. 외부 writer 차단 확인도 동일 binding으로 `issue507_f00001_external_writers_excluded_v1`에 별도 설정해야 한다. 이는 운영자의 차단 확인이며 API 권한 차단을 대신하지 않는다. 모듈 스스로 이 두 값을 설정하지 않는다.
5. `issue507F00001SnapshotRepair_(true)`는 최신 binding을 대조하고, 전체 native 백업 생성·readback, 원본/원천 재확인 후 승인값을 소비한다. F00001 기존 한 행 G:K(평가단가/평가액/손익/수익률/출처)만 쓴다.
6. 전체 Snapshot readback으로 나머지 38행·다른 날짜·확장 열 보존을 확인하고 생산 진단으로 재검산한다. F00002 경고는 그대로 남으므로 전체 상태를 VALID로 바꾸거나 완료/큐를 지우지 않는다.

전체 ScriptLock + 펀드/백필 lease(만료 포함), 마감 PRICE/FUND, 미검증 원장,
소급 재계산 pending 차단을 사용한다. 잠금 동안 앱 writer의 신규 획득은 차단되며,
lease/stage가 있는 기존 producer를 거부하고, lease 없는 수동 refresh는 전체 진입 차단·기존 실행 종료 확인서로 별도 배제한다. 이 절차를 자동화해 입증할 수 있는 운영 통합 전에는 실제 실행하지 않는다. 오래된 표식은 이 경로에서 해제하지 않는다.
Snapshot 수식은 지원하지 않고 쓰기 전에 차단한다. 가격·NAV·좌수·거래원장·환율은 읽기만 한다.

실패/시간초과/응답 유실 시 백업을 삭제하지 않는다. 자동 rollback은 다른 writer 값을 덮을 수 있어 수행하지 않는다.
쓰기 직전 승인을 소비하므로 부분 실패의 무조건 재실행도 금지된다. 백업과 최신 원본을 별도 읽기 전용 대조 후 새 복구를 승인한다.
성공해도 전용 백업은 유지한다. source revision만 갱신하고 F00002 경고/운영 오류/대기열은 보존한다.

검사: `node scripts/check-issue507-f00001-scoped-repair.mjs`.
생산 `diagnoseSnapshotIntegrity`를 실행하고 합성 계산 원천/시트로 불변조건을 검증한다.
실제 운영 재검산·백업/복구 성공과 합성 검사를 혼동하지 않는다.
