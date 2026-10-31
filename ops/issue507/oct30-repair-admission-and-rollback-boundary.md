# Issue #507 — 2026-10-30 국내 37종목 복구 승인·백업·동시실행 barrier (소스 전용)

## 운영 현실 및 발견한 중요한 차단 조건

- 2026-10-30 KRX 공식 정확일은 37/37(주식16/ETF21), 실제 시트에서는 국내 가격이력 0/37·스냅샷 39행 중 국내 37 전일이월, NAV 펀드 2 정상. 개별 37개 가격의 비공개 실조회/원본 보정은 **아직 미실행**.
- 생산 GAS blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`의 실제 `_issue507AssertDrain_`은 최소 420초 연속 차단, 운영 rollout 증빙의 시간 순서 및 활성 실행 0을 확인하지만 반환값이 **`writeAuthorized:false`**입니다.
- 더 중요하게 **실제 `_issue507GateEnter_`는 `mode !== 'OPEN'`에서 `GATE_MAINTENANCE`를 던집니다.** 따라서 모든 writer를 DRAINING으로 만든 뒤 기존 호출로 37종목만 수정하는 것은 불가능합니다. 임의로 OPEN으로 돌리면 다른 writer도 열려 동시수정 안전성이 무너집니다. 이는 현재 실제 복구가 막힌 구조적 이유 중 하나이지, 37개 KRX 가격 원천 장애라는 뜻은 아닙니다.
- 신규 scoped 복구는 독립적인 승인된 GAS 특례와 기존 **555개 writer admission/fence**의 경합 차단, 실행 소유자만 접근할 수 있는 별도 보호된 route/승인 토큰이 필요합니다. 현 PR에는 그러한 특례 구현이 없으며 `writeAuthorized:false`로 고정합니다.
- `_backupSheetBeforeWrite`는 원본 `_sheetContentSignature`(수식 포함)와 백업 서명을 관리하지만 `_backupSnapshotBeforeWrite`는 Snapshot만을 위한 별칭입니다. 과거 날짜 국내 37종가 보정은 **가격이력과 Snapshot 2개 시트를 수정**하므로 각 시트에 동일한 작업 ID로 별도의 실제 복제본과 검증된 복원 절차가 필요합니다. 한쪽 백업만으로 성공 주장 금지.
- 기존 `batchUpsertPriceHistory` 및 `_writeSnapshotDateScoped_`는 자체 CAS/readback과 부분 실패 보상 경로가 있지만, 서로 다른 2개 시트에 대한 **통합 원자 트랜잭션 보증은 별도 증빙되지 않았습니다.** 가격이력 일부 저장 후 GAS timeout 등에서 Snapshot 보정이 이루어지지 않을 수 있고, 롤백 가능성도 미검증입니다.

## 이번 PR의 비작동형 평가

- `scripts/issue507-oct30-repair-admission-audit.mjs`: 실제 작업 승인·개별 KRX 37가격 보호된 코드 일치 증빙·운영 버전/시간대·420초 gate/legacy 종료·ScriptLock/외부 writer 배제·가격이력+스냅샷 2개의 복제본/서명/복원 리허설·독립 scoped gate 승인을 7개 범주로 분리한 읽기 전용 체크리스트 함수입니다. 출력을 `writeAuthorized=false`/ `deployAuthorized=false`로 고정합니다. 모든 가상 조건이 충족되어도 `CHECKLIST_COMPLETE_NOT_EXECUTABLE`일 뿐, 실제 GAS/원본 쓰기 권한을 부여하지 않습니다.
- `simulateOct30PlannedRecovery`: 보호된 two-sheet sequence를 수동 승인을 전제로 **합성** 모의합니다. 사전 백업 → 가격이력 → Snapshot → 사후 39행/39행 readback이라는 순서를 벗어나면 중단합니다. PRICE 성공 후 SNAPSHOT 오류/timeout/응답 불명 또는 readback 실패는 `INCIDENT_PARTIAL_UNKNOWN`으로 분류하고 자동 재시도·완료 마커를 금지하며 **운영자의 원본 복원/재검산이 필요**하다고 표시합니다. 실제 코드의 자동 rollback은 구현/검증하지 않았습니다.
- `scripts/check-issue507-oct30-repair-admission-audit.mjs`: 동결된 운영 GAS의 `_issue507GateEnter_`와 `_issue507AssertDrain_`을 실제 VM 실행하여 DRAINING의 승인 불가와 gate 차단 및 420초·active writer 조건을 검증합니다. 생산 `_backupSheetBeforeWrite`/원본 서명/두 writer의 존재와 CAS 계약을 대조하고, 합성 정상/승인 누락/백업 서명·기한 누락/동시 실행/부분 실패를 시험합니다. 네트워크/실원본 쓰기/GAS 배포/NH 토큰 발급 모두 0.
- `source`·`backups`·`operator`에 입력한 boolean 등은 *받은 확인서를 검사하는 형태*이지 실운영에서 그 확인서를 발급하거나 진위를 독립 검증하는 기능은 아닙니다. synthetic complete 증거를 운영 승인으로 해석 금지.

## 실제 운영 복구 전 필요 절차

1. PR #798(선택 평가 계획)과 #799(사후 검산기)를 각각 사용자 승인 후 최신 main + CI 통합·Codex 리뷰까지 완료합니다. 이 PR도 별도 병합 승인 필요.
2. 보호된 GAS에서 개별 KRX 37종목의 거래일·코드·가격·출처를 **외부 출력 없이** 같은 실행 내 검증합니다. 실제 시트 물리 39행과 2개 정상 NAV·가격이력·거래원장/좌수/원가의 실시간 unchanged 증빙을 확보합니다.
3. 별도 사용자 승인된 릴리스 후보에 scoped 승인/운영 소유권/555 writer gate/legacy 및 Sheets API 외부 writer 배제, 두 시트의 동일 run ID 백업·수식 포함 원본 서명·복원 리허설과 CAS 기반 보정 로직을 구현합니다. 원본 변경 전에는 유지보수 창과 중단/롤백 조건을 승인받습니다.
4. 별도 운영 GAS 배포 및 **금융 원본 쓰기**에 대한 명시적 사용자 승인을 받고, 승인된 실행에서만 37건 가격이력 추가와 국내 37행 G:K 변경, 펀드 2행 A:L·과거 자료 원형 보존을 수행합니다.
5. 완료 처리는 사후 39행/가격이력 39행뿐 아니라 backup signatures, 다른 날짜·두 시트의 사전/사후 보존 증빙, CAS/lock/gate/legacy 격리, 부분 실패/rollback 결과까지 모두 확인한 이후 별도 승인 단계에서만 허용합니다.

**이번 PR은 승인 전 병합·실운영 배포·금융 원본 쓰기·토큰 발급/Telegram 전송을 하지 않습니다.**
