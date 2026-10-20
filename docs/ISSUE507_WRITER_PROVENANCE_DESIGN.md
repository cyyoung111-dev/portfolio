# Issue #507 — Snapshot Writer 출처·지문 추적 설계

**상태: 설계 승인 이전, 운영 미적용.** 이 문서만으로 원본 시트/백업/큐/GAS를 변경하지 않는다. 과거 Writer 원인을 확정하거나 복원 승인 근거로 삼지 않는다.

**2026-10-21 소스 정합성 주석:** 과거 감사 실행은 운영 GAS v9.244였지만, GitHub `main` 소스는 PR #589→#591→#592→#594→#595→#596 병합 후 **v9.250**이다(merge HEAD `f7a8f130`). `main` 병합이 운영 GAS 버전 변경이나 23일 Snapshot 복구를 의미하지 않는다. PR #598(v9.251 가격이력 배치 Writer 후보)은 리뷰/CI 통과 상태지만 아직 미병합이며 운영 미배포. 아래의 기존 full-sheet Writer 분석과 과거 동시성 재현은 **v9.244 이전 경로에 대한 사고 원인·안전 게이트 근거**로 유지하며, 이를 main v9.250 현재 코드라고 간주하지 않는다.

## 1. 운영 증거와 추적 한계

- 2026-01-07~01-23 기준 거래원장 기대 561 date-code 중 수량·취득원가 일치 377, 저장행 누락 79, 존재하나 불일치 105, 원장 밖 51. 불일치 105건(12개 종목)은 모두 현재 Snapshot 수량·원가가 현행 원장 재생값보다 크다.
- 두 10/19 복구 전 백업에도 문제 105건 중 100건의 같은 수량·원가 쌍이 기록되어 있다. 이 사실은 백업 당시 거래원장이 현재와 동일했다는 증거는 아니다.
- 17일 Snapshot 물리 560행 중 저장일시 값은 3행에만 존재한다. 누락된 과거 작성시각/실행자를 사후 역산하여 확정하지 않는다.
- 10/19 복구 전 백업은 UNREGISTERED, 10/20 15:07 백업은 WRITE_FAILED(자체 서명 true). 백업 자체의 서명은 생성 당시 원본/원장 범위의 정확성을 증명하지 않는다. 자동 전체복원·삭제 불가.

## 2. 생산 경로 영향 분석 (운영 감사 v9.244와 현재 main v9.250 구분)

| 함수·경로 | 현재 계약 | 후속 계측 경계 |
|---|---|---|
| _tradeLedgerContentFingerprint_ | 거래원장 전체 11열·물리행 순서 SHA-256 | 현재 원장 버전 지문. 과거 Writer 실행 지문은 저장돼 있지 않음 |
| _detectExternalTradeLedgerChanges_ | 지문 이중읽기 및 이전 digest 비교, 변경 시 대기열/revision 갱신 | 단일 감지 시점의 변화만 증명, 원인 Writer 아님 |
| _applyHoldingTrade / _calcCodeHoldingsAtDate / _buildHoldingsByRequestedDate | 거래일 이하 원장 재생·코드 정규화 | #586의 생산함수 날짜 경계 테스트로 보호. 과거 Writer 버전 동일 보증은 아님 |
| writeSnapshotRows | **운영 감사 v9.244**: 전체행 rewrite/append 가능. **main v9.250**: PR #589 이후 대상 날짜·변경 범위 한정 Writer로 변경(동일셀 외부 API 경쟁 미해결) | 공통 Writer 계측 후보. 과거 full rewrite 진단은 역사적 경로, 현행 date-scoped no-op/최초 생성/append/부분 커밋을 별도 검증 |
| _backupSheetBeforeWrite / _markSnapshotBackupStatus / _settleSnapshotBackupOperation | backup sourceSignature와 backup signature 및 작업 상태 | backup operationId와 개별 write traceId는 별개. WRITE_FAILED 재사용 금지 |
| runPendingTradeSnapshotRebuild | Lock, DATE_DISCOVERY, 큐, phase-only last checkpoint | RUNNING/COMPLETED 상태만으로 특정 date-code 저장 실물 증빙 안 됨 |
| saveDailyPriceHistory / _rebuildDailySnapshotsLocked / handleRewriteSnapshotDate / 수동·NAV·backfill 호출자 | 서로 다른 작업 ID·검증·백업 정책 | callerKind을 검증된 allowlist로 전달하거나 UNKNOWN_CALLER로 남겨야 함 |

열린 PR #577은 DATE_DISCOVERY 성능 검증, PR #586은 원장 replay 검증. **이 PR은 문서 1개만 추가**하여 두 PR의 GAS·스크립트·workflow·package.json을 수정하지 않는다.

## 3. Writer provenance 최소 스키마

실제 구현 시 내부 ScriptProperties에 **최근 해결 완료 이력의 bounded ring**(예: 16~32건)과 **미해결 사건용 durable journal**을 구분한다. `PREPARED`, `COMMIT_UNVERIFIED`, `SOURCE_CHANGED`, `TIMEOUT_SUSPECTED` 같은 미해결 항목은 처리 전 ring에서 자동 퇴출할 수 없다. 미해결 journal은 별도 제한 크기·전체 Property 용량 상한을 검사하며, **용량 부족 시 이후 신규 원본 쓰기를 fail closed**한다. 미해결 이력을 성공 이력으로 덮어 덮어쓰거나 증거 손실 후 성공으로 보고하지 않는다. 인증된 상태 API와 CI 로그에는 민감정보 없는 상태·날짜·집계만 노출한다. raw 계좌/코드/종목명/보유액/단가/원본행/토큰/요청 URL/예외 메시지는 저장·출력 금지.

| 필드 | 용도 |
|---|---|
| schemaVersion / traceId / operationId / writerKind | 고유 실행 trace와 기존 operation ID 별도 연결. writerKind은 허용목록 |
| asOfDate / startedAt / endedAt | 대상일(KST)과 실제 이벤트 시각 |
| ledgerDigestAtBuild / ledgerDigestBefore / ledgerDigestAfter | **행 계산과 연결된** 원장 지문, 잠금 내 writer 진입/종료 fingerprint(비공개 저장). 행 계산 시점 증명이 없으면 완료 인증 불가 |
| integrityRevisionBefore / After | 마이그레이션·쓰기 없는 strict-read 사용 |
| snapshotSourceDigestAtRead / AtBackup / PreCommit / PostCommit / signatureScope | **대상일뿐 아니라 다른 날짜까지 포함하는 원본 전체시트** 관찰값을 단계별 비교. 백업 sourceSignature의 정확한 시점·범위 기록, DATE_EXPECTED/DATE_VERIFIED와 FULL_SOURCE_VERIFIED 구분 |
| backupReferenceState | REGISTERED_VERIFIED / SOURCE_ABSENT_NOT_APPLICABLE / UNKNOWN / FAILED. 원본 시트 최초 생성은 부재를 잠금 내 확인한 경우에만 별도 적용 |
| state / writeAttempted / persistVerified / sourceStable | PREPARED / NO_OP / COMPLETED / FAILED / SOURCE_CHANGED / COMMIT_UNVERIFIED / TIMEOUT_SUSPECTED |
| blockedReasonClass | 안전하게 승인된 열거형 분류(민감 문자열 불가) |

전체 Sheet signature(약 1만 행)를 write 전후 **매번 중복 계산하면** GAS 6분 한도/쿼터 위험이 있다. 이미 백업 생성 단계에서 얻은 서명을 재사용하고, 이후 대상 날짜에 대한 검산과 full-sheet hash를 구별한다. expected-row signature는 저장 실물 검증을 대체하지 못한다.

## 4. 실제 writer에 통합할 상태 전이

1. **행 생성 전부터** 기존 ScriptLock이 유효한지 확인하고 원장 digest를 기록하여 그 데이터로 기대행을 생성한다. 호출자가 lock 밖에서 행을 미리 만들었다면 `ledgerDigestAtBuild`를 함께 전달하고 writer 진입 시 digest와 **같은지 반드시 비교**한다. 외부 Sheets API 변경은 GAS ScriptLock으로 막을 수 없으므로, 계산 중 원장 전후 digest까지 일치해야 하며 불확실하면 해당 행을 writer에서 다시 계산하거나 **원본 변경 전 차단**한다. 단지 Writer 진입/종료 fingerprint가 같다고 구버전 원장으로 만든 행을 인증하지 않는다. 경합/시간제한 임박/원천부족/보호 충돌도 원본 쓰기 전 중단한다.
2. no-op은 writeAttempted=false와 NO_OP로 종료, 정상 Writer 쓰기 통계에 포함하지 않는다.
3. 실제 쓰기가 예정된 때만 PREPARED 메타 기록. 이미 존재하는 Snapshot 원본의 변경이라면 기존 백업의 sourceSignature·registry 상태와 복원 범위를 검증한다. provenance 메타 저장 실패나 **필수 백업** 실패 시 원본 변경 전 fail closed. **최초 시트 생성**은 잠금 내 `getSheetByName`가 null임을 확인하고 `SOURCE_ABSENT_NOT_APPLICABLE`로 기록한다. 이 분기에는 복사 대상 원본이 없으므로 백업을 강제하지 않되, 시트가 동시에 새로 생겼거나 부재 판정이 불안정하면 차단한다. 최초 생성은 검증된 expected 전체 키집합·행수·저장 성공/실패 시 잔여 신규 시트 처리 기준까지 검사해야 하며, `UNKNOWN/FAILED` 백업을 성공으로 간주하는 예외가 아니다.
4. **과거 v9.244 full rewrite는 다른 날짜도 다시 썼으므로 별도 고위험 분기**이다. 원본 전체를 읽어 `combined`를 만들 당시의 full-source digest를 기록하고, 쓰기 직전 원본/백업의 생성시각 및 sourceSignature와 다시 비교한다. 다른 날짜의 값·수식·행수가 바뀌었거나 digest가 다르거나 검증 예산이 부족하면 **원본 변경 전에 차단·재계산**한다. 출처가 다른 쓰기는 자체 Writer ScriptLock 밖에서 발생하므로 검사→실제 `setValues` 사이의 race는 사후 검사만으로 증명되지 않는다. 외부 direct Sheets Writer 배제/일시정지를 증명할 수 없는 운영에서 full rewrite를 절대적 `sourceStable=true`/`COMPLETED`로 인증하지 말고, 외부 Writer 통제·선행 합의 또는 최소범위 date-scoped update 설계를 우선 검토한다. append, 최초 시트 생성, full rewrite 각각 별도 검사하되 기존 원장/가격/NAV/MANUAL 보호 규칙을 변경하지 않는다.
5. SpreadsheetApp.flush 후 저장 데이터/대상일 읽기 검산, 원장 fingerprint 재취득. digest 변동/읽기검산 실패 시 COMPLETED를 기록하지 않고 COMMIT_UNVERIFIED 또는 SOURCE_CHANGED로 표기. **이미 쓰기가 수행됐을 때 무작정 다시 쓰거나 자동 롤백하지 않는다.**
6. 모든 판정 완료 및 저장 실물 확인 후에만 COMPLETED, persistVerified=true. 상태 기록 실패 후 PREPARED 또는 COMMIT_UNVERIFIED가 남으면 별도 **미해결 journal**에 보존하고, 정상 ring 기록이 많아져도 자동 퇴출하지 않는다. 후속 read-only 검증 후 명시적 해결 시각/근거/결과를 남기며, journal이 꽉 차거나 저장이 불가능하면 다음 신규 writer를 **원본 변경 전 차단**한다.
7. 재시도마다 새로운 traceId를 부여하되 이전 COMMIT_UNVERIFIED/타임아웃 기록을 그대로 보존한다. `SOURCE_ABSENT_NOT_APPLICABLE`의 최초 생성 실패 후 재시도는 존재 여부·잔여 행/헤더를 재진단해 **기존 시트 업데이트 분기**로 전환하거나 차단한다. queue/lease가 예고 없이 사라지면 성공 대신 미검증 경보를 낸다.

### 반드시 별도로 증명할 항목

- ScriptLock은 GAS 내 동시 접근 보호일 뿐 외부 Sheets API 쓰기를 완전히 배제하지 않는다. **원장 및 Snapshot 원본** 모두 별도 경합 위험이 있다. Snapshot 원본의 읽기·백업·commit 전후에 타 날짜 외부 수정을 주입하는 synthetic race 테스트로, 원본 덮어쓰기 또는 허위 COMPLETED가 발생하는 기존 구조를 재현하고 차단 조건을 정한다. full-sheet 시그니처 추가 계산은 GAS 실행한도와 상충하므로 실제 시간·셀 쿼터를 따로 측정해야 한다. begin/end digest 같음만으로 과거 원장 불변이나 외부 동시쓰기 배제가 증명되지 않는다.
- 출처 계측이 저장돼도 과거 105건 Writer 원인이나 수정자를 **소급 확정할 수 없다**.
- 중앙 writeSnapshotRows 호출만으로 외부 Google Sheets 직접 수정이나 가격/NAV/FX 별도 Writer의 결과를 증명하지 못한다.
- 2025-12-31 가격/NAV/FX 이월은 2026-01-01의 검증된 해당 값이 없을 때만 검토한다. 2026-01-01 수량·취득원가는 1월 1일 이하 원장 거래로만 계산한다.

## 5. 구현·출시 순서

**단계 A — synthetic 계약:** 정상, no-op, 최초 생성(SOURCE_ABSENT_NOT_APPLICABLE), append, full rewrite, 오류/부분실패, lock 충돌, **행 계산 후 외부 원장 변경(기존 writer 진입 전후 지문은 같은 상태)**, **Snapshot full-sheet 읽기와 실제 setValues 사이 다른 날짜 외부 변경 주입**, 재시도, 타임아웃, 미해결 journal 포화/퇴출 방지, 2025→2026 날짜 경계, 저장용량 한도 테스트. 재현한 현행 취약점은 합격으로 꾸미지 말고 반드시 별도 차단 구현의 red→green 증거로 기록한다. 실제 GAS 함수 실행, 독립 오라클, 삭제 변이 시 실패 테스트를 갖춘다. 신규 check 스크립트는 반드시 package.json check:ci 경로에 등록한다.

**단계 B — Writer 통합 PR:** GAS 수정 시 헤더/변경이력, 모든 gasVersion 응답(handleGetSettings 포함), 웹 EXPECTED_GAS_VERSION, DEPLOYMENT.md, manifest/hash, 운영 트리거와 상태 API의 일관성 검사 필요. 여러 Writer 호출자가 해당 함수의 실행을 공유하므로 append/백업 정책과 재시도에 대한 영향 검증 없이 패치하지 않는다.

**단계 C — 제한된 운영 검증:** 사용자 승인 후 배포, 시간/비용·메타데이터 용량·큐 진행성 검증, read-only 결과만 집계, 원본 복구는 별도 승인. Source digest/revision과 backup signature 자체가 공식 KRX/NAV/FX 가격증빙을 대체하지 못한다.

**병합 및 복구 경계:** 사용자 승인 없는 자동 PR 병합, GAS 배포, 거래원장·Snapshot·가격/NAV/FX/백업/큐 변경·복구·삭제 없음. Issue #507 OPEN과 restoreAllowed=false 유지.

## 6. PR #589→#596 병합 이후: 동일 날짜 다중 Writer의 운영 배포 차단 기준

**2026-10-21 정합성 갱신:** PR #588의 기존 full-sheet lost-update 재현 이후 #589가 대상 날짜 물리행만 수정하도록 변경했으며, #589→#596은 `main`에 병합 완료됐다. 따라서 §2·§4의 “full rewrite”는 운영 v9.244의 **과거 생산 경로** 설명이다. main v9.250의 date-scoped 구현이 운영에 실제 배포됐다는 증빙은 없다. 코드 병합 후에도 direct Sheets API **동일 date-code TOCTOU**가 해소된 것은 아니다. #598의 v9.251 가격이력 배치 후보와 Snapshot Writer 출처 계측은 범위가 다르다.

- **실제 재현한 잔여 문제:** PR #589 HEAD `5f209756e476bec7005ac4437eee307a30278b21`의 실제 생산 함수를 이용한 합성 검사 `ISSUE507_KNOWN_UNSAFE_SAME_DATE_TOCTOU_REPRODUCED`는 외부 Sheets API가 원본 검사 후 **같은 date-code**를 변경하고 GAS가 `setValues`하면 외부 갱신이 유실되어도 대상일 검산이 성공함을 보인다. CI 녹색은 안전 보증이 아니라 결함 재현 증거다.
- **전제 범위:** ScriptLock·원본값/수식 사전 재검사·append 목적지 검사·실패 시 역순 보상 복원은 각각 유용하지만, 외부 직접 Sheets API/수동 편집과 하나의 원자적 쓰기 계약을 공유하지 않는다. 원본 서명 전후 검사도 검사→쓰기 사이의 TOCTOU를 제거하지 않는다. 보상 복원은 중간 실패/타임아웃·제3자 재수정 시 무조건 성공하지 않는다.
- **시트 수준 충돌 게이트:** 운영에 Snapshot을 쓸 수 있는 GAS 트리거·API 엔드포인트·외부 Sheets API 클라이언트·수동 편집/운영 도구의 writer 경로를 목록화한다. 저장소 내 호출 경로만 조사했다고 외부 직접 writer가 없다는 결론을 내릴 수 없다. 독립 writer가 남아 있으면 (a) 모든 쓰기를 공통 직렬화 서비스 한곳에 모으고 직접 쓰기를 차단하거나, (b) 실제 지원되는 원자적 조건부 갱신/버전 게이트를 식별하여 **서로 다른 클라이언트가 함께 준수함**을 검증해야 한다. Sheets `getValues`→`setValues`만으로 CAS(compare-and-swap)를 구현했다고 주장하지 않는다.
- **독립 실패 오라클:** 같은 날짜 동일 코드의 GAS↔외부 API 경쟁, 다른 코드 append 선점, 삭제/마지막행 축소, 기존 수식 롤백, 두 번째 비연속 블록 실패, flush 실패, 하드 타임아웃 후 재시도, journal 저장 실패를 분리한다. 각 시나리오는 외부 업데이트 불변, 대상일 정확한 보존/차단, 다른 날짜 미변경, 미확인 시 `COMMIT_UNVERIFIED`/fail closed 여부를 검사한다. **기존 취약점 재현 테스트는 수정완료 판정 기준에서 제외**한다.
- **운영 출시 판정:** `#589`가 main에 병합되어 타 날짜 덮어쓰기 경로를 축소한 사실과, 아직 해소되지 않은 동일 날짜 경합 차단을 별도 게이트로 평가한다. **모든 Snapshot writer의 직접 편집 경로를 실효적으로 배제한 단일 직렬화** 또는 **서로 다른 클라이언트 모두가 강제·준수하고 실제 경합으로 검증한 조건부 버전/CAS(compare-and-swap) 갱신**이 증명되기 전에는 main v9.250을 “Snapshot Writer 동시성 안전”으로 간주하거나 운영 배포·데이터 복구 승인하지 않는다. Sheets API `spreadsheets.batchUpdate` 한 요청 내부의 all-or-nothing 원자성은 여러 클라이언트 사이의 읽기→쓰기 조건부 커밋이나 동일 날짜 lost-update 방지 증거가 아니며, 그것만으로 출시 게이트를 통과하지 않는다. 사용자 승인 없는 실제 Snapshot/거래원장/백업/보류 큐 변경, 재서명·전체 롤백·자동 dedupe도 금지한다.

**설계 작업과 사고 복구 분리:** 이 장의 증빙은 향후 손실 방지를 위한 것이며, 과거 수량·원가 불일치 105건의 작성 시점/작성자나 사용 가능한 COMPLETE 백업을 소급 생성하지 않는다. #507은 OPEN, `restoreAllowed=false` 유지.
