## GAS v9.251 — Issue #507 가격이력 배치 D:F 동시 저장·목적지 검증 (2026-10-21)

- **배포 상태:** main의 v9.250과 운영 GAS v9.244(마지막 읽기 전용 진단 기준)는 그대로 유지. 본 PR은 미병합 수정 후보이며 실제 운영 배포·원본 정리·복구를 승인하지 않습니다. `gas-deploy.yml`은 명시적 `workflow_dispatch`일 때만 배포 작업을 실행합니다.
- **릴리스 pin:** `gasVersion=9.251`, GAS Git blob `1af4df97bb467389c6ea60f71a6033cc7dc81483` 및 Web 기대 버전·릴리스 manifest 일치. 이전 v9.250 이하 source pin 유지.
- **운영 트리거 기존 시각 유지:** 22:10 / 23:10 / 00:30 / 08:45 (KST), 등록 및 스케줄 변경 없음.
- **주요 수정:** 실제 시장가격 확정 및 소급 적재에서 호출하는 `batchUpsertPriceHistory`는 종전 **가격(D열)과 저장시각·출처(E:F)를 각각 전역 2차례에 나누어 기록**해 일부 셀만 갱신되거나 가격과 source가 서로 다른 시점에 결합될 수 있었습니다. 지금은 선택된 기존 물리행의 D:F를 **한 번의 `setValues`로 기록**합니다. 타 날짜/코드 행의 내용·수식·확장열은 다시 쓰지 않습니다.
- **경합·원본 보호:** 원본 전체 A:F 및 대상 수식의 사전·커밋 직전 검증. 기존 MANUAL 가격은 기존 보호 유지하고 외부 writer가 초기 read 후 MANUAL/가격/행 정체성을 수정했다면 자동 덮어쓰지 않고 차단합니다. 신규 append는 초기 lastRow가 바뀌었거나 전체 목적지 값/수식이 비지 않았으면 중단해 다른 날짜 추가값을 덮어쓰지 않습니다.
- **실패:** 배치의 한 셀 범위라도 시도된 뒤 후속 쓰기/저장 검산이 실패하면 `PRICE_HISTORY_BATCH_COMMIT_UNVERIFIED`를 표시하고 읽기 캐시 revision 갱신을 최선 노력합니다. 타 외부 writer를 덮어쓸 수 있는 물리행 자동 롤백은 수행하지 않습니다. **동일셀 preflight→write TOCTOU와 다중행 원자성, hard GAS timeout 후 영속 상태는 해결되지 않았습니다.**
- **검증:** 실제 생산 GAS 함수를 synthetic VM에서 실행하는 `scripts/check-issue507-price-batch-row.mjs`를 check:gas 및 Quality에 추가. 가격/출처 D:F 단일 쓰기, 외부 신규 MANUAL 보호, 수식 보호, 타 날짜 외부값 보존, 2번째 물리행 실패 `COMMIT_UNVERIFIED`, append 선점 차단, append 1건과 duplicate-key no-op 계약 검증. 원본 검사 `scripts/check-price-history-integrity.mjs`의 가상 Range에 getFormulas/빈 셀 반환을 보완합니다.
- **배포 후 검증(별도 승인 필요):** `getSettings.gasVersion=9.251` / `getAutomationStatus.gasVersion=9.251` 인증 조회 후, KRX·Toss 일자 확정 경로/원장·가격이력·Snapshot·NAV·FX·MANUAL·추가 사용자열/수식/backup registry/deferred queue 불변성 read-only 확인. 이전 보류 23일(원천부족/중복/혼합)을 자동 해제하거나 무근거 backfill하지 않습니다.
- **출시 차단:** Issue #507 OPEN, `restoreAllowed=false`; 운영 writer와 직접 Sheets API writer 공유 serialization/동일셀 CAS, 다중시트 트랜잭션, 부분 실패 recoverability 검증 미완료. 본 변경을 CI 통과만으로 운영 적용하지 않습니다.

---

## GAS v9.250 — Issue #507 syncCodes 종목코드 교정 단일 셀 한정 (2026-10-20)

- **배포 상태:** PR #595 위에 쌓인 미병합 후보. 운영 GAS 버전 v9.244 변화 없음. 선행 종속 PR #589→#591→#592→#594→#595의 코드가 필요하며 분리 배포 금지.
- **운영 트리거 시각 불변:** 기존 22:10 / 23:10 / 00:30 / 08:45 유지. 이 코드 변경에서 트리거 생성·삭제·일정 변경 없음.
- **원본/릴리스 pin:** `gasVersion=9.250` 전체 GAS Git blob `e300760560e763503439eb8a827891694baeaddb`. 이전 GAS pin은 유지; pin 및 CI 성공은 운영 배포 승인 아님.
- **변경:** `syncCodes`가 내부 호출하는 `_repairKnownCodeColumns`가 6개 시트의 코드 열 전체를 `Range.setValues(values)`로 재기록/열 전체 텍스트 서식 덮어쓰기를 하던 위험을 제거. 마스터 종목코드와 일치하는 **정확히 교정이 필요한 셀만** 그 셀에 한정해 읽기·수식/날짜·행 정체성 검사, 필요시 텍스트 서식 지정, 문자열 저장 및 readback 확인.
- **원천 보존:** 미인식 종목코드/수식은 고치거나 삭제하지 않으며, 다른 날짜/종목·거래원장 수량·가격/NAV/FX·확장열·스냅샷 이력·기존 열 서식은 재기록하지 않음. 코드 변경이 0이면 시트 포맷 변경·백업 생성·revision 갱신도 하지 않음.
- **동시성/부분실패:** 저장 대상 원본 및 행 A:최소 3열(거래원장은 A:E 포함) 식별자, 행수 외부 drift를 쓰기 직전 확인. 실패 시 backup `WRITE_FAILED` 보존/자동 롤백 금지. 각 시트별 성공·실패는 독립; 전체 동작의 다중시트 transaction atomicity는 제공하지 않음. **외부 Sheets API 동일 셀 검사→쓰기 TOCTOU는 미해결**.
- **Codex P1 보완(대량 처리 한계):** 일반 `syncCodes` 호출당 전체 6개 시트 합계 **최대 24개 코드 셀만** 검증·수정합니다. 호출별 `codeRepairPending`(보류 수정 셀 수)·`codeRepairContinueRequired`(추가 동기화 필요) 및 각 시트별 `deferred`를 응답에 포함하고, 다음 **명시적** `syncCodes` 요청에서 기존에 바뀐 코드를 건너뛰고 나머지 행을 재확인합니다. 비동기 자동 반복·백그라운드 실행/숨은 커서 없음. 서로 다른 시트의 부분 완료는 사용자에게 공개하며 동일셀 CAS는 미해결입니다.
- **검증:** 실제 생산 GAS 함수 기반 synthetic VM `scripts/check-issue507-code-repair-scoped.mjs`를 check:gas/Quality에 포함. 타 날짜 외부 변경 보존, 0-padding, 원천/formula/미인식 코드 보호, no-op에 서식·백업 없는 계약, 다른 날짜→원본 식별자 drift 및 기준 target drift, 2번째 시트 쓰기 실패의 백업 안전 표시 검증. 가격이력 정적 검사도 전체열 쓰기 기대 조건 삭제.
- **배포 후 확인(별도 사용자 승인 필요):** 실제 `getSettings.gasVersion=9.250`와 `getAutomationStatus.gasVersion=9.250` 인증 조회, 사용자 마스터/거래원장·가격/NAV/FX/Snapshot·사용자 확장열·백업·미해결 큐의 읽기 전용 불변성 검사. 현 단계에서는 실제 원본 수정/재작성·백업 삭제·자동 restore 금지.
- **차단:** 다른 Writer의 외부 직접 API 경합·복수 시트 트랜잭션 안전·GAS 실행 시간 한도와 원천 부족 23일이 미해결. Issue #507 OPEN 및 `restoreAllowed=false`.

---

## GAS v9.249 — Issue #507 가격이력 중복 정리 대상 물리행만 저장 (2026-10-20)

- **배포 상태:** 미병합 PR 검증용 후보. 기존 v9.248 이하 및 운영 v9.244는 변경하지 않았습니다. #589→#591→#592→#594 위에 쌓인 종속 PR이므로 독립 배포·병합을 금지합니다.
- **운영 트리거:** 기존 22:10 / 23:10 / 00:30 / 08:45 유지. 작업 도중 트리거를 생성·수정하지 않습니다.
- **릴리스 소스 정합성 pin:** `gasVersion=9.249`, 전체 GAS blob `f250e9474447a73877f4fee3ad23b7a0fd6f2363`. 기존 v9.248 이하 핀은 보존됩니다. 해시 승인 목록 등록은 운영 배포 승인이 아닙니다.
- **핵심 변경:** `_cleanupPriceHistoryDuplicatesLocked`의 `ph.clearContents()`·전체 재정렬·재기록 제거. 동일 날짜/코드의 가격이력 중복 그룹에서 기존 우선순위(MANUAL/savedAt·최신 저장시각·뒷행)를 유지하고 **남길 기준행은 원래 물리행에 보존**, 삭제 가능한 중복 물리행만 값·수식 확인 후 빈 슬롯 처리. 다른 날짜·다른 종목의 가격·소스/수식/사용자 열·헤더를 다시 기록하지 않습니다.
- **Codex P2 수용·수정:** 제거 대상의 `' MANUAL '` 등 공백 포함 소스를 검사할 때에도 후보 우선순위와 동일하게 `trim().toUpperCase()`로 보호. 실제 생산 함수 VM에서 차단/시트·백업·revision 불변성 검증.
- **근거 보호:** 제거 후보의 MANUAL 또는 사용자 저장시각, G열 이후 사용자 값, 수식이 있으면 자동 정리 전체를 `PRICE_CLEANUP_UNSAFE_EVIDENCE_REQUIRES_REVIEW`로 중단하여 거래원장 대조를 요구. 남길 기준행 또는 제거 대상이 백업 생성 후 외부 Writer에 의해 바뀌어도 차단합니다. 원래 다른 날짜·코드의 물리행 위치를 이동하지 않습니다.
- **부분 실패·백업:** 제한된 셀 기록에 오류가 나거나 타 Writer와 겹치면 `PRICE_CLEANUP_COMMIT_UNVERIFIED`, 기존 백업 `WRITE_FAILED` 상태 유지 및 자동 재실행·전체 복원 금지. 물리행을 비운 뒤에는 식별자가 사라져 자동 보상 안전성을 보증할 수 없습니다. 다른 API의 **검사→쓰기 동일셀 TOCTOU는 미해결**이며 cross-client CAS가 아닙니다.
- **검증:** 실제 GAS 생산 `_cleanupPriceHistoryDuplicatesLocked`를 synthetic VM에서 호출하는 `scripts/check-issue507-price-cleanup-scoped.mjs`를 check:gas·Quality 게이트에 추가. 외부 타 날짜 가격/소스 수정 보존, 7열 추가값 유지, MANUAL·타임스탬프·수식·확장열 보호, 기준행/대상행 drift, 2번째 쓰기 실패 `WRITE_FAILED` 백업 유지, no-op까지 검증. 기존 가격이력 정적 검사 역시 전체행 재기록 대신 대상 범위 저장 + 캐시 revision 갱신으로 변경.
- **배포 후 확인(별도 사용자 승인 필요):** 실제 `getSettings.gasVersion=9.249`와 `getAutomationStatus.gasVersion=9.249`을 인증 조회해 버전 검증한 뒤, 거래원장·Snapshot/가격이력·NAV·FX·사용자 추가열/수식·대기열·백업의 불변성 및 중복 진단을 읽기 전용으로 확인합니다. 자격증명/운영 환경 변경이나 보류 원천 강제복구·자동 백업 삭제/실데이터 정리는 금지합니다.
- **남은 출시 차단:** 외부 Sheets API 직접 writer의 공유 직렬화/동일셀 원자성, 다른 Write/삭제/대량 코드 보정 경로, GAS 쿼터 및 NAV·가격/Snapshot 복수시트 원자성, 원천 부족 보류일 확인이 미완료. Issue #507 OPEN 및 `restoreAllowed=false` 유지.

---

## GAS v9.248 — Issue #507 Snapshot 중복 정리 물리행 한정·원천 보존 (2026-10-20)

- **배포 상태:** PR #592 위에 쌓인 후속 수정 PR입니다. **GAS 운영 배포·자동 원본 정리/삭제·복구 금지**, 실제 운영 v9.244 변경 없음. #589/#591/#592 미해결 외부 API 동일셀 경쟁과 다중시트 원자성 제약이 있어 이 릴리스는 안전·승인 상태가 아닙니다.
- **릴리스 pin:** `gasVersion=9.248`, 전체 GAS blob `17ab235f10940f6020fd421f9afceae573e7a685` (기존 v9.247 이하 pin 유지). 해시/CI 통과는 운영 배포 승인이 아닙니다.
- **변경:** `_cleanupSnapshotDuplicatesLocked`가 전체 A:L 재배열·저장을 멈추고, 날짜/종목 중복 분류 결과에 따라 실제 제거해도 되는 **중복/0좌수 원래 물리행만** A:마지막 열로 검사·빈 슬롯 처리합니다. 다른 날짜/종목의 행 위치와 A:M 이상 사용자 정의 열의 정합을 유지합니다.
- **원천/수식 보호:** 날짜 유실 payload는 거래원장 근거 없이 자동 삭제하지 않고 `invalidDateRowsBlocked`로 보고합니다. 제거 후보의 13열 이후 사용자 데이터·수식 또는 MANUAL이 존재하면 **전체 정리를 사전 차단**해 불확실한 삭제를 하지 않습니다. 안전하지 않은 자동정리는 `SNAPSHOT_CLEANUP_UNSAFE_SOURCE_REQUIRES_REVIEW` 오류와 함께 중단합니다.
- **동시성/부분 실패:** 백업을 확보한 후 각 제거 대상 물리행 및 남길 기준행의 전체 원본 값을 검증하고, 제거 대상 수식을 저장 직전 재검사합니다. 외부 대상 행 변화/복수 범위 저장 실패는 `WRITE_FAILED` 백업을 남기고 `SNAPSHOT_CLEANUP_COMMIT_UNVERIFIED`로 명시합니다. **비운 행의 정체성이 사라졌기 때문에 불확실한 롤백은 자동 수행하지 않습니다.** 외부 Writer가 검사와 쓰기 사이 동일 셀을 바꾸는 TOCTOU는 미해결이며 cross-client CAS가 아닙니다.
- **검증:** 생산 함수 3개를 Node VM으로 실행하는 `scripts/check-issue507-snapshot-cleanup-scoped.mjs`를 GAS/Quality 검증에 포함. 12열 중복의 타 날짜 업데이트 보존, 13열 사용 컬럼 보호/0좌 정리, 중복 custom 열 차단, 날짜 유실 보존, MANUAL·수식 보호, 외부 대상셀 변경 차단, 부분쓰기 실패 백업 보류 등 synthetic cases.
- **배포 후 확인(별도 사용자 승인 전제):** 실제 운영 `getSettings.gasVersion=9.248` 및 `getAutomationStatus.gasVersion=9.248`을 인증 조회해 릴리스 버전을 확인하고, 거래원장·원천 데이터/사용자 M열 이상 값·수식·Snapshot 대상/다른 날짜 행·가격/NAV/FX·보류 큐·백업 상태 불변성을 **읽기 전용으로** 확인합니다. 실패 시 원본 자동복구·삭제·백업 정리 금지.
- **후속:** #593의 원본 unsafe 재현은 독립 main 코드 증거로 유지. 실제 운영 상태/백업·23일 보류 원천을 읽기 전용 검증하기 전에는 병합/배포/원본 자동 복구·삭제 불가. 기존 22:10 / 23:10 / 00:30 / 08:45 트리거 동작은 변경하지 않습니다.

---

## GAS v9.247 — Issue #507 현재가 소스 Snapshot 대상일·코드 변경셀만 저장 (2026-10-20)

- **배포 상태:** PR #591을 기반으로 하는 후속 종속 PR 검증 단계. #589 및 #591의 외부 동일셀 경합과 다중시트 부분완료 위험이 남아 **병합/운영 배포 미승인**. v9.247 배포 완료를 선언하지 않습니다.
- **운영 트리거 시간:** 기존 22:10 / 23:10 / 00:30 / 08:45 유지. 자동 트리거 신규 생성/이동 및 가격 원천 정책 변경 없음.
- **릴리스 소스 정합성 pin:** `gasVersion=9.247`, 전체 GAS Git blob `6c1114ecad634f05a6d84912e3b5d44bb5ed40e5`. v9.246 이하의 기존 핀 유지. 릴리스 해시 등록은 배포 승인이 아님.
- **변경:** `handleGetPricesCompat`가 `_updateTodaySnapshotSource`를 호출할 때 가격 제공자 **소스가 실제 바뀌는 대상 날짜·코드의 물리행 K:L 두 셀만** 저장. 이전 전체 Snapshot K:L 재기록을 제거하고 MANUAL 소스, 저장일시, 다른 날짜/종목·사용자 열/수식 보존.
- **원본·실패 검사:** 대상 행 A:C 식별자와 K:L의 원본 값을 저장 직전 확인, 행 구조 변경시 fail closed. 비연속 셀 저장 실패시 **그 작업이 시도한 대상 K:L만** 신중히 보상. 보상 불확실·외부 재수정 겹침은 `COMMIT_UNVERIFIED` 오류로 노출. 현재가 기록은 원래 단일 GET 흐름이며 트랜잭션 저널/지속적 rollback 보증을 추가했다고 주장하지 않음.
- **검증:** 실제 GAS `_updateTodaySnapshotSource`를 합성 VM에서 실행하는 `scripts/check-issue507-today-source-scoped.mjs`; 타 날짜/같은 날짜 타 코드 외부수정 보존, MANUAL/no-op 보호, 행 교체·K:L drift 차단, 2번째 write 실패·보상 외부수정 차단, revision 메타 기록 확인. 종전 `getRange(2,11,rowCount,2).setValues` 제거 계약 확인.
- **남은 출시 차단기:** 외부 API가 검사와 쓰기 사이 같은 셀을 바꾸는 TOCTOU는 해결되지 않았고 ScriptLock·셀 재검사만으로 cross-client CAS/직렬화가 성립하지 않음. 다른 Snapshot writer(중복행 cleanup, 코드열 재기록, 수동 전체삭제 포함) 점검, 다중 시트 NAV/가격/Snapshot atomicity·GAS 시간 제한·durable journal 검증까지 필요.
- **배포 후 확인(별도 사용자 승인 전제):** 실제 `getSettings.gasVersion=9.247` 및 `getAutomationStatus.gasVersion=9.247` 확인, 가격이력/거래원장/NAV/원본 Snapshot/FX/미완료 큐/백업의 읽기 전용 전후 비교. 자동 재작성/복구·백업 정리/삭제·보류 해제 금지. Issue #507 OPEN 및 `restoreAllowed=false` 유지.

---

## GAS v9.246 — Issue #507 펀드 좌수 파생 Writer 변경셀 한정 (2026-10-20)

- **운영 트리거 시간:** 기존 KRX/과거 보류 작업 스케줄 **22:10 / 23:10 / 00:30 / 08:45**를 그대로 유지합니다. 운영 릴리스 배포 전후 확인 항목이며 이 PR에서 트리거를 생성하거나 변경하지 않습니다.
- **배포 상태:** PR #589 기반 후속 코드 검증용 브랜치. PR #589 자체가 외부 동일 날짜 API 경합 미해결 상태이므로 이 버전의 **병합·운영 배포는 보류**합니다. 기존 운영 GAS v9.244는 변경하지 않습니다.
- **릴리스 소스 정합성 pin:** `gasVersion=9.246`, 전체 GAS 파일 Git blob `0ba7d0d30de93fcd0ec4528fadf25816a9ffccf9`. 앞선 v9.245 승인 pin은 보존됩니다. pin은 안전성/배포 승인 자체를 의미하지 않습니다.
- **핵심 변경:** `handleSaveFundUnits`의 NAV·가격이력·Snapshot 파생 재계산이 기존 전체행 `setValues`를 반복하지 않고, 변경된 물리행의 변경셀만 원본 값/수식 확인 후 저장합니다. 펀드 좌수 0 전환 시 Snapshot의 해당 물리행만 비우고 다른 날짜/코드의 행 위치를 이동하지 않습니다. 신규 펀드 파생행은 마지막에 추가하며 외부 선점 시 중단합니다.
- **일부실패 보전:** 원본 백업은 시트별로 만들고, 범위 쓰기 중 오류가 있으면 시도한 변경셀의 수식/리터럴 원본 이미지를 보상 복원합니다. 불확실한 범위는 WRITE_FAILED 상태로 남기고 자동 성공/전체복원으로 판정하지 않습니다. 다중 **시트간 원자적 트랜잭션**은 아닙니다.
- **남은 출시 차단기:** 외부 Sheets API 같은 셀 변경에 대한 검증→저장 TOCTOU, ScriptLock 외부 쓰기 중앙화·조건부 CAS, 미해결 journal·일부 성공 후 자동 재시도, GAS 실행시간/쿼터, 다른 날짜/코드 보존의 운영 재현은 **미검증**입니다. 따라서 완료·안전·복구 승인으로 판단하지 않습니다.
- **검증:** 신규 `scripts/check-issue507-fund-derived-scoped.mjs`를 실제 GAS 생산 함수 VM에 연결하고 Quality·GAS 정적·릴리스 전체 소스 pin·웹 expectedVersion을 확인합니다. NAV·가격이력 직접 쓰기 및 0좌수·MANUAL·함수 실패/재시도 회귀는 별도 게이트로 유지합니다.
- **배포 후 확인(별도 사용자 승인 필요):** `getSettings.gasVersion=9.246` 및 `getAutomationStatus.gasVersion=9.246` 실제 배포를 확인하고, Snapshot/가격이력/NAV의 다른 날짜·코드와 거래원장·원천·대기열·백업 불변성을 읽기 전용 검사 후 단계별 제한 복구를 별도로 승인받습니다.

---

## GAS v9.245 — Issue #507 날짜 한정 Snapshot Writer 안전 개선 (2026-10-20)

- **배포 상태:** PR #589 코드 리뷰 및 안전검증 중. 운영 적용 여부는 이 문서만으로 증명되지 않습니다. **사용자 병합·배포 승인 전에는 v9.245 운영 미적용**이며, 실제 Snapshot/거래원장·백업·큐 변경 작업이 아닙니다.
- **릴리스 소스 정합성 pin:** `gasVersion=9.245`, 전체 GAS 소스 Git blob `940998491bd1f8261e20d887285b269b526a9f21`. 기존 v9.244 pin은 유지. pin은 저장소 검증 대상이며 운영 배포 승인이 아닙니다.
- **안전 수정:** 기존 `writeSnapshotRows`가 새 날짜·기존 날짜를 불문하고 전체 스냅샷 시트를 `setValues`로 덮어쓰던 경로를, **해당 날짜 물리행만 갱신/빈칸 처리하고 새 코드는 끝에 추가**하는 경로로 제한. 서로 다른 날짜의 값·수식/셀을 재기록하지 않아 타 날짜 API 변경의 lost-update 경합 범위를 제거합니다. 자동 중복 정리·MANUAL 보호·원본 백업 생성 및 실패 판정·날짜별 저장 검산은 기존 계약 유지.
- **다중 범위 오류 보상:** 여러 물리범위/신규행 혼합 쓰기가 중간 실패하면, **이미 변경한 대상 날짜의 셀만** 역순으로 원본 관측값과 비교하여 보상 복원합니다. 다른 날짜는 되돌리지 않으며, 검사 중 외부 수정/보상 실패 시 COMMIT_UNVERIFIED 성격의 명시적 오류로 남겨 백업·원장·대기열 재검증을 요구합니다. Sheets API의 외부 동일 날짜 경합은 완전 직렬화된 것이 아닙니다.
- **마지막 행 교체 시 자체 행수 축소 처리:** 구종목 마지막 물리행을 삭제(빈 셀 처리)하고 신규코드를 append할 때 `getLastRow()`가 감소하는 건 Writer 자신의 정상 동작입니다. 원래 행수보다 **증가한 경우**만 별도 구조 경합으로 판정하고 append 목적지의 값·수식을 직접 확인해 선점 상태를 차단합니다. 정상 마지막 행 교체와 타 API 목적지 선점 두 경로를 생산 함수 기반 합성 회귀로 구분 검증합니다.
- **최신 Codex 추가 수정:** 외부 API가 append 예약 위치를 선점하면 행수·수식 포함 원본 셀을 다시 읽어 **쓰기 전에 차단**합니다. 비연속 범위 갱신의 보상 journal은 `getValues` 외에 `getFormulas`를 함께 저장해 숫자로 수식을 고정하지 않고 복구합니다. 외부 API의 검사~쓰기 구간 같은 날짜 경합은 아직 절대 원자적이지 않습니다.
- **외부 변경 차단:** 원본행 및 물리 행수 drift를 백업 직후 커밋 전에 재확인하고, 다르면 원본 수정 전 중단. 단, 같은 날짜 API write의 **검사~쓰기 간 TOCTOU**까지 원자적으로 해결하지 못하므로 완전 동시성 안전이라고 선언하지 않음. 외부 Sheets Writer 중앙화/정지와 Writer 원장 지문·journal은 별도 과제.
- **동작 차이/용량:** 제거한 종목/중복 날짜의 물리 슬롯은 다른 날짜 행을 움직이지 않기 위해 빈칸으로 남을 수 있음. 전체시트 행수·포맷/수식·백업 보관 용량/원장 스캔 성능 및 다른 날짜 변화 불변을 PR 기반 합성 계약과 실제 배포 전 별도 검증.
- **검증:** `scripts/check-issue507-snapshot-date-scoped.mjs`는 실제 생산 함수 VM에서 no-op, 기존 시트 신규 날짜, 변경·보호, 타 날짜 외부 수정 주입, 대상일 원본 변경 및 행 구조 변경 차단, 삭제/날짜 오류를 검사. 릴리스 버전·웹 `EXPECTED_GAS_VERSION`·`handleGetSettings`·`getAutomationStatus`·승인 pin/manifest·Quality CI 각각 확인.
- **배포 후 확인:** 사용자의 **별도 승인**이 있을 때만 GAS 릴리스/배포. 운영 `getSettings.gasVersion=9.245`, `getAutomationStatus.gasVersion=9.245`를 인증 조회하고, 신규일 append 및 기존일 갱신의 실제 Snapshot 다른 날짜 값/수식·원장/가격/NAV·미완료 큐·백업 상태 불변성을 read-only로 먼저 검증. 자동 복원/백업 삭제/보류 큐 해제 금지, Issue #507 OPEN 유지.

## GAS v9.244 — Issue #507 worker phase 및 미해결 날짜 전수 진단 (2026-10-20)

- **배포 상태:** 별도 단계 PR/CI/Codex 리뷰 준비. 기존 운영 GAS **v9.243**이며, 본 소스는 사용자 승인 전 병합·배포하지 않습니다.
- **릴리스 승인:** `gasVersion=9.244`, 전체 GAS 원본 Git blob `758e5e4da5d32252af3472e248ca023004cf4e4b`. 이전 v9.243 소스 승인 해시 유지.
- **운영 관측:** 시간 worker는 `2026-10-20 09:02:31 KST` 시작 후 `DATE_DISCOVERY` 마지막 기록만 남아 종료 미확정. 해당 단계가 Snapshot 마지막일 `_latestConfirmedSnapshotDate`인지 전체 소스일 `_collectDailySnapshotDates`인지 판별 불가.
- **보류 전수 조사:** 인증된 기존 `getAutomationStatus`에 `tradeSnapshotDeferredDates`(정렬된 600건 이하 날짜 배열)와 `tradeSnapshotDeferredCursor`를 추가했습니다. 새 워크플로 `issue-507-deferred-source-audit-readonly`는 수동 실행 시 전체 보류일을 6일 단위로 `diagnoseSnapshotIntegrityRange`에 전달하고 KRX/FX/NAV/충돌 상태를 날짜/유형/건수만 출력합니다. 호출 전·후 보류 목록 및 각 청크의 원천 revision이 변하면 FAIL-CLOSED로 종료합니다. 합성 계약 검증과 실제 v9.244 배포 이후의 운영 검증을 구분합니다. 아직 가격 원천 보강/보류 해제/시트 쓰기는 **미실행**입니다.
- **변경:** 기존 `DATE_DISCOVERY`는 Snapshot 마지막일을 읽기 전 유지, 완료 직후 `DATE_SOURCE_COLLECTION` 저장, 여러 원천 날짜 수집 완료 직후 `DATE_DISCOVERY_COMPLETE` 저장. 이 세 단계와 기존 `DATE_DIAGNOSTIC` 전환으로 진입 경계를 구별합니다. `status-only` 정해진 enum 계약도 동일하게 수정합니다.
- **안전:** 기존 ScriptLock 및 `trade_snapshot_worker_last_v1`의 마지막 RUNNING 체크포인트 외 새로운 속성/시트 생성 없음. 수량·취득원가의 거래원장 우선, 확정 가격/NAV 출처, `MANUAL` 보존, 기존 Snapshot·pending/deferred·백업·worker 선영속 순서는 변경하지 않습니다. 단계별 타임스탬프는 진행 확인용이지 실제 실행 완료/시간초과를 확정하지 않습니다.
- **기존 KRX 스케줄:** 22:10 / 23:10 / 00:30 / 08:45 유지. Source-only writer나 가격이력·Snapshot을 쓰는 기능은 추가하지 않습니다.
- **검증:** GAS 실제 worker 생산 함수 VM에서 단계 순서·중단 지점의 마지막 phase·원장 보류 선영속·락·커서 불변 확인. 헤더/설정/웹 응답/배포 승인 blob/manifest 정합·GAS validate/Quality 필수 검사 수행.
- **배포 후:** `getAutomationStatus.gasVersion=9.244` 및 `getSettings.gasVersion=9.244`로 정확한 배포 확인 후 다음 시간 worker 결과를 읽기 전용 조회합니다. `DATE_DISCOVERY` 정체면 마지막 Snapshot 날짜 조회 단계, `DATE_SOURCE_COLLECTION` 정체면 날짜 원천 탐색 단계로 한정해 조사하며 성공 후에는 종전처럼 Snapshot 정합성 재확인. 근본 성능 개선·원본 날짜 복구는 별도 승인 단계입니다.

---

## GAS v9.243 — Issue #507 연말 KRX 대상 종목 확정 종가 읽기 전용 검증 (2026-10-20)

- **배포 상태:** PR/CI/Codex 리뷰 검증 단계. 사용자 승인 이전에는 자동 머지·운영 배포·원본 시트 쓰기 없음.
- **릴리스 승인:** `gasVersion=9.243`, 전체 실제 GAS source Git blob `a28be0795b820e96c2659a2d96e030fecaba4f94`. v9.242/v9.241 소스 승인 해시 보존.
- **필요 이유:** 2025-09-03과 2025-12-30 KRX 전체 보유 종목의 공식 종가가 5/5, 30/30으로 조회됐지만, 최초 누락 종목 1개 자체의 대상 포함 여부/정확한 원천일은 집계만으로 미확정. 거래원장 최초 거래 2025-09-03, 해당 현행 코드 가격이력은 2026-01-06 시작, 2026-01-01 저장 Snapshot 30항목에도 해당 코드 없음.
- **변경:** 기존 인증된 read-only `getKrxHeldCloseCoverage`에 선택적 `code` 인자를 전달하여 기존에 구축한 `expected` 보유 국내 KRX 대상 목록과 `fetchPricesKrx` 결과를 교차 검증. `targetEvidence`는 `eligibleHeldDomestic`, `exactDateConfirmed`, `usedDate`, `providerClass`만 반환; 코드/종목명/가격/매입원가/수량/계좌 제외. `code` 인자 없는 기존 호출은 동일 집계 응답을 유지하고 `targetEvidence=null`만 추가.
- **검증:** 실제 GAS `_krxHeldTargetCloseEvidence_`와 `handleGetKrxHeldCloseCoverage`을 VM에서 실행하여 OpenAPI/OTP 확정, stale/미래일, carry/0원, 비보유 종목, 인증 거부를 회귀 테스트. 비식별 CI에서만 실행하고 운영 호출은 **수동 dispatch + 운영 v9.243 확인 이후** 실행.
- **안전:** 가격/FX/NAV/Snapshot/거래원장/ScriptProperties/trigger/worker/cursor 쓰기 경로 불변. 기존 KRX 일정 22:10 / 23:10 / 00:30 / 08:45 불변. 읽기에서 원천 가격을 확보하더라도 **그 자체로 과거 평가행 수정을 승인하거나 원본 Snapshot에 쓰지 않음**. 이월은 2026-01-01 당시 보유 수량·원가는 거래원장, 종가는 실제 마지막 공식 원천일을 독립 검증한 뒤에만 사용.
- **배포 후 확인:** 운영 인증 `getSettings.gasVersion=9.243`와 `getKrxHeldCloseCoverage` 대상 종목 증거 확인, 2025-09-03 및 12-30 `eligibleHeldDomestic=true` && `exactDateConfirmed=true`가 입증된 경우에만 다음 별도 *SOURCE ONLY* 보강안을 검토. 기록이 불충분하면 기존 가격이력/원본 Snapshot·deferred 9일 이상 전부 보존. Issue #507 OPEN.

---

## GAS v9.242 — Issue #507 worker 6분 초과 단계 추적 (2026-10-19)

- **배포 상태:** PR 검증 단계. 자동 배포/운영 실측 전에는 정상 복구를 선언하지 않습니다.
- **릴리스 승인:** `gasVersion=9.242`, 실제 전체 GAS source blob `b530a305c6b3056b5e75cc8da47dbe1b078ce4c4`; 이전 v9.241 승인 이력 보존.
- **운영 문제 근거:** v9.241 worker 첫 진입 `2026-10-19T11:02:23.565Z` 이후 11:10:59Z까지 마지막 상태가 `RUNNING`으로 유지되었고 deferred 0, pending 2025-12-31 불변. Apps Script 공식 실행당 제한 6분(https://developers.google.com/apps-script/guides/services/quotas). 원인 단계를 아직 확인하지 못하므로 실제 재계산·커서를 임의 변경하지 않습니다.
- **수정:** 실운영 `runPendingTradeSnapshotRebuild`에서 Sheet 열기 전 `ENTRY`, 원장 변경 SHA 확인 직전 `LEDGER_FINGERPRINT`, pending/deferred 읽기 전 `QUEUE_READ`, Snapshot 날짜 후보 읽기 전 `DATE_DISCOVERY`, 단일 날짜 계산 진입 전 `DATE_DIAGNOSTIC`, 상태 영속 직전 `CURSOR_COMMIT`, deferred 순환 진단 직전 `DEFERRED_RETRY`를 `tradeSnapshotWorkerLastResult.phase` enum으로 기록합니다. `runStartedAt`은 원래 진입 시각(UTC ISO)을 유지합니다. `at`은 최근 단계 마커 시각입니다. 원문 로그·종목·거래원장·보유·금액·토큰 미출력.
- **기존 KRX 스케줄 불변:** 22:10 마감 보완, 23:10 역사 백필, 00:30 역사 백필, 08:45 KRX T+1 조회는 동일하게 유지합니다.
- **안전:** 단계 체크포인트는 기존 last worker ScriptProperties 1개에만 기록합니다. ScriptLock 선획득, BUSY 별도 보존, 원천 부족 deferred 선기록·pending 후전진, 거래원장 단일 원천, MANUAL/가격/원본 Snapshot/백업 및 KRX/Toss 쓰기 보호 **동작 변경 없음**.
- **검증:** 실제 GAS worker VM으로 진입·원장 지문·큐 조회·날짜 진단·커서 단계 순서 및 최초 시작 시각 보존 테스트. 인증 READ ONLY 진단 파서는 정해진 단계 이외를 거부하며 구버전 단계 없는 체크포인트도 지원합니다.
- **배포 후:** v9.242 getAutomationStatus의 `tradeSnapshotWorkerLastResult.status=RUNNING`이 장시간 지속되면 `phase`, `runStartedAt`, `blockedDate`만 확인해 병목 단계를 특정합니다. 자동 worker가 `PENDING/DEFERRED_OUTSTANDING` 또는 `COMPLETED`로 종료하고 `deferredCount`와 pending 진전이 검증되기 전에는 Issue #507 OPEN. 다른 KRX pending 5건과 분리 점검.

---

## GAS v9.241 — Issue #507 거래원장 보유·expected 0 Snapshot 안전 이월 (2026-10-19)

- **배포 상태:** PR/CI 단계, 아직 운영 미배포. 병합 후 GAS deploy 및 인증 운영 실측 전에는 완료로 판정하지 않습니다.
- **릴리스 승인:** `gasVersion=9.241`, 전체 GAS source blob `761db12b1b35e3212774cdeaf4485f6ae181cc0f`. v9.240 승인 해시·진단 메타데이터 보존.
- **운영 재현:** 2025-12-31 GAS v9.240 인증 READ_ONLY 단일일 진단 `PARTIAL`(expected=0, stored=2, sourceError=0), 기간 진단 `SOURCE_INCOMPLETE`(expected=0, stored=2, sourceError=1), 전후 읽기 비교 안정. worker 마지막 `BLOCKED`, pending=2025-12-31. [#507 교차 진단](https://github.com/cyyoung111-dev/portfolio/actions/runs/39239237970).
- **결함·수정:** 기존 단일일 Snapshot 빌더는 확정 가격/환율 부족 시 `throwOnError=true`에서도 `[]`를 반환할 수 있어 worker가 `PARTIAL`로 오분류합니다. `_assessTradeSnapshotWorkerDate_`에서 *단일일 expected=0, 상태 PARTIAL/NO_SNAPSHOT, 거래원장상 실제 양수 보유 확인*인 경우 **쓰기 전에** `DEFERRED/SOURCE_INCOMPLETE`로 분류합니다. 이미 관리하던 SOURCE_INCOMPLETE/CONFLICT/PRICE_SUSPICIOUS 보존 정책과 펀드/MANUAL 보호는 변경하지 않습니다.
- **안전 회귀:** GAS 실제 함수 VM에서 2개 원천 부족일의 deferred 영속 선행, pending 다음 날짜 이동, writer 0회, ScriptLock 해제 확인. 원장 보유 0인 `NO_SNAPSHOT`은 정상 빈 포트폴리오로 유지, 양수 보유를 증명할 수 없는 다른 오류는 `BLOCKED` 유지. 기존 정상 MISMATCH/충돌/백업/가격·Toss/KRX/Web 테스트 보존.
- **변경 범위:** 거래원장·Snapshot·가격/KRX·NAV·기존 백업 및 트리거 등록 로직, 원본 시트 직접 쓰기·삭제 없음. worker 기존 정책에 따른 *향후 예약 실행*은 원천 부족 날짜만 deferred로 기록한 뒤 다음 날짜를 순차 검사합니다.
- **배포 후:** 인증 `getAutomationStatus`로 v9.241·CLOCK 1개·`workerLastResult`·`deferredCount`·`pendingTradeSnapshotRebuildFrom` 실측. 실제 자동 시간 작업이 실행되기 전에는 커서 전진 완료 주장 금지. 22:10·23:10·00:30 KRX 백필 및 08:45 T+1 검증 경로 유지.

---

## GAS v9.240 — Issue #507 worker 트리거 유형·소유 계정 관측범위 진단 (2026-10-19)

- **배포 상태:** 이 PR은 우선 코드/정합성 CI 검증 단계입니다. 병합·gas-deploy·운영 getAutomationStatus 교차검증 전에는 실제 적용 또는 시간 worker 정상 실행으로 인정하지 않습니다.
- **릴리스 승인:** `gasVersion=9.240`, 전체 GAS source blob `98c20f52807530933a74827476c86b5713f3254f`. v9.239 원본 승인 pin은 보존합니다.
- **핵심 읽기 전용 진단:** `getAutomationStatus.tradeSnapshotWorkerTriggerAudit`에서 `runPendingTradeSnapshotRebuild` 트리거의 `visibleCount`, `clockCount`, `nonClockCount`, `unknownCount`만 집계합니다. `getEventType() === ScriptApp.EventType.CLOCK`와 `getTriggerSource() === ScriptApp.TriggerSource.CLOCK`가 모두 참인 경우에만 `clockCount`로 인정합니다. `scope=CURRENT_USER`는 Apps Script 실행자에게 보이는 트리거만 집계됨을 뜻합니다. 트리거 고유 ID, 계정 및 스프레드시트 식별자, 거래값, 자격증명은 노출하지 않습니다.
- **안전 및 판정:** 기존 `triggerReady`와 별도로 `tradeSnapshotWorkerTriggerAudit.clockReady`를 출력합니다. 후자는 현재 사용자 범위에서 올바른 시간 트리거 **1개 설치** 증거일 뿐 실제 호출·실행 성공을 뜻하지 않습니다. v9.239 이전에는 추가 진단을 강요하지 않으며 v9.240 이후 필드 누락·집계 불일치는 fail-closed. 잘못된 이벤트 유형이 확인되더라도 자동 삭제/재생성하지 않습니다.
- **비변경:** 거래원장·Snapshot·원천 KRX/펀드 NAV·ScriptProperties·트리거 등록/삭제·writer lease·pending/deferred/백업/가격 로직, Toss 및 웹 화면 동작은 그대로입니다. 22:10·23:10·00:30 KRX 백필, 08:45 T+1 KRX 진단 일정을 유지합니다.
- **배포 후:** v9.240 인증 운영 `getAutomationStatus`에서 `clockReady` 및 `tradeSnapshotWorkerLastResult/LastBusy`, `pendingTradeSnapshotRebuildFrom`, `tradeSnapshotDeferredCount`를 함께 확인합니다. `clockReady=true`·heartbeat null이면 트리거 생성자 계정의 Apps Script 실행 이력/권한 문제 조사; `clockReady=false` 또는 `unknownCount>0`이면 실제 이벤트 유형/현재 사용자 소유 계정부터 진단. 원본 거래원장과 Snapshot에는 무수정.
  
---

## GAS v9.239 — Issue #507 시간 worker 진입·잠금 실패 조기 체크포인트 (2026-10-19)

- **배포 상태:** PR #560 코드 검증 중이며 아직 실제 운영 GAS에 적용되지 않았습니다. GAS 배포 성공 및 운영 v9.239 실측 전에는 적용 완료로 간주하지 않습니다.
- **릴리스 승인:** `gasVersion=9.239`, 전체 GAS source blob `ed555bd181c57ab2e8bf2102938c0089d6df2937`. 병합·배포 전에는 변경한 코드가 실제 운영에 적용됐다고 주장하지 않음.
- **증상:** v9.238 운영에서 `hasLedgerRebuild=true`인데 `tradeSnapshotWorkerLastResult=null` · `tradeSnapshotDeferredCount=0` · pending `2025-12-31`; 사용자 거래원장의 2025년 말 가격 부족이 아닌 *worker 진입·잠금/타임아웃* 문제일 가능성도 진단해야 함.
- **첫 진입:** 설치형 `runPendingTradeSnapshotRebuild`에서 ScriptLock을 실제 획득한 직후, **getss()/원장 SHA-256 두 번 읽기/원천 검증/대기열 처리 이전** `trade_snapshot_worker_last_v1`에 `RUNNING`과 UTC 시각만 기록. 성공·오류 결과는 기존 완료 enum·시각으로 갱신. GAS hard timeout은 `RUNNING` 잔존해 명확한 미완료 증거.
- **잠금 경합:** ScriptLock 획득 실패 시 `trade_snapshot_worker_busy_v1` 별도 속성에 `BUSY`·UTC 시각을 저장하고 즉시 종료. 다른 실행의 `RUNNING` 체크포인트를 덮어쓰지 않음. 잠금 자체/대기열/원본은 변경하지 않음.
- **안전한 운영조회:** `getAutomationStatus.tradeSnapshotWorkerLastBusy` 읽기 전용 필드와 기존 lastResult를 함께 노출. Node 안전 파서는 허용 enum·정규 UTC·정수 건수만 출력하며 원장·종목·가격·토큰/비밀 속성을 제외. 7분 이상 RUNNING은 `TIMEOUT_SUSPECTED` *가능성*으로만 표시(실제 Google 실행 기록은 별도).
- **회귀:** 실제 GAS 함수 VM에서 시작 `RUNNING`이 Sheet 접근보다 먼저 기록되는지, 잠금 경합 시 진행 중 RUNNING/대기 커서가 보존되는지, 기존 미해결 날짜 이월/순환이 유지되는지 확인. 기존 22:10·23:10·00:30·08:45 KRX, Toss, NAV/Snapshot 보호, 거래원장 fingerprint/월별 브리핑은 변경하지 않음.
- **배포 후:** GAS v9.239 · Apps Script 새 version · webhook/프로세스 정상 인증을 확인한 뒤 시간 worker 첫 실행의 `RUNNING`, `BUSY`, `ERROR`, `PENDING` 중 해당하는 실제 checkpoint를 조회. `RUNNING`만 보이면 시간초과/중단 원인 파악; `null`이면 앱 스크립트 trigger 실행 소유권·시간 스케줄 문제 미해결. **pending 2025-12-31→전진 및 deferred>0이 실증되기 전에는 Issue #507 CLOSE 금지**.

---

## GAS v9.238 — 거래원장 재계산 원천부족·충돌일 보류 후 후속 날짜 진행 (2026-10-19)

- **배포 상태:** PR 검토·CI·운영 배포 후 버전 실측 전까지 미배포. 승인 GAS 전체 source blob `134ae6e83b28f8b8772a411b2685e228f3af2388`.
- **원장 단일 원천 불변:** 거래이력 SHA-256 지문, 이동평균 원가 및 날짜별 가격이력/펀드 NAV를 기준으로 검사합니다. Snapshot은 결과이며 미확정 가격을 합성하거나 거래원장 내용을 덮어쓰지 않습니다.
- **기아 상태 해소:** 2025-12-31부터의 기존 재평가 pending은 유지하며 각 날짜를 GAS `diagnoseSnapshotIntegrity`로 사전검사. `SOURCE_INCOMPLETE`, `CONFLICT`, `PRICE_SUSPICIOUS`는 Snapshot에 쓰지 않고 `trade_snapshot_rebuild_deferred_v1`에 날짜를 영속 기록한 후에만 진행 커서를 전진합니다. 원자료가 정상이고 재계산 후 `VALID`이거나 원장상 무보유를 증명한 빈 날짜만 완료 처리. 알 수 없는 오류/쓰기 실패/`MISMATCH` 지속은 `BLOCKED`로 중단하며 cursor를 앞당기지 않습니다.
- **미해결 자동 재검증:** 전체 날짜 순차 검증 후에도 deferred 날짜는 남으며 시간 worker가 1시간 간격 순환 1일 재검사합니다. 새 원장 fingerprint/수량 변경으로 다시 앞 날짜부터 시작하면 과거 deferred 항목도 확인 후에만 해제. 저장 목록은 최대 600일/8,000자 제한, 용량 초과는 원본 유지 및 실패 처리.
- **실행 증명:** `getAutomationStatus`에 `tradeSnapshotWorkerLastResult`(시각, 상태 enum, 처리/보류 건수 및 날짜만), `tradeSnapshotDeferredCount`, `tradeSnapshotDeferredOldestDate`를 추가. 개인 거래값·원가·수량/계좌·인증키는 속성/로그에서 제외. pending `- `라도 deferred가 있으면 `WARNING`.
- **안전:** 기존 22:10 당일 KRX 백필 / 23:10 과거 KRX 백필 / 00:30 추가 백필 / 08:45 익영업일 KRX 검증은 모두 유지. 기존 ScriptLock/ledger hard-timeout write journal/기존 2일 처리 예산 유지. 1/6(33/33), 6/5(37/37), 9/15·16(39/39) 실데이터 `VALID` 및 각 백업 보존. 기존 다이트/시장 브리핑/KRX nightly backfill 경로 무변경.
- **배포 후:** [gas-deploy] 성공, 운영 `gasVersion=9.238`, pending 최초 2025-12-31에서 deferred 1건 기록 후 다음 날짜 이동, 정확한 exception 수 및 timestamped worker checkpoint 실측. pending 소진 후 deferred 순환 재시도 확인, 정상이 아닌 과거 날짜는 완료로 표시하지 않음. `SOURCE_INCOMPLETE` 원천 구매/가격 직접 조작 없이 후속 날짜 원장 변경 시 `VALID` 회귀 확인.

---

## GAS v9.237 — 거래원장 변경 Snapshot 추적·제한 재계산 (2026-10-19)

- **배포 상태:** PR #549 리뷰·필수 CI 확인 중. 실제 GAS 운영 배포/트리거 설치/원본 Snapshot 복구는 별도 작업이며 아직 완료로 간주하지 않습니다. 승인 source blob `d68e38126a2905ebcd6b90931489624a65d9d272`; 배포 후 `gasVersion=9.237` 실측 필요.
- **단일 원천:** 거래이력은 보유수량·이동평균 취득원가(기존 매도·분할 원칙 유지), 가격이력/KRX 및 해당일 FUND_NAV는 평가단가, Snapshot은 파생 평가 결과입니다.
- **외부 API 수정 감지:** Sheets API/다른 스크립트는 onEdit를 발생시키지 않으므로 매시간 worker에서 거래원장 A:K 전체의 **행 순서 보존 SHA-256을 두 번 읽어 일치 여부** 확인. 값 변경·과거 거래 삭제 시 최초 저장 Snapshot부터 보수적으로 재계산 대기(충돌은 보호). 매수·매도·분할의 행 순서만 변경된 경우에도 취득원가가 바뀔 수 있어 재계산 대기에 등록함. 시작 시 최초 스캔은 지문 등록과 함께 기존 Snapshot 최초일부터 재계산을 대기 등록하고, 실제 확인되지 않은 과거 데이터를 정상으로 표시하지 않음. Web syncTrades는 **원장 쓰기 이전**에 영향 시작일 pending을 영속한 후 Snapshot 재생성에 성공하면 지문 확정·pending 해제(도중 GAS hard timeout이면 pending 유지). 원시 계좌·원장 금액은 ScriptProperties에 기록하지 않음.
- **수정 경로:** 웹 syncTrades의 최초 변경일 재계산 및 partial pending 유지. Standalone 시트 onEdit 설치형 트리거와 행 구조 변경은 영향 날짜를 재계산 대기로 영속하며, **원본 거래이력 외의 시트 데이터를 기준으로 보유수량을 추정하지 않습니다.**
- **예산·안전:** GAS 시간 기반 1시간 간격 worker가 pending이 있을 때만 기존 Snapshot 날짜 가격/NAV·거래원장과 기존 Snapshot/누락 Snapshot을 함께 포함하는 날짜 **최대 2개씩** 처리. 해당일 expected 거래원장/가격/NAV와 저장본이 GAS `VALID`일 때만 다음 날짜로 진행; 보호 대상 MANUAL/원자료 부족/미확정 충돌/중복은 대기를 유지합니다. 자동 전체 정리 또는 날짜 공란행 귀속은 하지 않습니다.
- **원장 쓰기 중단 보호:** 웹 syncTrades는 원장 A:K를 지우기 전에 과거 재계산 pending과 영속 `trade_ledger_write_unverified_v1` 표시를 기록. 쓰기 검증 완료 후에만 이 표시를 삭제합니다. 미완료 표시가 있으면 이후 웹 재동기화/시간 worker는 원본 재작성·Snapshot 계산을 모두 차단하고 보존된 거래원장 백업으로 수동 원천 복구 및 확인이 필요합니다. 운영 상태는 `WARNING`, 야간 점검은 `TRADE_LEDGER_WRITE_UNVERIFIED`로 표시합니다.
- **소급 날짜 보호:** 멀티셋 내용 변경과 매수·매도·분할 순서 변경의 영향 시작일 중 **최초 날짜**부터 재계산하며, 원장상 보유가 0임이 확인된 빈 날짜는 정상으로 인정하지만 보유가 있는데 행이 없는 날짜는 차단합니다.
- **기존 운영 일정 유지:** 22:10 당일 / 23:10 과거 / 00:30 추가 과거 KRX 백필, 08:45 T+1 KRX 원천 검증과 분리. 계좌·가격·토큰 상세 로그 미출력.
- **배포 후:** 실제 `getAutomationStatus`에서 `trigger.hasIntegrityEdit`·`trigger.hasLedgerRebuild` 참, pending 시작일과 worker trigger 1개씩 검증. 임시 소규모 테스트 거래 원장 수정→재계산 대기→GAS `VALID`→대기 해제를 독립 확인. API 변경 감지는 fingerprint로 대기 등록되지만, 오래된 충돌일에서 blocked될 수 있어 실제 데이터 최종 반영·운영 관측은 별도로 검증 필요.
- **Issue #507 잔여:** 역사적 충돌 160일·중복 초과 1,129행 및 날짜 공란 1,630행은 READ_ONLY expected 전체서명/원천 NAV·수량·원가 증명 전에는 쓰기 금지. 9/15·16 GAS VALID 39/39 유지.

---

## GAS v9.236 — 23:10·00:30 과거 백필 체크포인트 분리 (2026-10-19)

- 배포 상태: 병합 후 실제 gas-deploy 및 운영 `gasVersion=9.236` 확인 전에는 미배포. 승인 source blob `54840112e1ffa3292edda154d07e0a8b22747933`.
- 운영 시각: 22:10 당일 백필, 23:10 과거 백필, 00:30 다음날 과거 백필, 08:45 익영업일 KRX 공식 종가 재확인.
- 각 트리거의 진입은 별도의 RUNNING checkpoint로 기록합니다. 무작업·잠금 충돌·성공·예외 각각 상태/시간/안전한 enum만 저장하고 하드타임아웃은 RUNNING 잔존으로 판정합니다.
- 공유 과거 백필 마지막 결과, ScriptLock/lease, 국내외 Snapshot·가격이력·원장·펀드 NAV·대기열 해제 정책은 바꾸지 않습니다. 개인정보/인증정보 원문은 checkpoint에 저장하지 않습니다.
- 배포 후: 23:10, 00:30 실제 트리거 실행마다 `getAutomationStatus.historical2310Checkpoint`와 `historical0030Checkpoint`가 독립 갱신되는지 검증합니다. 실행 전 null은 정상이며 정상 작동 판정은 별도입니다.
- 9/15·9/16 Snapshot 충돌과 휴장 pending은 임의 삭제·일괄 정리하지 않습니다.

---

## GAS v9.235 — T+1 오전 08:45 KRX 확정 종가 자동 역사 백필 (2026-10-19)

릴리스 계약: `gasVersion=9.235`. KRX 10/16 금요일 종가는 다음 거래일 10/19 월요일 08:00 이후 게시 예상이며, 조회 가능 여부와 영속 복구는 분리하여 검증합니다.

- **실행:** 기존 22:10·23:10·00:30 야간 백필을 보존하고, KST 08:45 `runPortfolioMorningKrxBackfill0845` 시간 트리거를 추가합니다. Apps Script의 `nearMinute(45)` 오차를 감안해 08:30~10:14 KST 외에는 쓰기 없이 중단합니다. 토요일·일요일·KRX 공휴일·미지원 캘린더에도 실행하지 않습니다.
- **대상 날짜:** 운영 당일 이전 가장 최근의 검증된 KRX 거래일 **1건만** 선택합니다(10/19 → 10/16). 휴장 pending 10/09~11은 오전 우선순위를 막지 않습니다. 야간 round-robin 복구 커서는 변경하지 않습니다.
- **쓰기 전:** 해당 거래일의 대기열 포함 여부와 GAS `handleGetKrxHeldCloseCoverage`에서 원장·마스터 기반 보유 국내종목 전수의 실제 KRX/KRX_OTP exact-date 공식 종가, 중복·고아 코드 0을 검증합니다. 부족하면 `KRX_MORNING_AWAITING_PROVIDER_PUBLICATION`으로 즉시 중단하고 원본 시트/대기열 무변경.
- **안전한 복구:** 검증된 경우 기존 `_runPendingKrxBackfillWithLease_` writer를 사용하며 ScriptLock, 펀드·통합마감 lease, PRICE/Snapshot 백업/충돌 보호, 국내외 전체 Snapshot 무결성·거래원장 검증, 성공 후 대기열 해제를 그대로 적용합니다. 해외 보유를 일괄 차단하는 수동 targeted API는 사용하지 않습니다.
- **배포 상태:** 코드 PR/테스트 확인 전에는 **미배포·미운영**입니다. 병합 뒤 gas-deploy 성공과 운영 GAS v9.235, Apps Script 실제 시간 트리거 **정확히 1개 등록**을 별도로 확인해야 합니다. GAS 웹앱 배포만으로 신규 time trigger가 생긴다고 가정하지 않습니다.
- **배포 후 실측:** `getAutomationStatus`의 08:45 트리거, 10/16 official KRX held 37/37(동적 분모 우선), 가격이력 exact-date, Snapshot 기대/저장 39/39, 원장·출처 VALID, 10/16 pending 해제, 10/09~11 휴장 대기열 불변을 각각 확인합니다. 22:10/23:10/00:30 복구 로그와 오전 실행 여부도 구분 확인해야 합니다.

---

## GAS v9.234 — Toss 고정 IP 중계 opt-in 준비 (2026-10-17)

릴리스 계약: `gasVersion=9.234`. 인증된 `handleGetSettings` 및 `getAutomationStatus` 응답, 웹 표시 버전 정합성을 배포 이후 확인.

- **기본 동작:** `TOSS_RELAY_MODE` 가 `ON`이 아니면 기존 GAS Toss 직접 경로와 KRX/가격이력/Snapshot 자동화는 기존과 같습니다. 오라클 계정·VM/공인IP/도메인 없이 GAS relay 전환 **금지**.
- **전환 조건:** OCI Always Free VM의 고정 출구 IPv4 + Toss 허용IP 등록 + `verify-live.mjs` 인증 및 시세 확인 후, GAS Script Properties에 `TOSS_RELAY_URL=https://<subdomain>/v1/fetch`, `TOSS_RELAY_SHARED_KEY`, `TOSS_RELAY_MODE=ON`(가장 마지막) 설정. 인증값을 GitHub·로그·웹에 기록하지 않습니다.
- **릴레이 동작:** `_tossRequest_` 의 요청만 고정 HTTPS market-data-only relay에 전달. 액세스 토큰은 Oracle relay만 발급·캐시하며 ON 상태에서 GAS의 직접 OAuth 요청을 차단합니다. 302 등 redirect 차단, 비TLS·IP URL·임의 경로·임의 엔드포인트 거부. 호출 실패 시 Toss 시세만 실패로 처리, KRX 대체/유효 공식 종가 제한은 유지. `TOSS_RELAY_MODE=OFF`는 롤백만 수행하며 동일 Toss client 신규 OAuth를 여러 위치에서 발급하지 않도록 VM relay 정지 후 순차 전환.
- **안전:** 시장 데이터만 허용. 주문/계좌/자산 접근 없음, 원본 과거 가격이나 Snapshot 직접 변경 없음. 실데이터 검증 전 `FINAL_KRX` 판단 금지.
- **기존 예약 트리거 보존:** 19:00 마감, 20:30 watchdog, 22:10 백필, 23:10 과거 백필, 00:30 과거 백필. 릴레이 opt-in은 이 일정과 KRX 가격 저장·백필 로직을 변경하지 않습니다.
- **배포 후 검증:** 실제 GAS 웹앱 `gasVersion=9.234`, 웹 예상 버전, `TOSS_RELAY_MODE=OFF` 기존 경로 불변, OCI relay live 005930 정상 확인 뒤에만 `ON` 전환, 37종목 시세 응답 및 KRX 저장 계약 검증. 실증 전 정상 운영 판정 금지.
- **배포 상태(2026-10-18 23:31 KST):** [gas-deploy 39136238042](https://github.com/cyyoung111-dev/portfolio/actions/runs/39136238042)에서 **GAS v9.234 / Apps Script version 286 / webApp verified**, Quality/Web CI 모두 성공. [Toss 실운영 진단 39136238017](https://github.com/cyyoung111-dev/portfolio/actions/runs/39136238017)은 OAuth `NETWORK` HTTP 403 `access_denied`, 진단 시 relay 미연결. 즉 코드 배포는 확인됐으나 **Oracle VM·고정 outbound IP·DNS/TLS·WTS 허용IP·시세 중계 실연결은 미완료**. 신규 무료 VM 설치 PR #539 기반 설치기와 검증기는 DNS A 단일 목적지/AAAA 없음 및 root 비밀파일 소유권까지 오프라인 강화. `TOSS_RELAY_MODE=ON`은 실제 Toss 005930 다회 검증 후 수동 설정.

---

## GAS v9.233 — KRX 완료일 검증 2일 순환·기아 방지 (2026-10-16)

- **운영 근거:** v9.232 배포 후 10/08 기간 Snapshot `VALID` 39/39행·수치/출처 차이 0건. 그러나 10/06~16 총 11일 pending(휴장 10/09~11 포함), 운영 `overallStatus=ERROR`. 읽기 전용 [실운영 진단](https://github.com/cyyoung111-dev/portfolio/actions/runs/38889748797)을 통해 확인.
- **확인된 코드 원인:** `_pruneVerifiedHistoricalKrxPending_`가 가장 오래된 거래일 2일만 반복 검사하여, 해당 날짜가 완결 증명에 실패하면 뒤의 10/08 `VALID` 날짜를 검사하지 못하는 *기아 가능성*. 휴장일은 2일 증명 예산에서 제외합니다.
- **변경:** 같은 ScriptLock·소유 lease 안에서 별도 `portfolio_close_backfill_prune_cursor_v1`를 순환시키며 1회 최대 2일을 검증합니다. 실패·예외 시에도 커서를 전진시키되, 대기열에서는 KRX 당일 공식 가격이력·원장 수량·전체 국내외 Snapshot `VALID`까지 입증된 날짜 **만** 제거합니다. 기존 실제 백필 재시도 커서는 변경하지 않습니다.
- **비변경:** KRX 가격 수집·원천일 정책, 휴장일 큐, 9/15·16 충돌·MANUAL, 가격이력·Snapshot·NAV·거래원장, Toss, 22:10/23:10/00:30 트리거, 타 백필 일자 선택 정책.
- **배포 상태:** 검토 및 CI 진행 중이며 운영 v9.233 반영 확인 전. 기존 실운영은 v9.232(배포 버전 284). PR 병합만으로 pending 감소나 휴장 복구를 선언하지 않습니다.
- **배포 후:** GAS `gasVersion=9.233`, 실제 Apps Script 웹앱 버전·최신 실데이터 `getAutomationStatus`·10/06~16 날짜별 정합성 및 pending 확인. 등록된 야간 작업 이전에는 자동 큐 정리 완료를 주장하지 않습니다.
- **승인 소스:** 전체 GAS blob `3f7d34c3680c737b4f21c09540fa46d2a17eadb4` 승인 고정; 생산 함수 VM 2건 proof 순환/휴장/lease/오류·원본 보호 회귀, Quality/GAS/Web CI, 최신 Codex 유효 P1/P2 미해결 0건.

---

## GAS v9.232 — 기간 Snapshot 진단 펀드 NAV 출처 정합성 수정 (2026-10-16)

- **원인:** 10/08 단일 날짜 Snapshot 진단은 `VALID`(39/39행)이나 기간 진단은 F00001/F00002 펀드 출처 2건만 `MISMATCH`였습니다. 기간 생성기 `_buildIndexedSnapshotRows`가 NAV 이월일자 `@YYYY-MM-DD`를 누락하고 NAV가 확정돼도 가격이력이 있으면 NAV를 우선 적용하지 않는 차이를 확인했습니다.
- **변경:** 기간 진단에서 유효한 펀드 NAV 평가금액을 날짜별 진단처럼 우선하고 이월 원천일을 `FUND_NAV_CARRY@YYYY-MM-DD`로 생성합니다. 금액·출처·저장일시를 생산 함수로 회귀 검증합니다.
- **비변경:** 단일 날짜 진단, KRX 종가·가격이력·Snapshot 원본, 10/09~11 pending, 거래원장·NAV·Toss, 22:10/23:10/00:30 예약 트리거.
- **배포 상태 — 운영 반영 확인 (2026-10-16 19:41 KST):** PR #527 병합 `f541de05` 후 [gas-deploy 실행 38888833784](https://github.com/cyyoung111-dev/portfolio/actions/runs/38888833784) 성공. 로그상 **GAS v9.232 / Apps Script 배포 버전 284 / 운영 웹앱 검증 성공**. KRX 10/12·10/13 공식 원천 37/37종목씩 확보됐으나 가격이력·Snapshot 영속 복구를 의미하지 않습니다. 10/08 기간 진단 `VALID` 및 10/09~11 pending 해제는 별도 재조회 전까지 미확인입니다.
- **배포 후 검증:** 운영 인증 `getSettings`/`getAutomationStatus`의 `gasVersion=9.232`, 10/08 기간·단일 진단 39/39행 `VALID`와 출처·금액 불일치 0건, 10/09~11 휴장 pending 상태를 **읽기 전용**으로 재검증합니다. `gas-deploy` 완료 성공 이후 `krx-holiday-september-readonly`에서 자동 재조회하고 날짜별 값이 확인되기 전에는 복구 완료로 보고하지 않습니다.
- **승인 소스:** GAS 전체 blob `e2d6094e78c5c8867d7219f038e5f3b6f440d554` 고정 및 기간 진단 실제 함수 VM 회귀·Quality/GAS/Web CI·Codex 중요 P1/P2 검증 필수.

---

## GAS v9.231 — 10/08 펀드 Snapshot 출처 2셀 서버 원자정합화 (2026-10-16)

- **수정 전 진단:** GAS 실운영 `diagnoseSnapshotIntegrityRange`에서 10/08은 39/39행으로 가격·보유수량·원가·평가단가·평가액이 전부 일치하지만, **F00001·F00002 출처 2건만 현재 기대값과 달라 MISMATCH**입니다. 직전 확정 Snapshot `VALID` 검증이 필요한 10/09~11 휴장 큐를 처리하는 데 장애가 될 수 있습니다.
- **안전 계약:** 신규 인증 POST `repairOct08FundSourceOnly`는 **고정 2026-10-08**에만 작동하며 GAS **ScriptLock 안에서** 기대행 39개와 기존행 39개의 날짜·코드·종목명·모든 수치·저장일시·비대상 출처가 **완전 일치**하는지 재검증합니다. MANUAL·중복·수치/원장 충돌·펀드 외 출처 변화가 하나라도 있으면 **쓰기 전 차단**합니다. 범용 `rewriteSnapshotDate`는 호출하지 않습니다.
- **변경:** 성공 시 서명 검증된 `스냅샷` 백업을 생성한 뒤, 두 펀드의 **K열 평가출처 2셀만** 변경합니다. 실패 시 원래 셀값 롤백을 시도하고 백업을 WRITE_FAILED로 보호합니다. 전후 `diagnoseSnapshotIntegrity`가 `VALID`여야만 완료 처리합니다.
- **비변경:** 가격이력, 거래원장, 펀드 NAV/좌수, 9/15·16 Snapshot 충돌·MANUAL, Toss API, 10/09~11 pending 큐 마커 및 KRX 장전·마감 트리거.
- **운영 트리거 기존 일정 보존:** KST **22:10** 당일 미완료 백필, **23:10** 과거일 복구, 익일 **00:30** 과거일 복구. 이 출처 보정 PR은 트리거 등록·스케줄·휴장 대기열 큐를 변경하지 않습니다.
- **배포 상태 — 운영 적용 확인 (2026-10-16 18:20 KST):** PR #524 병합 `39a23147` 후 `gas-deploy` 실행 [38879523394](https://github.com/cyyoung111-dev/portfolio/actions/runs/38879523394) 성공. 배포 스크립트는 기존 웹앱 배포가 이미 GAS v9.231 소스와 일치하고 운영 endpoint 검증을 통과했음을 확인하여 중복 배포를 생략했습니다. 이를 실제 신규 버전 배포로 오인하지 않습니다.
- **10/08 운영 결과 (2026-10-16 18:21 KST):** [일회성 복구 워크플로 38879753438](https://github.com/cyyoung111-dev/portfolio/actions/runs/38879753438) `SOURCE_ONLY_APPLY=1` 실행에서 `{"mode":"ALREADY_VALID","date":"2026-10-08","changed":0}` 반환. 기존 `VALID` 39행 판정으로 추가 데이터 쓰기는 수행하지 않았습니다. 10/09~11 큐까지 완료된 증거는 아닙니다.
- **남은 과제:** PR #523의 2026-10-16 17:10 KST 읽기 전용 진단에서 휴장 pending 10/09~11 세 건과 해당 날짜별 Snapshot 0행, 9/15·16 기존 중복·충돌 확인. PR #524의 18:21 기준선 `VALID` 이후 첫 22:10/23:10/익일 00:30 재시도 실결과는 아직 미확인입니다. 읽기 전용 진단 워크플로에서 휴장일 `diagnoseSnapshotIntegrityRange` 기대/저장 행 및 공유된 마지막 과거 백필 시도 기록을 확인한 뒤 원본 변경 여부를 판단합니다. 이 기록만으로 23:10과 00:30 트리거의 개별 실행 여부는 판정할 수 없으므로, 실행별 heartbeat는 별도 GAS 개선 대상으로 유지합니다.
- **배포 후:** GAS `gasVersion=9.231`, 운영 웹앱 버전/배포 완료, 신규 원자적 endpoint의 출처 2셀 제한 적용 결과, 10/08 `VALID`, 기존 수치 39행 불변, 10/09~11 큐 보존 및 다음 휴장 백필 결과를 각각 확인합니다.
- **배포-복구 실행 순서:** `main` GAS 소스 변경으로 실행된 `gas-deploy` 전체 워크플로가 **성공 완료된 뒤**에만 신규 `workflow_run` 작업이 시작됩니다. 실제 운영 `getAutomationStatus.gasVersion=9.231`을 인증 확인한 후에만 10/08 두 셀 출처 수정을 허용합니다. GAS 검증만 성공하고 실제 배포가 스킵된 경우 v9.230 상태라면 쓰기 전 차단합니다.
- **검증 게이트:** 승인된 GAS 소스 전체 blob SHA `815c0b60e4d54ef04c05dd2d618e6bce052d41d6`, VM 생산함수 테스트, Quality/Web/GAS Validate, Codex 유효 P1/P2 미해결 0건. `workflow_run`의 복구 대상 HEAD 직접 부모가 검토된 `main b1122ab3d006`이 아닌 경우에는 최초 적용을 허용하지 않습니다.

---

## GAS v9.230 — 휴장일 대기열 선두로 인한 KRX 완료일 검증 지연 방지 (2026-10-16)

- **원인:** 10/09(휴장) 및 10/10~11(주말)이 백필 pending 큐 선두에 남아, 이전 사전 정리 함수의 `slice(0,2)`가 해당 날짜만 반복 확인했습니다. KRX 공식 종가가 없는 날에 exact-date KRX 영속 검증을 적용하는 사전 정리에서는 완료된 10/12~14 검증까지 도달하기 어렵습니다.
- **변경:** KRX `CLOSED`로 확정된 날짜는 **사전 정리 검증 대상에서만** 제외하고, 가장 오래된 KRX 비휴장일 2개를 순서대로 검증합니다. 단일 ScriptLock/lease, 해당일 KRX 종가 및 **국내외 전체 Snapshot** 검증 후에만 그 날짜의 큐를 해제합니다. 휴장 대기일은 삭제하지 않고 일반 휴장/해외 마감 재시도 경로에 보존합니다.
- **비변경:** 10/15의 공식 종가 exact-date 미확보에 대한 차단, Toss 인증·API, 9/15·9/16 중복 Snapshot, 거래원장/NAV/가격 쓰기 및 22:10/23:10/00:30 KST 트리거 스케줄.
- **배포 상태 (2026-10-16 확인):** PR #519 병합 `main e3246653d563`, 운영 GAS v9.230 / Apps Script 배포 버전 282 / webApp 버전 검증 성공. CI·Codex 최신 리뷰 통과. 10/12~14 PRICE·Snapshot 영속 검증은 성공했으나 pending 해제 및 10/15 복구는 별도 운영 작업으로 남음.
- **배포 후:** getSettings 및 실제 GAS `gasVersion=9.230`, pending 날짜별 보존/해제, 운영 시트 10/12~14 KRX 37행+Snapshot 39행, 10/15 exact-date 공식 종가와 미복구 보호, 과거 휴장 pending 분리 진단.
- **안전 게이트:** Quality/Web/GAS validate, 실제 생산 함수 VM 회귀, Codex 중요 P1/P2 0건, 전체 승인 소스 blob 해시 일치 확인 후 병합 판단.

---

### 운영 KRX 야간 상태 자동 점검 (GitHub Actions)

- 새 `.github/workflows/krx-nightly-health.yml`은 **매일 KST 02:30(UTC 17:30)** 이후, 야간 백필 22:10/23:10/익일 00:30에 이어 운영 결과를 읽기 전용으로 확인합니다. GitHub 예약 실행은 운영자/서비스 사정에 따라 지연될 수 있습니다.
- 인증된 `getAutomationStatus`를 호출하는 기존 `diagnose-backfill-status.mjs` 결과만 사용하며, 트리거 누락/중복, 잔여 KRX pending, 운영 ERROR/WARNING, 공식 KRX 마지막 날과 Snapshot 마지막 날의 불일치를 판정합니다.
- 실패 시 GitHub Actions 기록에 잔여 날짜·개수·비민감 상태코드만 남깁니다. **가격/NAV/Snapshot/거래원장/ScriptProperties 변경, 큐 자동 삭제, 외부 비용 발생 작업은 하지 않습니다.**
- 예약 실행 성공은 GAS 백필 실행 성공을 대체하지 않습니다. 실제 복구의 마지막 날짜별 PRICE/Snapshot 원본 검증은 별도 유지합니다.

---

### 2026-10-12~14 운영 KRX 완료일 대기열 일회성 정리

- [PR 작업] `krx-verified-pending-finalize.yml`은 최초 `main` 도입 push에서 **이전 부모 커밋이 승인된 고정 main SHA `d18070fa3c85ced8b3f10c7ea83e03d6b264d7f5`와 같고**, 해당 부모에 파일이 없으며 HEAD의 직접 부모임이 확인된 경우에만 자동 apply=1을 허용합니다. **이후 삭제 후 재도입하더라도 부모 SHA가 달라져 자동 적용이 차단되며**, 병합 이전에 다른 변경이 main에 들어오면 의도적으로 dry-run으로 중단합니다. 이후 workflow 파일을 편집한 push에서는 **읽기 전용 dry-run**으로만 실행되며, 추가 적용은 명시적 수동 `workflow_dispatch apply=true`가 필수입니다. 승인 범위는 2026-10-12~14 완료 pending marker 해제에 한정됩니다.
- `finalize-verified-krx-pending.mjs`는 **10/12, 10/13, 10/14 고정 3일**만 인정하며, 먼저 인증된 `apply=0`으로 각 날짜의 공식 KRX 37종목·국내외 전체 Snapshot 검증 결과를 확인합니다. 셋 중 하나라도 실패하면 **큐를 전혀 변경하지 않습니다.**
- 3일이 모두 검증됐다면 `apply=1`을 **대상 날짜당 1회** 순차 호출합니다. GAS `handleReconcileCompletedKrxPending`가 각 시점에 ScriptLock/Writer lease/전체 가격·Snapshot 증명을 재검사하고, **검증 완료된 해당 날짜의 pending 마커만 삭제**합니다. 호출 실패 시 안전 중단하며 재실행은 멱등입니다.
- 마지막에 다시 인증된 `apply=0`으로 세 날짜의 pending=false/verified=true를 재확인해야 성공으로 판정합니다. 가격이력·Snapshot·거래원장·NAV·백업은 읽기만 합니다. 최악 요청 예산은 사전·사후 2회 × (인증 1건 + 날짜별 3건) × 90초 + 적용 3회 × 120초 = **18분**이며, GitHub job 제한은 여유를 둔 **25분**으로 설정했습니다.
- **비대상 보호:** 10/09~11 휴장 대기, 10/15 미복구, 9/15~16 충돌·MANUAL 원본은 수정하지 않습니다. 실제 Workflow apply 수행/대기열 해제 성공은 PR 병합 로그가 아닌 워크플로 응답 및 운영 재진단으로 확인합니다.

---

## GAS v9.229 — KRX 백필 영속 검증 후 대기열 완료 (2026-10-16)

- **변경:** 백필 PRICE 저장 후 ScriptLock 안에서 영속 검증·마감 상태 정합화·pending 해제를 일괄 수행합니다. 일반 KRX 거래일에 국내 보유가 있으면 해당일 공식 종가·Snapshot을 검증하며, 국내 휴장일 또는 해외 전용 보유는 요청일 KRX 강제 검증 없이 실제 Snapshot 날짜를 사용합니다. **모든 경우**에 국내외 전체 Snapshot의 수량·원가·평가·출처 정합성과 저장 행 수를 동일 ScriptLock 아래 재검산합니다. 검증 실패·중간 거래원장 변경·정합화 실패 시 대기열을 보존합니다.
- **큐 삭제 경로 일원화:** 정상 KRX 거래일의 동일 날짜 완료 증명 함수에 국내외 전체 Snapshot 검증을 포함시켜, 재시도·22:10/23:10/00:30 사전 정리·인증된 수동 대기열 정리에서 같은 안전 조건을 적용합니다. 원천상 KRX 휴장/해외 전용 재시도는 실제 Snapshot 날짜를 별도로 검증합니다.
- **안전:** 9/15·9/16 등 과거 충돌 원본은 자동 정리하거나 덮어쓰지 않습니다. 기존 Toss 403 진단은 유지합니다.
- **운영 트리거:** KST 22:10 당일 백필(`runPortfolioCloseBackfill2210`), 23:10 과거 백필(`runPortfolioHistoricalBackfill2240`), 익일 00:30 과거 백필(`runPortfolioHistoricalBackfill0010`). 기존 트리거 스케줄과 담당 작업은 변경하지 않습니다.
- **검증:** 전체 GAS 소스 검토 및 해시 승인, 회귀 테스트, quality-check와 gas-deploy validate 통과, Codex 리뷰 후 병합·운영 적용을 판단합니다.
- **배포 후:** 운영 GAS `gasVersion=9.229`, 백필 완료/오류 로그, 대기열 보존, 가격이력·Snapshot 정합성을 읽기 전용으로 확인합니다.
- **배포 상태:** PR #518 검토 중. **운영 배포 미실시**. 기존 운영 버전은 별도 확인 필요.

---

## GAS v9.228 — Toss 실제 HTTP 403 공급사 오류코드 세분화 (2026-10-15)

- **배경:** 운영 PC는 같은 GAS v9.227과 캐시 토큰으로 5개 시장 API·삼성전자 현재가 모두 200, 모바일 데이터망은 캐시 토큰으로 6개 리소스 전부 403, GitHub Actions 신규 OAuth는 403 `access_denied`. 동일 HTTP 403에서 GAS가 원문 오류를 하나의 `IP_NOT_ALLOWED_OR_FORBIDDEN`으로 통일하여 실제 토스 `ip-not-allowed`와 `forbidden`·`edge-blocked`를 구별할 수 없었음.
- **영향 범위:** KRX/원장/Snapshot 저장 로직과 예약 트리거 **22:10 당일 / 23:10 과거 / 00:30 과거 백필**은 변경하지 않음.
- **수정:** Toss 403 응답 JSON에서 **검증된 3개 코드만** `providerCode`로 전달하고, 그 외 문자열·비JSON·불명형식은 `UNKNOWN_403`만 제공. 자격증명·access token·원문 body·메시지·헤더 원본을 포함하지 않음. 기존 `code` 및 OAuth Cache·현재가·원장·Snapshot 동작 유지.
- **배포 상태:** PR 후보 코드·테스트 검토 중. **현재 운영 GAS v9.227**과 구분. 승인/병합 전 v9.228 운영 배포는 수행하지 않음.
- **배포 전:** 9.228 전체 GAS 소스 Git blob `c326fc480dca53de86f72938f9585dc61f995422` 승인 pin 검증, 헤더·실제 API `gasVersion`·웹 `EXPECTED_GAS_VERSION=9.228` 정합, Toss 403 세 코드·알 수 없는 응답의 변이 테스트·품질 게이트/독립 리뷰 확인.
- **배포 후:** GitHub Actions 실제 GAS 배포 실행 및 웹앱 getSettings `gasVersion=9.228` 확인. PC/모바일 **새 연결 진단**에서 리소스 403 `providerCode`와 각 `requestId`를 대조하여 원인 확정. OAuth forceFresh 금지. 특정 endpoint에서 `ip-not-allowed`를 확인해도 각 기기/실행의 실제 Toss 출구 IP를 직접 검증한 것은 아님.

---

## GAS v9.227 — #511 지정 KRX 복구의 해외 보유 사전검증 (2026-10-15)

- 한 날짜 전용 `recoverPendingKrxClose`는 `apply=0` 사전검증에서 실보유 해외/비-KRX 종목을 확인하면 `TARGET_FOREIGN_DATE_CONFLICT`로 차단합니다. 실제 적용이 `TARGET_CROSS_DATE_PRICE`로 실패하는 경우를 백업/lease 획득 전에 차단하여 거짓 `ready:true`를 방지합니다.
- 국내 KRX만 실제 보유한 대상일은 기존 사전검증·백필 동작을 그대로 유지하며, 일반 19시 마감/야간 재시도/해외 장의 다른 날짜 가격 기록 계약은 변경하지 않습니다.
- 전체 실데이터 복구 및 기존 9월 Snapshot 중복 정리는 별도 검증·승인이 필요합니다. GAS 소스, 웹 기대 버전 및 배포 승인 blob SHA는 이 PR에서 동일 버전으로 유지합니다.

- **기존 예약 일정 유지:** KST 22:10 당일 백필, 23:10 과거 백필, 00:30 자정 이후 과거 백필은 변경하지 않습니다. 이 PR의 차단은 명시 지정한 1일 제한 복구 전용입니다.
- **배포 상태:** PR #512는 2026-10-15 18:25 KST 병합, 18:26 KST 실제 Apps Script v279에 GAS v9.227 배포 및 getSettings 운영 응답 확인 완료. KRX 10/12·10/13 보유 37코드 읽기 전용 검증 성공.
- **배포 후:** 승인된 CI·GAS 실제 배포와 `getSettings`, `getAutomationStatus`, Toss 진단 응답의 `gasVersion=9.227`을 각각 확인합니다. `recoverPendingKrxClose`의 해외 혼재 날짜 dry-run이 `ready:false / TARGET_FOREIGN_DATE_CONFLICT`로 **원본 백업/가격/Snapshot 쓰기 전에** 차단되는지, 국내 KRX 전용 날짜는 기존 사전검증을 유지하는지, 기존 트리거/큐/원장/NAV·가격·스냅샷에 부작용이 없는지 별도로 확인합니다. 운영 검증 전에는 복구 정상화를 선언하지 않습니다.

---

## GAS v9.226 — 누락 과거일 한 날짜 제한 복구 (배포 전)

- **배포 상태:** 후보 소스 및 회귀 검사 단계. 운영은 v9.225이며 복구 성공을 아직 주장하지 않습니다.
- **기존 일정:** 22:10 당일 및 23:10/00:30 과거 백필은 기존 순환 선택·lease 경로를 유지합니다.
- **목적:** 야간 작업의 자동 날짜 선택이나 일반 Snapshot 재작성으로 우회하지 않고, 명시한 미완료 과거일 한 날짜만 기존 exact-date 백필로 처리합니다.
- **기본 진단:** 인증된 POST `recoverPendingKrxClose`에서 `date=YYYY-MM-DD`, `apply=0`(기본). 엄격한 과거일, 실제 pending, 해당일 Snapshot 0행, 기존 보유 KRX/비공식 가격 0건, 마스터·원장 및 공식 원천 전량 일치를 확인합니다. 진단은 시트·Properties·백업을 변경하지 않습니다. 인증 비활성 및 GET 요청은 적용할 수 없습니다.
- **명시 적용:** `apply=1`만 쓰기를 허용합니다. 기존 공유 writer lease를 얻은 뒤 상태를 다시 검사하고 가격이력·Snapshot의 검증된 작업 백업을 먼저 만듭니다. 실제 저장 재조회도 KRX 전량 exact-date여야 하며 이후 Snapshot/원장 검증 성공 뒤 해당 날짜 큐만 완료합니다. 다른 큐·순환 커서·당일 마커를 보존하고, 기존 Snapshot/가격이 있거나 backup/source/검증 실패 시 중단합니다. 부분 저장은 실패로 보고하며 자동 반복하지 않습니다.
- **다른 거래일 쓰기 차단:** 해외 보유의 최근 완료 세션 등 실제 가격 날짜가 대상일과 다른 행이 하나라도 있으면 첫 가격 쓰기 전에 중단합니다. 기존 해외 종가를 다른 날짜에 갱신하지 않습니다. 일반/자동 마감의 해외 세션 정책은 유지합니다.
- **운영 절차:** 전체 워크북 외부 백업을 먼저 보존하고 `krx-targeted-recovery` 워크플로를 main에서 한 날짜·apply=false로 실행합니다. 적용 대상과 백업을 확인한 뒤 같은 날짜·apply=true를 명시합니다. 전송 타임아웃/오류 후에는 먼저 읽기 전용 조회로 부분 완료 여부를 확인합니다.
- **배포 후:** 승인된 main CI·GAS 배포 및 `gasVersion=9.226`을 확인합니다. 적용 뒤 정확한 KRX 가격·Snapshot 수량/원가/평가/출처·그 날짜 queue 해제와 다른 날짜/NAV/MANUAL/백업 보존을 별도로 검증합니다. 배포나 원천 조회만으로 복구 완료를 선언하지 않습니다. #507의 다른 날짜 중복은 처리하지 않습니다.

---

## GAS v9.225 — standalone 과거 백필 트리거 설치 (배포 전)

- **배포 상태:** 후보 소스 및 테스트만 준비합니다. 병합·운영 배포·트리거 설치·데이터 복구는 미완료입니다. 운영은 v9.224입니다.
- **원인:** 운영 standalone 프로젝트 편집기에서 기존 `repairMissingDailyTriggersPrompt()`는 `SpreadsheetApp.getUi()` 예외로 트리거 등록 전에 실패합니다.
- **변경:** 운영 소유 계정이 편집기에서 `installMissingHistoricalBackfillTriggers()`를 명시적으로 실행하면 누락된 23:10/00:30 과거 백필 트리거만 설치합니다. 같은 함수를 반복 실행해도 기존 트리거를 추가·삭제·재설정하지 않습니다. 기존 중복은 개수로 보고하고 보존합니다. 이 함수는 HTTP API나 자동 실행 경로에 연결하지 않습니다.
- **보호:** ScriptLock 안에서 존재 여부를 확인합니다. 시트·Properties·큐·MANUAL/NAV·백업을 읽거나 쓰지 않고, 즉시 백필도 실행하지 않습니다. 일부 설치 실패 시 성공한 트리거를 보존하고 다음 실행에서 나머지만 설치합니다.
- **기존 일정:** 22:10 당일 백필과 23:10/00:30 과거 백필의 기존 실행·공유 lease·데이터 보호 경로는 유지합니다.
- **배포 후:** 별도 승인된 배포가 끝난 뒤 운영 계정에서 설치 함수를 실행하고 로그의 두 count가 각각 1인지 확인합니다. 인증된 읽기 전용 `getAutomationStatus`에서도 등록 개수·중복을 재확인합니다. 계정별 트리거 조회 범위를 넘는 다른 소유자의 등록 여부는 이 결과로 단정하지 않습니다.
- **운영 검증:** KST 23:10 및 익일 00:30 회차의 실제 실행·대상 날짜 공식 KRX 저장·Snapshot·대기열 결과를 각각 확인합니다. 등록 성공만으로 10/12~14 복구 완료를 선언하지 않습니다.

---

## GAS v9.224 — KRX 당일·과거 누락일 시간 분리 복구 (PR #505, 배포 전)

- **배포 상태:** 본 PR의 CI 및 코드 리뷰 검증 중. 병합 또는 운영 GAS 배포를 완료한 것으로 기록하지 않습니다. 기존 v9.223 배포 이력과 구분합니다.
- **배포 전:** `quality-check` 및 `gas-deploy` 검증 성공, 리뷰 지적사항 해결, 승인된 v9.224 GAS 소스 해시 일치, 웹 `EXPECTED_GAS_VERSION=9.224` 확인.
- **배포:** main 병합 후 승인된 GAS 배포 워크플로 결과와 실제 Apps Script 배포 버전을 별도로 확인합니다. 배포 성공 로그만으로 운영 응답 버전이 변경됐다고 단정하지 않습니다.
- **배포 후:** 인증된 `getSettings` 및 `getAutomationStatus` 응답의 `gasVersion=9.224`와 웹 버전 경고 부재를 확인합니다. 인증 토큰·개별 종목가격·원본 응답은 로그에 남기지 않습니다.
- **22:10 동작:** 당일 PRICE·Snapshot 누락이 있으면 당일 날짜만 재시도합니다. 당일 실패가 과거 누락일 복구를 독점하지 않습니다.
- **23:10 / 00:30 동작:** 독립 일일 트리거가 과거 누락일 1건만 순환 커서로 재시도합니다. 두 작업은 동일한 lease/lock을 사용하며 실패 시 큐를 보존합니다. 신규 트리거는 GAS 운영 설치/자가복구 후 실제 등록 상태를 별도로 확인해야 합니다.
- **검증:** 당일 PRICE/Snapshot 성공 여부, 과거 KRX exact-date 공식 종가 37건 및 Snapshot 39행, 날짜별 `queuedForBackfill=false`를 실제 운영에서 각각 확인합니다. 실패·불일치·타임아웃 시 해당 날짜 큐 항목을 유지하고 기존 lease/lock과 Snapshot/NAV 보호를 유지합니다. 2026-10-12·13 누락분은 운영 확인 전까지 복구 완료로 표시하지 않습니다.
- **실패 시:** 버전 불일치 또는 백필 이상 발생 시 배포 진행을 중단하고 원천 응답·운영 상태를 비민감 진단으로 확인합니다. 대기열을 수동으로 일괄 삭제하지 않습니다.

---

## GAS v9.223 — 22:10 백필의 완료된 KRX 대기일 자동 정리 (2026-10-14)

기존 22:10 `runPortfolioCloseBackfill2210()`가 소유한 7분 backfill lease 안에서, 과거 대기일 최대 **2일**에 대해 기존 검증기 `_verifyCompletedKrxPendingDate_`로 가격이력(KRX/KRX_OTP exact-date)·Snapshot·수량/평가·**해당일 소급 거래원장 수량과 Snapshot 수량 일치**·원장/마스터 정합성을 확인합니다. 모든 검사가 통과한 날짜의 **ScriptProperties 큐 항목만** ScriptLock 하에서 제거합니다. 미완료 날짜, 예외, 잠금 만료 시 원본 마커를 유지합니다.

- 완료 마커 정리 뒤 **기존의 날짜당 최대 1회** 백필 재처리 경로로 들어가므로, 2026-10-12 / 2026-10-13 누락일은 여러 회차에 걸쳐 저장될 수 있습니다. 소유한 snapshot/NAV/마감 소유권은 변경하지 않으며, 19시 마감 경로에서는 정리를 실행하지 않습니다.
- 실제 운영 요청에서 10/7·10/8은 앞선 PR #502 dry-run에서 각 37개로 READY, 10/12·10/13은 PR #503 공식 원천 37/37이지만 운영 가격이력/Snapshot은 비어 있었습니다. **본 PR 배포만으로 실제 복구됐다고 간주하지 마세요.** 22:10 실행 후 `가격이력` 각각 KRX 37, `스냅샷` 날짜별 39 및 `queuedForBackfill=false`를 검증해야 합니다.
- 실제 백필은 기존 `saveDailyPriceHistory`의 정확한 KRX 원천일·Snapshot 불일치 안전장치를 그대로 사용하며, 검증되지 않은 날짜는 절대 사전 제거하지 않습니다. 운영 인증 토큰은 어떤 Actions/PR에도 출력하지 않습니다.

---

## GAS v9.222 — KRX 보유 37개 종목 공식 종가 일치 확인 (2026-10-14)

- 인증된 `getKrxHeldCloseCoverage&date=YYYY-MM-DD`는 해당일 실제 보유한 KRX 종목을 거래이력/코드마스터에서 읽어, 37개 전체의 `KRX/KRX_OTP` 공식 원천일 일치 건수를 집계합니다. 개별 보유코드·가격·API 키·응답 원문을 출력하지 않습니다.
- `expectedHeldCodes`, `officialExactDateCodes`, `missingCodes`, `staleCodes`, `duplicateMasterCodes`, `orphanLedgerCodes`, STOCK/ETF 그룹 집계 및 `ready`만 응답합니다.
- 예상 결과는 2026-10-12 및 2026-10-13 각각 37/37이지만 **실제 원천 37개 전수 조회 전 확인된 사실이 아닙니다.** 이 단계는 읽기 전용이며 가격이력·Snapshot·pending/마감 상태를 변경하지 않습니다.
- 워크플로는 `diagnose-krx-held-coverage.mjs`를 실행하며 원천 37/37 완전 일치인 경우에만 진단 성공입니다. 실제 누락일 복구는 기존 `saveDailyPriceHistory`의 보호된 트리거/실행 소유권 조건을 통해 별도로 수행해야 합니다.
- 이전 배포 GAS 9.221, Apps Script 배포 버전 273과 구분해야 하며 PR 병합/실배포 전에는 이 기능이 운영에 없습니다.

---

## GAS v9.221 — KRX 야간선물 비민감 읽기 전용 진단 (#496, 2026-10-14)

- `getKrxK200NightDiagnostics`는 인증된 GET/POST `date=YYYY-MM-DD` 요청으로 선물 일별 원천의 HTTP 상태·JSON 구조·각 단계별 **건수**만 반환합니다. 요청 인증 토큰 외에 신규 외부 자격증명은 불필요합니다.
- 응답 `diagnostic`에는 `keyConfigured`, `primaryHttpStatus`, `alternativeHttpStatus`, `source`, `parseStatus`, `beforeNightFinalCutoff`, `stats`를 포함하며 원문/가격/종목 식별자/인증키는 노출하지 않습니다. 401/403이면 기존 보조 키를 안전하게 재확인합니다.
- 통계 단계: `totalRows` → `exactDateRows` → `exactDateNightRows` → `exactNightProductRows` → `validExpiryRows` → `unexpiredExpiryRows` → `positiveCloseRows` → `nearestExpiryRows` / `wouldSelect`. `nightMarketRows`는 요청일 외 데이터 혼입 확인용이며 `exactProductLabelVariants`는 상품 표기 차이 탐지용입니다.
- 읽기 전용 진단입니다. **NIGHT_FINAL 판단, KRX 선물 선택 조건, 브리핑 publication gate, PRICE/Snapshot/거래원장/시장 원장은 변경하지 않습니다.** 공식 원천이 확인되지 않은 상태에서는 MORNING 발행을 강행하지 않습니다.
- 병합·검증·실 GAS 배포 이후에만 운영의 관련 날짜에 호출하고, 문제 유형별 통계로 원인을 결정합니다. 이 문서 작성 시점에 원천 응답의 날짜별 통계는 아직 확인되지 않았습니다.

---

## GAS v9.220 / PR #498: KRX 완료일 pending 해제 (2026-10-14, 검증 중·운영 미실행)

- 기존 v9.219의 PRICE/Snapshot/NAV/거래원장 생성·저장 로직은 유지하고, **운영자 명시적 요청에 한해서만** 완료된 과거 KRX pending 마커를 ScriptLock으로 해제하는 인증된 POST 경로 `reconcileCompletedKrxPending`를 추가합니다. 배포만으로 마커 정리가 자동 실행되지 않습니다.
- 인증: 기존 `GAS_ACCESS_TOKEN`을 `accessToken`으로 전달하는 `application/x-www-form-urlencoded` POST. **실토큰·웹앱 URL·원본 데이터를 로그나 PR에 기록하지 마세요.** GET는 `POST_ONLY`로 거부합니다.
- **사전 확인(기본 dry-run)**: `action=reconcileCompletedKrxPending&dates=2026-10-07,2026-10-08&apply=0`. 응답 `mode=DRY_RUN`, 각 날짜 `ok=true`, `queued=true`, `verifiedCodes=37`이 충족되는지 운영 기록과 대조합니다.
- **반영(명시적 실행)**: 위 사전확인이 성공하고 CI·Codex 리뷰·main 병합·GAS 실배포·운영 `getSettings.gasVersion=9.220`를 확인한 뒤에만 동일 POST에 `apply=1`로 실행합니다. `mode=APPLIED`, `cleared=2`를 확인하고 날짜별 `getKrxSourceDiagnostics`의 `queuedForBackfill=false`를 재검증합니다.
- 보호조건: 해당 날짜의 **원장 양수 보유 전 코드 마스터 포함**, KRX 공식 가격이력 `(date,code)` 유일·양수, Snapshot 해당 날짜·코드·공식 출처·평가금액 및 분할소수점 반올림 계약 일치, 펀드·백필·마감 실행 잠금 모두 해제. 어느 하나라도 불일치하면 **요청 날짜 일괄 보존**. 기존 PRICE/Snapshot/NAV/거래이력과 마지막 마감 소유권 메타 수정 금지.
- 10월 12~13일은 공식 exact-date 종가/스냅샷 자체가 없어 **apply 절대 금지**. 같은 이슈 #495의 별도 복구 단계에서 원천일 검증 후 처리합니다. #496 NIGHT_FINAL 및 USDKRW 브리핑 게이트는 이번 변경 범위 밖입니다.
- 이 문서는 **준비된 운영 절차**이며 작성 시점에는 GAS v9.220 미배포, 해당 POST 미실행. 앱 웹 캐시 서비스워커 버전은 기존과 정합성을 유지하지만 기존 방문자의 오프라인 캐시가 오래된 버전 경고를 표시할 수 있으므로 배포 후 온라인 갱신을 검증합니다.

---

> 2026-10-14 PR #493 최신 Codex P2 대응: GAS v9.218은 무코드 펀드 CAS stale 재요청에서 **펀드뿐 아니라 전체 쓰기 가능 Settings 키**(정규화된 coded 메모·테마·계좌 등)가 서버 저장값과 일치해야만 `alreadyApplied`를 반환합니다. 다른 탭이 우연히 같은 펀드를 기록한 뒤 미저장 테마/계좌/종목 메모를 가진 최초 요청은 `SETTINGS_CODELESS_FUND_STALE`로 거부합니다. 실제 생산 handler 회귀 추가. 웹 기대 GAS 9.218, `settings_fetch 20261014-6`, PWA cache `20261014-19`. Draft/미병합/미배포. 기존 v9.217 설명은 이력으로 유지합니다.

## PR #493 자체 재검토 — 신규 append 부분 실패 후 사용자가 목표 비중/메모 재수정한 경우 (2026-10-13)

> 2026-10-14 PR #493 검증 후보: GAS v9.217은 무코드 펀드 CAS 응답 유실 재시도에서 전체 Settings 재기록 없이 ACK하여 타 탭 테마·계좌·종목 메모 덮어쓰기를 차단합니다. 웹 기대 버전 9.217, settings_fetch 20261014-5, PWA cache 20261014-18. Draft/미병합/미배포이며 운영 GAS·Sheets 수정 없음. 종료 기준은 docs/QUALITY_GATES.md §5-A입니다.

- 기존 복구 부채가 최초 입력 `userFields`를 유지하는 동안 같은 브라우저에서 사용자가 신규 C의 targetWeight/notes를 수정하면, 재시도 전 동일 workbook/source 신규 종목 journal은 최신으로 갱신되지만 `_rememberSameTargetCodeSettingsRepairs`의 기존 metadataOnly 부채가 처음 값을 유지해 오래된 비중·메모를 복구하는 사례 확인.
- `src/web/domain/portfolio/data.js`: **같은 sourceId, 이전/현재 exact (name,code), metadataOnly 상태가 일치하고 최신 durable journal이 명시적으로 userFields를 갖는 경우에만** 기존 Settings repair debt의 targetWeight·notes를 새 값으로 갱신. 없는 필드는 명시적 최신 증거에서만 삭제 가능, 기존 종목/교체 journal 변경 없음. 사용자 비중 수치(0~100) 클라이언트/GAS 허용 범위 일치.
- `scripts/check-stock-master-append-repair.mjs`: 실제 웹 sync/Bootstrap VM에서 첫 코드 append 커밋과 Settings 실패 직후 C 비중 25→45, 메모 변경한 뒤 복구해 새 값이 유지되고 서버 추가 row가 중복되지 않으며 debt/journal 해제되는 경우 추가. 기존 재시작/기초정보/보호키 회귀 유지.
- GAS **v9.212 변경 없음** (기존 full source blob/승인 pin 그대로), 웹 `data.js?v=20261013-11`, PWA `portfolio-cache-20261013-32` 동기화. PR Draft·미병합·미배포, 다른 PR/운영 데이터 변경 없음. **독립 Codex 리뷰는 사용량 한도 메시지로 재실행 불가; 자체 검사 및 CI와 구분**.

---
## PR #493 Codex P2 — 신규 종목 append 사용자 비중·메모 보존 (2026-10-13)

- **원인**: 관리 화면이 `saveSettings`를 종목 코드 append보다 먼저 실행하여 미등록 신규 C를 서버에서 제외. 후속 `syncCodes`는 C를 빈 Settings 항목으로 생성하므로 로컬 `targetWeight=25`와 메모 소실. 브라우저 종료/코드만 flush 상태에서도 동일 문제가 반복.
- **GAS v9.212**: `handleSyncCodes`가 전체 코드 마스터 CAS + ScriptLock 하에서 **실제 toAppend에 포함된 신규 정확 name/code pair**의 `userFields` 중 검증된 `targetWeight`(0~100)와 `notes`(최대 4000자)만 최초 Settings 항목에 기록. 기존 종목/명시적 교체/메타데이터 단독수정의 userFields는 무시해 다른 종목 사용자 설정 변경 금지. 코드만 flush 후 실패한 경우, 명시적인 같은 workbook/source `metadataOnly` 복구 증명 안의 userFields를 읽고 **원본 Settings가 아직 없는 정확한 pair**에만 적용.
- **웹/영속 Journal**: 데이터 도메인의 신규 종목 journal에 사용자가 입력한 targetWeight/notes를 source-pinned으로 저장하고, 네트워크 호출 직전에 최신값을 갱신. 부분 저장 확인 시와 강제 종료 후 Bootstrap에서는 동일 증명을 GAS Settings-only CAS로 전달. `queueMgmtGsheetSync()`는 서버 종목 코드 동기화 이후 일반 Settings 저장. 관련 정적 자산 캐시/예상 GAS 버전 동기화.
- **검증**: 실제 생산 GAS 종목 sync handler VM `check-stock-master-replacement-preflight.mjs`에서 A 기존 비중 37/notes 유지 + 신규 C 비중25/메모 최초 append 저장, 기존 A 가짜 userFields 무시. 실제 웹 sync/Bootstrap VM `check-stock-master-append-repair.mjs`에서 최초 성공/코드만 부분 저장/브라우저 종료 재시작 모두 C 비중25/메모 보존, journal/debt/마스터 CAS 정상 종료. Quality/Web/GAS CI 적용.
- GAS v9.212 전체 Git blob `b2f2f94e1f6790a31988c2931fb124aff891da05`; PR Draft 미병합/운영 미배포, main/원본 #489~#492/실제 Google Sheet/원장/종가·NAV/Snapshot/브리핑 불변.

---
## PR #493 Codex P2 — 일반 Settings 저장의 코드 마스터 원본 정합성 차단 (2026-10-13)

- **원인**: 다른 브라우저 A→B 코드 시트 변경이 완료되고 `EDITABLE_PRICES` 쓰기만 실패하면 master B/Settings A 상태. 일반 `handleSaveSettings`는 B에 대응하는 원본이 없어 사용자 `targetWeight`·`notes`를 기본값으로 다시 만들면서 기존 A 메타데이터를 삭제함.
- **GAS v9.211**: 일반 saveSettings에서 `EDITABLE_PRICES`가 제출된 경우, 같은 ScriptLock 안에서 현재 코드 마스터의 모든 정확한 종목명/코드 pair에 대응하는 **저장된 서버 Settings 원본이 정확히 하나** 존재하는지 양방향 검사. 누락·고아·중복·형식 오류는 `SETTINGS_CODE_MASTER_MISMATCH`로 일반 설정/테마 포함 **어떠한 Settings 쓰기 전** 중단. 정상 저장에서는 stale incoming 개별 종목을 server master에 projection하되 원래 목적의 신규 종목 임의 부활 금지, 사용자 필드·코드 없는 TDF·보호 대상 DIVDATA/LOAN/REAL_ESTATE 불변.
- **생산 함수 VM** `scripts/check-stock-master-save-settings-integrity.mjs`: 코드 부분저장 B/원본 A(targetWeight=37/notes) → 쓰기 0, 타종목 C·누락·중복·고아·손상된 Settings 검사, 건강한 Settings의 일반 테마/목표비중 저장과 펀드·대출/부동산/배당 보존. quality/web/GAS 게이트에 추가.
- GAS v9.211 full Git blob `1985fbbe0a351074ac9ee9bfabbdc787ec99a672`, 웹 Expected 버전/Settings fetch 캐시/PWA 및 deploy SHA pin 정합. Draft·미병합·운영 배포 skipped, main/원본 #489~#492/운영 데이터 미변경.

---
## PR #493 Codex P2 — Settings-only 재기준화 전체 원본/증거 정합성 보호 (2026-10-13)

- **원인**: 기존 `metadataOnly` 부채로 다른 브라우저의 A→B 코드 마스터 부분 커밋을 무시한 채 Settings 전종목을 rebase, B의 targetWeight·notes를 기본값으로 소실 가능.
- **GAS v9.210**: 동일 workbook ScriptLock 및 full master CAS에서 각 *현재* master name/code가 Settings의 정확 원본 1개 또는 개별 복구 증거를 보유하고, 재기준화에서 제거되는 코드 Settings orphan에는 검증된 rename/삭제 증거가 있는지 양방향 검사. 미증명/중복/경쟁 alias면 `CODE_REBASE_SETTINGS_MASTER_MISMATCH` (또는 provenance conflict)로 쓰기 0. 일반 동기화의 별도 full-master 검사는 유지.
- **웹**: metadataOnly는 자신이 실제 가리키는 종목만 증명하며 GAS에 범위를 넘김. 원래 A→B 성공 뒤 B가 후속 삭제되면 empty provenance 대신 `retired:true` tombstone을 전달하여 stale A만 안전 정리. CAS/최종 readback 후에만 부채·journal 제거. 다른 종목·삭제·이름 충돌은 fail closed.
- **생산 GAS VM** `scripts/check-stock-master-force-rebase-provenance.mjs`에서 master B,C/Settings A,C/metadataOnly C의 원본 비중 37 유실 경로 재현→차단, 정상 append/rename/tombstone(실제 타겟 삭제)/무근거 orphan·중복 검증. 기존 Bootstrap/append/연속교체·종가/NAV/Snapshot 테스트 회귀 유지.
- GAS v9.210 whole-source Git blob `86cbc5e7a140b66b3f4c5543a73c90b573479b9c`, 웹 캐시/Expected 버전/CI 소스 pin 동기화. Draft·미병합·운영 deploy skipped, 원본 PR #489~#492/main 및 운영 GAS/실제 데이터 변경 없음.

---
**v9.209 회귀 정합**: 기존 `handleSyncCodes`에서 Settings 저장 실패에 반환하던 명시적 `CODE_SYNC_SETTINGS_FAILED` 코드를 단일 키 CAS 오류에서도 유지. 실제 기존 거래 쓰기 검증 VM은 새 단일 셀 helper 호출·실패·회복을 재현하도록 업데이트. GAS full blob `2eeaa55461a8f9f69e017655be402a83d859faad`, expected version/PWA v28 동기화.

---
## PR #493 Codex P1/P2 — 종목 Settings 단일키 CAS 및 신규 append 부분 커밋 복구 (2026-10-13)

- **P1**: 일반 syncCodes 및 Settings-only 재기준화의 전역 `_writeSettingsMap`/`clearContent` 제거. 같은 ScriptLock 안에서 EDITABLE_PRICES 단일 셀만 기존 JSON 비교(CAS) 후 갱신, 신규 설정에는 해당 키 행만 삽입. 중단돼도 대출/부동산/배당/기타 Settings 행 보존.
- **P2**: 확인된 신규 append와 독립 메타데이터 변경을 동일 workbook/source durable 추가 journal로 입증해 Settings-only `metadataOnly` 복구 부채에 보존. 일반 실패→재시도, 응답 전 프로세스 종료→Bootstrap 양쪽에서 누락된 코드 Settings를 재구성. 미승인 추가·삭제·이름 교체는 암묵적 복구 금지; 최종 master 확인 후 부채·journal 해제.
- **생산 함수 VM 테스트**: 신규 `scripts/check-stock-master-settings-cell-write.mjs` (CAS, 단일 셀, 키 부재 생성, 인위적 실패와 LOAN/REAL_ESTATE/DIVDATA 보존), `scripts/check-stock-master-append-repair.mjs` (실제 웹 sync/Bootstrap append 복구, 미승인 변경 차단). 기존 회귀 및 web/quality/GAS 체크에 추가.
- **버전** GAS v9.208 Git blob `2cee1e67fd0283f4c5fd7119424f1b82b4159ec5`, 웹 기대 버전/PWA 캐시/배포 안전 지문 동기화. Draft 미병합, 운영 미배포, 원본 #489~#492·main/실데이터 불변.

---
## PR #493 Codex P2 — 코드 변경 전 전체 Settings 원본 정합성 확인 (2026-10-13)

- 기존 코드 A→B가 부분 커밋되어 마스터 B / Settings A로 불일치할 때, 다른 탭에서 B 섹터 수정·무관한 C 추가가 사용자 비중·메모를 지우는 문제를 방지.
- GAS v9.207 일반 `handleSyncCodes`는 실제 코드 쓰기 전에 전체 코드 마스터의 각 name+code가 Settings에 정확히 한 번 존재하고 Settings에 orphan coded 항목이 없는지 검사합니다. 불일치·중복 시 `CODE_SYNC_SETTINGS_MASTER_MISMATCH`로 데이터 저장 0. 명시적 `forceSettingsRebase`는 기존 별도 provenance CAS 경로 유지.
- 생산 GAS handler VM 테스트에 타 탭 부분 커밋·섹터 변경·신규 추가·무관 종목 변경·중복·별칭 반례 및 정상 종목 수정/append/코드 없는 TDF 설정 보호 추가. 원래 테스트가 web/quality/GAS CI에서 실행됨.
- GAS v9.207 full Git blob `23d04044aff5e9390855bdc219eda6aa03b04291`; 기대버전·PWA 캐시·지문 게이트 동기화. CI 지문은 운영 배포 승인이 아님. Draft·미병합·미배포, 원본 #489~#492/main 및 운영 자료 무변경.

---
## PR #493 Codex P2 — Settings 원본 없는 후속 교체 방지 (2026-10-13)

- A→B 종목 코드 마스터만 반영되고 Settings에는 A가 남은 부분 커밋 직후 다른 브라우저에서 B→C로 교체하면 사용자 비중·메모가 유실될 수 있었음. GAS `handleSyncCodes`는 정상 교체에서 기존 Settings의 정확 pair 1건을 강제하며, 0건/중복/신규 별칭 충돌을 코드 시트 변경 전 `CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT`로 거부함.
- 생산 `handleSyncCodes` 함수 호출 기반 VM 회귀를 CI에 추가해 부채 상황에서 코드/Settings 저장 0과 정상 교체(전체·이름만·코드만) 시 사용자 필드 승계를 검증하도록 함.
- GAS v9.206 full-source 지문 게이트 및 웹 기대버전 9.206, settings_fetch 20261013-6, PWA 20261013-25. 본 소스 지문은 CI 무결성 확인이며 운영 배포 승인이 아님. Draft·미병합·운영 GAS 미배포, 원본 #489~#492와 main 직접 변경 없음.

---
## PR #493 Codex P2 2건 — 복구 부채 성공 해제·후속 삭제 종결 (2026-10-13)

- **즉시 Settings 복구 성공 뒤 남는 부채**: 일반 `syncCodes` POST가 오류를 반환했지만 코드 마스터가 이미 최신으로 바뀐 경우 Settings-only 복구가 성공해도 기존 코드가 빈 `replacements/settingsReplacements`만 삭제해 `metadataOnly` 부채가 남던 문제 수정. 이제 부분 커밋 시 생성한 `repairProof` 전체를 추적하고, 성공한 CAS Settings 수리 **뒤 최신 `getCodeList` 전체 마스터 readback 일치 검증을 통과해야만** 해당 부채를 영속 해제합니다. 실패·소스 전환·후속 CAS 충돌 시에는 부채 유지.
- **A→B 교체 부채 발생 후 B 후속 삭제**: 전용 `_classifyPinnedCodeSettingsRepairDebt`는 현재 동일 workbook/source 전체 마스터에서 B 정확히 존재·A 별칭 부재이면 기존 Settings provenance를 B로 이전합니다. A/B 둘 다 없고 어느 이름/코드 구성요소도 충돌하지 않을 때는 더 이상 이전 대상이 없으므로 Settings-only full-master CAS 재기준화에서 stale A를 정리하고 부채를 종결합니다. 종목명만/코드만 교체 시 동일한 구성요소를 원본 별칭으로 오인하지 않도록 구분합니다. A 또는 B의 이름/코드가 경쟁적으로 재사용되면 자동 정리하지 않고 fail closed.
- **검증**: 실제 웹 VM에서 메타데이터 코드만 저장 후 Settings 즉시 수리 성공→재부팅/추가 쓰기 없이 `metadataOnly` 부채 0건, 실패 시 durable 보존. 실제 전체 deferred-script Bootstrap VM에서 A→B 교체 뒤 다른 탭 B 삭제→현재 C만 있는 코드 마스터로 Settings 읽기 복구, stale A 제거, 다른 C 비중/대출/코드 없는 펀드 보호, 부채 0건 및 별칭 충돌·이름만/코드만 교체 안전성 확인.
- **범위**: 최신 클라이언트 `settings_sync.js?v=20261013-20`, PWA `portfolio-cache-20261013-24`. 기존 GAS v9.205 및 전체 source blob `120593344d2b9da89f3e603bdb2349fc3ef571f9` 변경 없음. PR Draft·미병합, main/원본 #489~#492/운영 GAS·스프레드시트·종가/NAV/Snapshot/브리핑 미변경. 승인 없는 병합·실제 배포 없음.

---
## PR #493 Codex P2 — 메타데이터 부분 커밋 복구 근거 정정 (2026-10-13)

- **원인**: 웹 `syncCodesToGsheet()`는 메타데이터만 GAS 코드 시트에 확정되었으나 Settings 복구가 실패하면 임의 `partial.codes[0]`을 `metadataOnly` 영속 부채에 기록했습니다. 무관한 그 행을 다른 탭에서 삭제하면 다음 Bootstrap이 실변경 종목과 무관하게 영구 실패했습니다.
- **보완**: 새 `_stockMasterMetadataOnlyRepairProof(before,after)`는 전필드 코드 마스터 fingerprint와 동일 종목명+코드 identity 집합을 확인한 뒤 실제 type/sector/currency/market 필드가 변경된 행만 추출합니다. 증명되지 않은 추가·삭제·교체는 metadataOnly 기록으로 우회하지 않고 fail-closed 처리합니다. 기존 `metadataOnly:true` 복구 부채는 행 식별자 존재를 요구하지 않고, 동일 workbook source ID의 현재 전체 master fingerprint/CAS로 Settings를 재기준화합니다. 실제 종목명/코드 교체 부채는 기존 엄격한 원본·대상 존재 검사를 계속 적용합니다.
- **실제 VM 회귀**: A+B 마스터에서 B 섹터 부분 커밋·Settings 연속 실패 시 영속 부채가 B를 가리키는지 확인, 타 탭 A 삭제 후 B 단독 마스터로 CAS Settings 복구와 부채 해제 검증. 구버전에서 잘못 A를 가리키는 metadataOnly 부채가 남은 상태에서도 Bootstrap이 최신 B 서버 Settings를 재조회하고 `targetWeight` 37을 보존하는 테스트 추가.
- **정적 자산**: `settings_sync.js?v=20261013-19` 및 PWA `portfolio-cache-20261013-23`. GAS 기존 v9.205 전체 소스/승인 blob은 변경하지 않음. `main`, 원본 Draft #489~#492, 운영 GAS·Sheets·트리거/배포 변경 없음. 실제 운영 복구는 미실행.

---
## PR #493 Codex P1 — 종목 삭제 시 Settings 전체 유실 차단 (2026-10-13)

- **원인**: v9.204 삭제 경로가 원본 설정을 읽은 뒤 `_writeSettingsMap()`의 모든 Settings row `clearContent()`→재기록을 실행했습니다. 실행이 중단되는 순간 LOAN, REAL_ESTATE, DIVDATA, 코드 없는 펀드, 기타 종목별 설정까지 누락될 수 있고, 삭제 journal에는 삭제 대상 1건만 보존되어 전역 Settings 유실을 되돌릴 수 없었습니다.
- **구조적 수정**: GAS v9.205에서 삭제·보상·Bootstrap 복구의 `_writeSettingsMap` 호출을 제거하고, `EDITABLE_PRICES` 키가 고유하게 존재하는지 확인 후 **해당 VALUE 셀 하나만** `setValue(JSON.stringify(array))`로 갱신합니다. 기존 값과 전체 JSON 동일성 비교, 단일 셀 쓰기 후 재조회 검증, 중복 키/충돌/손상 시 fail closed합니다. 다른 Settings 키는 수정할 수도, 일괄 초기화할 수도 없습니다. 기존 ScriptProperties 삭제 증거·same-source CAS·ScriptLock은 유지합니다.
- **회귀**: 실제 GAS handler VM에서 전역 `_writeSettingsMap`이 호출되면 테스트가 즉시 실패하도록 하고, LOAN·REAL_ESTATE·DIVDATA·fundDirect·APP_THEME의 원본 값을 정상 삭제/행 삭제 실패/Settings 쓰기 실패/중단 후 Bootstrap 재시도/Settings 종목 비중 복원 전체 경로에 대조합니다. append-only/normal code CAS 및 이전 P1·P2 경로도 CI에서 검증합니다.
- **릴리스 소스**: GAS v9.205 full Git blob `120593344d2b9da89f3e603bdb2349fc3ef571f9` (스크립트/`EXPECTED_GAS_VERSION` 승인 게이트 일치). Web `settings_fetch 20261013-5`, PWA cache `20261013-22`. **CI validate는 운영 배포가 아니며 실제 GAS 배포 단계 skipped.**
- **제한**: 이 변경은 PR #493 Draft에만 존재하며 원본 #489~#492, main 및 운영 GAS/Sheets 가격·원장·NAV·Snapshot·브리핑에는 미적용. 기존 그 외 일반 Settings 저장 함수의 구조적 재작성은 이번 삭제 전용 수정 범위에 포함하지 않았습니다.

---
## PR #493 재리뷰 P2 — GAS 강제 종료 삭제 트랜잭션 복구 (2026-10-13)

- **GAS v9.204 검증 후보**: Git 전체 source blob `b4a81fafcd87dd101c625087c6df5323ab0df069`. `deploy-gas.mjs`, `check-gas-deploy.mjs`, 웹 `EXPECTED_GAS_VERSION` 일치. PWA `settings_fetch 20261013-4`, cache `20261013-21`. 소스 승인 지문은 CI 품질검사용이며 운영 배포 승인 아님.
- **삭제 트랜잭션 원자성 보완**: 첫 code row 변경 이전에 ScriptProperties `PF_PENDING_CODE_DELETE_TXN_V1`에 동일 워크북 source ID, 코드/name, 종목별 원본 Settings 전체 사용자 메타데이터를 영속 기록. 코드 row 삭제/flush/Settings 기록 사이 강제 종료되어도 다음 `getBootstrap`, `getSettings`, `getCodeList`의 ScriptLock 복구에서 두 저장소 일치 전에는 stale Bootstrap/최신 master 성공을 허용하지 않음.
- **재시도 정책**: 코드 row가 남았으면 원본 종목 설정 전체를 복원하고 삭제 롤백. 코드 row가 사라졌으면 거래·보유 원장 미참조와 동일 코드/이름 충돌 검증 후 Settings의 해당 종목을 제거해 삭제 완료. 원본과 다른 워크북·손상된 journal·동명이인·추가 보유 참조·일부 쓰기 실패 시 journal 유지, 오류 반환, 잘못된 완료 차단. 확인된 정합 상태에만 journal 정리.
- **생산 VM 검증**: deleteRow 예외/Settings 저장 실패 보상 복구/코드 row flush 직후 강제 중단 후 Bootstrap 복구 실패 유지·후속 정상 복구/원본 `targetWeight` 복원/정상 삭제와 잠금 해제, 기존 master CAS 및 전체 품질 테스트.
- **범위 제한**: PR Draft 미병합. 기존 #489~#492/main, 실제 운영 GAS·거래/보유 원장·가격이력·NAV·Snapshot/브리핑과 API 인증정보 미변경. 실제 운영 버전·데이터 검증 및 배포는 별도 승인 필요.

---
## PR #493 추가 재리뷰 P2 및 삭제 트랜잭션 — 2026-10-13 (Draft / 배포 금지)

- **재시작 후 교체 journal 단독 복구**: 코드 시트 A→B flush 이후 Settings 수리 응답을 받기 전에 브라우저가 종료돼도, 동일 GAS workbook의 확정 B pair와 A의 부재를 서버 Bootstrap 코드 마스터에서 증명하면 편집 journal을 지우기 **전에** 별도 Settings-only 영속 복구 부채로 승격합니다. 먼저 ScriptLock/전체 코드 마스터 CAS에서 Settings 사용자 속성(`targetWeight` 등)을 복구하고 재조회한 뒤에만 journal을 퇴역시킵니다. 원본이 아직 있거나 pair가 다르면 append 권한으로 대체하지 않습니다.
- **GAS 삭제 실패 원자성 보완**: 원격 거래/보유 미참조 및 전체 마스터 CAS 확인 후 코드 행을 삭제·flush·검증한 **다음** Settings에서 해당 identity를 제거합니다. `deleteRow()` 예외는 Settings를 수정하지 않으며, Settings 저장 실패 후에는 원본 Settings와 삭제한 코드 행의 보상 복원을 ScriptLock 안에서 시도하고 실패 상태를 별도 오류 코드로 구분합니다. 저장/복원 성공과 실제 운영 검증은 별개입니다.
- **실 생산 VM 회귀**: 브라우저 재시작 시 교체 journal만 남은 clean Bootstrap에서 A/111111→B/222222·비중 37 수리 및 실패 보존, GAS 삭제 핸들러의 행 삭제 예외·Settings 쓰기 실패 후 코드/사용자 필드 원복·정상 삭제를 검사합니다. 최신 커밋 CI 결과는 해당 HEAD의 workflow 결과를 기준으로 따로 확인합니다.
- **버전/배포**: GAS v9.203 full-source Git blob `7e673bbb7349931935c3db6510cb9ddee1adbb6e`; 웹 `settings_sync 20261013-18`, `settings 20261013-8`, PWA `20261013-20`. 원본 PR #489~#492, main 및 운영 GAS·Sheets 거래/보유/NAV/가격/Snapshot/브리핑 경로는 미변경. 이 Git blob은 배포 승인이 아니라 검증 후보입니다.

## PR #493 Codex 추가 P2·부트스트랩 복구 설계 검증 — 2026-10-13

- **부트스트랩 복구 (P2)**: 거래·보유 dirty 및 코드 추가 journal이 없어도 동일 GAS URL·워크북에 Settings 복구 부채가 있으면, 최초 Bootstrap Settings 적용 **이전**에 잠금·전체 마스터 CAS로 Settings를 수리하고 새 `getBootstrap`을 재조회합니다. 실패 시 부채를 보존하고 완료 처리를 중단합니다.
- **메타데이터 단독 부분 커밋 (P2)**: 이름·코드 교체 없이 섹터·통화·시장만 변경된 뒤 Settings 저장이 실패해도 `metadataOnly` 영속 복구 부채를 기록합니다. 재시도는 변경 없이 확정 마스터에서 Settings를 재조정하고 이 identity를 rename 증거로 사용하지 않습니다.
- **검증**: 실제 Bootstrap VM에서 기존 A Settings+신규 B 코드 시트, 거래·보유 dirty/추가 journal 없음→Settings 선수리→Bootstrap 재조회 및 B의 `targetWeight` 보존, 실패 시 bootstrap 거절. 웹 VM 메타데이터 단독 부분 기록·Settings 연쇄 실패·복구 후 부채 해제. `quality-check`·`web-check`·GAS `validate` 통과.
- **배포 제한**: GAS v9.202 전체 Git blob `23dd4fa2c455c315d6925d57f3bdfe5baec40aeb` 유지. 웹 `data.js 20261013-9`, `settings_sync.js 20261013-17`, `settings.js 20261013-7`, PWA `20261013-19`. PR Draft·미병합, 배포 skipped.

## PR #493 재리뷰 재검토 — 2026-10-13 (Draft / 운영 배포 불가)

- **GAS v9.202 후보**: 리뷰용 전체 Git blob `23dd4fa2c455c315d6925d57f3bdfe5baec40aeb`; `scripts/deploy-gas.mjs` 무결성 게이트 및 `scripts/check-gas-deploy.mjs` 체크 일치. 운영 배포가 아닌 CI 검증 소스입니다.
- **부분 코드 커밋 이후 복구 실패**: GAS 코드 시트 A→B 기록을 동일 워크북의 전체 마스터 readback으로 확인하면, Settings 쓰기가 재차 실패해도 웹은 성공한 코드 전이 A→B를 큐에 게시하고 대기 중인 A→C journal을 B→C로 다시 작성합니다. 동시에 A→B Settings 메타데이터 복구 근거를 별도 로컬 영속 journal에 기록합니다. 다음 작업은 같은 CAS·ScriptLock에서 Settings A→B를 먼저 **코드 시트 무변경으로 수리·재확인한 뒤** B→C를 반영합니다. 다른 workbook/변경된 마스터에서는 쓰기를 차단하고 복구 근거를 보존합니다.
- **일반 코드/이름 교체 전 Settings 중복 검사**: A/1과 신규 B/2가 Settings에 동시에 있거나 같은 이름/코드 충돌 기록이 있을 경우 코드 시트 쓰기 전 `CODE_SYNC_REPLACEMENT_SETTINGS_CONFLICT`로 실패합니다. 명확한 A 원본만 있으면 추가 메타데이터(`targetWeight` 등)를 B로 승계합니다. 기존 복구 전용 모드의 별도 provenance 검증도 유지합니다.
- **회귀**: 실제 웹 VM 동시 A→B 부분 commit→Settings 재복구 실패→B→C 대기편집→Settings 복원 후 C 저장·journal/부채 해소, 실제 GAS handler VM 일반 교체 중 중복 Settings 차단 및 정상 교체 사용자 설정 보존. `quality-check`, `web-check`, GAS `validate` 성공(배포 작업은 skipped).
- **운영 영향 제한**: #489~#492·main, GAS 실배포, Sheets 거래/보유/Snapshot/가격/NAV, 브리핑 트리거·인증정보를 변경하지 않았습니다. 실제 운영 버전 확인 및 실데이터 검증은 별도 단계이며 Draft 해제·병합·배포를 하지 않았습니다.

## PR #493 최신 리뷰 보완 — 2026-10-13 (Draft / 운영 배포 금지)

- **GAS v9.201 검증 후보**: 전체 Git blob `d3d4ce4a9f7db4096f99b8b214dad959736ecb5f`. `deploy-gas.mjs` 승인 지문 게이트와 `check-gas-deploy.mjs` 기대값을 함께 변경했습니다. 이는 소스 무결성 게이트이지 운영 배포 승인이나 실제 배포가 아닙니다.
- **신규 Codex P2 — 교체 후 Settings 메타데이터 손실**: 코드+이름 교체가 코드 시트에 확정됐지만 Settings 저장에 실패하면, 클라이언트는 검증된 기존→신규 identity를 `settingsReplacements`로 제공합니다. GAS는 같은 ScriptLock/코드 마스터 CAS와 Settings의 유일 원본·신규 대상 검증 이후 기존 `targetWeight` 등 사용자 필드를 옮깁니다. 복구 모드는 코드 마스터 전체를 바꾸지 못하며 코드/메타데이터가 조금이라도 다르면 쓰기를 차단합니다.
- **신규 Codex P2 — stale payload에 최신 CAS 부착**: 요청 생성 당시 마스터의 전필드 지문과 직렬 큐 내 **자체 성공·readback으로 확인된 전이**만 인정합니다. 다른 탭의 종목 분류/통화/시장 변경은 최신 GET이라도 오래된 payload의 CAS 근거로 삼지 않고 POST 이전 차단합니다. 성공 검증은 code/name뿐 아니라 전체 전필드·행 수를 포함합니다.
- **검증**: 실제 브라우저·GAS 함수의 in-flight A→B→C, 재시도/원복, 외부 섹터 수정 시 POST 0, 코드 commit 후 Settings 실패·메타데이터 유지·불일치 차단·재복구 멱등성을 회귀검사합니다.
- **운영 제한**: main/원본 PR #489~#492, 운영 GAS 및 OAuth 키·시트 원장·가격이력·Snapshot은 직접 변경하지 않습니다. Codex 독립 재리뷰·최종 통합 CI·운영 실환경 검증 전에는 Ready·Merge·실배포 금지입니다.

## PR #493 통합 후보 보완 — 2026-10-13 (Draft / 운영 배포 금지)

- **GAS v9.200 후보**: 전체 소스 Git blob `3eb6b4ad640b85f0648f16e3571099e5c374368a`를 `deploy-gas.mjs`의 정확한 소스 승인 게이트에 등록했습니다. 이 SHA는 **통합 검증 후보**의 무결성 식별자일 뿐, 운영 배포 승인이 아닙니다.
- **연속 종목 변경**: 동기화 요청을 대상별 직렬화하고 큐에서 실행할 때 동일 워크북의 최신 `getCodeList`를 확인해 원본→신규 교체 journal을 재기준화합니다. 다른 workbook/source, stale CAS, 출처 미확인 신규 추가는 거부합니다.
- **Settings 부분 저장**: 종목코드 시트 변경 후 Settings 쓰기가 실패할 수 있으므로 웹은 서버 재조회로 실제 변경 완료 여부를 판단합니다. 전체 요청과 정확히 일치할 경우에만 코드 마스터에 대한 변경 없는 `forceSettingsRebase=1` 요청을 전체 마스터 CAS·ScriptLock 아래 재실행합니다. 부분 일치나 출처 불일치 시 재전송하지 않고 pending journal을 보존합니다.
- **검증 범위**: 브라우저 VM에서 A→B 작업 중 B→C 수정, 진행 중 원복, 코드 시트 성공/Settings 실패 후 복구를 확인합니다. GAS VM에서 Settings 실패 주입과 재조정 시 종목 중복·원본 변경이 없고 ScriptLock 해제되는지 검증합니다.
- **운영 분리**: PR #489~#492 및 main, 실제 GAS/시세/원장/Snapshot/키는 수정하지 않습니다. 통합 CI와 독립 리뷰 종료 전 Ready·Merge·실제 deploy를 수행하지 않습니다.

## PR #493 2026-10-13 Codex 후속 P2 — 연속 종목명/코드 교체 안전성

- Codex HEAD `c230751` 지적: 사용자가 서버 동기화 전 `A/1 → B/2 → C/3`처럼 연속 편집하면 기존 UI 교체 이력이 `B/2 → C/3`만 남고 실제 서버 원본 `A/1`은 유지됩니다. 게다가 일치하지 않는 교체 journal이 신규 추가 권한으로 잘못 사용되어 원래 종목과 신규 종목이 동시에 남을 위험이 있었습니다.
- **수정**: 동일 GAS target/workbook source의 미확정 변경 journal을 연쇄 합성하여 가장 오래된 서버 원본 `A/1 → C/3`으로 유지합니다. `smSave`는 새 journal을 기록한 **뒤** 이전 상태를 정리하고 이름만/코드만 변경하는 중간 단계도 같은 provenance로 추적합니다. 편집을 원래 서버 pair로 되돌렸을 때는 미확정 journal을 삭제합니다.
- **Fail-closed**: `syncCodesToGsheet`가 `replaces`가 존재하는 항목을 절대로 신규 추가 권한으로 쓰지 않습니다. 교체 원본 pair가 예상 서버 전체 코드 마스터 스냅샷에 정확히 1개 존재할 때만 `replacements`를 보내고, 미일치·이력 손상 시 어떤 일반 종목 master POST도 수행하지 않습니다. GAS는 전체 마스터 CAS와 동일 ScriptLock을 유지하며, 이름만/코드만/양쪽 변경을 **원래 행을 교체하는 방식**으로 처리하되 별개 행과 충돌하면 거부합니다. 성공 응답 후 서버 readback에서 실제로 변경된 옛 코드/이름이 남지 않았는지 검사한 경우만 journal을 제거합니다.
- **회귀**: 실제 브라우저 VM에서 연속 2단계 변경의 원본 `A/1` 보존, 원본 없는 journal 전송 0회, 원래 pair로 돌아오는 동작과 journal 제거, 성공한 교체의 readback 및 journal 정리를 확인합니다. 실제 GAS handler VM에서는 이름만·코드만 별도 교체가 모두 기존 **단일 행**을 유지하며 Settings와 같은 내용을 갖는지 확인합니다.
- 후보 GAS v9.199 blob `852c26bbaf5312f8aa447f5f1d03a8932a85b3f8`. 정적 웹 자산 `data.js=20261013-6`, `settings_sync.js=20261013-11`, `mgmt_stock.js=20261013-6`, `sw/cache=20261013-13`. 현재 PR은 Draft, 운영 GAS/시세/거래/Snapshot 데이터 불변, main 및 원래 PR #489–#492 변경 없음.

## PR #493 2026-10-13 Codex 최근 P1 2건·P2 2건 / 자체 재검토 (Draft·배포 금지)

- **P1 오래된 거래 쓰기 vs 종목 삭제**: GAS `handleSyncTrades`가 실제 같은 ScriptLock 내부에서 현재 서버 코드 마스터와 각 거래의 code/name 일치 또는 현재 이름 확인된 레거시 무코드 거래를 검증한 후에만 거래 원장을 비웁니다. 삭제 이후 stale 종목 거래는 `TRADES_CODE_MASTER_CONFLICT`로 쓰기 이전 거부합니다.
- **P1 무코드 일반 보유**: 동일 검증 함수를 `handleSyncHoldings`에 적용하되 주식·ETF 등 일반 보유는 무코드로 저장할 수 없도록 엄격하게 차단합니다. 예외는 명시적 `TDF`·`펀드`·`FUND` 유형인 직접펀드로 한정합니다. 두 경로 모두 `syncCodes`/조건부 삭제와 동일 GAS ScriptLock을 사용합니다.
- **P2 오래된 Settings 삭제 종목 복원**: `handleSaveSettings`가 `EDITABLE_PRICES` 전체 배열을 그대로 덮어쓰는 대신 잠금 안의 현재 종목코드 시트를 기준으로 종목 code/name/type/sector/currency/market을 재구성합니다. 코드 시트에서 삭제된 종목은 stale Settings로 재등록되지 않으며, 다른 테마·계좌 설정과 무코드 직접펀드 설정은 보존합니다. `handleSyncCodes`도 코드/이름/메타데이터의 모든 성공한 변경(코드만·이름만·둘 다·추가)을 같은 잠금 안에서 Settings 마스터에 반영해 다음 Bootstrap의 고스트 원본을 방지합니다.
- **P2 이름+코드 동시 편집 차단 및 고스트**: `smSave`가 원래 code/name과 변경 code/name을 동일 workbook 식별자의 UI journal에 보관합니다. 브라우저 일반 동기화는 기존 고정 전체 서버 마스터 snapshot CAS와 원본→신규 교체 사유를 함께 POST합니다. GAS는 같은 ScriptLock 안에서 기존 code/name 정확한 행을 교체하고, 변경된 code/name이 중복 원본 행 없이 반영되었는지 검사한 뒤 Settings까지 업데이트합니다. 서버 getCodeList readback에서 기존 pair가 없어지고 새 pair가 일치해야 정상확정 및 journal 정리합니다. 구형·stale CAS 요청은 계속 차단합니다.
- **회귀검사 및 검증**: 실제 GAS 함수 VM에서 삭제한 코드의 거래/보유 stale 참조, 일반 무코드 보유 차단 및 직접펀드 허용, stale Settings 삭제 종목 재생성 차단, 이름+코드 동시 변경 시 기존 코드 행 덮어쓰기(append 0회) 및 Settings 업데이트를 검증합니다. 기존 거래 날짜/수량/코드 strict readback mock은 현재 마스터 원천을 추가해 유지합니다. 웹 PWA `data.js=20261013-5`, `settings_sync.js=20261013-10`, `mgmt_stock.js=20261013-5`, `sw/cache=20261013-12`; GAS v9.199 Git blob `da46710c8bf4fcea4a9369c4fb8932f7c651cdd1` 고정. 운영 GAS 배포·main/원래 PR #489~#492 변경·실거래 원장/종가/Snapshot 데이터 변경 없음.

## PR #493 2026-10-13 Codex 추가 P1/P2 + 자체 검토 (Draft / 운영 배포 금지)

- 최신 리뷰 HEAD `b5ac992` P1: `handleSyncHoldings`는 `handleDeleteUnreferencedCode`와 달리 ScriptLock 없이 보유현황 전체를 덮어쓸 수 있었습니다. 기존 `syncTrades`/`syncCodes`/조건부 삭제와 같은 `LockService.getScriptLock()` 범위 안에서 보유현황을 파싱, 현재 코드 시트의 `code/name`과 일치하는지 확인, 보유현황을 저장합니다. 삭제 후 늦게 도착한 보유현황도 삭제된 코드를 참조하면 `HOLDINGS_CODE_MASTER_CONFLICT`로 실패하며, 코드 없는 직접펀드 보유는 계속 허용합니다.
- P2: 일반 `syncCodes`에 서버 마스터 revision 조건이 없어 다른 탭이 코드를 삭제한 뒤 구식 정보가 같은 코드를 재생성할 수 있었습니다. Bootstrap/`getCodeList`의 workbook source에 고정한 코드 마스터 스냅샷을 요청 시점에 캡처하고, 기존 `expectedSourceId`와 함께 `expectedCodes`로 POST합니다. GAS는 같은 ScriptLock 안에서 원격 전체 마스터와 예상값을 정규화·비교하여 `CODE_SYNC_MASTER_CHANGED`이면 **시트에 쓰기 전** 실패합니다. 현재 revision 정보를 전달하지 못하는 이전 버전 `syncCodes` 클라이언트는 `CODE_SYNC_REVISION_REQUIRED`로 **쓰기를 차단**합니다(기존 클라이언트 호환성보다 원장 무결성 우선). 신규 code/name은 동일 workbook의 검증된 UI 등록 journal이 있을 때만 일반 동기화 대상에 포함합니다.
- 성공한 일반 동기화는 단순 ACK가 아니라 같은 workbook의 `getCodeList` readback으로 code/name을 검증하고 나서 캐시/등록 journal을 갱신합니다. 원격 삭제도 readback 성공 이후에만 local master revision을 업데이트해 후속 정상 등록은 최신 스냅샷 기준 CAS로 진행하고, 삭제된 종목의 근거 없는 재등록은 거절합니다.
- 회귀테스트: 실제 브라우저 VM에서 A→B 세대 전환과 큐 대기, 같은 workbook readback, 삭제 후 최신 master revision 재설정, 삭제 종목의 증빙 없는 재등록 거부, 신규 등록 journal 허용; 실제 GAS VM에서 다른 workbook source/이전 revision/legacy 무revision 일반 sync 거부, 삭제 후 stale holdings 쓰기 차단, 유효한 holding 쓰기 및 서버 잠금 해제. 자동화 `quality-check`, `web-check`, `GAS Validate` 통과 전제이며 최종 커밋에서 재확인합니다.
- 후보 GAS v9.199 source blob `feb0077bbc420f478c2a7559f36cd4e43988c592`; 웹 `settings.js=20261013-6`, `settings_sync.js=20261013-9`, SW/cache `20261013-11`. main과 기존 PR #489~#492, 운영 GAS 및 실제 자산원장/보유/시세·Snapshot은 변경하지 않았습니다.

## PR #493 2026-10-13 최신 Codex P1/P2 및 자체 검토 (Draft / 운영 미배포)

- 최신 리뷰 HEAD `6e719c9` P1: 보통 `syncCodesToGsheet()`는 연결 세대를 넘기지 않고 URL별 대기열 내부에서 전역 EDITABLE_PRICES를 늦게 읽으므로, A 연결의 대기 요청이 B 연결의 코드를 A로 전송할 수 있었습니다. 호출 즉시 **현재 target URL·connection generation·workbook 지문과 코드/이름/분류/통화/시장 값의 복사본**을 캡처하고, 큐 실행 직전 동일 target generation/source 및 쓰기 준비를 재확인합니다. 원격 일반 syncCodes에도 workbook `expectedSourceId`를 포함하여 같은 GAS URL이 새 SS_ID를 가리키더라도 서버 ScriptLock 내부에서 변경 전 거부합니다. 구버전 클라이언트를 위한 서버 인자 생략 호환은 유지합니다.
- P2: 오래된 `deleteUnreferencedCode` 요청이 다른 탭에서 같은 code/name의 sector·currency·market을 수정한 종목을 삭제할 수 있었습니다. 기존 대상별 쓰기 대기열의 이전 POST 완료 후 `getCodeList`를 읽고 **삭제 당시 로컬 code/name/type/sector/currency/market과 정확히 대조**, 그 순간의 원격 전체 마스터 스냅샷을 POST에 넣습니다. 서버는 같은 ScriptLock에서 전체 마스터 지문을 현재와 비교한 뒤에만 거래/보유 미참조 조건 및 Settings/코드 삭제를 수행합니다. GET 전후 같은 연결 검증 및 로컬 재등록 방지도 반영했습니다.
- classic browser 및 GAS 함수 VM에 A 동기화 POST 대기→B 연결 복원→A 대기 요청 자동 중단, in-flight A payload 고정, server-side 일반 코드 sync의 타 워크북 출처 거부, 동일 code/name·다른 sector 원격 선수정 시 삭제 CAS 실패 등의 회귀검사를 추가했습니다.
- 이 통합 후보의 GAS v9.199 검증용 git blob SHA는 `53eeff145dc908b1b17c773655bd1e7d60822e14`이며 `check-gas-deploy` 및 배포 사전 게이트의 고정 해시를 함께 변경했습니다. 웹 자산 `settings_sync.js=20261013-7`, `sw/cache=20261013-9`. 원래 PR #489~#492/main, 운영 GAS 실배포, 키, 실제 원장/가격/Snapshot 데이터는 건드리지 않았습니다.
- 최종 CI/독립 재리뷰 후에도 PR Draft·미병합 상태로 유지합니다.

## PR #493 Codex 추가 P2: 신규 종목 삭제·비동기 POST 경합 수정 (2026-10-13 · Draft/미배포)

- 리뷰 HEAD db64a11에서 발견한 P2: 사용자가 신규 종목을 삭제할 때 이미 시작된 일반 syncCodes POST가 뒤늦게 완료되면 서버 종목 마스터와 브라우저 기초정보에 종목이 다시 나타날 수 있음.
- 같은 GSheet URL의 웹 종목코드 쓰기를 `_queueGsheetStockMasterWrite`로 직렬화합니다. 일반 syncCodes는 큐의 실제 실행 시점에 최신 `EDITABLE_PRICES`에서 요청을 구성합니다. UI 삭제 시 이전 POST를 먼저 기다린 뒤 `deleteUnreferencedCode`를 실행해 같은 코드가 뒤늦게 재등록되지 않도록 합니다.
- GAS `handleDeleteUnreferencedCode`: 같은 ScriptLock 아래 요청 대상 워크북 지문·코드·이름 일치 검증, 원격 거래/보유에서 참조하는 경우 삭제 금지, 서버 Settings의 동일 종목 기록과 코드 마스터 행 제거, 삭제 후 getCodeList 확인. UI에서도 원격 GET으로 삭제 결과를 확인하며 실패 시 경고를 표시합니다.
- 실제 classic 웹 VM에서 이미 시작된 syncCodes POST를 지연한 상태로 삭제 요청을 추가하는 순서 테스트, 실제 GAS VM에서 타 워크북·거래 참조 시 삭제 거부 및 미참조 행/Settings 삭제 확인을 추가했습니다.
- 검증 브랜치 GAS v9.199 최신 full-source blob: `0e38e4cf32ea23be3ccc11e7112eafa63e3d68b0`. 서명 고정 및 배포 사전검증 기대 SHA를 함께 갱신했습니다. 웹 assets `settings_sync=20261013-5`, `mgmt_stock=20261013-4`, `sw/cache=20261013-7`. 나머지 자산은 기존 최신 pin 유지.
- 원본 Draft #489~#492, main, 운영 GAS와 인증키·거래원장·가격이력·Snapshot 실데이터를 변경하지 않았으며, 한국·미국장만 대상으로 CI 및 추가 재리뷰 중입니다.

## PR #493 신규 Codex 리뷰 P1 2건/P2 1건 추가 수정 (2026-10-13 · Draft/미배포)

- 최신 리뷰(HEAD `9796f743`) P1: 동일 이름이 서로 다른 코드에 중복된 Bootstrap 마스터에서 `forEach` 내부 return으로 충돌이 무시됐습니다. **일반 for-of 및 즉시 false 반환**으로 코드·이름 중복을 전면 거부합니다.
- P1: 이전 `syncCodes`는 이미 존재하는 코드나 종목명을 바꾸는 upsert라 Bootstrap 이후 다른 탭이 등록한 종목이 덮어써질 수 있었습니다. 새 GAS `syncCodesAppendOnly`는 `getBootstrap`의 코드 마스터 전체(code/name/type/sector/currency/market)와 워크북 출처 식별자를 **ScriptLock 내부**에서 다시 비교해 일치할 때만 신규 코드를 추가합니다. 일반 `handleSyncCodes`도 동일 스크립트 잠금을 사용합니다. 충돌/다른 워크북/세대 변경 시 거부하고 기존 셀을 덮어쓰지 않습니다.
- P2: 코드 추가 이력은 URL뿐 아니라 실제 스프레드시트 ID의 SHA256 지문에 묶습니다. 같은 GAS `/exec`가 다른 `SS_ID`로 바뀌어도 과거 등록 이력을 새 원장의 승인 근거로 쓰지 않습니다. 정상 일반 syncCodes 성공, 복구 POST+동일 워크북 getCodeList 재확인, 명시적 삭제·종목 이름/코드 변경·CSV 코드변경 때 이력을 폐기합니다.
- 새 GET 필드 `codeMasterSourceId`는 원시 스프레드시트 ID가 아닌 앞부분 SHA256 지문으로서 코드/원장/인증값을 포함하지 않습니다. GET 응답의 출처 식별자와 CAS 서버 source ID가 다르면 쓰기 전 차단합니다.
- 실제 웹 classic-script 및 GAS 함수 VM에서 마스터 이름/코드 중복, 타 탭 동시 등록, 동일 URL의 SS_ID 변경, 일반 동기화 이력 폐기, 기존 row 불변성 및 GAS lock 해제를 확인하는 회귀검사를 추가했습니다.
- 검증 브랜치 GAS v9.199 전체 소스 blob: `ccb7f2c552b50d71f20d46e976d50468568c4da3`. 기존 승인 고정 SHA 및 배포 사전검증 기대값을 이 검증 후보에 맞춰 갱신했으며 운영 배포는 수행하지 않았습니다. 웹 자산은 data/settings_sync `20261013-4`, settings `20261013-5`, settings_net `20261013-1`, mgmt_stock `20261013-3`, sw/cache `20261013-6`.
- 원본 PR #489~#492, main, 운영 GAS 키/원장/가격이력/Snapshot 무변경. 최종 독립 재리뷰와 CI를 통과하더라도 사용자 승인 없이 병합/실배포하지 않습니다.

## PR #493 후속 자체검토: 미거래 신규종목 코드 복구 완결성 (2026-10-13 · 미배포)

- 기존 P1 수정의 추가 경계 사례: 사용자가 신규 종목을 관리 화면에서 등록하고 아직 거래·보유가 없는 상태로 코드 저장에 실패하면, dirty 거래/보유의 코드만 기준으로 복구할 때 해당 신규 마스터 항목을 찾지 못함. 이후 서버의 오래된 EDITABLE_PRICES를 다시 적용하면서 신규 종목이 UI에서도 유실될 수 있음.
- 동일 연결에서 승인된 종목 등록 이력 자체를 복구 후보로 포함합니다. 거래나 dirty가 없어도 원격 code/name 충돌 검사 → **신규 코드만 syncCodes** → 동일 URL의 getCodeList 재조회 → 최종 전체 payload 검증까지 성공한 경우만 확정합니다.
- 복구 직후 Bootstrap 코드 목록도 최신 서버 재조회 결과로 교체하여 후속 reconcile에서 코드가 사라지지 않도록 합니다. 명시적 종목 삭제 시 로컬 등록 이력을 즉시 제거하고, 성공적인 서버 확인 후에도 이력을 지웁니다. GET 실패·등록불일치·연결 변경에서는 거래/보유 쓰기 중단 및 미확정 이력 보존.
- 실제 웹 classic script 회귀검사: **미거래 등록+dirty, 미거래 등록+dirty 없음, 명시적 삭제, POST 성공 후 GET 실패**. 최종 버전 data/settings_sync `20261013-3`, settings `20261013-4`, mgmt_stock `20261013-2`, sw/cache `20261013-5`.
- 기존 #489~#492/main을 수정하거나 GAS 실운영 배포·실거래/가격이력/Snapshot 쓰기를 수행하지 않았습니다. 한국·미국장 범위, Draft 유지.

## PR #493 최신 Codex P1: 거래 식별자·신규코드 복원 (2026-10-13 · Draft / 미배포)

- 리뷰 `c7f8cca` P1 두 건을 독립 검토: 거래 코드 존재 여부만 확인하면 다른 종목명의 거래가 새 연결에 전송되어 원장이 변경될 수 있음. `isPinnedRestoreTradeMasterComplete`는 이제 **동일 마스터 행의 정확한 code/name 쌍**을 요구하며 상충·중복 마스터도 거부함.
- 정상 연결에서 검증된 신규 종목 등록/CSV 추가는 **대상 URL별 로컬 추가 이력**으로 기록. 복구 시 같은 대상 서버의 Settings 또는 이 기록으로 출처를 증명하는 신규 종목만 별도 `syncCodes`를 전송함. 현재 서버의 기존 code/name과 충돌하면 즉시 중단하고 거래·보유·fundDirect의 검증까지 모두 통과해야 함.
- POST 성공만으로 거래를 복구하지 않음. 같은 URL의 `getCodeList`로 다시 읽어 기존 코드 불변·새 코드/이름 일치를 확인한 뒤 원장/보유 저장을 허용. 미검증 자료·타 URL 등록 이력은 자동 쓰기 없이 실패 처리하며 dirty/pending을 보존함.
- 실제 브라우저 VM에서 코드-이름 충돌, 같은 대상 승인 신규코드의 syncCodes 실패 후 복구, 타 대상 등록 이력 거부, 같은 서버 Settings의 신규코드 복구 시나리오를 추가함.
- 웹 자산 `data.js/settings_sync.js=20261013-2`, `settings.js=20261013-3`, `mgmt_stock.js=20261013-1`, `sw/cache=20261013-4`. CI 및 재리뷰 전 Draft/운영 미배포 유지. 기존 PR #489~#492와 main은 수정하지 않음.

## PR #493 P1: 보유·직접펀드 전체 마스터 사전검증 (2026-10-13, Draft / 미배포)

- Codex 리뷰 HEAD b4fdd1f에서 발견한 P1: 기존 거래코드 검증만으로는 거래가 없는 구보유/직접펀드 payload가 다른 연결로 쓰이는 문제를 차단하지 못함.
- `isPinnedRestorePortfolioMasterComplete`가 거래, 보유, 직접펀드 전체를 **동일 getBootstrap 응답의 코드/코드없는 펀드 마스터**와 검증. 이름-코드 충돌, 마스터에 없는 보유/펀드가 하나라도 있으면 syncHoldings/syncTrades/saveSettings 호출 전 실패 처리하여 로컬 pending/dirty 보존.
- 일반 dirty, pending 현재 원장 및 명시적 빈 원장 재시도에 동일 가드 적용. 정상 코드 없는 TDF/펀드는 동일 연결의 Settings로 증명된 경우만 허용.
- 실제 브라우저 로드 회귀검사: 거래 없는 불명 보유·직접펀드, 정상 거래+불명 보유/펀드 혼재, 코드 충돌, 정상 보유/TDF 복원 및 pending 재시도 쓰기 차단.
- 웹 캐시: data.js 및 settings_sync.js `20261013-1`, service worker `20261013-3`. main/원래 PR #489~#492/GAS 운영 배포/실데이터 수정 없음. CI 및 재리뷰 후 Draft 검증.

## PR #493 레거시 강제 복원 pending/dirty 쓰기 선차단 (2026-10-13 · Draft / 미배포)

- 독립 Codex P1: getBootstrap 대기 중 생성된 `latePending`/`lateDirty`를 구버전 getSettings 폴백에서 처리할 때, pending 재시도가 마스터 검증 전에 syncHoldings/syncTrades/saveSettings를 호출할 수 있습니다.
- 최신 통합 후보는 load 시작 시점에 있던 pending/dirty와 강제 복원 중 늦게 도착한 pending/dirty 모두에 대해 **동일 연결의 getBootstrap 코드 마스터 배열 존재**를 원격 쓰기 이전에 검사합니다. 검증 실패 시 RESTORE_MASTER_UNAVAILABLE로 중단, 로컬 거래/보유 및 pending/dirty payload를 삭제하지 않습니다.
- 실제 브라우저 스크립트 순서로 구버전 응답+대기 중 새 거래·보유+pending/dirty를 주입하는 회귀검사 및 초기 pending 단독 회귀검사를 추가했습니다. syncHoldings/syncTrades/saveSettings 0회, 복구 플래그 보존을 검사합니다.
- 배포 캐시: settings.js 20261013-2, service worker 및 cache 20261013-2. 통합 목적은 한국장과 미국장 원장 보호이며 제3국 시장 시세 확장은 수행하지 않습니다.
- Draft 유지. main 또는 원본 PR #489~#492 병합, GAS 배포 및 실데이터 쓰기는 하지 않습니다.

## PR #493 통합 자체검토: 레거시 원장 쓰기 차단·KRX 저장 상태 게이트 (2026-10-13, 미배포)

- P1: getBootstrap를 지원하지 않는 구버전 GAS가 getSettings로 fallback하여도 동일 연결의 코드 마스터를 신뢰할 수 없으므로, dirty 거래원장·보유 재전송을 **쓰기 전** 차단합니다. load 도중 새 dirty가 들어오는 경합도 동일 차단. 원본 dirty는 보존하고 서버 GAS 업그레이드 후 다시 검증해야 합니다.
- P2: read-only KRX CLI의 healthy는 3개 시장 exact-date 응답뿐 아니라 storedCoverage.status=OK, missingOfficialCodes=0, missingSnapshotCodes=0, queuedForBackfill=false가 동시에 충족되어야 합니다. 구버전 미제공·읽기 실패·시트 누락·마스터 미확정·백필 대기는 실패 처리. 운영 데이터는 수정하지 않습니다.
- 한국장/미국장 운용 범위에 따라 불필요한 제3국 신규 개발은 제외합니다. 웹 캐시 settings.js=20261013-1, service worker=20261013-1로 갱신합니다. 이 코드는 main, 원래 네 PR, 운영 GAS에 배포되지 않았습니다.

## PR #493 한국·미국 전용 USD 통화 무결성 P1 수정 (2026-10-13 · Draft / 미배포)

- 미국 상장종목 US/USA/NYSE/NASDAQ/AMEX/OTC와 market 빈 레거시 USD 종목은 코드 마스터 통화가 정확히 USD여야 정상 일일 마감 대상입니다. KRW/JPY/EUR/HKD/GBP 등은 Yahoo USD 가격을 다른 환율로 평가하는 오류를 방지하기 위해 조회·백필 큐·Snapshot 쓰기 전에 명시적 오류로 거부합니다.
- 방어는 `_assertSupportedDailyCloseMarkets_`의 사전 검사와 `_verifyForeignDailyCloseCoverage_`의 저장 전 이중 검증에 적용합니다. KRX/KRW 국내 종목 및 펀드·TDF 예외는 유지하고, 다른 해외 거래소 지원을 확대하지 않습니다.
- 실제 생산 함수 실행 테스트에서 미국 거래소별 비USD, 마스터 통화 KRW, 정상 NYSE/NASDAQ/USD, 국내외 혼합 보유 검증을 추가했습니다. 원본 데이터·운영 GAS 미변경.
- 통합 GAS v9.199 검증용 전체 소스 SHA: `d082240c3e10fbdc41e853bd220848b6e7d0449a`. 이전 문서에 기재된 SHA는 이력으로만 유지합니다.

## PR #493 한국·미국 전용 마감 적용 (2026-10-13 · Draft / 미배포)

- 사용자 요구에 따라 지원 대상은 KRX 상장 및 미국 US/NYSE/NASDAQ/AMEX/OTC 주식·ETF로 제한합니다. JP/HK/UK/EU의 달력이나 거래소별 확정 종가를 추가 개발하지 않습니다. 기존 데이터/조회 함수는 삭제하지 않습니다.
- 자체 재검토: KRX 대상 마켓 판정은 **국내 허용목록**(빈 기존 시장·KR·KRX·KOSPI·KOSDAQ·ETF)으로 검증합니다. 새로운 `AU/ASX/CA/TSX` 등 미지원 해외시장이 `KRW` 통화라는 이유만으로 공식 KRX 가격으로 혼입되지 않고, 보유 시 명시적인 미지원시장 오류가 나도록 회귀 테스트로 고정합니다.
- 실제 보유한 **미지원 시장**이 나타나면 `saveDailyPriceHistory`가 가격·Snapshot 기록 및 누락일 큐 준비 전에 명시적으로 실패합니다. 미지원 시장 가격을 단순히 제외하거나 지난 가격으로 대체해 성공 처리하지 않습니다. 입력 데이터 자체는 건드리지 않습니다.
- NYSE/Nasdaq 2025-01-09 지미 카터 국가애도 **특별 전면 휴장**을 2025 미국 주식시장 확정 달력에 포함했습니다. Nasdaq 2024-12-30 발표 및 NYSE/ICE 2024-12-30 보도자료로 확인했습니다. 따라서 2025-01-10 한국시간 19시 미국 기준 마지막 완료일은 2025-01-08입니다.
- 기존 미국 일반/임시 휴장 날짜 판정과 KRX 저장·스냅샷 실보유/추적 가격 검산을 유지합니다. 단위/실제 GAS saveDailyPriceHistory VM에서 한국+미국 보유 정상 허용, 다른 해외시장 보유는 가격 조회·큐 변경 이전 차단을 검사합니다.
- **GAS v9.199 승인 해시 후보** `e1376c4b868b5bb1ba7e3e8afd7993cfdd9f0955`. 이 해시는 검증 브랜치에서만 사용하며 운영 배포 승인이나 원래 PR #489~#492 병합을 의미하지 않습니다.

## PR #493 미국 주식시장 공식 휴장일 기반 완료 세션 검증 (2026-10-13 · Draft / 미배포)

- Codex P1: 해외 확정 종가 필수일을 평일만으로 계산하면 미국 노동절/추수감사절/Good Friday 휴장을 거래일로 간주하여 PRICE/Snapshot 저장이 불필요하게 영구 실패할 수 있었습니다.
- NYSE 2025~2028 공개 휴장표(https://www.nyse.com/trade/hours-calendars)에서 US/NYSE/NASDAQ/AMEX 등 미국 주식시장 휴장일을 명시하고 해당 휴장을 건너뛰도록 실제 `_foreignMarketRegularCloseCutoff_`를 수정했습니다. 미국 은행 휴무인 Columbus Day는 NYSE 개장일이므로 반드시 거래일로 인정합니다.
- Yahoo 실제 확정값 존재만으로 휴장을 추론하지 않으며, 거래소별 공식 증거가 확인된 날짜만 스킵합니다. 정규장 `YAHOO_REGULAR_CLOSE`/usedDate/marketDate 유한 양수·정확한 완료 세션 검증과 누락 시 저장 전 실패는 유지됩니다.
- NYSE 공개 표를 적용할 수 없는 연도는 확인되지 않은 휴장일을 자동으로 정상 판정하지 않습니다. JP/HK/UK/EU 거래소 휴장을 미국 표에서 추측하지 않으며, 해당 시장의 공식 휴장 달력 확장이 별도로 필요합니다.
- GAS 검증 후보 full-source SHA `8129475334acebdb09075f2938e0955d5f125639`; 배포 승인 사전게이트 및 테스트와 동일 고정. 운영 GAS 실제 deploy, 원장/가격이력/Snapshot 쓰기, main 병합 금지.

## PR #493 Snapshot integrity revision 충돌 방지 (2026-10-12 · Draft / 미배포)

- 통합 CI 독립 재검산에서 저장 프로퍼티 쓰기 실패 후 다음 읽기의 새 migration revision이 기존 값과 우연히 일치할 수 있음을 확인했습니다. 같은 millisecond 및 동일 난수 환경에서는 stale Snapshot integrity cache key가 남을 위험이 있습니다.
- `_getSnapshotIntegrityRevisionState`의 신규 migration revision은 실행 내 마지막 migration revision보다 반드시 1 이상 증가합니다. 범위가 안전한 정수인 동안 속성 저장 실패나 같은 밀리초 내 재생성 시 revision 충돌이 발생하지 않도록 합니다. 테스트에 Date.now·Math.random을 고정한 반복 migration 반례를 추가했습니다.
- 최신 GAS source blob: `da9fec20f6431d133bd2b9e233ac69aba9f57010`. 이전 source blobs는 이력이며 최신 deploy 사전 게이트 소스로 사용하지 않습니다. main 병합 및 운영 배포는 수행하지 않았습니다.

## PR #493 P1: 해외 확정 종가 누락 시 PRICE 성공·Snapshot 저장 차단 (2026-10-12 · Draft / 미배포)

- Codex 새 P1 및 자체검토: 국내 KRX 일부 성공 시 Yahoo 해외 가격이 없거나 오래된 완료 세션인 종목을 이전 가격이력으로 이월하여 Snapshot이 정상 완료될 수 있었습니다. 새 생산 `_verifyForeignDailyCloseCoverage_`는 **모든 실제 해외 보유 종목마다 마지막 완료 세션 날짜와 일치하는 YAHOO_REGULAR_CLOSE의 유한 양수·CONFIRMED 가격**을 실제 저장 전에 요구합니다.
- 정상 해외 세션/코드별 확인되지 않으면 PRICE 단계를 예외로 실패시키고 누락일 복구/Watchdog을 성공으로 처리하지 않습니다. 해외 공휴일도 신뢰할 수 있는 별도 휴장 증거가 없으면 임의 직전값으로 확정하지 않는 보수적 기준입니다.
- 추가 독립 확인: 해외시장 코드의 currency가 구버전 기본값 KRW로 남아 있으면 Yahoo 외화 가격을 원화 평가로 오인할 수 있습니다. 실제 해외 공급자 가격을 확보하더라도, 종목코드 마스터의 통화가 KRW인 해외 보유는 명시 오류로 차단해 올바른 USD/JPY/HKD/GBP/EUR 통화 수정 후 재시도하도록 했습니다. 실데이터 변경 없음.
- 실제 saveDailyPriceHistory 생산 함수를 실행하는 회귀검사에 국내 성공+해외 누락, 오래된 해외 세션, 비공식 현재가, 해외시장+KRW 통화 충돌, 국내외 동시 성공의 경계 시나리오를 추가했습니다. 가격/Snapshot 실제 쓰기는 mock에서 차단했습니다.
- GAS 통합 source blob (최신 검증 후보): `3dd99ad6dd048e01fa2d3db5452341d894abb9ba`. 원본 #489~#492와 main, 운영 GAS 및 자격증명·원장·가격이력·Snapshot은 변경하지 않았습니다.

## PR #493 해외시장 종가 조회 및 Yahoo 심볼 검증 (2026-10-12 · Draft / 미배포)

- 후속 Codex P2 2건: saveDailyPriceHistory의 해외 종가 호출 분기와 _isKrxDailyCloseTarget_의 불일치, 그리고 KRW 기본값+해외시장 종목의 Yahoo 티커 심볼 미생성을 자체 확인하고 수정했습니다.
- 실제 저장 경로가 **국내 대상만** fetchPricesKrx에 전달하고, 해외 조회 분기를 같은 공통 판정 함수의 반대로 적용합니다. US/NASDAQ+KRW 종목이라도 Yahoo 정규장 조회를 거치고, 조회 실패를 기존 저장 종가가 있는 것처럼 묵인하지 않습니다.
- Yahoo 심볼: US/USA/NYSE/NASDAQ/AMEX/OTC는 코드, JP/TSE/TYO는 .T, HK/HKG/HKEX는 .HK, UK/LSE는 .L. EU는 거래소가 특정되지 않아 **명시된 전체 공급자 심볼**(예: 코드 SAP.DE 또는 item.yahooSymbol=SAP.DE)만 허용합니다. 미확정 심볼은 조용히 생략하지 않고 실패를 반환하므로 가격이력/Snapshot이 성공 처리되지 않습니다. 기존 마스터에 Yahoo 별도 열이 없으면 유럽 코드를 시장 접미사 포함으로 등록해야 합니다.
- _foreignMarketTimeZone_도 US/JP/HK 거래소 별칭을 적용해 통화 기본화가 실제 해외시장 정규장 날짜에 영향을 주지 않게 했습니다. 생산 _yahooEquitySymbol_→fetchPricesYahooRegularClose 실제 호출 및 saveDailyPriceHistory에서 해외 1종목만 보유하는 반례로 회귀 검증합니다.
- GAS v9.199 최신 검증용 source blob은 ea84dabc10f9d49619afc3fa9bf98700a1c388f9이며 아래 이력 해시들은 최신 승인 소스가 아닙니다. **원본 PR #489~#492, main, 운영 GAS, 자격증명, 가격이력 및 Snapshot은 변경하지 않습니다.**

## PR #493 통합 KRX 시장 분류 일치 검증 (2026-10-12, Draft / 미배포)

- 독립 Codex 리뷰가 확인한 후속 P2: `getCodeItems()`는 구버전 비어 있는 통화를 KRW로 보정하므로 `UK/LSE/EU` 등의 해외 시장 종목이 KRX 누락 대상이 될 수 있었고, `US+KRW`는 진단에선 제외되지만 실제 마감에선 KRX 대상으로 포함되는 상충 상태였습니다.
- `_isKrxDailyCloseTarget_` 공통 함수는 유효한 비펀드 코드·원화 통화·해외시장 아닌 항목만 국내 확정가 대상으로 인정합니다. 실제 KRX 조회 `fetchPricesGoogleFinance`, `_assessDailyKrxStockClose`, 누락일 큐 `_hasKrxHoldingsForCloseDate_`, 저장된 휴장일 종가 복구 `_readStoredOfficialKrxClosesForHoliday_`, `_krxReadOnlyStoredCoverage_`, 해외 종가·watchdog 판단도 이를 공동 사용합니다.
- 기존 거래원장·가격이력·Snapshot·자격증명은 변경하지 않습니다. 테스트는 `US/JP/HK/UK/LSE/EU/NASDAQ` 등 market/currency 충돌·빈 통화 및 유효 국내 종목 양방향 반례를 생산 함수에 대입합니다. 새로 판별되는 해외 종목의 실제 Yahoo/KRX 가격 공급 계약은 운영에서 별도 검산해야 합니다.
- GAS v9.199 통합 검증 후보 전체 blob: `b3ad78e672f8921e5d83f39786f74cf9f884080c`. 승인 고정·회귀검사·독립 재리뷰 전까지 main 병합/실제 GAS 배포 금지. 이전 버전 소스 해시는 기록 이력일 뿐 최신 승인 소스가 아닙니다.

## PR #489~#492 통합 검증 후보 (2026-10-12, Draft / 미배포)

### PR #493 KRX 진단 추가 안전성 보완 (2026-10-12)

- KRX 공식 종가 누락 `storedCoverage`는 보유 국내 KRW 종목만 집계하며 USD/US, JPY/JP 및 해외 시장 보유를 KRX 공식 종가 누락으로 분류하지 않습니다. 원래 가격이력·Snapshot 전체 행 수는 읽기 전용으로 별도 유지합니다.
- 공식 가격 검증은 정확한 요청 거래일, 보유 종목 코드, KRX/KRX_OTP 원천에 **유한 양수 종가**까지 요구합니다. 0·공란·음수·NaN/Infinity 등 손상 행은 공식 종가로 집계하지 않습니다. 읽기·진단만 수행하며 자동 백필이나 원본 변경은 하지 않습니다.
- 진단 CLI에서 구버전 GAS가 `exactDateRows`를 제공하지 않으면 HTTP 200/전체행 1건 이상이어도 대상 거래일을 확인한 것으로 판정하지 않습니다. 최신 GAS 도입 전 운영 검증 결과는 미확인/불건전으로 표시합니다.
- 추가 검증 GAS v9.199 후보 소스 blob: `3b9d3d7cce66315505af35562f931e3b484650d6`. 아래 통합 최초 후보 blob은 이력이며 지금 검증·배포 사전게이트 기준이 아닙니다. Codex 독립 재리뷰 및 CI·운영 검증 전 병합·실제 GAS 배포 금지.


- 이 소스는 #492의 Toss OAuth 진단·단일 복구 및 #491의 KRX 시장별 기본/보조 인증키·정확한 BAS_DD·보유 공식 종가/Snapshot 읽기 진단을 **GAS v9.199 하나로 통합**한 테스트 후보입니다.
- #489의 getBootstrap 동기화 전 마스터 검증 및 원장 dirty 보호, #490의 설정 화면 60초 현재가 polling 후 DOM 재렌더 억제를 같이 보존합니다.
- v9.198 단독 후보 승인 blob은 별도로 기록하고 통합 v9.199 GAS 전체 blob `2be650c42557e220e6ae96d46148037d008f0f5e`을 검증 고정합니다. 원래 #489~#492 Draft PR을 변경하거나 main에 병합하지 않습니다.
- 정적 자산: portfolio/data 20261012-1, settings.js 20261012-3, settings_sync.js 20261012-10, settings_fetch.js 20261012-6, PWA 20261012-16. 전후방향 테스트가 모든 변경분을 검증한 뒤에만 통합 병합 여부를 결정합니다.
- 읽기 전용 KRX 진단은 실제 가격 백필·원장 수정이나 부적절한 시트 쓰기를 실행하지 않습니다. 사용자가 승인하지 않은 운영 GAS 배포·OAuth 키 변경·실제 운영 Snapshot 복구는 금지입니다.
- 주의: 아래 v9.199/v9.198 단독 PR 관련 병합 충돌 설명은 독립 후보 작성 당시의 이력이며, 통합 후보는 GAS·웹 파일 및 테스트의 충돌을 별도로 정리한 소스입니다. **CI 통과만으로 Toss 모바일 데이터망 401 해결이나 KRX 10/08 누락 종가 복구를 입증하지 않습니다.**

## GAS v9.199 — Toss 진단 토큰 재발급 방지 및 모바일 연결 비교 (2026-10-12, Draft / 운영 미반영)

- 유효한 Toss OAuth 캐시 토큰이 있는 경우 일반 진단 버튼은 신규 client_credentials 발급 없이 동일 토큰으로 시세 및 시장 API를 점검합니다. 캐시가 없으면 기존 진단처럼 새 토큰을 1회 확보합니다.
- Codex P2 보완: 캐시상 유효하지만 실제 시세 API가 401로 거부한 토큰은 기존 시세 경로의 ScriptLock/토큰 비교·갱신 함수를 재사용해 한 번만 복구합니다. 다른 실행이 이미 갱신한 토큰은 재사용하고, 복구 후 다시 401이어도 재발급하지 않습니다. 캐시 미스·OAuth 401/403·단순 403에서는 이 복구를 실행하지 않습니다. 진단 응답의 `oauth.recovery`는 복구 여부/결과만 제공하며 토큰이나 OAuth HTTP 200을 조작하지 않습니다.
- 토큰 발급 네트워크 HTTP 상태는 신규 OAuth 발급 시에만 표시합니다. 기존 토큰을 재사용한 결과는 `CACHE / CACHED_TOKEN_REUSED / httpStatus=null`로 구분하며, 강제 발급 검증은 명시적인 `freshOAuth=1`에서만 허용합니다.
- 웹 진단에 GAS 배포 ID의 마지막 8자만, exec/dev 종류, GAS 접근토큰 등록 유무, 실제 GAS 버전을 표시합니다. Client ID/Secret, 접근토큰 원문, 배포 URL query는 반환/표시하지 않습니다.
- 후속 자체검토: 진단 중 연결 URL·접근토큰 변경 또는 빠른 중복 진단의 비동기 응답 경합으로 이전 GAS 결과가 새 연결에 표시되는 오류를 차단합니다. 요청 시점의 URL·연결 세대·토큰을 검증하며 Web JS/PWA 캐시와 실제 진단 함수 실행 회귀검사를 동기화했습니다.
- GAS 스프레드시트 메뉴 및 웹 연결 진단 모두 **관측 IP를 실제 Toss 요청의 송신 IP로 단정하지 않고 허용 IP 임시 등록·Google 공유 IP 대역 일괄 등록을 권고하지 않습니다.** 캐시 재사용·복구와 리소스 403을 구분해 표시합니다.
- 진단의 `oauth.source`는 **최초** OAuth 출처이며, 복구 출처는 `oauth.recovery.source=NETWORK`(직접 신규 발급), `CACHE_UPDATED`(다른 실행 갱신 재사용), `NETWORK_ERROR`(신규 발급 실패)로 구분합니다. `freshOAuthTested`는 실제 신규 발급 성공만 가리킵니다. 복구 실패 최종 코드는 `diagnosticCode`, `TOSS_LAST_DIAGNOSTIC_CODE`, 웹 최근 진단 표시에서 동일하게 보존합니다.
- 모바일과 PC가 다른 URL/토큰을 쓰는 경우 구분할 수 있지만 **이 변경 자체로 Toss OAuth 401 unidentified-client 또는 Google 송신 IP 차단이 해결되었다고 주장하지 않습니다**. 동일 연결 여부와 실제 계정 OAuth 응답은 운영 배포 후 별도 확인이 필요합니다.
- 이 PR은 main v9.197을 기준으로 독립 작업되어 #491의 v9.198 KRX 진단과 GAS 전체 파일/웹 캐시가 충돌할 수 있습니다. 두 PR을 병합하기 전에 최신 main을 기준으로 **양쪽 코드를 통합하고 v9.199 전체 blob pin 및 캐시를 재산출**해야 합니다. 단독 운영 배포 금지.
- 외부 서버 비용 0원, 인증키·거래원장·가격이력·Snapshot 수정 없음. 승인된 CI와 독립 리뷰 후 병합 여부 결정.

## GAS v9.198 포함 변경 — KRX 시장별 인증 승인 및 누락 커버리지 읽기 전용 진단 (통합 테스트 후보)

- `getKrxSourceDiagnostics?date=YYYY-MM-DD`는 KOSPI·KOSDAQ·ETF 시장별 기본키 HTTP/스키마/요청일 `BAS_DD` 정확한 행 수를 점검합니다. 기본키가 401/403인 시장마다 보조키를 확인하여 한 시장 승인만으로 다른 시장을 정상 판정하지 않습니다.
- 응답 `alternateProbes`는 시장별 검증, `storedCoverage`는 보유 공식 종가·가격이력·Snapshot 및 백필 큐 누락의 **읽기 전용 점검**입니다. 최초 `alternateProbe`도 호환 유지합니다.
- 운영 2026-10-08 데이터의 실제 복구는 이루어지지 않았으며, 기본/보조 KRX 계정의 시장별 권한 승인과 날짜 일치 공식 가격을 운영에서 별도로 확인해야 합니다.
- 이 변경은 단독 #491의 검토 전 v9.198 코드에서 채택되었으며 최종 통합 v9.199 소스의 검산·독립 검토 및 연계 배포 승인 전까지 운영에 반영하면 안 됩니다.

## GAS v9.197 — 거래 DATE 읽기 검증 및 Bootstrap 실패 단계 (2026-10-12, 미배포 후보)

- PC 콘솔의 `syncTrades 실패: 거래이력 쓰기 후 검증 실패`와 운영 거래이력 A열 DATE 서식을 읽기 전용 확인했습니다. 기존 원시 JSON 비교는 저장 입력 `YYYY-MM-DD`와 읽은 Date 객체를 다르게 판정합니다.
- 거래이력 검증에만 시트 시간대의 날짜 비교를 적용합니다. 코드·수량·단가·메모 검증, 실패 백업 보존, 잠금 해제 및 검증 전 Snapshot 재산출 금지는 유지합니다. 공통 읽기 검증과 기존 시트 서식은 변경하지 않습니다.
- 설정 복원 실패 단계/오류 종류를 최신 연결에 귀속해 표시합니다. 운영 데이터·인증키·응답 본문은 새 진단에 기록하지 않습니다.
- #488은 #487 최신 후보(요청일 전체 검증 후 VKOSPI 캐시 포함)를 통합해 버전 역행을 방지한 후속 후보입니다. #487을 먼저 검토하고 #488을 최신 main에 다시 대조하십시오. GAS 기대버전/전체 blob 및 웹 캐시를 함께 갱신했습니다.
- 전체 blob 후보: `0d7eec10b1e1ff848b302e84db908196f4ef62eb`. PR/CI/리뷰와 실운영 복구는 별개입니다. 현재 운영 GAS 9.195는 사용자 화면 기준이며 이 후보는 배포하지 않았습니다.
- Sheets 쓰기, Script Properties/키 변경, 강제 동기화/초기화, 누락 가격이력/Snapshot 백필은 실행하지 않았습니다. 검토 완료 후 통제된 배포와 실제 복원 확인이 남습니다. 연결 테스트는 종목코드 쓰기 단계도 수행하므로 읽기 전용 진단으로 사용하지 마십시오.

## GAS v9.196 — K200 야간선물 / VKOSPI KRX 인증거부 보조키 재조회 (검증 후보)

- VKOSPI는 기존 공식 달력의 CLOSED를 요청 대상에서 제외하고 UNKNOWN은 조회합니다. 검증된 각 날짜만 일괄 캐시하고, 미공시·오류·다른 원천일 날짜는 캐시하지 않아 해당 날짜만 재시도합니다. 범위 캐시는 모든 요청 거래일의 유효 점수가 있을 때만 사용하며 이전 부분 범위 캐시와 키를 분리합니다.
- 기본 KRX 인증 슬롯이 **HTTP 401/403**으로 거부될 때에만, K200 야간선물과 VKOSPI 날짜별 해당 요청을 보조 슬롯으로 재조회합니다. 기본 슬롯의 정상 수신을 보존하고 HTTP200/빈 자료는 인증 실패로 재분류하지 않습니다.
- K200 NIGHT_FINAL은 기존 정확한 거래일·야간시장·만기·단가 필터 통과 시에만 발행하고, VKOSPI 날짜가 요청일과 다른 결과는 반영하지 않습니다. 보조 슬롯이 선물/변동성 지수 API를 승인받았는지는 **운영에서 미확인**입니다.
- 원장, 인증정보, PriceHistory, Snapshot 및 시트 내용은 변경하지 않습니다. PR 코드 CI/독립 리뷰 후에만 병합·실제 GAS 배포를 판단하며, #484의 10/08 일반주식 종가·스냅샷 복구는 별개입니다.

## GAS v9.195 / 웹 20261012-1: KRX 지수·휴장과 원천 장애 구분
- 국내 KOSPI/KOSDAQ의 최신 확정 가능한 KRX 거래일 지수는 `idx/kospi_dd_trd` / `idx/kosdaq_dd_trd` 정확한 날짜로 검증합니다. 기본 인증키가 401/403이면 보조키를 재시도하며, 시장별 다른 상태를 보존합니다.
- 장기간 그래프는 KRX 일별 API 대량 요청 없이 Yahoo(^KS11/^KQ11) 일봉을 보조 원천으로 사용하고 Yahoo 실패 시 Toss를 보조로 조회합니다. 이는 KRX 공식 확정값과 엄격히 구분되는 `UNVERIFIED_DAILY_CANDLE`입니다.
- 공식 달력상 CLOSED인 날짜만 건너뜁니다. 정상 거래일 OPEN의 HTTP200/0건·401·네트워크 실패는 `KRX_OFFICIAL` 오류로 표시합니다. UNKNOWN 연도를 임의 휴장으로 취급하지 않습니다.
- 손익그래프는 2026/2027 GAS 휴장일 달력과 같은 날짜 집합으로 거래일만 누락으로 계산합니다. 당일 19시 통합 마감 전과 휴장일은 스냅샷 누락으로 표시하지 않습니다.
- 원장/종가/가격이력/스냅샷을 수정하지 않고 운영 키도 교체하지 않습니다. #484의 누락 복구는 실거래일 공식 종가 확인 후 별도 처리합니다.

## 통합 PR #483 — KRX 장중 원천일 P2 복구 (2026-10-11)

- 연결된 PR #481의 GAS v9.194 전체 소스와 장중 확정 종가 생산 함수 테스트를 통합에 반영합니다. 당일 장중 KRX 잠정 종가를 사용하지 않고 직전 확인된 국내 정규 거래일을 명시해 조회하며, 더 오래된 응답은 거부합니다.
- 2026/2027 확정 휴장일·주말, 미등록 연도 UNKNOWN, 정규장 개시·종료 시각, 해외 가격 조회 및 이전 캐시 경로를 분리합니다.
- 정확한 GAS 전체 blob pin, 웹 EXPECTED_GAS_VERSION, 릴리스 검증 테스트는 #481과 동일합니다. 코드 CI·Codex 리뷰 완료 전에는 검증 후보이며 main 병합·GAS 배포·실계좌/시트 데이터 수정은 하지 않습니다.

## 통합 브랜치 점검: PR #476 + #477 + #478 + #481 (2026-10-11)

- 이 문서는 각각 별도 Draft PR의 변경을 하나의 **검증용 후보**로 조합한 결과입니다. 아직 main 병합·운영 GAS 배포·Google Sheets 데이터를 수정하지 않습니다.
- KRX read-only 진단(#476), 한국장 브리핑(#477), 포트폴리오 화면 캐시(#478), GAS v9.194 장중 확정 종가/종가·NAV/배포(#481)를 동시에 검사합니다. 이전 #479/#480 스택 내용은 #481에 포함되며 중복 병합하지 않습니다.
- 웹 정적 파일 `views_portfolio.js`, `views_system.js`, `views_history.js`와 SW cache name의 버전 참조를 독립적으로 추적합니다. 브리핑은 핵심 미국 지수 2개와 USD/KRW 부분 장애 시 실패를 올바르게 보고해야 합니다.
- Codex 독립 리뷰 및 실제 GAS 운영 진단은 별도 승인 단계이며, 여기서 CI 통과는 실제 가격·Snapshot 복구의 증거가 아닙니다.

## PR #477 휴장일 해외지수 자체검토 보강 (2026-10-11)

- KRX 공식 휴장일에는 `KRX_FINAL` 국내 최종 Snapshot을 생략하되, `EVENING` 해외 지수·환율 수집은 정상 실행합니다.
- `EVENING` 수집의 성공은 S&P 500(`SP500`), 나스닥100(`NASDAQ100`) **둘 다** 유효하고 USD/KRW가 유효한 경우에만 인정합니다. VIX/SOX만 있고 미국 핵심 지수가 없으면 워크플로 종료코드 1과 `FOREIGN_CONTEXT_MISSING` 진단을 반환합니다.
- 국내 휴장일 여부만으로 해외 공급자 실패를 성공 처리하지 않으며, 이 조건은 읽기 전용 회귀테스트와 별도 CLI 프로세스 테스트로 검증합니다. 운영 GAS 데이터나 투자원장에 가격을 쓰는 변경이 아닙니다.

## GAS v9.193 통합 검증 PR #481 (2026-10-11)

- PR #481은 현재 `main`을 기준으로, #479 종가 원천일 검증·#480 NAV 완료/타임아웃/Snapshot no-op·#481 KRX 인증 슬롯/OTP 복구를 모두 포함한 **단일 후보 릴리스**입니다. PR #479/#480을 차례로 개별 배포하지 않습니다.
- 변경된 레거시 GET의 외화 종가는 해당 거래소의 최근 완료 세션으로 검사합니다. 국내 종가가 오래됐을 때도 유효한 해외 캐시는 보존하고 국내 종가만 재조회하며 미래일자 또는 오래된 원천은 반환하지 않습니다.
- 자동화 화면은 `fundAttempt.state = TIMEOUT_SUSPECTED`를 시작 시각/대상일과 함께 표시합니다. 변경 UI와 정적 PWA 캐시 버전도 동기화해야 합니다.
- 운영 GAS 배포는 승인된 전체 GAS 소스 Git blob 및 **실제 배포 프로젝트의 파일 구성이 manifest JSON 하나 + SERVER_JS 하나인지** 먼저 검증합니다. 현재 HEAD manifest는 이미 배포된 manifest와 일치해야 합니다. 예상 밖 파일·manifest drift·승인되지 않은 버전은 운영 쓰기 전 거부합니다.
- **캐시 전량 만료 시에도 안전 조회:** 현재일 GET은 과거 특정일 조회로 빠지지 않고, 국내 KRX와 미국 등 해외시장의 최근 완료 정규장을 별도로 검증합니다. 장중 당일 KRX 값·해외 미래일자·종가일이 오래된 가격은 현재 확정값으로 반환하지 않습니다.
- **정상 거래일 최종 마감:** 일반 종목은 요청 날짜와 KRX 실제 종가 원천일이 같아야 합니다. T-1/T-2 종가는 조회용 이월값일 수 있어도 당일 PRICE/Snapshot 마감 성공 증거가 아닙니다. 공식 휴장일에만 직전 확정 세션 종가를 허용합니다.
- **버전 생성 후 재검증:** GAS Apps Script API가 신규 `versionNumber`를 만든 뒤 실제 불변 버전의 SERVER_JS와 manifest·파일 구성을 다시 읽어 승인 소스와 비교합니다. 검사 실패 시 기존 `/exec` 배포 ID를 새 버전으로 전환하지 않습니다.
- CI와 리뷰가 끝난 뒤에도 실제 GAS 웹앱·KRX 인증·NAV/Snapshot 읽기 전용 진단이 필요합니다. 정상 운영을 CI 성공만으로 인정하지 않습니다.

## GAS v9.193 통합 준비: PR #479→#480→#481 (2026-10-11)

- KRX 레거시 종가 캐시 갱신일시와 실제 원천 종가일을 별도 컬럼으로 기록합니다. 구버전 4열 캐시는 확정 원천일이 없어 최신 종가로 인정하지 않습니다. 전일 종가를 당일 저장한 경우 당일 확정 가격이력에도 기록하지 않습니다.
- NAV 완료 집계 및 KRX OpenAPI/대체 인증키/OTP 복구는 후속 스택 PR #480/#481에 포함되며, **세 PR 모두 검증·병합한 뒤 GAS·웹을 하나의 v9.193으로 배포**해야 합니다. 개별 PR 병합 직후 배포/소급 복구는 금지합니다.
- 웹 기대 버전 9.193, CSS/JS/PWA 캐시 불일치, 기존 Snapshot·MANUAL 보존 및 원천일 검증을 함께 확인합니다.
- **운영 GAS 릴리스 승인:** `scripts/deploy-gas.mjs`의 `REVIEWED_GAS_SOURCE_BLOBS`에 등록된 전체 `src/gas/apps_script.gs` Git blob SHA와 배포 대상의 내용이 정확히 일치해야만 `dry_run=false` 배포를 허용합니다. v9.193 승인 SHA는 #481 통합 기능(종가 원천일, 펀드 owner/Snapshot, KRX 대체 키·OTP)이 모두 반영된 소스를 가리킵니다. 함수명·주석만 있는 더미 코드와 승인되지 않은 v9.194 또는 구버전 롤백도 거부합니다.
- **이후 릴리스:** GAS 소스가 한 글자라도 바뀌면 리뷰된 통합 소스의 Git blob SHA를 확인하고, 새 GAS 버전 및 해당 SHA를 같은 PR에서 함께 승인·갱신합니다. 재검토 없는 임의의 SHA 교체·버전 변경은 금지합니다. `dry_run=true`는 인증·대상 조사용으로 허용하되 실제 쓰기를 하지 않습니다.
- 실제 KRX 종가와 10/07~08 누락 데이터 복구는 운영 연결 진단 뒤 별도 실행합니다. CI 통과는 운영 복구 증거가 아닙니다.

## PR #471 최신 Codex P2 통합 수정: 자정 NAV·예약 소유권 (2026-10-09)

- 지연 NAV 반복 트리거는 KST 자정 뒤에 발화해도 예약의 `date`가 만료 전이면 해당 날짜를 실행 대상으로 유지합니다. `runDailyFundValuations(targetDate)`의 대상 종료 날짜도 원 예약일로 한정하며 해당 날짜의 성공 마커와 결과에 정합화합니다.
- 가격 실패 예약 생성 시 별도의 후속 summary 저장 전에 트리거/예약과 `runId`·시작시각·PRICE 오류 근거를 공유 ScriptLock에서 영속 저장합니다. Apps Script 강제 종료로 summary가 누락되면 저장된 소유권 증빙이 유효한 경우에만 후속 NAV 성공 기록으로 해당 부분 상태를 복원하고 PRICE는 실패로 유지합니다.
- 같은 날짜라도 `runId`가 다르거나 시작 메타데이터가 누락된 기존 PRICE summary에 NAV 성공 마커를 무단 합산하지 않습니다. 자정·다른 실행 ID·상태 누락·GAS 중단 경로를 행동 검증에 포함했습니다.
- GAS/Web CI는 코드 검증이며 운영 트리거 실측·Apps Script 배포·실제 Snapshot 데이터 재검증과 구분합니다.

## PR #471 최종 자체검토: 실행 소유권·부분 완료 표시 (2026-10-09)

- 22:10 PRICE 재생이 원래 마감 summary를 처음 만드는 경우, 동일 거래일의 `portfolio_close_run_started_at`·`portfolio_close_run_started_ms`를 함께 복원하여 NAV 성공 마커가 합쳐진 후 `_portfolioCloseRunState`와 자동화 상태 UI 모두 COMPLETE로 판정되도록 합니다.
- 기존 partial summary에 실행 시각이 없으면 동일 날짜 소유권을 확인한 뒤 복원합니다. 단지 summary 객체가 존재한다는 이유만으로 완료로 표시하지 않으며, PRICE/NAV 모두 성공하고 오류가 없을 때만 COMPLETE로 판단합니다.
- 정상 CLOSE NAV 성공 마커는 run-id·거래일·시작시각 조건에 더해, 동일 날짜에 남아 있는 **이전 마감** summary와 startedAt/startedMs가 다른 경우에도 결합하지 않습니다.
- 회귀검사는 실제 PRICE replay→summary 생성→NAV success reconciliation→운영 상태 판정 순서와 역순, 메타데이터 없는 부분 성공, 같은 날짜 다른 실행 소유권을 함께 실행합니다.
- 버전 `9.192`는 현재 PR 기능 버전이며, 이 문서는 해당 변경의 로컬/CI 동작 계약만 기술합니다. 실제 운영 GAS 배포와 운영 데이터 정상 여부는 확인되지 않았습니다.

## PR #471 추가 자체 검증: 실제 가격 저장과 복구 큐 원자성 (2026-10-09)

- `saveDailyPriceHistory(targetDate, {deferQueueCompletion:true})`로 호출한 정규 마감·야간 백필은 원천가격과 Snapshot이 저장됐다는 이유만으로 큐를 조기 제거하지 않습니다. 정규 19시/20:30 마감은 `portfolio_close_last_result` 최종 저장 이후에만 해당 날짜의 큐를 해제합니다.
- 22:10 별도 worker는 실제 `saveDailyPriceHistory`의 deferred 경로를 사용하여 마감 상태를 같은 ScriptLock 안에서 먼저 기록한 뒤 큐를 정리합니다. 상태 저장 오류·잠금 획득 실패 시 날짜는 큐에 남아 반복 시도 가능하며 테스트에서 실제 생산 함수를 실행해 조기 큐 삭제 여부를 검증합니다.
- 과거 누락일 맨 앞 날짜에 지속적인 KRX/API 오류가 발생하더라도 뒤 날짜들이 영원히 밀리지 않도록 `portfolio_close_backfill_retry_cursor_v1` 키로 **이전/다음 날짜 순환 재시도**합니다. 22:10 복구에서는 오늘 watchdog 미완료일이 있으면 과거 대기 날짜보다 우선 처리하고, 오래된 날짜는 삭제하지 않고 보존합니다.
- GAS 가격 저장, Script Properties 큐, 마감 상태는 Google Sheets/Script Properties의 진정한 분산 트랜잭션은 아닙니다. 커밋 간 부분 실패 시 날짜를 보존하고 멱등적인 재실행으로 정합성을 회복하도록 설계하며 운영 상태 확인은 배포 이후 별도 수행합니다.

## PR #471 교차 운영 검증: 실행 소유권이 다른 PRICE/NAV 상태 혼합 방지 (2026-10-09)

- 정상 19시/20:30 마감의 최종 `portfolio_close_last_result`에 정확한 `runId`를 함께 영속합니다. PRICE 재생이 처음부터 summary를 복원할 때에는 실행 소유권을 확인한 경우에만 같은 runId를 기록합니다.
- 정상 CLOSE NAV 성공 마커와 기존 summary를 합칠 때 **명시적 runId가 같거나 기존 레거시 시작 시각·millisecond 모두 정확히 일치**해야 합니다. 두 값이 모두 없는 summary에 나중 실행의 NAV 성공을 억지로 합치지 않습니다.
- 식별 불가 과거 PRICE 실패 summary에 새 가격 복구를 합치는 과정에서도 기존 `fundOk:true`를 임의 유지한 채 `COMPLETE`로 만들지 않습니다. 펀드 결과 확인 필요 오류를 남겨 운영자가 차이를 확인할 수 있게 합니다.
- GAS 운영 상태 UI의 `_portfolioCloseRunState`도 저장된 runId와 현재 소유권이 다르면 완료로 표시하지 않습니다. 직접 production helper 테스트와 기존 NAV·PRICE·자정 회귀검사에서 확인했습니다.

## PR #471 추가 리뷰: 정상 NAV 성공 증거 및 당일 긴급 복구 용량 (2026-10-09)

- 19시·20:30 통합 FUND 단계가 NAV 데이터 저장 후 최종 summary 기록에서 오류가 나더라도 `portfolio_fund_close_success_v1`에 **실행 runId·거래일·시작 이후 성공 시각·lease 토큰**을 남깁니다. Watchdog catch와 22:10 독립 작업은 해당 runId와 날짜가 현재 운영 마커와 일치하는 경우에만 이전 같은 날의 FUND 실패 표시를 정상화합니다. 다른 날짜·실행의 성공 기록으로 새 오류를 덮어쓰지 않습니다.
- 일반 과거 날짜의 누락 큐 추가는 기존 300건 한도를 유지하지만, 당일 watchdog 실패는 같은 공유 Script Properties 큐에 최대 600건까지 긴급 보류할 수 있습니다. 날짜 문자열 JSON 배열은 이 범위에서 약 8KB 미만이며, 600건까지 가득 찼다면 성공 로그를 남기는 대신 명시적 오류를 발생시킵니다.
- 야간 22:10 worker는 과거 누락 목록이 300건으로 가득 차더라도 오늘 PRICE 미완료 날짜를 우선 복구하며, 과거 대기 날짜를 임의 제거하지 않습니다.
- 테스트는 정규 NAV의 성공 후 최종 summary 저장 실패, 다른 runId의 잘못된 성공 마커 방지, PRICE 미완료 300건+당일 긴급 추가, 대기열 600건 초과 오류 표면화를 검증합니다.
- CI 통과는 운영 트리거 및 Sheets 원천 실측을 대신하지 않습니다. `main` 병합·GAS 배포·실제 데이터 검증은 별도 승인·확인이 필요합니다.

## PR #471 최신 리뷰 후속: watchdog 예외·독립 백필·복구 대기열 정합성 (2026-10-09)

- 20:30 watchdog이 마감 PRICE 저장 중 예외로 실패해도 최신 당일 PRICE 미완료를 공유 Script Properties 큐에 영속 저장합니다. 한국 휴장일에 해외 보유 종목을 처리하는 경우도 포함하며, 이미 당일 PRICE가 성공했다면 NAV만의 오류 때문에 가격을 다시 예약하지 않습니다.
- 기존 19:00/20:30 통합 마감에서는 과거 날짜 KRX 백필을 더 이상 직접 실행하지 않습니다. 금일 PRICE와 FUND 성공·오류 결과를 우선 확정하고, 누락일 큐는 22:10 독립 worker가 1회 1날짜씩 처리합니다. 따라서 백필 소요시간 때문에 현재 마감 상태 기록이 6분 제한으로 소실되지 않도록 합니다.
- 독립 백필의 PRICE 저장 성공 시에는 공유 잠금 안에서 당일 마감 결과를 갱신한 **후** 날짜 큐를 제거합니다. 상태 반영 실패 시에는 큐를 유지해 다음 실행에서 재시도합니다. 당일 마감 결과가 없으면 가격 성공·펀드 미확인으로 명시하고, 새 날짜의 더 최신 마감 결과는 덮어쓰지 않습니다.
- 이 변경의 CI는 실제 운영 트리거·KRX API 오류·실제 Google Apps Script 배포를 검증하지 않습니다. PR 리뷰 및 테스트 완료와 운영 확인은 구분합니다.

## GAS v9.192 / 정규장 공식 종가 브리핑 대체조회 (2026-10-09)

- 브리핑 MORNING에서 Toss 지수 일봉이 403/미확정이면 직전 KRX 정규 거래일 공식 종가를 조회합니다. 당일 공식 종가는 16:00 이전에는 확정으로 처리하지 않습니다.
- KOSPI/KOSDAQ 정규장 지수는 `KRX_OFFICIAL`, 확정 상태 및 정규장 관측시각이 확인된 경우에만 FINAL로 인정합니다. Toss의 과거 미확정 candle은 FINAL로 승격하지 않습니다.
- KRX 지수 시장별 HTTP 401/403/비JSON/응답 형식 오류를 별도 기록하며, 주식 KRX 최초 요청의 HTTP 상태도 로깅하고 인증 오류에는 과거 날짜 반복조회를 줄입니다.
- Codex 2차 P1 후속: 기존 `KRX_VERIFIED_EMPTY_OR_CLOSED_GAP` 단순 표시는 재사용 불가. 범위 증거는 `KRX_CONFIRMED_CLOSED_GAP@검증종료일|확인휴장일목록` 형식으로 기존 `MARKET_MASTER.quality`에 보존하며, MORNING 평가 시 현재 기준 직전 날짜까지의 모든 날짜와 목표일이 일치할 때만 유효합니다.
- KRX HTTP 200 + 빈 `OutBlock_1`만으로는 정상 거래일을 임시 휴장으로 간주하지 않습니다. 확인된 KRX 달력의 `CLOSED` 날짜만 공백 증명에 포함하며, `OPEN/UNKNOWN` 빈 응답은 최신 공식 종가 확정 불가로 NOT_READY 유지합니다.
- 추가 회귀: 금요일 종가→월요일 정상 장전→화요일 원천 장애에서 월요일 데이터 누락 차단, 정확한 10/09 휴장·10/10~11 주말 허용, 다른 날짜로 검증 결과 재사용 금지, 검증 목록의 부분 누락 차단, 기존 단순 quality 차단, provider→MARKET_MASTER 품질 증거 전달.

- 기존 19시 KRX 실보유 종목 확정 마감·20:30 watchdog·22:10 백필, 펀드 NAV·Snapshot 안전성 계약은 그대로 유지합니다.
- 테스트: `check-index-providers`, `check-market-briefing-headless`, 기존 `check:ci` 전체. KRX 실서비스 권한 및 실 운영 GAS 배포 여부는 GitHub CI로 보증하지 않습니다.
- GAS v9.192 / 웹 기대 버전 9.192 / 웹 SW 캐시 `portfolio-cache-20261009-3`.

## GAS v9.191 / PR #471 가격 실패 시 펀드 평가 격리 (2026-10-08~09)

- KRX 가격 단계 실패 시 19시 마감을 즉시 ERROR로 기록하고, 독립 펀드 평가를 10분 반복 트리거(최대 3회 시도·45분 만료)로 분리합니다.
- 예약 시 다른 계정의 트리거 목록이 아닌 공유 Script Properties + ScriptLock으로 중복 예약을 방지합니다.
- 독립 펀드·20:30 watchdog의 펀드 평가 구간은 공통 7분 실행 lease로 중복 외부 NAV 조회를 차단합니다.
- 지연 실행은 자기 trigger UID만 정리하며 최신 다른 계정 예약을 삭제하지 않습니다.
- 가격이력·Snapshot 원본의 직접 수정은 없고, KRX 인증 실패 자체 및 누락일 복구는 별도 운영 검증이 필요합니다.
- (현재 기준) 19:00/20:30 통합 마감 내부에서는 과거 KRX 누락일 백필을 실행하지 않습니다. 최종 마감 상태를 먼저 저장하고, 22:10 `runPortfolioCloseBackfill2210` 독립 트리거가 하루 최대 한 날짜를 처리합니다. NAV·백필 lease 및 정규 PRICE 진입은 공유 ScriptLock으로 상호 배제됩니다. KRX 원천 오류 자체는 해결하지 못합니다.
- 재시도 3회 소진 예약은 해당 시도가 실행 중일 때는 교체하지 않습니다. 실행 시작 전에 기록하는 `attemptToken/activeUntil`으로 예약 결정과 NAV lease 사이의 경합을 보호합니다.
- 정상 통합 마감에서 펀드 평가가 성공하면 같은 날짜의 이전 지연 펀드 예약을 공유 저장소에서 해제합니다. 기존 예약의 반복 트리거는 자기 UID로만 정리하고 다른 사용자 계정 트리거는 조작하지 않습니다.
- `setupTrigger()`, 기존 19시 마감 트리거 또는 일일 자동 점검(`integrity-change-v6-close-watchdog-backfill`)이 22:10 백필 트리거를 설치·정리합니다. 계정별 트리거 목록은 본인 계정만 볼 수 있으므로 다른 계정의 중복 설치 여부는 실제 실행 로그로 추가 검증해야 합니다.
- GAS 버전 9.191, 웹 기대 버전 9.191, settings_fetch / 서비스워커 캐시 20261008-12.
- 10/09 추가: 20:30 watchdog이 지연 NAV나 다른 PRICE 실행에 밀려 SKIPPED되고 당일 확정 PRICE가 아직 없으면, 해당 날짜를 영속 복구 대기열에 저장합니다. 22:10 독립 worker는 **오늘 보류된 날짜를 우선** 재시도하고, 나머지 과거 누락일은 순환 커서 기준으로 후속 실행에서 처리합니다.
- 당일 독립 복구가 먼저 성공하고 지연 NAV가 나중에 성공하는 순서도 처리하며, `portfolio_close_last_result`의 PRICE/FUND 상태를 각각 합산하여 두 단계가 모두 정상일 때에만 COMPLETE로 기록합니다. 과거 날짜 백필은 기존 최신 성공 Snapshot 메타데이터를 유지하고, 당일 복구는 새 성공 상태를 유지합니다.
- deferred NAV가 활성 PRICE/FUND lease 때문에 **실행조차 못 한 경우**, 예약 시도 횟수에 반영하지 않고 같은 UID의 예약을 보존합니다. 실제 NAV 실행 실패만 횟수에 반영합니다.
- 수동 메뉴 `runDailyPriceSnapshotNow()`와 레거시 `runEvalPriceUpdate1620()` 역시 NAV·정규 마감·백필과 공유 writer lease를 사용합니다. 다른 작업이 실행 중이면 `PRICE_BUSY`로 안전 차단되며 작업 종료 후 다시 시도해야 합니다.
- 이 검증은 GitHub CI의 GAS 동작 모의 검사이며 **실제 Google 계정별 트리거·KRX API 수신·GAS 운영 배포를 확인한 것은 아닙니다.** 시뮬레이터와 실제 Google 서비스 사이의 차이는 운영 상태 진단으로 별도 확인합니다.

## GAS v9.190 / PR #470 통합 마감·브리핑 검증 (2026-10-08)

- #468·#469 기능/버전 보호하며 19시 당일 KRX 정규 마감 + 20:30 실패 자동 재시도·중복 트리거 진단을 일원화.
- 미국 종가는 한국 거래일 대신 뉴욕 최근 완료 정규장 기준일을 조회하며 실제 미국 원천일로 저장.
- Toss OAuth 403, KRX night 401, USDKRW 공급원 실패는 별도 운영 권한/원천 문제이며 실제 발행 검증 전 정상 판정하지 않음.
- 운영 GAS 배포·브리핑 발행·시트 데이터 검산은 코드 CI와 별도로 확인.

## GAS v9.189 / PR #469 브리핑 provider 보강 (2026-10-08)

- 기존 KRX VKOSPI 단일 조회와 Yahoo DXY·UST10Y·WTI·GOLD·BTC를 브리핑 collector에 연결하고 K200 야간선물 readiness 계약을 강화합니다.
- 현물 2년물 수익률로 확인되지 않은 UST2Y 및 미연결 NVDA/MU/수급/breadth는 PLANNED로 구분합니다.
- PR #468의 손익 재계산 및 GAS v9.188 기능을 보존하고 GAS/웹 기대 버전을 9.189로 올립니다.
- 실제 운영 배포 및 실데이터 점검은 CI 및 리뷰 후 확인합니다.

## GAS v9.189 / 당일 마감·watchdog 보강 (2026-10-08)

- 19시 통합 마감은 정규 거래일 당일 KRX exact-date 종가를 우선 저장합니다.
- 정규 거래일에 KRX가 전일값만 반환하면 당일 마감으로 저장하지 않고 실패 처리합니다.
- 20:30 `runPortfolioCloseWatchdog2030`가 당일 마감 미완료/오류만 한 번 재시도합니다.
- 통합 마감 START/PRICE/FUND/COMPLETE/ERROR 단계는 `동기화로그`에 `PORTFOLIO_CLOSE`로 영속 기록합니다.
- GAS `9.189`, 서비스워커 `portfolio-cache-20261008-10`, settings_fetch `20261008-3`.

## GAS v9.188 / Settings·강제복원·펀드 Snapshot 보강 (2026-10-08)

- 복구 patch와 대기 중인 전체 Settings 저장을 동시에 보존합니다. 복구 후 전체 저장은 오래된 fundDirect 필드만 제거하고 계좌·테마 등 다른 필드는 정상 저장합니다.
- 부분 Settings patch가 기존 예약 전체 Settings payload를 무효화하고 write revision으로 이미 queue에 들어간 stale payload도 차단합니다.
- 강제 포트폴리오 복원 직전에 같은 target의 신규 pending-empty/dirty를 재확인하여 load 도중 발생한 사용자 변경을 원격 preflight 값으로 덮지 않습니다.
- 과거 펀드 좌수 0→양수 정정 시 기존 MANUAL 가격이력이 있으면 신규 Snapshot도 동일 평가금액/소스를 사용합니다.
- GAS `9.188`, 서비스워커 `portfolio-cache-20261008-9`, settings `20261008-8`.


## PR #468 리뷰 후속: 과거 수량 정정 및 자동 재평가 (2026-10-07)

- 일반 종목: 거래이력 수정 시 최초 변경일을 계산해 해당일부터 마지막 확정 Snapshot까지 `rebuildDailySnapshots`를 실행하고, 원자료 revision을 갱신해 손익그래프 cache를 무효화합니다.
- 펀드: 동일 적용일 좌수 정정과 과거 변경점 삽입을 허용하되 동일 날짜 중복행은 만들지 않습니다. 영향기간은 변경일부터 다음 좌수 설정 전일까지입니다.
- 펀드 좌수 정정 시 기존 `펀드기준가격`의 NAV·공시일 원본은 유지하고 좌수/평가금액 파생열, F코드 가격이력, 기존 Snapshot 평가값을 새 좌수로 재계산합니다. MANUAL 행은 보존하며 NAV 원자료가 없는 날짜는 임의 덮어쓰지 않습니다.
- 0좌 전환은 이후 펀드를 손익 원자료 계산에서 제외하고 기존 파생 평가행은 0 평가 상태로 정리합니다.
- 19시 마감 단계 마커는 run-id로 격리해 겹친 실행의 종료가 더 최근 실행 상태를 덮어쓰지 않도록 했습니다.
- KRX 휴장일 fallback 행은 화면용 결과에만 남기고 공식 당일 KRX 가격이력에는 적재하지 않습니다.
- 웹 자산 쿼리와 서비스워커 cache 버전을 함께 갱신했습니다.
## GAS v9.188: 펀드·동기화·마감 안전성 후속 (2026-10-07)

- 독립 재검토 후속: 부분 Settings patch는 일반 전체 Settings debounce와 분리하고, 실제 전송 직전에 연결 generation·복원 잠금·load epoch를 다시 검증하여 같은 연결의 오래된 예약 저장이 강제 복원 결과를 덮지 않게 합니다.
- dirty holdings 복구는 복원 전 EDITABLE_PRICES 전역상태가 아니라 캡처 payload의 종목코드·자산유형을 우선 사용합니다.

- 펀드 좌수 원본을 수정하기 전에 `펀드좌수` system backup을 생성하고, 저장 후 재읽기 검증이 성공한 경우에만 backup을 완료·정리합니다. 원본 쓰기 실패 시 backup은 `WRITE_FAILED`로 보존합니다.
- `handleSaveFundUnits()`는 실제로 ScriptLock을 획득한 경우에만 release하여 lock 획득 실패가 후속 예외로 가려지지 않도록 합니다.
- 사용자가 누르는 상단 업데이트와 거래 탭 재동기화는 로컬 거래 유무와 무관하게 GAS 거래·보유 원장을 authoritative하게 다시 받습니다. 정상 빈 원장(0건)도 성공 복원으로 인정해 오래된 다기기 로컬 캐시가 원격 최신 원장을 덮는 경로를 차단합니다.
- 빈 원장 pending이 있는 상태에서 명시적 원격 pull을 실행하면 pending 삭제 동기화를 먼저 성공 확인합니다. 성공한 로컬 삭제 의도를 서버에 확정한 뒤에는 같은 요청에서 오래된 원격 원장을 다시 가져오지 않으며, 실패하면 복원 완료로 승격하지 않습니다.
- pending 상태에서 새 거래가 생긴 경우에도 repair token을 원격 동기화 성공 전에 지우지 않습니다. 현재 거래·보유가 모두 서버에 확정된 뒤에만 제거하며, 앱 재시작 시 로컬 거래가 있어도 해당 repair 경로를 재시도합니다.
- authoritative pull 직전에는 기존 로컬 거래의 코드교정 결과를 GAS로 다시 쓰지 않습니다. 원격 최신 원장을 받기 전에 오래된 로컬 거래가 서버를 덮는 pre-pull write 경로를 차단합니다.
- 같은 GSheet에서 자동 bootstrap과 수동 원격 pull이 겹쳐도 load epoch로 최신 요청만 상태를 계속 적용합니다. 명시적 pull은 시작 즉시 restore 잠금을 걸어 완료 전 일반 원격 쓰기를 차단합니다.
- GAS version `9.187`, 웹 기대 버전 `9.187`, 서비스워커 `portfolio-cache-20261008-9`, data `20261008-6`, settings `20261008-8`, settings_sync `20261008-2`, settings_tabsync `20261007-1`, settings_fetch `20261008-2`.
- 일반 설정·부동산 debounce 저장은 payload/target/generation 고정뿐 아니라 네트워크 전송도 직렬화해, 같은 연결에서 연속 저장 응답 순서가 뒤집혀 오래된 payload가 마지막에 덮어쓰는 race를 차단합니다.
- 19시 마감 진단은 `portfolio_close_stage=ERROR`를 INCOMPLETE보다 우선 판정해 실제 실패 실행을 명확히 노출합니다.
- 펀드 좌수 정정의 파생 NAV·가격이력·Snapshot backup은 전체 reconciliation 성공 뒤에만 정리합니다. 후속 단계 partial 실패 시 앞선 단계의 작업 시작 전 복구본도 유지합니다.
- 현재 보유에서 빠졌더라도 Settings master의 EDITABLE_PRICES/fundDirect에 남은 과거 코드 없는 TDF·펀드 이름은 거래원장으로 재구성 불가능한 자산으로 취급해 기존 과거 Snapshot을 보존합니다.

## GAS v9.183 / 웹 독립 재검토 보강 (2026-10-07)

- GSheet 연결 초기복원 또는 A→B 전환 복원이 끝나기 전에는 일반 설정·종목코드·보유현황·거래원장 원격 쓰기를 차단합니다. 복원 실패 상태에서 이전 연결 메모리가 새 연결에 덮어써지는 것을 방지합니다.
- 초기 bootstrap은 single-flight로 실행하고 성공한 경우에만 restored 상태가 됩니다. 실패한 bootstrap은 재시도 가능하며 URL 변경 시 기존 promise를 무효화합니다.
- 현재가/가격이력 요청과 편집기 이력 캐시는 GSheet URL+generation에 귀속합니다. 연결 변경 뒤 이전 연결의 늦은 응답은 전역 가격·환율·진단 상태에 적용하지 않습니다.
- 거래 삭제 pending은 원래 연결로 돌아왔을 때 복원 내부에서 캡처된 target/generation으로 안전하게 재시도합니다.
- 원자료 손익은 거래원장으로 과거 보유시점을 재구성할 수 없는 코드 없는 TDF/직접펀드를 조용히 합계에서 누락하지 않고 제외 경고와 종목명을 노출합니다. 자동 시작일에는 거래/가격이력뿐 아니라 펀드 NAV·좌수 시작일도 포함합니다.
- 펀드 좌수 정정이 직접 갱신하는 펀드기준가격·가격이력·Snapshot에도 system backup 생성·실패 보존·성공 정리 정책을 적용합니다.
- 펀드 NAV/좌수 복구의 장시간 chunk 작업과 수동가격 batch→건별 fallback은 작업 시작 시 GSheet URL+generation을 고정합니다. 연결이 바뀌면 남은 작업과 응답 적용을 즉시 중단해 다음 연결로 작업이 넘어가지 않습니다.
- GAS version `9.183`, 웹 기대 버전 `9.183`, 서비스워커 `portfolio-cache-20261007-31`.
- 주요 웹 자산: data `20261007-11`, settings_net `20261007-3`, settings `20261007-9`, settings_sync `20261007-17`, settings_fetch `20261007-10`, mgmt_editor `20261007-11`, views_history_pipeline `20261007-6`.

## GAS v9.182: 거래 partial 재계산·손익 KRX carry 정합성 (2026-10-07)

- 거래원본 저장 후 과거 Snapshot 재계산이 partial로 끝나면 최초 영향일을 Script Properties에 영속합니다. 동일 거래를 다시 동기화해 원본 차이가 없어도 그 영향일부터 재계산을 다시 수행하고, 성공한 뒤에만 pending을 제거합니다.
- 손익 원자료 계산은 과거 `KRX_CARRY` / `KRX_OTP_CARRY` 가격이력 행을 그 날짜의 공식 종가로 직접 채택하지 않습니다. 직전 실제 확정 KRX 행을 찾아 `_CARRY@원천일`로 평가해 이월 여부와 원천일을 명시합니다.
- GAS version `9.182`, 웹 기대 버전 `9.182`, 서비스워커 `portfolio-cache-20261007-29`, settings_fetch `20261007-9`.

## GAS v9.181: GSheet 연결 전환 복원 안전성 보강 (2026-10-07)

- 연결 변경 강제 복원은 현재 연결의 거래·보유 읽기가 모두 성공했는지 설정 전역상태 적용 전에 확인합니다. 하위 읽기 실패 시 이전 연결 포트폴리오와 새 연결 설정을 섞지 않고 복원을 중단합니다.
- bootstrap 응답의 `portfolioReadStatus.tradesOk/holdingsOk`를 강제 복원 판정에 사용하며, 해당 상태가 없는 구버전 GAS는 연결 변경 강제 복원에서 안전 실패 처리합니다.
- 신규·레거시 Settings에 `fundDirect`가 없어도 보유현황 시트의 코드 없는 TDF/펀드를 거래 유무와 관계없이 직접펀드로 보완 복원합니다.
- 거래이력 기반 과거 Snapshot 재생성은 현재 보유현황의 코드 없는 TDF/펀드처럼 거래원장에 역사 정보가 없는 자산을 새로 추정하지 않습니다. 대신 해당 날짜에 이미 존재하는 Snapshot 행만 보존하여 마지막 일반 거래 삭제나 과거 수량 정정이 비거래 펀드 Snapshot까지 지우지 않도록 합니다.
- 배당 저장 큐는 호출 시점 GSheet URL과 연결 generation을 함께 고정합니다. 저장 대기 중 연결이 바뀌면 stale payload를 새 연결에 쓰지 않고 실패 처리하여 cross-write를 차단합니다.
- GAS 버전 비교는 문자열 segment 기준으로 처리해 `9.181`을 `9.34`보다 최신으로 올바르게 판정합니다. 전용 배당/부동산 저장 실패 시 최신 GAS에서 구형 일반 Settings fallback이 다시 실행되는 문제를 차단합니다.
- 일반 설정·부동산 debounce 저장은 호출 시점 payload와 GSheet URL/generation을 함께 고정합니다. 연결 전환 시 이전 연결의 예약 저장은 실패 처리하며 새 연결 상태가 이전 URL로 쓰이는 것을 차단합니다.
- 마지막 거래 삭제 pending은 다른 GSheet로 전환했다고 삭제하지 않습니다. 대상이 다른 동안에는 실행하지 않고 원래 연결로 돌아왔을 때 성공할 때까지 재시도합니다.
- GAS version `9.181`, 웹 기대 버전 `9.181`, 서비스워커 `portfolio-cache-20261007-28`, settings `20261007-8`, settings_fetch `20261007-8`.

## GAS v9.180: 19시 마감 단계·KRX 원천 응답 진단 (2026-10-07)

- 자동 마감 시작/PRICE/FUND/COMPLETE/ERROR 단계와 시작·전환 시각을 Script Properties에 저장합니다. 마지막 성공 기록이 없더라도 시작 후 중단한 경우 `INCOMPLETE`로 구분합니다. Apps Script 실행 기록 조회 권한이 부족하므로 정확한 실패 원인 자체는 새 단계 진단에서 추가 확인해야 합니다.
- 인증된 `getKrxSourceDiagnostics?date=YYYY-MM-DD` 읽기 전용 API에서 KOSPI/KOSDAQ/ETF 별 응답 HTTP 상태·OutBlock_1 행 수·JSON 형식 상태만 노출합니다. API 키·원문 응답은 반환하지 않습니다. 기존 공식 종가 저장값과 별도로 국내 KRX 공식 데이터 최종 일자를 표시하여 펀드 NAV 날짜가 최신 국내 종가를 오인시키지 않게 합니다.
- 운영 10/07 복구: KB S-T NAV 9/22~10/06 8건을 정확한 클래스 `KR5223AQ0185` FunETF 원천에서 검증하여 원본 시트에 기록. 국내 종가 9/30·10/01·10/02·10/06 각 37종목은 Yahoo/기업 IR/복수 시세원으로 날짜·과거 KRX 기준가 교차검증 후 **2차 제공처 라벨을 유지**하여 저장. KRX 공식 종가로 오기하지 않으며, KRX API 복구 시 공식 데이터로 재검증·교체해야 합니다. 현재 API 인증키는 설정되어 있으나 직접 KRX 조회 0건이며 OTP도 비정상 짧은 응답이었습니다.
- 복구자료 저장·평가금액은 계산 검증했고, 19시 자동 마감 성공과 KRX API 원인(401/403/빈 OutBlock)은 이번 변경만으로 보장하지 않습니다. 배포 후 `getKrxSourceDiagnostics`, `getAutomationStatus.closeRun`을 실측하여 후속 조치합니다.
- GAS version `9.180`, 웹 기대 버전 `9.180`, 서비스워커 `portfolio-cache-20261007-24`, settings_fetch `20261007-7`.

## GAS v9.179 / 웹 settings_fetch 20261007-6: 마감 종가 실보유 종목 기준 검증 (2026-10-07)

- 일일 KRX 종가 검증의 대상은 종목코드 마스터 전체가 아닌 **요청 거래일 거래원장 기준 실제 보유수량 >0** 종목입니다. 과거 전량매도·상장폐지 종목이 코드 마스터에 남아 있어도 마감 커버리지와 수집 결과를 오염시키지 않습니다.
- **일일·기간 진단·손익 원자료·소급채우기·펀드 수동복구까지** 공통 `_applyHoldingTrade`를 종목코드 기준 집계로 통일했습니다. `_calcCodeHoldingsAtDate`는 일일/스냅샷 표시명만 현 코드 마스터 명칭으로 보정합니다. 거래원장은 수정하지 않으며, 회사명 변경 전 매수/변경 후 전량매도 및 분할의 수량·평균원가를 같은 코드로 계산합니다.
- KRX OpenAPI뿐 아니라 **OTP/CSV의 시장구분 열**에서도 보유 코드→KOSPI/KOSDAQ/ETF를 기록합니다. 가격 0건도 시장 소속을 추적하며, 시장 정보가 없고 미조회된 보유 KR 종목은 별도 누락 그룹에서 실패 처리합니다. 미보유 시장 API 장애는 무시하며, OTP는 **주말·등록 KRX 휴장일에만** 직전 실제 거래일로 날짜를 조정합니다. 정상 거래일의 데이터 수집 실패를 과거 종가로 숨기지 않습니다. 배포 후 `getAutomationStatus` 및 KB S-T 실제 NAV 저장은 별도 운영 검증이 필요합니다.
- GAS 기대 버전: `9.179`, 서비스워커 캐시 및 settings_fetch 쿼리: `20261007-6`.

## GAS v9.178 / 웹 settings_fetch 20261007-5: KRX 종가 신선도·KB NAV 누락 기간조회 보완 (2026-10-07)

- 19시 통합 마감에서 KRX/OTP 일반 종목 확정 종가가 0건이거나 검증된 최종 거래일이 오래되면, 펀드 NAV 날짜로 성공 처리하지 않고 **일반 종목 단계 ERROR**로 기록합니다. 전체 종목 70%가 아닌 **주식/ETF 그룹별 70%** 커버리지 및 KRX OpenAPI **KOSPI·KOSDAQ·ETF 각 시장 응답 일자와 건수**를 검증합니다. 펀드 단계는 독립적으로 계속합니다.
- 실제 확인된 KRX 종가 거래일을 스냅샷 기준일로 사용합니다. 2026년 공시된 KRX 휴장일 17일을 거래일 시차에서 제외하여 설 연휴 3평일 휴장도 정상 허용하고, 실제 거래일 3일 이상 누락은 오류로 차단합니다. **2027년 이후 휴장일은 아직 미등록**이므로 신규 연도 반영 전 오류 발생 시 휴장일표를 추가 검증해야 하며, 임시 휴장일은 자동 추정하지 않습니다.
- KB 밸류포커스 S-T (`KR5223AQ0185`) FunETF NAV 누락 공시일을 최대 14일 달력 범위로 묶어 조회 횟수를 줄입니다. 한화 펀드는 기존 조회 경계/공시예정일 계약을 유지합니다. HTTP 403, 제공기관 데이터 누락 시 원천을 조작하지 않으며 수동 import 경로를 보존합니다.
- **운영 확인:** 배포 후 웹 설정 화면의 `getAutomationStatus`에서 `portfolioClose.priceOk/priceDate/errors`, `portfolioCloseLastError`, `fundLastWarning/Error`을 확인합니다. 일반 종목 `가격이력` 최신 확정 종가 및 KB `펀드기준가격` 공시일이 실제 증가했는지 데이터로 확인합니다.
- 기존 2026-09-30~10-02 미확정 종가는 이 변경만으로 자동 소급되지 않으므로, 인증된 KRX 원천이 복구되면 별도 소급 작업으로 확정 실제 거래일 자료만 반영합니다. 운영 FunETF HTTP 응답은 배포 전 미검증이며 임의 NAV/종가를 만들지 않습니다.
- GAS/웹 기대 버전: `9.178`. 정적 캐시: `portfolio-cache-20261007-5`. `settings_fetch.js?v=20261007-5`로 버전 변경을 반영합니다.

## GAS v9.177 / 웹 20261007-4: 원자료 자동 손익 및 펀드 NAV 이월평가 (2026-10-07)

- 손익 전용 `getHistorySource` / `getHistorySourceDetail` read-only API를 추가했습니다. 거래·확정 가격이력·펀드 공시 NAV·좌수·환율로 손익을 재구성하며 기존 Snapshot 중복/충돌값을 참조하지 않습니다.
- NAV 미공시 평가일은 미래 데이터를 쓰지 않고 마지막 확정 공시 NAV × 해당일 좌수로 계산합니다. 실제 NAV 공시일과 평가일은 표시상 구분합니다.
- 가격/환율이 검증되지 않은 날짜는 매입원가 fallback 대신 오류 사유와 함께 제외합니다. MANUAL은 자동 가격이 없는 평가일의 예외에만 사용할 수 있습니다.
- 손익 조회용 인덱스는 Snapshot 시트 및 전체 기간 정합성 추가 계산을 생략하고, 조회 결과를 원자료 revision별 10분 cache로 보조합니다.
- GAS v9.177 / 웹 버전 20261007-4 / service worker `portfolio-cache-20261007-4`입니다.

## GAS v9.176 / 웹 20261007-3: 손익 정합성 표시·Toss 0건 진단 보강 (2026-10-07)

- 손익 그래프에서 오류/충돌 날짜가 24일을 넘으면 전체 높이 점선을 반복하지 않고 상단 짧은 tick으로 축약해 과밀 줄무늬를 방지합니다.
- Snapshot 진단 응답에 중복 그룹 분류 요약(EXACT_DUPLICATE, SINGLE_EXPECTED_MATCH, MANUAL_PROTECTED, UNRESOLVED_CONFLICT, SOURCE_INCOMPLETE)을 포함하고 웹 정합성 요약에 MANUAL 보호/미해결 충돌 그룹 수를 표시합니다.
- Toss 현재가 조회는 `NOT_RUN/SUCCESS/EMPTY/ERROR` 상태를 함께 반환합니다. 웹의 Toss 상태 chip을 눌러 Toss/KRX/최근 확정 이력 fallback 상태를 구분합니다.
- 현재가 cache key를 `prices_v9176`로 갱신해 구버전 진단 metadata 캐시를 재사용하지 않습니다.
- GAS/웹 기대 버전은 `9.176`, 정적 cache는 `portfolio-cache-20261007-3`입니다.

## GAS v9.175: 통합 리뷰 P2 자동화·Snapshot 정합성 보강 (2026-10-07)

- 일일 트리거 점검이 누락 여부뿐 아니라 기존 `runEvalPriceUpdate1620` / `runDailyFundValuations` 레거시 분리 트리거와 `runDailyPortfolioClose1900` 중복 개수까지 검사하고 정상 집합으로 자동 정리합니다.
- 자동화 상태의 Snapshot 최근일은 펀드 0좌 lifecycle을 통과한 유효 Snapshot 행만 대상으로 계산합니다.
- Snapshot stale 기준일은 달력상 직전 평일 대신 최근 통합 마감의 실제 `priceDate`를 우선 사용하고, 없으면 가격이력 최근 확정일을 사용합니다.
- 웹 자동화 상태 카드에서 통합 트리거 중복 여부와 개수를 명시합니다.
- GAS/웹 기대 버전은 `9.175`, 정적 웹 cache는 `portfolio-cache-20261007-2`입니다.

## GAS v9.174: 자동화 미실행 상태 표시 보정 (2026-10-07)

- 19시 통합 마감 실행 이력이 아직 없으면 과거 `fund_last_error`보다 `NEVER_RUN` 판정을 우선합니다.
- 트리거 누락 또는 기존 분리 트리거 잔존은 실행 이력과 무관하게 계속 `ERROR`로 판정합니다.
- 통합 실행 전 남아 있는 과거 펀드 오류는 `이전 펀드 오류(참고)`로 표시하고 경고색으로 구분합니다.
- 첫 통합 실행 이후 실제 `portfolio_close_last_error`, `fund_last_error`, 통합 실행 오류가 있으면 `ERROR`로 표시합니다.
- GAS/웹 기대 버전은 `9.174`, 정적 웹 cache는 `portfolio-cache-20261007-1`입니다.

## GAS v9.173: 웹 자동화 상태 조회 (2026-10-06)

- `getAutomationStatus` read-only API로 19시 통합 마감 트리거, 기존 분리 트리거 잔존 여부, 최근 통합 실행, 일반 종목·펀드 결과, Snapshot/가격이력 최근일, 최근 오류·경고를 조회합니다.
- 구글시트 연동 화면에 자동화 상태 카드를 추가하고 화면 진입 시 자동 조회, `새로고침` 수동 재조회만 제공합니다. 복구·트리거 변경은 웹에서 수행하지 않습니다.
- 상태는 `NORMAL / WARNING / ERROR / NEVER_RUN`으로 판정하며 기존 16:20/펀드 분리 트리거가 남아 있으면 ERROR로 표시합니다.
- GAS/웹 기대 버전은 `9.173`, 정적 웹 cache는 `portfolio-cache-20261006-12`입니다.

## GAS v9.172: 일반 종목·펀드 일일 마감 통합 (2026-10-06)

- 기존 16:20 `runEvalPriceUpdate1620` 일반 종목 마감과 19시 `runDailyFundValuations` 펀드 마감을 19시 `runDailyPortfolioClose1900` 통합 트리거 1개로 전환합니다.
- 통합 마감은 일반 종목 확정가·가격이력·Snapshot 저장을 먼저 수행한 뒤 펀드 NAV·평가를 이어서 실행합니다.
- 일반 종목 단계가 실패해도 펀드 단계는 계속 시도하고, 반대로 펀드 단계가 실패해도 일반 종목 결과는 보존합니다. 부분 실패는 `portfolio_close_last_error`, 전체 실행 요약은 `portfolio_close_last_result`에 기록합니다.
- 자동 트리거 복구 시 v9.171 이전의 `runEvalPriceUpdate1620` / `runDailyFundValuations` 분리 트리거를 제거하고 통합 트리거만 유지합니다. 수동 실행 함수 자체는 호환성을 위해 남깁니다.
- GAS/웹 기대 버전은 `9.172`입니다.

## GAS v9.171: 펀드 자동화·손익 Snapshot 정합성 보강 (2026-10-06)

- F00002 `KB_VALUE_ST`는 정확한 표준코드 `KR5223AQ0185`를 사용해 FunETF 공개 NAV를 자동 조회합니다. HTTP/응답 오류 시 기존 확정 NAV와 수동 import 경로를 보존합니다.
- F00003은 0좌 전환일 이후 정상/기간 Snapshot 계산에서 제외하며 자동 외부 NAV 조회 대상이 아닙니다.
- 매일 19시 `runDailyFundValuations` 트리거를 공통 자동화 점검/복구에 포함합니다. partial은 경고로 기록하고 hard error만 자동화 실패로 처리합니다.
- Snapshot 안전정리는 날짜 유실 payload, 0좌 펀드 잔존, 안전 판정 가능한 중복을 백업·read-back 검증 후 제거하고 애매한 충돌은 보호합니다.
- GAS/웹 기대 버전은 `9.171`, 정적 웹 cache는 `portfolio-cache-20261006-11`입니다.

## GAS v9.170: trusted v2 이후 legacy backup 최종 정리 (2026-10-06)

- 성공한 system backup은 rollback 확인이 끝나면 삭제하는 기존 **steady state 0개** 정책을 유지합니다. 운영 통합문서에 정상 백업 탭을 상시 여러 개 보존하지 않습니다.
- 실제 backup content signature가 일치하는 최신 `backup-content-v2` COMPLETED 백업이 생성되면, 그보다 오래된 동일 source의 system-generated legacy COMPLETED 백업은 **재서명하지 않고** source schema 일치·수식 참조 0건을 확인한 뒤 stale rollback으로 정리합니다.
- 최신 v2 자체가 유효하지 않거나 source/schema가 다르거나 수식 참조가 있으면 기존처럼 삭제하지 않습니다. `CREATED`, `WRITE_FAILED`, USER_MANAGED/UNKNOWN 보호 정책도 유지합니다.
- 수동 `백업 진단`/유지보수 계획에서도 같은 source의 더 최신 trusted v2가 확인된 경우에만 과거 legacy signature mismatch를 정리 후보로 분류합니다.
- 현재 운영 파일은 과거 백업을 별도 전체 사본으로 보존한 뒤 불필요한 백업 탭을 수동 정리했으며, 이 변경은 향후 legacy 누적 재발을 막기 위한 lifecycle 마무리입니다.
- GAS/웹 기대 버전은 `9.170`, 정적 웹 cache는 `portfolio-cache-20261006-10`으로 함께 배포합니다.

## GAS v9.169: backup signature v2 + Toss token concurrency recovery (2026-10-06)

- 운영 진단에서 Snapshot backup이 새로 생성될 때마다 `content signature 불일치`가 1개씩 늘어난 현상을 수정합니다. 기존에는 copy 직전 source sheet signature를 registry `signature`에 저장했지만, `copyTo()` 뒤 수식 재계산 등으로 backup의 `getValues()`가 달라질 수 있었습니다.
- v2부터 `sourceSignature`은 같은 원본 상태 재사용 판정에만 쓰고, registry `signature`은 실제 생성 완료된 backup sheet를 다시 읽어 계산한 값으로 저장합니다. `signatureVersion=backup-content-v2`, `copySignatureDrift`도 진단 metadata로 남깁니다.
- 기존 signatureVersion 없는 과거 mismatch backup은 자동 재서명하지 않고 `legacy signature 불일치 · 자동 재서명 금지`로 계속 보호합니다. 과거 45개를 이번 배포만으로 자동 삭제하지 않습니다.
- Toss OAuth token cache miss는 ScriptLock single-flight로 직렬화하고, lock 획득 후 cache를 재확인하여 동시 client_credentials 발급으로 기존 token이 무효화되는 경쟁을 줄입니다.
- Toss Client ID/Secret 저장·삭제와 진단 OAuth도 같은 token lock 안에서 처리하며, lock 대기 뒤 자격증명을 다시 읽어 이전 설정으로 token을 발급하는 race를 막습니다.
- Toss resource GET이 401을 반환하면 현재 cached token이 실제 rejected token과 같을 때만 cache를 제거하고 새 token을 발급해 해당 resource 요청을 딱 1회 재시도합니다. 두 번째 401은 기존 오류 경로로 종료합니다.
- 이 401 recovery는 이미 발급된 token이 동시성으로 무효화된 경우를 자동복구하기 위한 것입니다. 현재 모바일 진단에서 OAuth endpoint 자체가 `401 / unidentified-client`를 반환하는 문제를 해결하거나 우회하지 않습니다.
- 기존 429/5xx retry, Retry-After/X-RateLimit-Reset, secret/token 비노출, Snapshot 보호 정책은 유지합니다.
- GAS/웹 기대 버전은 `9.169`, 정적 웹 cache는 `portfolio-cache-20261006-9`로 함께 배포합니다.

## GAS v9.168: 백업 보호 사유 세분화 (2026-10-06)

- 실제 운영 백업 진단에서 Snapshot 53개 중 44개가 포괄적인 `안전 조건 불충족`으로만 표시된 문제를 개선합니다.
- 자동 정리 가능 여부 계산은 변경하지 않고, 보호 사유 표시만 `content signature 불일치`, `미완료 registry 상태 · CREATED/기타`, `WRITE_FAILED · 복구 검증 없음`, `동일 operation에 미완료 CREATED 백업 존재`, `수식 참조 존재`, `USER_MANAGED/UNKNOWN 보호`, `원본 source sheet 없음` 등으로 세분화합니다.
- 백업 진단 팝업의 사유별 집계와 대표 시트명 최대 3개 표시 방식은 그대로 유지합니다.
- 삭제·signature 검증·formula reference·registry 보호 정책은 변경하지 않습니다.
- GAS/웹 기대 버전은 `9.168`, 정적 웹 cache는 `portfolio-cache-20261006-8`로 함께 배포합니다.

## GAS v9.167: Toss egress IPv4/IPv6 식별 + 백업 보존 사유 상세 (2026-10-06)

- 운영 진단에서 외부 IP 확인 provider들이 HTTP 200 / text/plain / length 38 응답을 반환했지만 IPv4 전용 검증 때문에 `INVALID_IP_RESPONSE`로 분류된 사례를 반영합니다.
- egress probe가 IPv4와 IPv6를 모두 문법 검증하고 정상 IP이면 `ipFamily=IPv4|IPv6`와 실제 관측 주소를 함께 반환합니다. IPv4-mapped IPv6도 IPv6로 식별합니다.
- IPv4/IPv6 어느 쪽도 아닌 응답은 기존처럼 원문을 노출하지 않고 provider별 status, code, body length, Content-Type, elapsedMs만 남깁니다.
- 웹 설정 화면과 스프레드시트 Toss read-only 진단 메뉴에 address family를 함께 표시합니다.
- 관측 IP가 실제 Toss OAuth 요청의 egress IP와 동일하다고 보장되지 않는 기존 주의문은 유지하며, Toss 콘솔이 해당 address family를 허용 IP로 지원하는지 별도 확인하도록 안내합니다.
- 백업 read-only 진단 팝업에는 source별 보존 사유를 집계하고 사유별 대표 백업 시트명을 최대 3개까지 표시합니다. 삭제·분류·보호 기준은 변경하지 않습니다.
- GAS/웹 기대 버전은 `9.167`, 정적 웹 cache는 `portfolio-cache-20261006-7`, Toss 설정 UI는 `settings_sync.js?v=20261006-5`로 함께 배포합니다.

## GAS v9.166: 백업 진단 성능 + Toss egress fallback 통합 보강 (2026-10-06)

- v9.165의 백업 진단 최적화를 유지하면서 Toss egress 관측을 단일 provider 의존에서 분리합니다.
- Toss 진단은 `checkip.amazonaws.com`을 1차, `api.ipify.org`를 2차 fallback으로 사용합니다. 첫 provider가 HTTP 200이어도 유효 IPv4가 아니면 두 번째 provider를 시도합니다.
- egress 관측이 모두 실패하면 원문 응답은 노출하지 않고 provider별 HTTP status, 판정 code, body length, Content-Type, elapsedMs만 반환해 `200 / INVALID_IP_RESPONSE` 원인을 추적합니다.
- 외부 관측 IP가 실제 Toss OAuth 요청의 egress IP와 동일하다고 보장되지 않는 기존 주의문은 유지합니다.
- GAS/웹 기대 버전은 `9.166`, 정적 웹 cache는 `portfolio-cache-20261006-6`, Toss 설정 UI는 `settings_sync.js?v=20261006-4`로 함께 배포합니다.

## GAS v9.165: 백업 진단 중복 읽기 축소 (2026-10-06)

- 백업 유지보수 계획은 같은 실행에서 계산한 등록 백업의 서명 검증 결과와 source별 헤더를 재사용합니다. 수식 비교 대상은 백업 이름으로 제한하고 백업이 없으면 전체 수식 읽기를 생략합니다. 수식 참조를 검사하는 시트 범위와 기존 보호 조건은 유지합니다.
- 일반 `diagnoseWorkbookCells` API는 모든 시트의 수식 참조 진단을 유지합니다. 삭제 실행은 기존대로 lock 획득 후 계획을 새로 계산하며 dry-run 결과를 다음 실행의 삭제 근거로 재사용하지 않습니다.
- 운영 반영에는 GAS v9.165 재배포와 웹 기대 버전 갱신(cache `portfolio-cache-20261006-5`)이 필요합니다. 배포 후 삭제 없는 백업 진단의 실행 시간과 후보·보존 결과를 확인합니다. 대형 통합문서에서 6분 이내 완료 여부는 실제 운영 실행으로 확인해야 합니다.

## GAS v9.164: Toss egress IPv4 응답 파싱 보강 (2026-10-06)

- 운영 진단에서 `api.ipify.org`가 HTTP 200을 반환했지만 `INVALID_IP_RESPONSE`가 발생한 사례를 반영합니다.
- egress probe는 ipify의 IPv4 전용 plain-text endpoint `https://api.ipify.org`를 사용하고, 응답이 plain-text IPv4이면 그대로 처리합니다. 예외적으로 JSON 형태가 와도 `ip` 필드를 fallback으로 허용합니다.
- probe는 계속 Toss 연결 진단에서만 실행되며 실제 Toss 요청의 출구 IP와 동일하다고 보장하지 않습니다.
- GAS/웹 기대 버전은 `9.164`, 정적 웹 cache는 `portfolio-cache-20261006-4`로 함께 배포합니다.

## GAS v9.163: Toss GAS egress IPv4 관측 진단 (2026-10-06)

- 모바일 데이터에서 Toss OAuth가 `403 / access_denied`로 반복 실패하는 원인을 좁히기 위해, `diagnoseTossMarketData` 실행 직전에 `https://api.ipify.org?format=json`을 read-only 호출하여 외부 서비스가 관측한 GAS `UrlFetchApp` 출구 IPv4를 함께 표시합니다.
- 이 IP는 원인 추적용 참고값입니다. Google Apps Script가 Toss OAuth 요청에도 반드시 같은 NAT/egress IP를 사용한다고 보장하지 않으므로, UI에도 동일한 경고를 표시합니다.
- OAuth가 `403 / access_denied`인 경우에도 진단에서 관측한 IP를 곧바로 Toss 허용 IP에 등록하지 않습니다. 관측 IP는 참고값이며, 실제 Toss 요청의 송신 IP와 허용 정책은 공급자 로그 및 Google Apps Script `UrlFetchApp` 출구 특성을 별도로 대조해야 합니다.
- egress probe는 Toss 연결 진단에서만 실행되며 가격 조회·Snapshot·트리거·운영 시트에는 사용하지 않습니다. 외부 서비스로 Client ID/Secret, access token, 종목, 포트폴리오 데이터는 전송하지 않습니다.
- GAS/웹 기대 버전은 `9.163`, 정적 웹 cache는 `portfolio-cache-20261006-3`으로 함께 배포합니다.

## GAS v9.162: Toss OAuth 진단 식별자 보강 (2026-10-06)

- 모바일 데이터에서 Toss OAuth가 `401 / unidentified-client`로 반복 실패하고 같은 단말 Wi-Fi에서는 200으로 성공하는 실운영 사례를 추적하기 위해, `diagnoseTossMarketData`가 OAuth·market endpoint·005930 smoke 응답의 비민감 요청 식별자만 추가 반환합니다.
- 반환 대상은 `requestId`, `referenceId`, `x-amz-cf-id`에 해당하는 식별자이며 Client ID/Secret, access token, Authorization header, 원문 응답은 계속 반환·로그하지 않습니다.
- OAuth 401 `unidentified-client`는 market endpoint의 403 IP allowlist 오류와 별도로 안내하며, 식별자를 보존해 Toss 측 문의 시 호출을 특정할 수 있게 합니다.
- 외부 IP echo 서비스로 표시한 IP가 실제 Toss 요청에 사용된 UrlFetchApp egress IP와 동일하다고 보장할 수 없으므로, 오진 방지를 위해 임의의 outbound IP 표시 기능은 추가하지 않습니다.
- GAS/웹 기대 버전은 `9.162`, 정적 웹 cache는 `portfolio-cache-20261006-2`로 함께 배포합니다. 운영 데이터·Snapshot·트리거를 변경하지 않는 진단 보강입니다.

## GAS v9.161: 포트폴리오 메뉴 진단·실행 구분 (2026-10-06)

- GAS와 웹의 예상 버전은 함께 9.161로 반영합니다. 이 변경 자체는 배포 후 시트 초기화·트리거 재등록·소급채우기·전체 복구를 실행할 필요가 없습니다. 스프레드시트를 다시 열거나 새로고침하면 메뉴가 갱신됩니다.
- `진단·조회`의 자동화 점검과 복구 진행상황은 누락 트리거를 자동 등록하지 않습니다. 실행하려면 `복구·정리 실행`의 누락 트리거 복구 또는 스냅샷 후속 트리거 재예약을 선택합니다. 웹 조회의 일일 자동 트리거 복구와 기존 복구 API는 유지합니다.
- `오늘 종가 갱신` 메뉴는 자동 실행과 동일한 확정 평가단가·스냅샷 수동 갱신으로 통합합니다. 기존 `updatePrices` 함수는 유지하지만 직접 실행 시 종가 시트 전체를 재작성하는 이전 동작이므로 정례 실행하지 않습니다. 고정 가격소스·수동가격 이력 정책은 변경 옵션 대신 안내로 표시합니다.
- KRX 기간 조회는 종가데이터 시트 교체와 선택적 가격이력 반영을 구분하며 취소/창 닫기는 저장하지 않습니다. 스냅샷은 별도 복구 대상입니다. 소급채우기는 대상 기간·덮어쓰기 여부·진행 위치 대체를 확인한 뒤 시작합니다.
- 전체 스냅샷 복구, 코드·이름·중복 정리, 백업 정리는 진단 결과를 확인한 후 필요한 경우만 실행합니다. 기존 복구·백업 보호 기준은 유지합니다. 가격 이상치 진단은 외부 조회의 임시 계산을 사용할 수 있으나 가격이력·스냅샷을 저장하지 않습니다. 외부 연결 진단은 인증 캐시/진단 상태를 사용할 수 있습니다.
- `위험 작업`의 전체 초기화는 별도 백업 확인과 정확한 `가격이력·스냅샷 삭제` 문구 입력이 모두 필요합니다. Toss 인증 삭제와 트리거 전체 재등록도 이 구역에 둡니다. 운영 데이터 삭제·복구는 이번 검증에서 실행하지 않습니다.

## GAS v9.138 / 웹 20260929-12: 브리핑 국내 핵심주 공식 종가 보강

- GAS v9.138은 브리핑의 삼성전자(005930)·SK하이닉스(000660)를 기존 KRX 종가 helper로 read-only 조회하며, 요청일과 `usedDate`가 같은 양수 공식 종가만 `FINAL/REGULAR_CLOSE`로 사용합니다. 가격이력이나 Portfolio Snapshot에는 쓰지 않습니다.
- GAS v9.137은 KRX `drv/fut_bydd_trd`에서 exact BAS_DD·`MKT_NM=야간`·`PROD_NM=코스피200 선물`·실제 `ISU_NM=코스피200 F YYYYMM (야간)` 형식·단일 최근 미만기 월물·양수 `TDD_CLSPRC`를 모두 확인한 값만 `K200_NIGHT/NIGHT_FINAL`로 제공합니다. 06:00 이전, 이전 날짜, 정규시장, 0 종가, 다른 상품, 같은 최근월물 중복 후보는 확정값을 만들지 않습니다.
- GitHub 저장소 Variables에 `GAS_WEB_APP_URL`, Secrets에 `GAS_ACCESS_TOKEN`을 한 번 설정합니다. `.github/workflows/market-briefing-headless.yml`이 KST 06:15/07:30/16:05/20:15의 target checkpoint를 명시해 hydrate → collect → master 저장을 수행하고, `MORNING`·`KRX_FINAL`·`EVENING`은 readiness 통과 후에만 immutable snapshot을 저장합니다. `NIGHT_FINAL`은 해당 `tradingDate`에 `K200_NIGHT` / `NIGHT` / `FINAL` / `NIGHT_FINAL` 조건을 모두 만족하는 observation이 존재해야 성공하며 snapshot은 저장하지 않습니다.
- headless 실행에서만 당일 USDKRW가 provider 관측시각 없이 정각 후 300초 안에 수신되면 실제 `receivedAt`을 유지한 채 `SCHEDULED_DELAY_TOLERANCE_300S`로 선택하고 warning을 남깁니다. provider `observedAt`이 있으면 이를 우선하며, 다른 series·브라우저 실행·300초 초과에는 tolerance를 적용하지 않습니다.
- `NIGHT_FINAL` 확정값이 없거나 `MORNING`·`KRX_FINAL`·`EVENING`의 `decision.publishable=false`이면 snapshot을 저장하지 않고 CLI가 exit code 1로 종료되어 GitHub Actions가 실패로 표시됩니다. 실행 로그의 `missing`, `issues`, `providerErrors`로 원인을 확인합니다.
- 스케줄 실행은 GitHub Actions 및 배포된 GAS/KRX·Toss·Yahoo·환율 provider 가용성에 의존합니다. 현재 authoritative 휴장 calendar가 없으므로 휴장·미공시일도 `NOT_READY`로 실패 표시될 수 있으며, workflow red 자체만으로 provider 장애라고 단정하지 않습니다. workflow가 지연되더라도 target checkpoint를 현재 시각 기준으로 임의 변경하지 않습니다.

## GAS v9.131 / 웹 20260928-5: 기간 정합성 진단 index 최적화

- Apps Script v9.131과 정적 웹 20260928-5를 함께 재배포합니다. 실제 Snapshot 날짜만 전달하며 Snapshot/거래/가격/NAV/FX 원장을 요청당 한 번 읽고 index lookup을 사용합니다.
- 응답의 `performance`에서 `priceSeriesBuildCount=1`, `priceIntegrityBuildCount=1`, `holdingsBuildCount=1`과 read/index/calculation 시간을 확인합니다. 실패 시 `errorCode`, `phase`, `failedDate`, 처리 진행률을 확인합니다.
- 배포 후 1개월/3개월/1년 조회와 2026-06-18, 2026-07-22, 2026-09-24, 2026-09-25 상세 진단을 확인합니다.

## GAS v9.130 / 웹 20260928-4: 가격이력·Snapshot·성과 정합성 후속 복구

- Apps Script v9.130과 정적 웹 20260928-4를 함께 재배포합니다. 웹은 service worker 등록 URL과 cache name을 함께 올려 구버전 history 자산 혼용을 차단합니다.
- 운영 데이터는 `diagnosePriceHistoryIntegrity`로 가격/인접가격/source/당시 FX를 먼저 확인하고, 확정 reference가 있는 항목만 `previewPriceHistoryRepair` 후 POST `applyPriceHistoryRepair`로 교정합니다. MANUAL과 미검증 reference는 적용되지 않습니다.
- 이후 `diagnoseSnapshotIntegrity` → `rewriteSnapshotDate` → VALID 재진단 → `getHistory` 순서로 진행합니다. 대표 확인일은 2026-06-18, 2026-07-22, 2026-09-24, 2026-09-25입니다.
- 백업은 복구 전 `maintainSystemBackups({apply:false})`, 복구 검증 후 `{apply:true}` 순서로 실행하며 source별 최신 유효 COMPLETED 백업을 최소 1개 보존합니다.

## GAS v9.129 / 웹 20260928-3: Snapshot 안전 복구·백업 유지보수

- 손익 화면은 선택 기간을 `diagnoseSnapshotIntegrityRange` 한 요청으로 진단하고 `PARTIAL`/`MISMATCH`/`CONFLICT` 지점을 정상 손익선에서 끊습니다. 검증 가능한 오류만 `rewriteSnapshotDate`로 재진단→재작성→VALID 재확인하며 완료 후 이력을 다시 조회합니다.
- `maintainSystemBackups({apply:false})`는 삭제 없는 전체 분류를, 명시적 POST `apply:true`는 최신 유효본·active operation·수식 참조·사용자/UNKNOWN 백업을 보호한 안전 후보 삭제를 제공합니다. 시트 메뉴의 `백업 진단`과 `안전한 시스템 백업 정리`에서 전후 셀 수를 확인합니다.
- Apps Script v9.129와 정적 웹 20260928-3을 함께 재배포해야 합니다. 실제 배포 후 `2026-07-21`~`2026-07-23` range 진단에서 저장/예상 종목, code·수량·원가·평가단가·평가금액 차이, 가격/NAV/환율 source 상태를 확인하고 백업 정리는 먼저 dry-run 결과를 검토하세요.

## GAS v9.128 / 웹 20260928-2: Snapshot 정합성·백업 수명주기

- `diagnoseSnapshotIntegrity` GET으로 저장 Snapshot을 거래·가격·NAV·과거 환율 원자료 재계산값과 쓰기 없이 비교하고, `rewriteSnapshotDate` POST는 진단으로 안전성을 확인한 특정일만 재작성한 뒤 재진단합니다.
- 재사용한 `CREATED`/`WRITE_FAILED` 백업도 성공 시 `COMPLETED`로 승격하고, 스키마·signature·formula·naming을 모두 검증한 orphan만 채택해 source별 최신 1개 정책을 적용합니다. 사용자/UNKNOWN 백업은 자동 삭제하지 않습니다.
- Apps Script v9.128과 정적 웹 20260928-2를 함께 재배포해야 합니다. 배포 후 `2026-07-21,2026-07-22,2026-07-23` 진단과 `diagnoseWorkbookCells`의 백업 분류·정리 전후 셀 수를 확인하세요.

## GAS v9.127 / 웹 20260928-1: 펀드 timeout 재검증과 비공시일 상태 정합성

- `refreshFundValuations`의 클라이언트 timeout/network 오류는 날짜별 실패 확정으로 간주하지 않습니다. 웹은 쓰기와 외부 NAV 조회가 없는 `getFundValuationStatus`로 펀드기준가격·가격이력·Snapshot 현재 상태를 재검증한 뒤 실제 NAV/파생행 미완료 날짜만 재처리 대상으로 남깁니다.
- F00001의 월·목·토·일 `NON_PUBLICATION_CARRY` 계약을 유지하며, 외부 API 오류 구간이 넓더라도 공시 예상일이 아니거나 이미 확정 NAV가 있는 날짜는 `API_FAILED`로 덮어쓰지 않습니다.
- Apps Script v9.127과 정적 웹 20260928-1을 함께 재배포해야 합니다. 배포 후 F00001 7일 복구를 실행해 timeout 발생 시 `결과 확인 필요`가 표시되고, 재검증 완료 후 상단 재처리 건수와 버튼 수가 일치하는지 확인하세요.
- 별도 휴일 calendar/provider 원자료는 아직 없으므로 공휴일을 임의 추정하지 않습니다. 공휴일 판정 확장은 후속 작업입니다.

## GAS v9.125 / 웹 20260923-3: 원본별 백업·종목코드·확정 NAV 정합성

- 시스템 백업 보존 정책을 `스냅샷`·`거래이력`·`가격이력`·`펀드기준가격`·`펀드좌수`·`종목코드` 원본별로 관리합니다. 자동 정리는 `COMPLETED` 백업 중 보존 수량을 넘은 항목만 대상으로 하며 `CREATED`·`WRITE_FAILED`·미등록 레거시 백업은 보호하고 미해결 사유를 반환합니다.
- 종목코드 열을 쓰기 전에 텍스트 형식(`@`)으로 고정하고 코드 값을 문자열로 정규화합니다. 종목 마스터에 정확한 정규 코드가 있을 때만 기존 숫자형 손상값을 복구하며 `0046Y0`, `F00001`, 해외 ticker는 길이를 변경하지 않습니다.
- `getHistory`는 `FUND_NAV_CARRY_INPUT_REQUIRED` 행을 펀드기준가격의 같은 날짜·코드·평가금액과 대조합니다. 확정 NAV 평가금액과 일치하는 경우에만 오래된 임시 source 경고를 제거하고, F00002처럼 확정 NAV가 없거나 금액이 다른 경우에는 경고를 유지합니다.
- Apps Script v9.125와 정적 웹을 함께 재배포해야 합니다. 배포 후 `handleSyncCodes`의 `codeRepair`, `diagnoseWorkbookCells`의 원본별 백업 현황, F00001 2026-09-16/18과 F00002 2026-09-22의 실제 파생행을 확인하세요.

## GAS v9.124 / 웹 20260923-2: 거래 영향 Snapshot 재계산과 확정 종가 정책

- 다일자 펀드 복구와 전체 일별 재생성은 논리 작업 ID 하나로 Snapshot 전체 백업을 한 번만 생성합니다. 동일 작업의 후속 날짜는 그 복구본을 재사용하고 정상 완료 뒤에만 등록된 과거 시스템 백업을 정리합니다.
- 거래이력 동기화는 신규·수정·삭제 행의 최초 영향일을 계산하고 마지막 확정 Snapshot 날짜까지 기존 원자료 계산 경로로 다시 비교·갱신합니다. 당일 미확정 Snapshot은 만들지 않습니다.
- Snapshot 중복 정리는 날짜+종목코드를 고유키로 사용합니다. 완전히 동일한 행만 자동 축약하며 값 충돌은 원천 재계산값과 대조합니다. MANUAL 또는 판정 불가능 충돌은 삭제하지 않고 결과에 남깁니다.
- 정상 비공시일은 당일 여부보다 펀드별 공시 주기를 먼저 적용해 `NON_PUBLICATION_CARRY`로 분류하고, 날짜별 재처리 목록은 실제로 평가·Snapshot이 검증된 날짜만 제거합니다.
- Toss `/prices`는 `REALTIME/INDICATIVE`, 검증 전 Toss 일봉은 `DAILY_CANDLE/UNVERIFIED_CLOSE`로 분류합니다. 국내 확정 Snapshot은 KRX `TDD_CLSPRC`를 우선하며, 가격이력 이월 시 실제 원 공급자와 가격 기준일을 보존해 `KRX_CARRY@2026-09-20` 형식으로 표시합니다.
- Apps Script v9.124와 정적 웹을 함께 재배포해야 합니다.

## GAS v9.123 / 웹 20260923: 백업 자동 보존 및 날짜별 펀드 결과

- Snapshot 백업은 Script Properties 레지스트리에 원본 시트·서명·생성 상태를 기록합니다. 정상 쓰기가 검증된 뒤 원본별 최신 완료 백업 1개를 남기고, 레지스트리로 시스템 생성이 확인된 과거 백업만 자동 삭제합니다. 이름만 유사한 기존·사용자 시트와 운영 원본은 삭제하지 않습니다.
- 자동 정리는 Snapshot 쓰기 잠금 안에서 실행되며 삭제·보존 수, 확보 셀 수와 실패 사유를 마지막 백업 상태에 기록합니다. 실패한 쓰기에서는 정리를 실행하지 않아 직전 유효 복구본을 보존합니다.
- 펀드 복구 응답에 날짜별 NAV 상태, 좌수 적용, 평가금액 및 Snapshot 저장·유지·실패 상태를 반환합니다. 웹은 7일 단위로 요청해 120초 단일 요청 위험을 줄이고 처리율과 성공 결과를 분리해 표시합니다. 클라이언트 오류 뒤에는 GAS가 계속 실행됐을 가능성을 안내하며 재실행 시 기존 확정값을 먼저 검증합니다.
- 손익그래프의 오렌지 NAV 미확정 마커와 최신 손익 마커를 선택하면 날짜·값·상태 및 종목별 상세를 표시합니다.
- Apps Script v9.123과 정적 웹을 함께 재배포한 뒤, 펀드별 날짜 결과·백업 정리 결과·차트 마커 선택 동작을 운영 데이터에서 확인해야 합니다.

## GAS v9.122: 백업 중복 생성 방지 및 통합문서 셀 진단

- Snapshot 쓰기 실패 후 같은 원본 상태로 재시도하거나 동일한 전체 재생성 작업이 다음 배치로 이어질 때 기존 백업을 재사용합니다. 새 백업은 원본 내용이 달라지고 별도 작업일 때만 만들며, 생성 직후 데이터가 없는 초과 행·열을 줄입니다.
- 백업 생성 전 새 시트 기본 격자를 포함한 잔여 셀을 확인하고 부족하면 원본 쓰기 전에 중단합니다. `diagnoseWorkbookCells`(인증 GET/POST)는 모든 시트의 최대/사용 행·열, 할당/사용/미사용 셀, 역할, GAS 참조, 수식 참조, 통합문서 점유율과 백업 정리 예상 셀을 반환합니다.
- `prepareBackupCleanup`(인증 POST)은 지정한 백업 시트를 지정한 하나 이상의 보관용 통합문서로 복사하고 값·수식·행·열을 검증합니다. 보관 문서의 셀 한도를 먼저 확인해 가능한 문서로 분산하며, 검증 완료·수식 미참조 항목만 삭제 후보로 표시합니다. 이 API는 운영 시트를 **삭제하지 않으며**, 롤백 필요성 확인과 사용자 승인을 받은 뒤 Google Sheets에서 삭제해야 합니다.
- 운영 반영에는 Apps Script v9.122 재배포가 필요합니다. 배포 후 `diagnoseWorkbookCells`로 실제 점유량을 기록하고, `prepareBackupCleanup`의 `copyVerified=true`, `deletionCandidate=true`를 확인한 뒤 삭제 승인을 받으세요. 삭제 전후 진단의 `totalCells` 차이가 실제 확보량입니다.

## 웹 20260922-3: 손익그래프 정상 조회 결과 유지

- 현재가 polling과 공통 `refreshAll()`이 손익 탭을 다시 렌더링해 정상 그래프·NAV 미확정·Snapshot 누락 경고를 초기 안내로 덮어쓰던 경로를 차단했습니다.
- 스냅샷과 비교지수 조회가 모두 성공한 최신 요청만 화면에 반영하며, 재조회 실패 또는 오래된 응답은 마지막 정상 그래프와 경고를 유지합니다.
- 손익 탭을 벗어났다가 돌아와도 마지막 정상 조회 화면을 복원합니다. 운영 반영에는 정적 웹/Service Worker `20260922-3` 재배포가 필요하며 GAS 재배포는 필요하지 않습니다.

## GAS v9.121: 펀드 NAV 저장 결과·시트 확장 보강

- NAV·가격이력·Snapshot 행 확장 전 셀 여유가 부족하면 세 대상 시트의 데이터가 없는 초과 열만 회수한 뒤 필요 셀을 다시 계산합니다. 값이 있는 열·행과 기존 백업 시트는 삭제하지 않습니다.
- 단계별 실제 저장 행 수를 응답에 반환해 정상 저장·일부 저장·저장 실패를 구분합니다. NAV가 먼저 저장된 뒤 가격이력 또는 Snapshot에서 실패하면 더 이상 전체 미변경으로 표시하지 않습니다.
- 웹 결과에 펀드명, 기준일 범위, 신규·수정·기존 동일·입력 중복 건수와 NAV·가격이력·Snapshot 실제 저장 건수를 표시합니다.
- 운영 반영에는 Apps Script v9.121과 정적 웹/Service Worker `20260922-2` 재배포가 필요합니다.

## GAS v9.120: 펀드 NAV import 셀 한도 오류 방지

- NAV import가 실행될 때마다 `펀드기준가격`·`가격이력` 전체를 새 백업 시트로 복제하던 경로를 제거했습니다. 이 경로는 반복 실행마다 통합문서의 할당 셀을 늘려 Google Sheets 2,000만 셀 한도를 초과시키는 직접 원인이었습니다.
- `펀드기준가격`과 `가격이력`은 변경 행과 신규 행만 쓰고, Snapshot도 해당 펀드·해당 날짜 행만 갱신하거나 신규 날짜 행을 추가합니다. 기존 확정 NAV·MANUAL·다른 자산·다른 날짜는 다시 쓰지 않습니다.
- import 응답의 `evaluation.capacity`에 실행 전후 전체 할당 셀, 잔여 셀, 백업 시트 수와 대상 시트의 사용/최대 행·열을 반환합니다. 필요한 행 확장으로 한도를 넘는 경우 쓰기 전에 중단합니다.
- 운영 반영에는 Apps Script v9.120과 정적 웹 재배포가 필요합니다. 기존 백업 시트는 자동 삭제하지 않으며, 배포 후 실제 F00001~F00003 NAV 반영과 하단 복구·손익그래프를 확인합니다.

## GAS v9.119: 펀드 NAV import 저장 오류 및 재실행 진단 보강

- `펀드기준가격`과 `가격이력` import 백업은 `Sheet.copyTo()` 대신 새 백업 시트에 값을 복사합니다. 운영 환경에서 `copyTo()`가 `지원되지 않는 작업입니다.`로 실패해 NAV 반영이 중단되는 경로를 제거하면서 쓰기 전 백업은 유지합니다.
- NAV 저장 뒤 가격이력 또는 스냅샷 쓰기가 실패해도 저장된 확정 NAV는 보존하며, 같은 NAV를 다시 반영하면 누락된 파생 단계만 복구합니다.
- import 응답과 `[FUND_NAV_DIAGNOSTIC]` 로그에 NAV/가격이력 백업·쓰기 및 스냅샷 쓰기 실패 단계를 `stageElapsedMs`와 함께 남깁니다.
- 운영 반영에는 Apps Script v9.119 재배포가 필요합니다. 재배포 후 실제 F00002 수기 NAV 반영과 Apps Script 실행 로그를 확인합니다.

## GAS v9.106: 펀드 비공시·NAV 누락일 임시 평가

- F00001의 월·목요일을 예상 비공시일로 분류해 실패·NAV 미복구 집계에서 제외합니다.
- 실제 NAV가 없는 날은 직전 확정 NAV와 해당일 좌수로 임시 스냅샷을 생성합니다.
- F00002/F00003은 외부 API를 호출하지 않고, 엑셀·수기 확정 NAV 누락일을 `NAV 입력 필요`로 표시합니다.
- 좌수 설정에서 F00001/F00002/F00003을 각각 업데이트할 수 있습니다.
- 운영 반영에는 Apps Script v9.106과 정적 웹 재배포가 필요합니다.

## GAS v9.105: 펀드 복구 선택적 진단 계측

- `refreshFundValuations` 요청의 `diagnostic=true`일 때만 F코드·구간·단계·함수·경과시간과 원본 예외/stack을 응답과 Apps Script 실행 로그에 남깁니다.
- `누락 평가금액 복구`는 진단 플래그를 보내고, 응답을 받은 진단 구조를 브라우저 콘솔에 `[FUND_NAV_DIAGNOSTIC]`으로 표시합니다.
- NAV·좌수·가격이력·스냅샷·retry·timeout 정책은 변경하지 않았습니다.
- 운영 반영에는 Apps Script v9.105와 정적 웹/서비스워커 재배포가 필요합니다.

## GAS v9.104: 저장 NAV 파생 복구 및 정정 공시 반영

- 저장된 확정 NAV로 가격이력·스냅샷 쓰기 실패를 재실행할 수 있으며 처리·미처리 건수와 사유를 응답합니다.
- 같은 `sourceDate`의 NAV 정정 시 이를 참조하던 기존 carry-forward 평가행도 재계산합니다. 관련 없는 `MANUAL` 가격과 다른 자산은 보존합니다.
- 일일 실행은 과거 확정 NAV 누락 또는 외부 오류가 있는 `partial` 결과를 성공으로 기록하지 않습니다. 당일 미공시 NAV는 `latestUnpublished`로 구분합니다.
- 파일 미리보기는 파일 선택 토큰과 펀드가 현재 상태와 일치할 때만 비동기 결과를 반영합니다.
- 네트워크 timeout/JSON 파싱 실패는 `응답 오류`로 뭉개지 않고 분류된 원인을 반환하며, 처리율은 처리 시도·정상 평가·미공시·미복구·실패로 구분합니다.
- 운영 반영에는 Apps Script v9.104와 정적 웹/서비스워커 재배포가 필요합니다.

## GAS v9.102: 한화 dailyPrice 실제 필드 보정

- F00001 한화 `dailyPrice` 응답은 `list[].wkdate`와 `list[].price`를 사용하며, 첫 행에 계약 필드가 없으면 실제 key 목록을 오류로 반환합니다.
- F00002/F00003 저장 NAV 복구도 웹에서 7일 단위로 호출합니다. 외부조회 금지와 F00003 0좌 정책은 유지합니다.
- 운영 반영에는 Apps Script v9.102 재배포가 필요합니다.

## GAS v9.100: 펀드 복구 잠금 범위와 한화 공시일 파싱 보완

- `handleRefreshFundValuations`는 전체 복구 동안 `ScriptLock`을 잡지 않습니다. 외부 HTTP 조회·NAV 파싱·평가 계산은 lock 밖에서 수행하고, NAV·가격이력 쓰기 직전에 최신 시트 상태를 재조회한 뒤 짧게 잠급니다.
- 한화 `wktdate`는 전용 parser에서 `YYYYMMDD`, `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD`만 정규화하며 그 밖의 값은 원문을 포함한 오류로 거부합니다.
- 운영 반영에는 Apps Script v9.100 재배포가 필요합니다.

## GAS v9.99: 확정 NAV 누락 판정 및 붙여넣기 미리보기 순서 보완

- 누락 복구는 `펀드기준가격` 행의 평가일이 아니라 `가격공시일`을 기준으로 확정 NAV 존재 여부를 판단합니다. 과거 carry-forward 평가행이 있어도 실제 공시 NAV가 없으면 누락으로 조회합니다.
- 붙여넣기 미리보기는 요청 ID와 선택 펀드를 확인해 늦게 도착한 이전 응답이 최신 입력 결과를 덮어쓰지 않습니다.
- 운영 반영에는 Apps Script v9.99 및 변경된 정적 웹/서비스워커 재배포가 필요합니다.

# Deployment Notes

## GAS v9.98: 누락 평가금액 복구의 펀드별 독립 처리

- `F00001`은 같은 날짜·코드·provider의 저장 NAV를 먼저 사용하고, 저장되지 않은 평일만 한화 공식 API에 최대 14일 구간으로 나눠 조회합니다. 주말은 NAV 누락으로 보지 않으며 국내 공휴일은 추측하지 않고 API 응답의 실제 공시일만 저장합니다. 기존 40일 lookback은 확정 NAV 날짜 backfill에 불필요하여 제거했고, 실패 구간은 1회만 재시도합니다.
- `F00002/F00003`은 외부 요청 없이 저장된 Excel 확정 NAV만 사용합니다. `F00003`은 2026-08-25부터 0좌로 계속 제외합니다.
- 한화 API 일부 구간이 실패해도 성공 구간과 F00002/F00003 복구를 계속 저장하며, 응답의 `fundResults`에 펀드별 저장 NAV·API 성공/실패 구간·평가·가격이력·스냅샷·0좌 제외 건수를 반환합니다.
- 웹은 F00002/F00003 저장 NAV 복구를 먼저 수행한 뒤 F00001을 7일 요청으로 분리합니다. F00001 요청 자체가 client timeout으로 종료돼도 앞선 저장 NAV 펀드 결과는 보존하며, 실제 완료한 펀드·일과 펀드별 결과를 누적 표시합니다. 운영 적용에는 `src/gas/apps_script.gs` 반영과 Apps Script 웹앱·정적 웹 새 버전 배포가 필요합니다.

## GAS v9.95: 확정 NAV 공통 반영과 후행 스냅샷 보완

- `F00001/F00002/F00003` 모두 정형 xlsx, 기존 xlsx/xls/csv, 표 붙여넣기 및 단건 수동 NAV 검증을 지원합니다. `F00001` 공식 한화 API는 그대로 유지합니다.
- 공식 API가 실제 반환했거나 사용자가 WARNING을 확인한 실제 NAV 날짜만 확정 자료로 저장합니다. 직전 NAV는 현재 추정 계산에 사용할 수 있지만 미공시 날짜의 확정 NAV·가격이력·스냅샷으로 복제하지 않습니다.
- 같은 날짜의 사용자 NAV가 기존값과 다르면 기존값→입력값을 WARNING으로 보여준 뒤 명시적 확인 시 기존 행을 갱신합니다. 자동조회는 저장된 사용자 NAV와 충돌하면 덮어쓰지 않습니다.
- 확정 NAV는 해당 날짜의 유효좌수와 `NAV × 좌수 ÷ 1,000`으로 평가하며, 해당 F코드의 가격이력과 해당 날짜 스냅샷 펀드 행만 후행 보완합니다. 다른 자산·과거 FX·거래·좌수 이력은 재계산하지 않습니다.
- `F00003`은 2026-08-25부터 0좌이며 NAV가 있어도 평가·스냅샷에 재등장하지 않습니다. 운영 적용에는 `src/gas/apps_script.gs` 반영과 Apps Script 웹앱 새 버전 재배포가 필요합니다.

## GAS v9.94: 웹 표 기준가 붙여넣기·충돌 보호

- `기준일/펀드규모/수정기준가/기준가/과표기준가` 표를 붙여넣으면 헤더가 정확히 `기준가`인 열만 평가 NAV로 인식합니다. `수정기준가`와 `과표기준가`는 사용하지 않으며 YY.MM.DD·YYYY.MM.DD·YY-MM-DD·YYYY-MM-DD를 지원합니다.
- 검증된 붙여넣기/import NAV는 신규 공시일에 최우선으로 추가하지만, 동일 클래스의 기존 NAV와 값이 다르면 충돌을 표시하고 저장을 차단합니다. 조용히 덮어쓰지 않습니다.
- 평가일에 NAV가 없으면 시작일 이전을 포함해 `NAV_DATE <= VALUATION_DATE`인 가장 최근 NAV를 사용하며 미래 NAV는 소급하지 않습니다. 평가금액은 기존 좌수 단위와 계산식 `NAV × 좌수 ÷ 1,000`을 유지합니다.
- 운영 적용에는 `src/gas/apps_script.gs` 전체 반영과 웹앱 새 버전 재배포가 필요합니다.

## GAS v9.93: 검증 NAV 우선·영향구간 재계산

- `F00002/F00003` 기준가격 UI에서 `NAV입력`(일자·기준가격 2열)과 `사용방법` 시트로 구성된 정형 xlsx 양식을 다운로드할 수 있습니다. 기존 xlsx/xls/csv 유연 파싱도 유지합니다.
- 정확한 펀드·클래스로 검증된 사용자 import NAV를 최우선으로 취급합니다. 동일 공시일의 기존 NAV가 다르면 기존값→업로드값을 미리보기한 후 기존 행을 갱신하며, 동일하면 변경하지 않습니다.
- NAV 신규·갱신일부터 다음 NAV 공시일 전까지의 영향구간을 병합해 `NAV × 날짜별 유효 좌수 ÷ 1,000`으로 평가금액과 펀드 가격이력을 갱신합니다. 해당 펀드 스냅샷 행만 교체하여 다른 자산·과거 FX·관련 없는 수동값을 보존합니다.
- 펀드 F코드의 정상 평가 원천은 NAV+좌수 이력이며, 영향구간의 기존 펀드 `MANUAL` 가격보다 검증 NAV 평가가 우선합니다. 일반 자산의 수동 가격 기능은 변경하지 않습니다.
- 미래 NAV 금지·직전 공시 NAV 이월·`F00003` 2026-08-25 이후 0좌 정책을 유지합니다. GitHub merge만으로는 운영 GAS가 바뀌지 않으므로 `src/gas/apps_script.gs`를 Apps Script에 반영하고 새 버전으로 재배포해야 합니다.

## GAS v9.92: AQ018/AP399 기준가격 파일 import

- `F00002(AQ018/S-T)`와 `F00003(AP399/S)`은 공식 자동 NAV endpoint 미지원 상태를 유지하며, 좌수 설정 패널의 `기준가격 가져오기`에서 사용자가 확보한 정확한 클래스의 xlsx/xls/csv 기간 NAV를 import할 수 있습니다.
- UI에서 KOFIA 클래스코드·표준코드와 KOFIA/FunETF/FundDoctor 참고 링크를 확인합니다. FunETF/FundDoctor는 자료 확인용이며 GAS 자동 provider로 사용하지 않습니다.
- GAS가 provider·클래스·식별자·날짜·NAV·좌수 이력을 다시 검증합니다. 기존 NAV는 동일값과 충돌 모두 보존하고 누락 NAV만 추가하며, 미래 NAV는 거부합니다.
- `F00003`은 2026-08-25 0좌 적용일부터 import 파일에 NAV가 있어도 평가에서 제외하며, import 후에는 기존 가격이력·스냅샷 누락 반영 경로만 재사용합니다.
- 운영 적용 시 `src/gas/apps_script.gs` 전체를 Apps Script에 반영하고 웹앱을 새 버전으로 재배포합니다.

## GAS v9.91: 정확한 클래스 NAV 재사용·직전 공시일 이월

- `F00001` 한화 LIFEPLUS 적격 TDF 2045 `C-RPe`는 한화자산운용 `GET https://www.hanwhafund.co.kr/api/fund/dailyPrice` (`fundCd=008942`, `period`, `startDate`, `endDate`)만 사용합니다. 응답의 `list[].wktdate`, `list[].price`를 읽고 HTTP 요청 범위 밖 날짜는 폐기합니다.
- `F00002`는 `AQ018` S-T, `F00003`은 `AP399` S 클래스로 고정합니다. 정확히 일치하는 공식 일별 NAV endpoint가 확인되지 않아 외부 조회는 명시적으로 미지원 처리하며, FunETF나 다른 클래스로 대체하지 않습니다.
- 공식 조회가 실패하면 같은 코드·클래스의 기존 `펀드기준가격`이 요청 범위 전체를 대체할 수 있을 때만 재사용합니다. 부족하면 쓰기 전에 실패하여 `펀드좌수`, `펀드기준가격`, `가격이력`, `스냅샷`을 보존합니다.
- 기간 평가금액 채우기와 일일 자동평가는 같은 NAV 경로를 사용합니다. 정확한 클래스의 기존 `펀드기준가격`이 모든 평가일에 있으면 외부 조회를 생략하고, 누락일이 있을 때만 첫 누락일 이전 40일부터 마지막 0좌 전 평가일까지 조회합니다. FunETF는 펀드 NAV 실행 경로에서 사용하지 않습니다.
- 평가일의 NAV가 없으면 해당일 이전의 가장 가까운 공시 NAV를 사용하고, 이후 NAV는 소급하지 않습니다. 이전 NAV도 없으면 쓰기 전에 명시적으로 실패합니다. 0좌 기간은 평가금액을 만들지 않고 조회 범위에서도 제외합니다.
- 운영 적용은 `src/gas/apps_script.gs` 전체를 Apps Script에 반영한 뒤 웹앱을 새 버전으로 재배포해야 합니다. 재배포 후 실제 GAS `UrlFetchApp` 응답과 일일 트리거 실행 기록을 확인합니다.

## GAS v9.89: 펀드 기간 기준가격 조회 403 진단

- 요청에는 `Accept`, `Accept-Language`, `Referer`, 일반 브라우저 `User-Agent`를 포함합니다. 401/403은 빈 가격으로 바꾸지 않고 제공처·HTTP 상태·기존 데이터 보존 사실을 오류로 반환합니다.
- 403이 계속되면 제공처가 Google Apps Script 요청 자체를 차단한 경우입니다. 기존 가격이력·펀드기준가격·스냅샷·좌수 이력은 조회 시작 전에 쓰지 않으므로 변경되지 않습니다.

## GAS v9.88: F코드 좌수 변경 이력 관리

- 좌수 설정에는 현재 보유 여부와 관계없이 기초정보, 거래이력, 기존 `펀드좌수` 중 하나에 근거가 있는 F코드만 표시합니다. 현재 보유와 과거 보유/전량 매도 종목을 구분하며, 근거 없는 임의 코드는 노출하거나 저장할 수 없습니다.
- `펀드좌수`의 기존 코드·적용시작일·좌수 행은 수정하거나 삭제하지 않습니다. 새 좌수·0좌 모두 새 적용 시작일 행으로 추가합니다. 같은 적용일의 다른 좌수는 거부합니다.
- 날짜별 평가는 해당 날짜 이전 또는 당일의 가장 최근 좌수를 사용합니다. 0좌 적용일부터는 신규 기준가격·가격이력·스냅샷 평가행을 만들지 않으며, 이전 보유기간의 기존 기록과 누락 보완분은 보존합니다.
- 전량 매도는 거래이력의 매도와 0좌 이력을 함께 기록해야 현재 보유현황에서도 사라집니다. 좌수 이력은 거래이력을 임의로 변경하거나 과거 스냅샷 행을 삭제하지 않습니다.

## GAS v9.87: 펀드 좌수 자동 평가와 스냅샷 보존

- 웹 변경과 함께 `src/gas/apps_script.gs` 전체를 운영 Apps Script에 반영하고 기존 배포를 새 버전으로 갱신합니다. GitHub 변경만으로 운영 GAS가 갱신되지는 않습니다.
- **좌수·현재가 → 펀드 좌수 자동 평가**에서 기초정보에 등록된 `F00001` 같은 코드마다 정확한 펀드 클래스, 전체 보유좌수, 적용 시작일을 저장합니다. 클래스는 한화 적격 TDF 2045 C-RPe, KB 밸류포커스 소득공제 S-T, 피델리티 월드Big4 S를 지원합니다. 개인 좌수는 저장소에 포함하지 않습니다.
- 좌수 저장 시 `runDailyFundValuations` 한국시간 19시대 일일 트리거를 등록합니다. 필요 권한은 시트 읽기/쓰기, 외부 URL 조회, 트리거 관리입니다. 최초 설정 후 Apps Script 트리거 목록에서 확인합니다.
- 초기 과거 자료는 같은 화면의 기간을 지정하고 **기간 평가금액 채우기**를 실행합니다. 31일씩 처리하며 오류 뒤 재실행해도 완료 구간은 중복 추가하지 않습니다. 자동 실행은 최근 32일의 누락을 재확인합니다. 장기간 중단됐던 구간은 기간 채우기로 보완합니다.
- `펀드좌수`는 코드·적용일별 좌수 이력, `펀드기준가격`은 날짜·NAV(1,000좌당)·실제 공시일·좌수·원화 평가금액을 저장합니다. 기존 `가격이력`의 F코드 가격은 **펀드 전체 평가금액**이며 NAV와 혼용하지 않습니다. 스냅샷에서도 F코드를 수량 1의 전체 평가금액으로 처리해 이중 곱셈을 방지합니다.
- 좌수 변경은 변경일의 새 설정으로 등록합니다. 이미 계산한 구간과 다른 좌수로 겹치는 등록, 같은 적용일 수정, 기존 코드의 클래스 변경은 거부합니다. 0좌 설정은 해당일부터 자동 평가를 중단하지만 거래이력의 매도를 대신하지는 않습니다.
- 조회한 공시일 사이 비공시일은 직전 NAV를 적용하고 실제 공시일을 별도 기록합니다. 공급자의 마지막 공시일 이후에는 잠정 가격을 확정 저장하지 않고 다음 실행에서 보완합니다. 영업일 공시 지연·휴일의 최신 날짜는 화면 종료일과 다를 수 있습니다.
- 기존 가격이력(MANUAL 포함)은 자동 계산으로 덮어쓰지 않습니다. 같은 날짜의 기존 스냅샷 수동값, 새 계산에서 누락된 종목, 가격자료가 없는 행과 과거 외화 행도 보존합니다. 신규 스냅샷은 다른 보유종목 평가자료까지 갖췄을 때만 작성합니다. 거래이력이 없는 날짜는 평가원금을 임의 생성하지 않고 보류 건수로 알립니다.
- 전체 재작성은 빈 결과로 기존 날짜를 삭제하지 않습니다. 스냅샷 쓰기는 잠금·쓰기 전 전체 시트 백업·한 번의 데이터 쓰기로 처리합니다. 백업 이름은 `스냅샷_백업_...`이며 자동 삭제하지 않습니다. 백업 실패 시 원본 쓰기도 중단합니다. 백업은 새 버전 적용 이후의 변경을 보호하며 이미 삭제된 과거 기록을 되살리지는 못합니다.
- 자동 실행의 최근 결과와 오류는 Script Properties의 `fund_last_result`, `fund_last_error`에 기록됩니다. 실제 Google 환경의 예약 실행·권한·공급자 접근은 재배포 뒤 확인해야 합니다.
- 기존 데이터 복구: 현재 시트를 먼저 복사한 뒤 시트 버전 기록 또는 보유 백업과 비교합니다. JSON에 남은 수동 현재가는 해당 날짜 값의 복구 후보지만 과거 스냅샷 전체를 대체하지 않습니다. 운영 데이터는 이 코드 변경 과정에서 수정하지 않았습니다.
- 다계좌에 같은 F코드를 보유한 경우 입력 좌수는 코드 전체 합계입니다. 현재 웹의 레거시 `fundDirect`는 이름별 총액 구조이므로 계좌별 실제 평가금액 분리는 계좌별 좌수 자료가 별도로 필요합니다.

### 검증

- `npm run check:gas`에 실제 저장 함수의 같은 날짜 추가, MANUAL 보호, 빈 결과, 쓰기 실패, 조회 오류 및 좌수 적용일·0좌·기준가격 이월·재실행 검사를 포함했습니다.
- 로컬 브라우저에서 좌수 입력→저장→2026-01-01~09-08의 9개 배치 요청과 데스크톱/모바일 화면을 검증했습니다. 이 검사는 GAS 응답을 대체한 테스트이며 운영 시트를 변경하지 않습니다.

## 정적 자산·서비스워커 캐시 갱신

- CSS 또는 JS를 수정하면 `src/web/index.html`의 해당 파일 `?v=YYYYMMDD-N`과 `src/web/sw.js`의 precache URL을 같은 값으로 갱신합니다.
- 서비스워커 등록 URL, `CACHE_NAME`, 핵심 precache 자산은 동일한 배포 버전을 사용합니다. 활성화 단계에서 이전 `portfolio-cache-*`를 삭제합니다.
- 동일 출처 정적 자산은 네트워크 우선 및 HTTP 캐시 우회로 조회하고, 오프라인일 때만 현재 서비스워커 캐시를 사용합니다. 내비게이션 요청은 오프라인에서 precache된 `index.html`로 대체합니다.
- 배포 후 기존 브라우저에서 앱을 닫았다 다시 열어 새 서비스워커가 활성화되는지, 개발자 도구 Application의 Cache Storage에 현재 캐시 하나만 남는지 확인합니다.
- `npm run check:typography`는 HTML의 CSS·서비스워커 등록 버전과 서비스워커의 캐시·precache 버전 일치를 함께 검사합니다.
- `core_ui.js`는 초기 테마 렌더링이 사용하는 `_escapeHtml()`을 제공하므로 `shared/theme.js`보다 먼저 로드해야 합니다.

## GAS v9.86 외화·내부 조회 보호

- 가격이력에 날짜별 환율이 저장되지 않으므로 전체 강제 재작성은 외화 종목의 기존 과거 스냅샷 행을 보존하고 국내 종목 행만 다시 계산합니다. 현재 환율로 과거 외화 평가금액을 덮어쓰지 않습니다.
- 가격이력·최근가격·종목코드·가격소스 조회 오류는 빈 결과로 숨기지 않고 해당 날짜 실패로 기록합니다. 내부 조회 오류 때문에 정상 데이터가 삭제되는 것을 방지합니다.

## GAS v9.85 전체 재작성 연속 처리·오류 구분

- 손익 그래프 화면이 열려 있으면 웹이 완료될 때까지 다음 3일 배치를 연속 요청합니다. 화면을 닫은 경우에만 기존 1분 간격 GAS 트리거가 이어서 처리하므로 전체 재작성 시간이 크게 늘어날 수 있습니다.
- 강제 재작성용 스냅샷 생성에서 시트 읽기 등 예외가 발생하면 빈 보유내역으로 취급하지 않고 해당 날짜 실패로 기록합니다. 실제 생성 결과가 정상적으로 빈 배열인 경우에만 기존 날짜 행을 삭제합니다.

## GAS v9.84 전체 재작성 중 재요청 처리

- 이미 전체 재작성이 진행 중일 때 웹에서 버튼을 다시 누르면 Script Lock을 기다리다 `잠금 시간초과`로 실패하지 않고, 기존 작업의 현재 상태를 즉시 반환해 진행상황 확인을 이어갑니다.

## GAS v9.83 전체 스냅샷 재작성 정합성

- 강제 재작성 날짜에 보유자료가 하나도 없으면 해당 날짜의 기존 스냅샷 행을 삭제해 오래된 평가금액이 그래프에 남지 않게 합니다.
- 복구 상태 초기화는 Script Lock 안에서 수행하고 이미 진행 중인 전체 재작성 요청은 거부합니다. 날짜별 오류는 그 날짜가 이후 실행에서 성공한 경우에만 제거합니다.

## GAS v9.82 전체 스냅샷 재작성 동시성

- 진행상황 조회가 실행 중인 후속 트리거를 유실로 오인해 중복 트리거를 만들지 않도록, 배치가 시작할 때 현재 트리거를 삭제하던 동작을 제거했습니다. 기존 `다른 프로세스에서 잠금 상태를 너무 오래 유지` 오류가 표시된 경우에도 점검 수가 계속 증가했다면 재시도가 작동한 것이지만, v9.82에서는 이 불필요한 잠금 경합을 방지합니다.
- 재시도 배치가 정상 완료되면 이전 배치 오류 문구를 지웁니다. 화면의 예상 시간은 한 번에 3일, 후속 실행 간격 1분을 기준으로 한 최소값이며 Apps Script 실행·트리거 지연에 따라 더 오래 걸릴 수 있습니다.

## GAS v9.81 손익 그래프 전체 스냅샷 재작성

- 손익 그래프 상단의 `GAS 전체 재작성` 버튼에서 저장된 전체 가격이력 날짜의 기존 스냅샷까지 다시 작성할 수 있습니다. 외부 가격을 새로 조회하지 않으며 브라우저를 닫아도 GAS 후속 트리거가 계속 처리합니다.
- 이 버튼은 로컬 스냅샷을 만드는 기능이 아니라 연결된 GAS에 요청해 구글시트의 `스냅샷` 시트를 덮어씁니다. 이후 접속에서도 같은 복구 결과를 조회합니다.
- 화면은 10초마다 진행상황을 확인하고 완료되면 손익 그래프를 다시 조회합니다. 진행상황 조회 중 후속 트리거 유실이 감지되면 GAS가 자동 재예약합니다.

## GAS v9.80 전체 스냅샷 복구 자동 재개

- 전체 가격이력·스냅샷 정합성 복구 도중 후속 시간 트리거가 사라지면 `전체 스냅샷 복구 진행상황` 메뉴가 이를 확인해 1분 후 실행을 다시 예약합니다.
- 날짜별 처리 밖에서 발생한 배치 오류도 진행 상태의 `최근 오류`에 저장하고 후속 실행을 재예약합니다. 재예약 자체가 실패하면 해당 원인을 상태창에 표시합니다.
- `점검 완료`가 더 이상 증가하지 않으면 GAS v9.80 재배포 후 `전체 스냅샷 복구 진행상황`을 한 번 열어 자동 재예약 메시지 또는 최근 오류를 확인합니다.

## GAS v9.79 스냅샷 누락 가격 보완

- 스냅샷 기준일의 종목 가격이 비어 있으면 같은 날짜의 값, 가장 가까운 직전 이력 순으로 사용합니다. 직전 이력이 전혀 없는 최초 구간에 한해서만 가장 가까운 이후 입력값을 사용합니다.
- 기존 스냅샷은 자동으로 일괄 변경되지 않습니다. GAS v9.79 재배포 후 손익 그래프의 `누락 보완` 또는 스프레드시트의 스냅샷 정합성 복구를 실행해야 재계산됩니다.
- 손익 그래프의 `수익률 MDD`는 입출금을 제거한 수익률 지수의 고점→저점이며, 입출금을 포함하는 `가장 높은 날` 평가금액과 날짜가 다를 수 있습니다.

## GAS v9.78 주담대 잔여기간

- 현재월 상환스케줄 행의 납입 후 잔액·이자는 현재 상태에 반영하고, `remainingMonths`는 다음 달 이후 스케줄 행만 계산합니다.
- 웹과 GAS의 자동 동기화 기준을 맞추려면 `src/gas/apps_script.gs` v9.78을 새 버전으로 재배포해야 합니다.

## 현재가 편집 요청 인증

- GAS 요청 인증이 활성화된 경우 현재가 편집의 가격이력 조회, 배치 저장, 건당 fallback도 공통 요청 유틸을 통해 브라우저의 `gsheet_access_token`을 전송합니다.
- 브라우저 토큰이 없거나 GAS Script Properties의 `access_token`과 다르면 `인증 실패`가 정상적으로 반환되므로 구글시트 연동 화면에서 동일 토큰을 다시 저장·검증합니다.
- 배당의 SEIBro 갱신·설정 읽기/쓰기뿐 아니라 공공데이터포털 및 GOOGLEFINANCE fallback 조회도 같은 인증 요청 유틸을 사용합니다.
- 손익 그래프의 스냅샷·종목별 상세·비교지수 조회도 공통 인증 요청 유틸을 사용합니다.
- 현재가 배치 저장이 응답 없이 건별 저장으로 전환되는 과정은 정보 로그로만 남기고, 건별 fallback까지 실패한 경우에만 경고를 표시합니다.

## Canonical web root

- 운영/로컬 정적 서버의 canonical web root는 `src/web`입니다.
- 실제 앱 엔트리포인트는 `src/web/index.html`입니다.
- 루트 `index.html`은 과거 배포/북마크 호환용 포워딩 파일로만 유지합니다.

## 로컬 실행

```bash
npm run serve:web
```

기본 주소: `http://localhost:4173`

## 배포 전 검증

```bash
git diff --check
npm run check:web:ci
npm run check:gas
cp src/gas/apps_script.gs /tmp/apps_script.js && node --check /tmp/apps_script.js
```

`npm run check:web:ci`는 구조, manifest, JS syntax, 전역 함수명, DOM 계약, inline handler, 생성 HTML inline handler 검사를 한 번에 실행합니다.

## API 비밀키와 선택적 요청 인증

- GAS v9.75부터 KRX·공공데이터 API 키 원문은 `Script Properties`에만 저장하며 `getSettings`와 `getBootstrap`은 설정 여부만 반환합니다.
- 구버전 `설정` 시트에 API 키가 남아 있다면 Apps Script 편집기에서 소유자 권한으로 `migrateLegacyApiKeysToScriptProperties()`를 한 번 실행합니다. 함수는 키를 `Script Properties`로 옮기고 설정 시트 원문을 제거합니다.
- 마이그레이션과 코드 반영을 확인한 뒤 브라우저의 과거 `krx_auth_key`, `public_data_api_key` localStorage 항목을 삭제합니다. 새 웹 버전은 시작할 때 자동 삭제합니다.
- 요청 인증은 기존 배포를 갑자기 차단하지 않도록 opt-in입니다. `Script Properties`에 `access_token`이 없으면 기존 요청을 허용하고, 값이 있으면 모든 GET·POST 요청에 같은 토큰을 요구합니다.
- 인증을 켜려면 충분히 긴 임의 토큰을 `Script Properties`의 `access_token`에 저장하고, 개인 브라우저 콘솔에서 `localStorage.setItem('gsheet_access_token', JSON.stringify('동일한 토큰'))`을 실행한 뒤 새로고침합니다. 토큰은 공개 저장소에 커밋하거나 URL에 직접 붙이지 않습니다.
- 정적 GitHub Pages 구조에서는 이 토큰이 브라우저 사용자·악성 확장프로그램·XSS에 노출될 수 있습니다. GAS URL만 유출된 경우의 방어에는 도움이 되지만 완전한 서버 인증은 아니며, 더 강한 보호에는 별도 인증 프록시가 필요합니다.
- 토큰 설정 전에 현재 브라우저에 토큰을 먼저 저장해야 접근 중단을 피할 수 있습니다. 다른 브라우저·기기에도 각각 다시 입력해야 합니다.

### v9.77 재배포 후 실제 설정 순서

아래 순서를 바꾸면 `access_token` 활성화 직후 웹앱이 인증 실패 상태가 될 수 있습니다. API 키 이전과 동작 확인을 먼저 끝내고 요청 인증은 마지막에 켭니다.

1. 대상 구글시트를 새로고침하고 상단 `📊 포트폴리오` 메뉴가 나타나는지 확인합니다.
2. `📊 포트폴리오 → ⚙️ 설정 → 🔐 레거시 API 키 안전 이전`을 한 번 실행합니다.
3. 완료창에서 공공데이터·KRX 키 결과를 확인합니다. 이 작업은 거래·보유·배당·부동산·가격 시트를 변경하지 않고 `설정` 시트의 레거시 키 필드만 제거합니다.
4. `📊 포트폴리오 → ⚙️ 설정 → ℹ️ API 인증키 저장 상태`를 실행해 필요한 API 키가 `저장됨`인지 확인합니다.
5. 공개 포트폴리오 웹앱을 열고 `구글시트 연동` 탭에서 `저장 · 연결 테스트`를 실행합니다. 아직 요청 접근 토큰은 설정하지 않습니다.
6. 현재가 조회 또는 배당 조회 중 실제 사용하는 기능 하나를 실행해 API 키 서버 이전 후에도 동작하는지 확인합니다.
7. 개인 비밀번호 관리자에서 24자 이상의 임의 문자열을 새로 생성합니다. 저장소 코드, 커밋, 채팅, 시트 셀에는 붙여넣지 않습니다.
8. 구글시트에서 `📊 포트폴리오 → ⚙️ 설정 → 🛡️ 요청 접근 토큰 설정·해제`를 열고 생성한 값을 입력합니다. 이 시점부터 토큰 없는 GAS 요청은 `인증 실패`가 됩니다.
9. 즉시 웹앱 `구글시트 연동 → GAS 요청 접근 토큰`에 같은 값을 입력하고 `저장 · 검증`을 누릅니다. 성공하면 입력란은 비워지고 상태가 `서버 인증 켜짐 · 브라우저 토큰 있음`으로 바뀝니다.
10. 웹앱의 `저장 · 연결 테스트`를 다시 실행하고 설정 복원·종목코드 동기화가 모두 성공하는지 확인합니다.
11. 사용하는 다른 개인 브라우저와 기기에서도 9~10단계를 반복합니다. 토큰은 기기 간 GAS 설정으로 복원되지 않습니다.
12. 더 이상 사용하지 않는 브라우저에서는 `브라우저 토큰 삭제`를 누르고 사이트 데이터도 삭제합니다.

v9.77은 `종목코드` 시트에 `시장` 열을 추가합니다. `시트 구성 확인·복구` 또는 웹 기초정보 저장 시 기존 다섯 열은 그대로 유지되고 여섯 번째 열만 추가됩니다. 기존 종목의 시장은 임의로 채우지 않으므로 웹 `기초정보 → 종목`에서 `KR`, `US`, `OTHER`를 직접 지정해야 국내·해외 실현손익 추정에 포함됩니다.

### 인증 실패 시 복구

- 웹앱에서만 실패하고 구글시트 메뉴는 열리는 경우: `구글시트 연동 → GAS 요청 접근 토큰`에 GAS와 같은 토큰을 다시 입력합니다.
- 토큰 값을 잊은 경우: 구글시트의 `🛡️ 요청 접근 토큰 설정·해제`에서 새 토큰으로 교체한 뒤 모든 개인 브라우저에 새 값을 입력합니다. 기존 토큰 원문을 조회하는 기능은 제공하지 않습니다.
- 즉시 호환 모드로 되돌려야 하는 경우: 같은 메뉴에서 `-`를 입력해 서버 요청 인증을 해제합니다. 이 경우 GAS URL만 아는 요청을 다시 허용하므로 임시 복구 후 새 토큰을 설정해야 합니다.
- `저장 · 검증` 실패 시 웹은 직전에 정상 사용하던 브라우저 토큰을 자동 복원합니다.

### API 키 변경·삭제

- 공공데이터 키 변경: 웹앱 `구글시트 연동 → 공공데이터포털 API 인증키` 또는 구글시트 메뉴 `공공데이터 API 인증키 설정`에서 새 키를 입력합니다.
- KRX 키 변경: 웹앱 `구글시트 연동 → KRX Open API AUTH_KEY` 또는 구글시트 메뉴 `KRX 인증키 설정`에서 새 키를 입력합니다.
- 키 삭제: 구글시트의 각 키 설정 메뉴에서 `-`를 입력합니다. 웹 입력란은 저장 성공 후 항상 비워지며 원문을 다시 표시하지 않습니다.
- 상태 확인: 구글시트의 `API 인증키 저장 상태`와 웹앱 연동 탭의 `키 저장됨/키 미설정` 배지를 사용합니다.

## 운영 반영 체크리스트

### Web

- [ ] 정적 서버 document root가 `src/web`인지 확인
- [ ] `/` 요청이 `src/web/index.html`을 반환하는지 확인
- [ ] 배포 후 JS/CSS/icon/manifest 404가 없는지 확인
- [ ] 변경한 JS/CSS의 `?v=` 자산 버전과 `sw.js`의 `CACHE_NAME`을 갱신했는지 확인
- [ ] 캐시 이슈가 있으면 브라우저 새로고침 또는 서비스워커 업데이트 확인

### Google Apps Script

`src/gas/apps_script.gs`가 바뀐 경우에는 저장소 커밋만으로 운영 GAS가 자동 갱신되지 않습니다.

- [ ] GAS 상단 버전/변경사항, `handleGetSettings()`의 `gasVersion`, 프론트 `EXPECTED_GAS_VERSION`을 함께 업데이트
- v9.108: Toss 현재가 symbol 정규화, `persist=false` 캐시 경로의 가격이력/Snapshot 무쓰기, 005930 read-only smoke 진단
- [ ] Apps Script 편집기에 `src/gas/apps_script.gs` 최신 내용을 반영
- [ ] 웹앱 새 버전 배포 또는 기존 배포 업데이트
- [ ] 앱의 구글시트 연동 화면에서 연결 상태 확인
- [ ] 현재가 업데이트, 현재가 편집 저장, 배당 조회 중 최소 1개 흐름을 확인
- [ ] 손익 그래프의 일별·주간·월간 전환, 누락 경고와 `누락 보완` 날짜별 POST 동작 확인
- [ ] `자동 트리거 등록·복구` 후 주담대 갱신(01:10), 코드 보정(15:50), 평가단가(16:20) 트리거 확인

GAS 메뉴 및 시트 구성:

- 스프레드시트 메뉴는 `📊 포트폴리오` 하나만 생성되며 `⚙️ 설정`, `📈 종가 관리`, `📆 소급채우기`, `🛠️ 유지보수`로 구분됩니다.
- `⚙️ 설정 > 시트 구성 확인·복구`는 운영 시트 8종을 생성하고 제목행·열 너비를 정리하지만 기존 데이터는 삭제하지 않습니다.
- 메뉴 표시에는 기본 `onOpen()`만 사용합니다. 기존 설치형 `onOpen` 트리거는 `자동 트리거 등록·복구` 실행 시 제거됩니다.
- 스프레드시트를 열면 `onOpen(e)`가 현재 문서 ID를 GAS `ScriptProperties`의 `SS_ID`로 갱신합니다. 다른 문서에서 복사한 GAS가 과거 문서 ID에 접근하는 오류를 방지합니다.
- 자동 연결이 되지 않으면 `⚙️ 설정 > 연결 스프레드시트 설정`에 현재 시트 URL을 입력해 연결 상태와 접근 권한을 확인할 수 있습니다.

웹 배포 캐시 확인:

- 손익 그래프처럼 분리된 JS 파일을 수정한 경우 파일 내용뿐 아니라 `index.html`의 `?v=` 자산 버전도 갱신해야 기존 브라우저/CDN 캐시가 새 파일로 교체됩니다.
- 서비스워커는 버전이 붙은 URL과 `updateViaCache: 'none'`으로 등록하며, 캐시 이름이 변경되면 활성화 단계에서 이전 캐시를 삭제합니다.

주담대 잔액 자동 갱신:

- 업로드한 `LOAN_SCHEDULE`의 현재월 행을 기준으로 잔액, 이번 달 이자, 누적 이자, 전체·잔여 상환개월을 계산합니다.
- GAS의 `syncMortgageFromSchedule` 트리거가 매일 01:10경 실행되므로 웹앱을 열지 않아도 월이 바뀌면 자동 반영됩니다.
- 웹앱을 열거나 GAS 설정을 다시 불러올 때도 한 번 더 계산하며, 앱을 계속 열어둔 경우에는 매시간 월 변경 여부를 확인합니다.
- 자동 갱신을 사용하려면 `📊 포트폴리오 > ⚙️ 설정 > 자동 트리거 등록·복구`를 한 번 실행해야 합니다.
- 자동 트리거와 웹 저장이 동시에 실행되더라도 GAS Script Lock으로 설정 시트의 덮어쓰기 충돌을 방지합니다.
- 투자계획의 연도별 현금흐름 표는 등록된 월별 스케줄을 연도별 원금과 이자로 나누어 표시합니다. 축적기는 월 추가투자액을 대출 납입 후의 순투자금으로 간주해 원리금을 금융자산에서 다시 차감하지 않고 참고값으로만 표시하며, 은퇴기에는 원금과 이자를 금융자산에서 한 번 차감합니다.
- 표 상단의 `등록 스케줄 시작~종료연도 · 표 반영 N개 연도`를 확인하면 스케줄 날짜가 현재 시뮬레이션 기간과 겹치는지 점검할 수 있습니다.

손익 스냅샷 점검·보완:

- 손익 그래프의 기간·주기·비교지수 선택은 조회 조건만 변경하며, GAS 조회와 그래프 작성은 `🔎 조회` 버튼을 누를 때만 실행합니다. 조회 중에는 버튼과 상태 영역에 `1/2 스냅샷 → 2/2 비교지수` 진행 단계를 표시합니다. 특정일 손익 상세 조회는 해당 날짜 input 변경 시 별도 요청합니다.
- 특정일 손익의 종목별 상세 표는 GAS v9.74 이상의 `getHistoryDetail` API가 필요합니다. GAS를 재배포하지 않으면 합계만 표시되고 상세 조회는 버전 불일치 또는 API 오류로 표시됩니다.
- 주간 그래프는 금요일 자료만 고집하지 않고 각 주의 마지막 스냅샷을 사용하며, 월간 그래프는 각 월의 마지막 스냅샷을 사용합니다.
- 선택 기간 중 비어 있는 일(오늘·주말 제외)·주·월이 있으면 손익 그래프 위에 누락 구간을 표시합니다. 휴장일은 웹에서 확정할 수 없으므로 일별 점검에서는 평일 후보로 표시될 수 있습니다.
- `누락 보완`은 마지막 저장일 다음 일·주·월부터 오늘까지를 검사하고, 거래이력과 Google Finance 가격이력으로 누락일을 다시 만듭니다. 최신 GAS v9.68 웹앱 재배포가 필요합니다.
- 여러 날짜는 프론트에서 날짜별로 하나씩 POST합니다. 날짜마다 과거 가격 조회와 시트 읽기·쓰기를 수행하므로 일별 누락이 많거나 Google Finance 응답이 늦으면 복구 시간이 길어질 수 있습니다. 한 날짜가 실패해도 다음 날짜를 계속 처리하고, 성공·실패 건수와 날짜별 실패 사유를 화면에 표시합니다. GAS는 호환성을 위해 요청당 최대 8개 제한을 유지합니다.
- 보완 요청이 실행되면 16:20 평가단가 자동 트리거도 점검하며, 트리거가 사라진 경우 자동으로 다시 등록합니다. 트리거가 있는데도 계속 누락되면 Apps Script의 `실행` 화면에서 권한·할당량·Google Finance 오류를 확인해야 합니다.
- 펀드·TDF 수동가격은 입력 기준일의 `가격이력`에 MANUAL로 보존됩니다. 이후 날짜에 별도 입력이 없으면 해당 날짜 이전의 가장 최근 수동가격을 이월하며, 기준일 이후에 입력한 미래 가격은 과거 스냅샷에 사용하지 않습니다.
- 펀드·TDF에 기준일 당일 또는 이전 수동가격이 전혀 없으면 평가단가를 임의 추정하지 않고 매입원가를 평가금액으로 사용하는 `COST_FALLBACK`으로 기록합니다. 정확한 과거 손익이 필요하면 해당 기준일의 수동가격을 추가한 뒤 스냅샷을 다시 보완해야 합니다.
- 날짜별 수동가격은 과거 스냅샷 재현에 필요하므로 v9.41부터 항상 보존되며, 기존 `최신값만 유지` 옵션은 비활성화됩니다.
- 자동 스냅샷은 매일 16:20경 `runEvalPriceUpdate1620`이 실행하며 Script Lock으로 수동 저장·복구와의 동시 쓰기를 차단합니다. 실패는 더 이상 로그만 남기고 성공 처리하지 않고 Apps Script 실행 실패로 전파됩니다.
- `📊 포트폴리오 > 🛠️ 유지보수 > 🔎 자동화 상태 점검`에서 실제 최신 스냅샷 날짜, 최근 자동 생성 성공·실패 시각과 오류를 확인할 수 있습니다. 스냅샷 시트가 정렬되지 않았더라도 전체 날짜 중 최댓값을 표시합니다.
- 상장 종목코드가 하나도 없는 펀드·TDF 전용 포트폴리오도 거래이력과 기준일 이하 최근 수동가격으로 자동 스냅샷을 생성합니다.
- v9.41까지 남아 있던 삭제된 보정 함수 호출은 16:20 자동 실행을 중단시킬 수 있으므로 v9.42에서 제거했습니다. 기존 배포에서 스냅샷이 장기간 생성되지 않았다면 v9.42 재배포 후 `자동 트리거 등록·복구`와 `누락 보완`을 순서대로 실행합니다.
- v9.42의 `getPrices`에는 누락된 내부 헬퍼 호출이 남아 가격 응답이 실패할 수 있으므로 v9.43 재배포가 필요합니다. `npm run check:gas`는 향후 같은 형태의 정의되지 않은 내부 헬퍼 호출을 배포 전에 차단합니다.
- v9.53부터 조회 지연을 유발하던 SOX 비교지수와 SOXX 대체 조회를 제거했습니다.
- v9.54부터 Settings 시트 저장은 데이터 행을 삭제하지 않고 내용만 초기화하므로 `고정되지 않은 행을 모두 삭제할 수 없습니다` 오류가 발생하지 않습니다.
- v9.55부터 요청별 임시 시트 이름에 생성시각을 기록하고 10분 이상 지난 시트만 정리해, 데이터 정리 작업이 현재 계산 중인 요청의 임시 시트를 삭제하지 않도록 보호합니다.
- v9.56부터 기초정보 저장은 Settings 응답을 먼저 확인하고, 재접속 시 종목코드 시트의 유형·섹터·통화도 병합해 과거 Settings 저장 실패로 남은 이전 섹터를 복구합니다.
- v9.57부터 `action=diagnoseEtfDividends`는 보유현황과 TTM 거래이력의 ETF를 동적으로 선정해 HAR에서 확인한 SEIBro 요청을 읽기 전용으로 진단합니다. `raw=1`을 지정하면 원문 XML을 포함하며 `ETF분배금이력`, `설정.DIVDATA` 및 다른 시트를 수정하지 않습니다. GAS 웹앱을 새 버전으로 재배포한 뒤 실행해야 합니다.
- v9.58부터 스프레드시트의 `📊 포트폴리오 → 🛠️ 유지보수 → 🧾 SEIBro ETF 읽기 전용 진단` 메뉴에서 URL을 직접 조합하지 않고 1단계 진단을 실행할 수 있습니다.
- v9.59부터 `📊 포트폴리오 → 🛠️ 유지보수 → 🧮 SEIBro ETF 2단계 드라이런` 메뉴에서 전체 분배금 행, TTM 주당합계, 기존 `DIVDATA` 대비 신규·정정·일치 건수를 저장 없이 확인할 수 있습니다.
- v9.60부터 2단계 드라이런은 대상 종목 수를 실행 시점에 자동으로 파악하고, 모든 종목의 TTM 결과를 10개씩 여러 결과창에 나누어 표시합니다. 표시 종목 수를 18개 또는 12개로 고정하지 않습니다.
- v9.61부터 `📊 포트폴리오 → 🛠️ 유지보수 → 💾 SEIBro ETF 3단계 운영 반영` 메뉴에서 전체 종목을 다시 검증하고 오류가 0건일 때만 `ETF분배금이력`과 `설정.DIVDATA`를 갱신합니다. 기존 이력 및 `MANUAL` 이벤트는 보존하며, 저장 오류 시 두 저장소를 작업 전 상태로 복구합니다.
- v9.62부터 배당 탭 진입 시 GAS의 최신 `DIVDATA`를 먼저 복원하며, SEIBro 이벤트가 있는 ETF는 공공데이터/GOOGLEFINANCE 자동조회 대상에서 제외합니다. GAS도 구버전 웹의 저장 요청이 기존 SEIBro ETF 값을 덮어쓰지 않도록 보호합니다.
- v9.63부터 배당 탭이 POST `refreshEtfDividends`를 호출해 SEIBro ETF 전체 검증과 증분 저장을 자동 실행합니다. 실행일에 현재 대상 전체가 이미 갱신됐다면 외부 요청과 쓰기를 생략하고 저장된 `DIVDATA`를 반환하므로, 평상시에는 GAS 메뉴의 3단계를 수동 실행할 필요가 없습니다.
- v9.64부터 손익 그래프의 선택 비교지수는 지수마다 별도 GAS 요청을 반복하지 않고 `getBenchmarks` 단일 요청과 단일 임시 시트에서 일괄 조회합니다. 동일 지수·기간 결과는 6시간 캐시해 5개 지수 선택 시 연속 타임아웃 가능성을 줄입니다.
- v9.65부터 자동 스냅샷은 실행일이 아니라 실제 확정 종가 거래일(T-1)로 저장합니다. 실행할 때 최근 2개 확정 거래일을 재검증하므로 하루 밀린 자료와 바로 전 누락일을 자동으로 바로잡고, 과거 GOOGLEFINANCE fallback도 요청일까지의 마지막 거래일 종가를 사용합니다.
- 기존 하루 밀림은 v9.65 배포 후 `📊 포트폴리오 → 🛠️ 유지보수 → 📸 최근 가격이력·스냅샷 정합성 복구`를 한 번 실행하면 최근 2개 확정 거래일 범위에서 즉시 재검증·복구할 수 있습니다.
- v9.66부터 위 수동 정합성 복구는 KRX·GOOGLEFINANCE 조회와 당일 종가 갱신을 실행하지 않고 이미 저장된 가격이력만 사용합니다. 긴 외부 조회와 시트 접근이 겹쳐 발생하던 Spreadsheet 서비스 타임아웃을 줄이고, 결과창에 재작성·일치·자료없음 날짜를 구분해 표시합니다.
- v9.67부터 수동 정합성 복구는 최근 2일로 제한하지 않고 확정 거래일까지 존재하는 전체 가격이력 날짜를 검사합니다. 한 실행에 3일씩 처리하고 남은 날짜는 1분 간격 시간 트리거로 이어서 실행하며, `📊 전체 스냅샷 복구 진행상황` 메뉴에서 전체·완료·잔여·재작성·일치·자료없음·실패 건수를 확인합니다.
- v9.68부터 16:20 일일 자동화는 확정 거래일(T-1)의 KRX 종가와 필요한 GOOGLEFINANCE fallback을 한 번만 조회하고 그 날짜 스냅샷만 검증합니다. 당일 가격 중복조회와 과거 반복 검증은 제거해 Spreadsheet 타임아웃 가능성을 줄였으며, 성공하면 이전 실패 표시를 정리합니다. `🛠️ 유지보수 → ▶️ 확정 평가단가·스냅샷 지금 갱신`으로 동일한 자동 경로를 즉시 점검할 수 있으며, 전체 과거 검증은 v9.67의 별도 배치 복구가 담당합니다.
- v9.69부터 앱 초기 복원은 `getBootstrap` 한 번으로 설정·거래·보유·종목코드를 함께 받습니다. 기존 4~6개 GAS 요청과 설정 시트 반복 읽기를 줄이며, 구버전 GAS에서는 기존 개별 API로 자동 대체됩니다. 적용하려면 GAS 웹앱을 새 버전으로 재배포해야 합니다.
- v9.70부터 평가가격 갱신 대상에 통화가 `USD`인 종목이 없으면 `GOOGLEFINANCE` 임시 시트 조회를 생략합니다. 국내 종목은 KRX 조회값을 사용하고 KRX 누락분은 저장된 최근 가격이력으로 보완합니다. 적용하려면 GAS 웹앱을 새 버전으로 재배포해야 하며, 실제 미국주식은 기초정보 통화를 `USD`로 등록해야 합니다.
- v9.71부터 평가가격 업데이트 완료 문구에 KRX 반영 건수, `GF 생략(USD 종목 없음)` 또는 GF 반영 건수, 최근 가격이력 보완 건수, 브라우저↔GAS 왕복시간, GAS 서버 처리시간과 60초 캐시 여부를 표시합니다. 브라우저 콘솔의 `[평가가격 조회 경로]`와 Apps Script 실행 로그의 `[price-lookup]`에서도 서버 조회값을 확인할 수 있습니다.
- v9.72부터 KRX가 휴일·반영 지연으로 이전 거래일을 반환하더라도 GAS 가격이력에 더 최신 날짜가 있으면 웹 평가단가와 기준일은 최신 이력을 사용합니다. 평가가격 갱신 시 최신 가격이력 날짜의 스냅샷도 즉시 생성·교정하며, 16:20 자동화 역시 단순 이전 평일이 아니라 실제 가격이력 최신 날짜로 스냅샷을 맞춥니다. 국내 종목만 보유한 스냅샷 계산에서는 환율 조회를 생략합니다.
- v9.73부터 웹 평가가격 조회가 하루 한 번 자동 트리거 3종을 점검하고, 16:20 평가가격·스냅샷 트리거가 누락된 경우 자동으로 다시 등록합니다. 60초 가격 캐시가 적중한 조회도 최신 가격이력 날짜의 스냅샷이 없으면 즉시 생성합니다. 웹앱과 트리거가 모두 장기간 실행되지 않는 경우에는 자동 복구 기회가 없으므로 최초 배포 시 `자동 트리거 등록`은 여전히 필요합니다.
- 배당 탭은 자동 연동 중·완료·실패 상태를 상단에 표시합니다. `배당 데이터 갱신`은 ETF/주식 외부 소스를 강제 재조회해 GAS에 저장하고, `GAS 데이터 다시 받기`는 외부 조회 없이 GAS의 마지막 정상 `DIVDATA`를 브라우저에 복원합니다.
- 배당 탭의 연동 상태·보조 문구는 다크/라이트 18개 테마에서 WCAG AA 4.5:1 이상 대비를 검사합니다. 모바일에서는 연동 버튼을 2열(360px 이하는 1열)로 배치하고 월별 그래프를 가로 스크롤로 표시해 금액 라벨이 잘리지 않도록 합니다.
- 상단 설정 모달은 `탭 순서`, `테마`, `글꼴`의 세 패널로 분리합니다. 테마 목록에는 색상 프리셋만, 글꼴 목록에는 글꼴 미리보기만 표시되며 두 설정은 선택 즉시 적용되고 GAS 설정 동기화 대상에 포함됩니다.
- 탭 순서의 ↑/↓/표시 버튼은 설정 패널 내부에서 직접 처리하며, 이동 즉시 상단 탭 순서와 localStorage를 갱신합니다. 모바일 탭 렌더러가 제공된 배포에서는 모바일 탭도 함께 갱신하며, 해당 함수가 없는 배포에서도 오류로 중단되지 않고 설정 목록과 스크롤 위치를 갱신합니다.
- 거래 추가·수정·삭제·계좌 일괄 변경은 저장 직후 `rawTrades → rawHoldings → rows` 순서로 다시 계산해 계좌별 금액에 즉시 반영하고, GAS 보유현황·거래이력 동기화는 300ms debounce 후 비동기로 실행합니다. 마지막 거래 삭제와 전량 매도도 기존 보유금액을 남기지 않습니다.
- 거래이력 행을 선택하면 문자열·숫자형 ID를 구분하지 않고 해당 거래의 매수/매도, 계좌, 종목, 수량, 날짜, 원화·외화 단가와 메모를 편집창에 복원합니다. 새 거래에서 `주식/ETF/펀드/TDF` 유형을 선택하면 현재 계좌의 종목 버튼도 해당 유형으로 즉시 필터링됩니다.
- 계좌별·종목별 `매입단가`는 가중평균을 원 단위로 반올림해 표시하되, `매입금액`은 반올림 단가×수량이 아니라 거래별 `수량×단가`의 실제 합계를 사용합니다. 기존 보유현황처럼 실제 합계가 없는 데이터만 종전 계산을 사용합니다.
- `거래 이력` 탭은 원장 입력·수정·일괄 작업 목적을 분명히 하도록 `거래 관리`로 표시합니다. `종목별 거래`는 계좌 필터와 계좌별 보유수량·매입금액 요약을 제공하며, 평균단가와 실현손익도 계좌별로 먼저 계산한 뒤 전체 합계를 만듭니다.
- v9.52부터 지수·배당 조회용 임시 시트는 요청별 고유 이름으로 만들고 `finally`에서 즉시 삭제합니다. v9.55는 생성시각을 판별할 수 있는 만료 시트와 구버전 고정 이름만 자동 삭제합니다. v9.52~v9.54에서 남은 UUID 전용 임시 시트는 실행 중인 요청과 구분할 수 없으므로 Apps Script 실행이 모두 끝난 뒤 수동 삭제할 수 있습니다.

현재가 조회 성능:

- KRX Open API의 KOSPI·KOSDAQ·ETF 및 휴일 fallback 요청은 v9.44부터 `UrlFetchApp.fetchAll()`로 병렬 처리합니다. 순차적으로 시장·날짜를 조회하던 대기시간을 줄입니다.
- 동일 날짜·동일 종목 구성의 현재가 응답은 GAS `CacheService`에 60초간 보관합니다. 앱 초기화와 새로고침이 겹쳐도 외부 API와 임시 시트 계산을 반복하지 않습니다.
- 환율은 요청 종목에 실제 포함된 외화만 조회합니다. 국내 종목만 있으면 환율용 GOOGLEFINANCE 임시 시트를 생성하지 않습니다.
- 60초 캐시는 조회 속도와 기기 간 최신성의 절충값입니다. 수동가격 저장 결과는 현재 화면에 즉시 적용되며, 다른 기기의 자동조회에는 최대 60초 후 반영될 수 있습니다.

설정·초기화 정합성:

- 앱 시작 시 GAS 설정, 기초정보, 배당, 부동산과 수동가격 복원이 끝난 뒤 현재가를 조회합니다. 원격 복원과 현재가 조회를 동시에 실행해 최신 가격이 오래된 설정 캐시에 덮이는 경쟁상태를 방지합니다.
- 일반 설정 저장은 기존 GAS 설정에 병합하며, `DIVDATA`, `LOAN`, `REAL_ESTATE`, `LOAN_SCHEDULE`, `RE_VALUE_HIST` 기존값을 보존합니다. 이 데이터는 각각 전용 저장 API와 자동 트리거만 갱신합니다.
- 소급채우기는 기준일 당일 MANUAL 가격을 최우선으로 사용하고, 없으면 기준일 이하의 최근 가격만 이월합니다. 미래 펀드·TDF NAV가 과거 스냅샷에 반영되지 않습니다.

## 공공데이터포털 배당 연동

한국 주식 배당 자동 조회는 무료 공공데이터포털 API를 우선 사용하고, 조회 실패/누락 시 기존 `GOOGLEFINANCE` fallback을 사용합니다.

- 주식과 ETF는 기초정보의 자산유형을 기준으로 배당 화면에서 구분해 표시합니다.
- 현재 공공데이터 연동은 `주식배당정보` API이므로 ETF 분배금의 완전한 자동 수집을 보장하지 않습니다. ETF는 `GOOGLEFINANCE` 조회 결과가 없으면 수동 입력을 사용합니다.

필요한 활용신청:

1. 금융위원회_KRX상장종목정보
2. 금융위원회_주식배당정보

앱에서 필요한 값:

- 공공데이터포털 인증키 1개
- 구글시트 연동 탭의 `공공데이터포털 API 인증키` 입력칸에 저장
- 앱에서 저장하면 GAS에도 동기화되어 다른 브라우저에서 설정을 복원할 수 있습니다.
- 스프레드시트 메뉴 `📊 포트폴리오 > ⚙️ 설정 > 🔑 공공데이터 API 인증키 설정`에서 저장하고, 같은 메뉴의 `API 인증키 저장 상태`에서 확인할 수 있습니다.
- Encoding 키/Decoding 키 모두 처리되도록 GAS에서 보정하지만, 포털에서 제공하는 Encoding 키 사용을 권장

동작 방식:

1. 종목코드로 KRX상장종목정보를 조회해 공식 종목명/법인번호를 찾습니다.
2. 법인번호 또는 공식 종목명으로 주식배당정보를 조회합니다.
3. 결과가 없으면 앱에 등록된 종목명으로 한 번 더 조회합니다.
4. 그래도 누락된 종목은 `GOOGLEFINANCE` 배당 조회로 fallback합니다.

배당 데이터 저장 방식:

- 자동 조회 결과와 수동 입력(ETF 포함)은 브라우저 localStorage가 아니라 연결된 GAS의 `설정` 시트 `DIVDATA` 항목에 저장됩니다.
- 수동 입력 팝업은 GAS 저장 응답을 확인한 뒤에만 완료 처리하며, 저장 실패 시 입력창을 유지하고 오류를 표시합니다.
- 새 기기나 새 브라우저에서는 `getDividendSettings`로 GAS 저장값을 다시 불러옵니다.

## KRX 가격 API 연동

- KRX Open API AUTH_KEY는 구글시트 연동 탭에서 저장하면 GAS에도 동기화됩니다.
- 스프레드시트 메뉴 `📊 포트폴리오 > ⚙️ 설정 > 🔑 KRX 인증키 설정`에서도 입력할 수 있습니다.
- 이 키는 공공데이터포털 키와 별개이며, 가격소스를 KRX 우선으로 사용할 때 종가 조회에 사용됩니다.

## 종목코드/공식명 관리

- 신규 종목 추가 시 종목코드만 입력해도 공공데이터포털 키가 저장되어 있으면 공식 종목명 조회를 시도합니다.
- 이미 등록된 종목은 기초정보의 `KRX 공식명 반영` 버튼으로 기존 종목코드들을 공식명 기준으로 보정할 수 있습니다.
- 공식명 보정 시 거래이력, 보유현황, 배당 설정 키도 함께 이동되도록 처리되어 있습니다.

## 보존 중인 문서 정책

- 오래된 리뷰/임시 체크리스트 문서는 저장소에서 제거했습니다.
- 현재는 운영에 필요한 이 파일(`DEPLOYMENT.md`)만 Markdown 문서로 유지합니다.
- 배포 절차, GAS 반영 절차, 공공데이터 API 사용 방식이 바뀌면 이 파일을 같이 업데이트합니다.

## 2026-09-02 계좌 증권사 코드·웹 자산 구조

- 계좌 마스터는 기존 `accountId`와 `taxType`을 보존하면서 `brokerCode`를 별도 저장합니다. 기존 기준 계좌명은 최초 마이그레이션에서만 정확 일치로 변환하며 이후 계좌명 변경으로 증권사를 다시 추론하지 않습니다.
- 알 수 없는 증권사 또는 세제유형은 `UNCLASSIFIED`로 유지되고 계좌 관리 화면에서 확인 필요 배지로 표시됩니다.
- JSON schema v7 백업은 과거 `broker` 누락/빈 값 백업을 계속 읽고 신규 백업에는 `brokerCode`를 포함합니다. GAS URL, 접근 토큰, API 키는 계속 제외합니다.
- 브라우저 접근 토큰 저장 위치는 정적 GitHub Pages 호환을 위해 `localStorage`로 유지합니다. 별도 인증 프록시 없이는 XSS·악성 확장프로그램 위험을 제거할 수 없으므로 저장 위치 전환은 적용하지 않았습니다.
- 투자계획 뷰는 `views_plan.js` 오케스트레이터와 기능별 `views_plan_*.js`로 분리했습니다. 로드 순서는 공용 상태/오케스트레이터 → 현황 → 내보내기 → 목표비중/매수 → 세금 → 은퇴 → 시뮬레이션입니다.
- 자체 CSS/JS는 `20260902-5` 캐시 버전을 사용하며 서비스워커 precache도 같은 버전입니다. XLSX는 기존 엑셀 내보내기의 즉시 동작과 오프라인 호환을 보존하기 위해 이번 변경에서 지연 로드하지 않았습니다.


## 2026-09-02 CSS 분리 1단계

- `base.css`의 투자계획·은퇴 전용 그리드, 현금흐름 표, 타이포그래피 보정과 반응형 규칙을 `styles/pages/plan.css`로 이동했습니다.
- 공통 Pretendard 선언, 글자 크기·굵기·UI 크기 토큰과 공통 컴포넌트 규칙은 변경하지 않았습니다.
- `check:typography`는 전체 CSS를 합쳐 기존 시각 계약을 검사하면서 `base.css`에 투자계획 전용 선택자가 다시 들어오지 않는지도 확인합니다.
- 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-5`로 통일했습니다.


## 2026-09-02 CSS 분리 2단계

- 상단 작업 영역, 현재가 상태, 도구 버튼 그룹, 주요 탭 내비게이션의 기본·모바일 레이아웃 규칙을 `styles/layout.css`로 이동했습니다.
- 요약 카드·테이블·테마·타이포그래피처럼 여러 화면이 공유하는 컴포넌트 규칙은 `base.css`에 유지했습니다.
- `check:typography`는 `layout.css`가 핵심 레이아웃 선언을 소유하고 `base.css`에 기본 `.action-bar` 선언이 재유입되지 않는지 검사합니다.
- 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-5`으로 통일했습니다.

### 상단 업데이트 버튼 상태 표시 보정 (2026-09-02)

- 업데이트 실행 중 버튼 안에 아이콘만 중복되어 보이지 않도록 버튼 문구를 `업데이트 중`으로 유지하고, 기존 지구본 아이콘에 회전 상태를 적용했습니다.
- 완료·오류 후에는 `aria-busy`를 제거하고 기존 `업데이트` 문구로 복원합니다. 글꼴·글자 크기·버튼 높이는 변경하지 않았습니다.
- 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-5`로 통일했습니다.

### 업데이트 결과 영역·손익 비교지수 표시 보정 (2026-09-02)

- 상세 업데이트 결과 영역이 날짜·업데이트 카드의 가용 폭을 넘어가지 않도록 flex 축소와 줄바꿈 규칙을 추가했습니다.
- 손익 그래프 비교지수의 내부 코드값은 유지하면서 표시 문구를 `KOSPI`, `S&P500`, `DOW`, `NASDAQ`, `NASDAQ100`으로 변경했습니다.
- 글꼴·글자 크기·글자 굵기와 버튼 높이는 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-5`로 통일했습니다.

## 2026-09-02 CSS 분리 3단계

- 배당 요약 카드, 월 필터, 월별 차트·금액표, GAS 연결 상태 및 배당 전용 반응형 규칙을 `styles/pages/dividend.css`로 이동했습니다.
- 공통 타이포그래피 토큰과 여러 화면이 공유하는 선택자 그룹은 `base.css`에 유지했습니다.
- 글꼴·글자 크기·글자 굵기와 기존 breakpoint 값은 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-6`으로 통일했습니다.

## 2026-09-02 CSS 분리 4단계

- 부동산 요약·상세·주담대 그리드와 부동산 편집기 반응형 규칙을 `styles/pages/asset.css`로 이동했습니다.
- 공통 카드와 입력 요소 스타일은 `base.css`에 유지했으며, 기존 4열·3열·2열·1열 breakpoint 값을 변경하지 않았습니다.
- 글꼴·글자 크기·글자 굵기는 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-7`로 통일했습니다.

## 2026-09-02 CSS 분리 5단계

- 손익 그래프 비교지수 버튼과 주간·월간 기간 버튼의 전용 스타일을 `styles/pages/history.css`로 이동했습니다.
- 기존 버튼 크기, 활성·초기화 상태, 사용자 UI 크기 토큰 연결을 그대로 유지했습니다.
- 글꼴·글자 크기·글자 굵기는 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-8`로 통일했습니다.

## 2026-09-02 CSS 분리 6단계

- 거래 관리 요약 카드·선택 표시·매수/매도 배지와 거래 편집기의 유형 버튼 및 모바일 규칙을 `styles/pages/trade.css`로 이동했습니다.
- 여러 화면이 공유하는 버튼·카드 토큰 연결은 `base.css`에 유지했으며 기존 크기와 breakpoint 값은 변경하지 않았습니다.
- 글꼴·글자 크기·글자 굵기는 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-9`로 통일했습니다.

## 2026-09-02 CSS 분리 7단계

- 공통 토스트 알림과 계좌 증권사 선택·검토 배지를 `styles/components.css`로 이동했습니다.
- 계좌 입력 컴포넌트는 `layout.css`에서, 토스트 컴포넌트는 `base.css`에서 제거했으며 기존 속성값을 그대로 유지했습니다.
- 글꼴·글자 크기·글자 굵기는 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-10`으로 통일했습니다.

## 2026-09-02 CSS 분리 8단계

- 상단 영역의 768px·600px·480px 반응형 규칙을 `styles/responsive.css`의 단일 breakpoint 블록으로 통합했습니다.
- 업데이트 버튼을 오른쪽 도구 버튼과 동일한 52px 아이콘·문구 구조로 맞추고, 모바일에서는 양쪽 모두 44px을 사용합니다.
- 업데이트 상세 결과는 내용 너비만 사용하되 최대 680px에서 줄바꿈되도록 해 불필요한 오른쪽 빈 공간을 줄였습니다.
- 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-11`로 통일했습니다.

## 2026-09-02 CSS 분리 9단계

- 색상, 타이포그래피, 간격, 반지름, 컨트롤 높이 및 그림자 변수를 `styles/tokens.css`로 이동했습니다.
- 최상위 색상·그림자·글꼴·타이포그래피 `:root` 블록은 선언 순서와 값을 그대로 유지하고 `base.css`에서는 제거했습니다. 반응형 범위 안의 토큰 재정의는 적용 순서 보존을 위해 기존 위치에 유지했습니다.
- Pretendard, 글자 크기·굵기 및 UI 크기별 토큰 값은 변경하지 않았으며, 자체 정적 자산과 서비스워커 캐시 버전은 `20260902-13`로 통일했습니다.

### 모바일 상단 작업 영역 겹침 보정 (2026-09-02)

- 600px 이하에서는 상단 작업 영역을 단일 열 grid로 고정해 날짜·업데이트·결과 영역과 도구 버튼 행이 서로 겹치지 않도록 했습니다.
- 도구 버튼 그룹은 별도의 가로 스크롤 행으로 배치하고 각 작업 그룹의 폭이 줄어들지 않도록 했습니다.
- 480px 이하에서도 설정 그룹을 강제로 새 줄에 늘리지 않으며, 정적 자산과 서비스워커 캐시 버전은 `20260902-13`으로 통일했습니다.

## 2026-09-03 CSS 최종 정리

- `base.css`에는 reset, 기본 폼, Pretendard 글꼴 연결 및 문서 배경만 유지했습니다.
- 나머지 공통 화면·컴포넌트·유틸리티 선언은 기존 선언 순서를 유지한 채 `components.css`로 이동해 렌더링 우선순위 변화를 최소화했습니다.
- 기존 CSS에 남아 있던 불필요한 닫는 중괄호 한 개를 제거하고, `base.css` 소유 범위가 다시 확장되지 않도록 정적 검사를 추가했습니다.
- 글꼴, 글자 크기, 굵기 및 UI 크기 값은 변경하지 않았으며 자체 정적 자산과 서비스워커 캐시 버전은 `20260903-1`로 통일했습니다.
### 시장데이터 provider 전환 준비

### 시장데이터 가격 경로·거래 Corporate Action 보강 (2026-09-16)

- 주식·ETF 현재가·과거 종가의 운영 fallback은 Toss → KRX/기존 공공데이터 → 저장된 확정 가격이력입니다. 가격 provider 함수와 UI 현재가 경로에서 GOOGLEFINANCE를 호출하지 않습니다.
- Toss 실패·부분 누락은 0이나 빈 값으로 저장하지 않고 기존 정상 가격·갱신시각을 유지하며, 화면에는 미조회/stale/error 상태를 표시합니다.
- 현재가 polling은 60초 간격 화면 갱신 전용이며 `persist=false`로 가격이력·Snapshot을 쓰지 않습니다. `document.hidden`일 때 중단하고 다시 보이면 즉시 한 번 확인합니다.
- 거래 입력·GAS 원장에 `split`·`reverse_split`, `ratio`, `fractionalCash`를 연결했습니다. 분할·병합은 매수/매도가 아니며 기본 현금흐름은 0, 총 취득원가는 유지하고 병합 단주는 실제 처리수량·현금정산을 수기 입력합니다.

- `diagnoseTossMarketData` read-only 점검 route가 환율(USD/KRW), KR/US 시장 캘린더, KOSPI/KOSDAQ 지수 현재가·일봉을 호출해 endpoint별 성공 여부·HTTP status·비민감 request/reference/edge 식별자·건수·소요시간만 반환합니다. 원문 응답·토큰·Authorization header·인증정보는 반환하거나 로그에 남기지 않으며 시트/Snapshot을 쓰지 않습니다.
- OpenAPI의 Market Indicators 지원 심볼은 `KOSPI`, `KOSDAQ`, `KR_BOND_2Y/3Y/5Y/10Y/20Y/30Y`입니다. `S&P500`, `DOW`, `NASDAQ`, `NASDAQ100`은 지원 목록에 없어 기존 정상 지수 공급원을 유지합니다. ETF proxy는 사용하지 않습니다.

- v9.107부터 GAS의 `getPrices`는 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`이 Script Properties에 모두 있을 때 Toss `GET /api/v1/prices`를 최대 200종목 batch로 우선 호출합니다. 과거 종가는 `/api/v1/candles?interval=1d&adjusted=false`와 `nextBefore`를 사용합니다.
- Toss OAuth access token은 Script Cache에 만료 60초 전까지 캐시하고, refresh token은 사용하지 않습니다. 429 및 5xx는 `Retry-After` 우선, 없으면 지수 백오프+jitter로 최대 4회 재시도합니다.
- Toss 키가 없거나 호출 실패하면 기존 KRX·저장된 확정 가격이력 경로를 유지합니다. Toss 응답으로 기존 확정 NAV·배당·스냅샷을 삭제하지 않습니다.

- `src/web/domain/market/market_data_provider.js`는 Toss 및 기존 공급원 응답을 `marketDate`, `symbol`, `market`, `closePrice`, `currency`, `source`, `priceType=REGULAR_CLOSE`, `status`, `fetchedAt`로 정규화합니다.
- Portfolio와 Briefing provider는 이 파일의 공통 contract 정규화를 사용합니다. Briefing의 당일 한국 지수 일봉은 `MORNING`에는 `PARTIAL`로 유지하고 명시적인 `KRX_FINAL`/`AFTER_FINAL`/`EVENING` checkpoint에서만 `FINAL`/`REGULAR_CLOSE`로 승격합니다. Yahoo 당일 값은 같은 checkpoint에서도 `DELAYED`로 유지합니다. `sourceDate`, `fallback`, `observedAt`, `receivedAt`, `timestampQuality`는 원장 병합 없이 각 저장 경로에 전달합니다.
- 삼성전자·SK하이닉스는 기존 `getPrices`의 화면 현재값과 같은 날짜 `getPriceHistory`의 KRX 확정값을 함께 확인합니다. Toss/현재값만 있으면 `PARTIAL`이며, KRX 확정 가격이력만 정규장 `FINAL` 관측으로 `MARKET_MASTER`에 저장합니다.
- 브라우저 runtime은 검증된 KIS `H0MFCNT0` raw frame을 `K200_NIGHT` 관측으로 저장하는 진입점을 제공합니다. `NIGHT_FINAL` checkpoint가 명시된 검증 frame만 `FINAL`이며 그 외 야간 frame은 `LIVE`입니다. 실제 WebSocket 수집기와 KIS credential/schema registry는 배포 환경에서 별도로 제공해야 합니다.
- 자동 초기 동기화는 `MarketBriefingMaster.CHECKPOINT_TIME` 기반 단일 resolver로 현재 KST checkpoint를 결정해 collector에 전달합니다. KRX 마감 gate는 당일 `tradingDate`의 확정값만 허용하며, Yahoo KOSPI200은 당일 `DELAYED` 보조값으로 허용하되 readiness warning에 남깁니다.
- GAS v9.132는 기존 14개 `MARKET_MASTER` core 컬럼 뒤에 `currency`, `source_date`, `fallback`을 추가합니다. 기존 시트는 누락 header만 뒤에 채우고 기존 행과 dedup key를 재작성하지 않으며, 빈 legacy metadata는 `null`/`false`로 조회합니다.
- GAS v9.133부터 마감 계열 checkpoint의 KOSPI/KOSDAQ 요청은 6시간 장중 cache를 우회해 Toss 일봉을 새로 조회하고 `fresh + confirmedClose` metadata를 반환합니다. collector는 이 명시적 metadata가 있는 당일 값만 `FINAL/REGULAR_CLOSE`로 승격합니다.
- KIS 야간 관측은 `appendMarketBriefingObservations` 성공을 commit point로 사용하며, 서버 저장 실패·POST 함수 부재·quarantine 시에는 localStorage에 병합하지 않습니다.
- GAS v9.134는 Toss indicator daily candle의 provider timestamp를 `observedAt` 후보로 보존하지만, 현재 확인된 응답 계약에는 정규장 종가 확정 status/finality가 없어 fresh 조회도 `confirmedClose=false`로 반환합니다. 따라서 당일 KOSPI/KOSDAQ은 확정 근거가 추가되기 전까지 `PARTIAL`로 유지되고 KRX final gate를 통과하지 않습니다.
- 삼성전자·SK하이닉스의 exact-date trusted 가격이력은 기존 `KRX_FINAL` session close 정의로 `observedAt`을 기록합니다. 실제 API 수신시각은 별도 `receivedAt`으로 유지하며 current/INDICATIVE, untrusted 또는 이전 거래일 이력에는 close 시각을 부여하지 않습니다.
- GAS v9.135는 16:00 KST 이후에만 기존 KRX AUTH_KEY로 공식 `idx/kospi_dd_trd`·`idx/kosdaq_dd_trd`를 조회합니다. `BAS_DD`가 요청일과 정확히 같고 `IDX_NM`이 `코스피`/`코스닥`, `CLSPRC_IDX > 0`인 행만 `KRX_OFFICIAL` 확정 종가로 사용하며 `observedAt`은 정규장 close인 15:30, `receivedAt`은 실제 조회시각으로 분리합니다. 공식 행이 없으면 Toss 보조값은 `PARTIAL`로 남아 마감 gate가 `NOT_READY`를 유지합니다.
- GAS v9.136은 KRX 공식 지수 fetchAll/network 오류를 격리해 Toss PARTIAL과 Yahoo 결과를 그대로 반환하고 `errors.KRX_OFFICIAL`에 원인을 남깁니다. 실제 producer가 없는 flow/breadth/after-turnover는 checkpoint warning으로만 보고하며, 브라우저 provider sync가 성공하고 readiness가 publishable일 때만 immutable snapshot 저장을 시도합니다.
- 별도 16:00 scheduler/trigger는 없으므로 브라우저가 열리지 않은 상태의 정시 수집·release는 운영 자동화 의존사항으로 남습니다.
- Toss 공식 endpoint·인증·응답 필드는 공식 사양을 확인한 뒤 GAS 서버 설정으로 주입해야 합니다. 코드에는 Client Secret 또는 추측한 endpoint를 저장하지 않습니다.
- `resolveMarketPrice`는 Toss 정상값을 우선하고, 누락 시 기존 공급원·저장 확정값을 fallback으로 선택합니다. 모든 후보가 이상하면 `null`을 반환하여 기존 가격을 지우지 않습니다.
- 휴장일은 `carryForwardRegularClose`로 직전 `CONFIRMED` 정규장 종가를 구분해 carry-forward할 수 있습니다. 분할·병합 계산은 총 취득원가를 유지하며 병합 단주는 자동 반올림하지 않습니다.
- GAS `UrlFetchApp`은 Google IP range pool에서 실행되므로 Toss 콘솔 허용 IP 미등록 시 OAuth/API가 403으로 차단될 수 있습니다. 고정 IP proxy는 구현하지 않으며, [Google UrlFetchApp 안내](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)와 Toss 콘솔 허용 IP 정책을 배포 전에 확인해야 합니다.
- Secret이 이미지·메신저·문서 등에 노출된 경우 해당 credential은 사용하지 말고 Toss 콘솔에서 재발급한 뒤 GAS Script Properties에만 설정합니다. 문서·예시·로그·PR에는 실제 값이나 토큰을 기록하지 않습니다.

## 비교지수 provider 업데이트 (2026-09-16)

- `getBenchmark(s)`의 KOSPI·KOSDAQ은 Toss 공식 Market Indicator `prices`/`candles(interval=1d)`를 사용하고, 동일 기간 결과를 Script Cache에 저장합니다. Toss 실패·빈 응답은 기존 성공 캐시를 우선 보존하며 0으로 저장하지 않습니다.
- 미국 `SP500(^GSPC)`, `NASDAQ(^IXIC)`, `NASDAQ100(^NDX)`, `DOW(^DJI)`는 Yahoo Finance chart JSON endpoint를 사용합니다. 현재값·전일 종가·등락률은 60초 캐시하며, 일별 시계열은 기간 캐시를 사용합니다. 렌더링마다 직접 호출하지 않습니다.
- Yahoo endpoint(`query1.finance.yahoo.com/v8/finance/chart`)는 비공식 인터페이스이며 계약·응답 변경, rate limit, 네트워크 차단 위험이 있습니다. 장애 시 GOOGLEFINANCE로 자동 전환하지 않고 기존 성공 캐시/빈 조회 오류를 유지합니다.
- 이 변경에서 GOOGLEFINANCE를 제거한 범위는 위 4개 미국 지수와 KOSPI·KOSDAQ 비교지수 경로입니다. 환율·배당·종목명 등 다른 기존 기능의 GOOGLEFINANCE 사용은 범위 밖이며 유지됩니다.
- GAS `UrlFetchApp`의 Google IP range pool 제약으로 Yahoo 또는 Toss가 403을 반환할 수 있습니다. 허용 IP 설정과 실제 응답을 배포 후 확인하며, proxy는 추가하지 않습니다.

### Toss 인증정보 설정 UI

- 웹앱 `설정 → 구글시트 연동`의 Toss 영역에서 Client ID와 새 Client Secret을 입력하고 저장합니다. 저장 성공 후 입력칸은 즉시 비우며, 브라우저 저장소·설정 시트·HTML 초기 데이터에는 원문을 남기지 않습니다.
- 스프레드시트 `📊 포트폴리오 → ⚙️ 설정` 메뉴에서도 `Toss Client ID 설정`, `Toss Client Secret 설정`, `Toss 설정 상태`, `Toss API read-only 진단`, `Toss 설정 삭제`를 사용할 수 있습니다. 빈 입력은 기존 값을 유지합니다.
- 서버 응답에는 Client ID 마스킹값, Secret 설정 여부, 마지막 진단 시각·성공 여부·오류 코드만 포함합니다. 삭제 확인 시 Toss Script Properties와 Toss token cache 및 Toss 진단 상태만 삭제하고 다른 API 설정과 Portfolio 시트는 건드리지 않습니다.
- 403은 Toss WTS Open API 허용 IP 미등록으로 안내합니다. IP는 GAS에서 설정하지 않고 Toss 콘솔에 등록하며, GAS `UrlFetchApp`은 Google IP range pool에서 실행됩니다.

## GAS v9.109: 원자료 기반 일별 Snapshot 재생성

- `rebuildDailySnapshots(from, to)`는 거래일만이 아니라 가격이력·거래·펀드 NAV·ETF 분배금·기존에 확인된 환율이력의 날짜와 그 범위의 평일을 후보로 구성합니다. 오늘은 제외하고, 전일 확정값을 포함합니다. 주말 거래·배당일은 원자료 날짜가 있으면 별도 후보로 남깁니다.
- 계산 입력은 거래원장, 종목코드, 가격이력, `펀드기준가격`, 검증된 환율이력뿐입니다. 기존 `스냅샷`은 signature 비교용으로만 읽습니다. 대상 날짜별로 계산 성공 후 불일치할 때만 upsert하며, 실패·환율 미확인·가격 누락 날짜와 기존 행은 보존합니다.
- 거래이력은 기존 9열과 신규 11열을 모두 읽고 `SPLIT`/`REVERSE_SPLIT`의 비율을 적용합니다. 분할·병합은 총 취득원가와 현금흐름을 바꾸지 않으며, 병합 단주는 자동 반올림하지 않습니다.
- F00001/F00002/F00003은 `펀드기준가격`의 평가금액과 `가격공시일`을 사용하며, 날짜별 좌수와 NAV carry-forward를 유지합니다. 해당 NAV 또는 가격이 없으면 기존 Snapshot을 지우지 않고 해당 날짜를 보류합니다.
- 현재 운영 코드에는 자동으로 기록되는 과거 환율 source가 없습니다. `환율이력`은 헤더가 `날짜|통화|환율`인 기존 운영 시트가 실제로 존재할 때만 읽는 read-only adapter이며, 시트가 없거나 구조가 다르면 현재 환율로 대체하지 않습니다. 새 시트를 만들거나 현재 환율을 과거에 주입하지 않습니다.
- Snapshot의 손익은 평가금액−매수원금 기준입니다. 화면의 현금흐름 조정 수익률 지수는 기존 BUY/SELL만 현금흐름으로 분리하며, TWR은 현금·배당·입출금 원천이 완전 연결되지 않아 이번에 도입하지 않았습니다.
- 비교지수는 Toss 확정 일봉 KOSPI/KOSDAQ 및 Yahoo의 비공식 확정 일봉을 Snapshot에 저장하지 않고 그래프 요청 시 cache로 조회합니다. 실시간 current 값은 전일 확정 Snapshot과 분리합니다.
- 그래프에는 `확정 기준 YYYY-MM-DD`를 표시하고, 현재가 polling은 `화면만 반영`으로 별도 표시합니다. GAS v9.109 및 정적 웹 재배포가 필요합니다.

### 시트 inventory

| 시트명 | 역할 | read 함수 | write 함수 | 현재 사용 | source of truth/파생 | 신규 구조 사용 | LEGACY 후보 | 삭제 전 확인 |
|---|---|---|---|---|---|---|---|---|
| 종목코드 | 종목 master·통화·시장 | `getCodeItems` | `handleSyncCodes`/`initSheet` | 사용 | 원천 | 사용 | 없음 | 코드·통화·시장 |
| 거래이력 | BUY/SELL/SPLIT/REVERSE_SPLIT 원장 | `handleGetTrades`/`calcHoldingsAtDate` | `handleSyncTrades` | 사용 | 원천 | 사용 | 없음 | 11열 비율·단주 |
| 가격이력 | 날짜별 확정·수동 가격 | `getPriceHistoryRow`/`getLatestPriceHistoryEntries` | `batchUpsertPriceHistory`/`handleSaveManualPrice` | 사용 | 원천 | 사용 | 없음 | source·입력시각 |
| 펀드좌수 | 적용일별 펀드 좌수 | `_readFundUnits` | `handleSaveFundUnits` | 사용 | 원천 | 사용 | 없음 | F00001~3 |
| 펀드기준가격 | NAV·공시일·평가금액 | `_storedFundNavRows`/`_getFundEvaluationAtDate` | `_refreshFundValuations`/`handleImportFundNav` | 사용 | 원천 | 사용 | 없음 | sourceDate·provider |
| ETF분배금이력 | SEIBro 분배금 확정 이력 | `_readEtfDividendHistory` | `_writeEtfDividendHistory` | 사용 | 원천 | 날짜 후보만 사용 | 없음 | SEIBro/MANUAL |
| 설정 | DIVDATA·앱 설정 | `_readSettingsMap` | `_writeSettingsMap` | 사용 | 원천/설정 | 배당 날짜 후보 | 없음 | DIVDATA |
| 스냅샷 | 평가 결과 materialized view | `_readSnapshotRowsByDate`/`handleGetHistory` | `writeSnapshotRows`/`handleSaveSnapshot` | 사용 | 파생 | 비교·upsert 대상 | 구형 10/11열 행 | 삭제·초기화 금지 |
| 환율이력 | 운영자가 별도 확보한 과거 환율 adapter | `_getHistoricalExchangeRates` | 없음 | 현재 미확인 | 확인 전에는 원천 아님 | 선택적 read-only | 후보 자체를 새로 만들지 않음 | 실제 시트·헤더·출처 |
| 종가·보유현황 | 현재/호환 보조 시트 | 기존 read/write 경로 | 기존 함수 | 사용 | 파생/호환 | 직접 재생성 입력 아님 | 운영 확인 후 판단 | 데이터 대조 |

위 inventory의 시트는 이번 변경에서 삭제하지 않습니다. `환율이력`이 실제 운영에 없으면 외화 Snapshot 재생성을 보류하는 것이 정상 동작입니다.

## GAS v9.110: getPrices 단계별 관측성

- 기존 `serverElapsedMs`는 유지하고, `priceLookup.timings`에 `setup`, `codeItems`, `initialPriceHistory`, `tossToken`, `tossPricesHttp`, `krx`, `recentHistory`, `snapshot`, `other`, `finalize`를 추가했습니다. 모든 값은 GAS `Date.now()` 기반이며 음수로 내려가지 않습니다.
- Toss는 기존 단일 batch 요청을 유지합니다. KRX는 `krxExecuted`, `krxElapsedMs`, `krxResultCount`로 실행 여부·소요시간·결과건수를 구분합니다. 추가 HTTP/Spreadsheet read, 종목별 호출·타이머는 없습니다.
- `recentHistoryFallbackItems`는 최종적으로 저장된 최근 확정 가격이력으로 보완된 종목만 `code`, `name`, `priceDate`로 반환합니다. Toss/KRX 정상 결과를 중복 표시하지 않으며, 0건도 안전한 빈 배열로 처리합니다.
- 웹의 기존 상태 chip을 유지하면서 `최근이력 N건`은 fallback 종목 목록을, `GAS Nms`는 단계별 timing을 탭/클릭으로 표시합니다. 모바일에서는 상태 영역을 눌러 상세를 확인할 수 있습니다.
- `persist=false`의 가격이력·Snapshot 무쓰기와 `persist=true` 기존 저장 정책은 변경하지 않았습니다.
- GAS 재배포 버전은 9.117, 브리핑 runtime/bootstrap 자산 버전은 20260921-1, 나머지 정적 자산 및 Service Worker cache는 20260921-2입니다. 실제 병목 판단은 배포 후 timing 값을 확인한 뒤 수행하며 이번 변경 자체는 성능 최적화가 아닙니다.


## v9.111 브리핑 지수 provider
- Yahoo 비공식 EOD 경로에 SOX(`^SOX`)와 VIX(`^VIX`)를 추가했습니다. SOX/VIX는 브리핑 collector에서 실제 관측일을 보존합니다.
- VIX의 1차 원천은 CBOE이며, 현재 Yahoo 경로는 보조 provider입니다.
- GAS와 정적 웹의 기대 버전을 9.111로 함께 올렸으므로 병합 후 GAS/웹 재배포가 필요합니다.

## v9.112 브리핑 지수 라우팅 수정
- v9.111에서 provider symbol은 추가됐지만 `_benchmarkSymbolMap()` 허용 목록 누락으로 `getBenchmarks`가 SOX/VIX를 필터링하던 문제를 수정했습니다.
- GAS/웹 기대 버전을 9.112로 동기화했습니다.

## v9.113 USD/KRW 브리핑 조회
- collector가 이미 호출하던 `getExchangeRateHistory` action을 GAS에 실제 구현했습니다.
- 신규 외부 환율 provider를 만들지 않고 기존 운영 `환율이력` 시트의 `날짜|통화|환율` 확정 행만 기간 조회합니다.
- 시트 부재/스키마 불일치/기간 데이터 없음은 빈 history와 명시 상태를 반환하며 현재 환율로 대체하지 않습니다.

## v9.114 KOSPI200 보조 EOD provider
- KOSPI200은 공식 Toss identifier를 추측하지 않고 Yahoo `^KS200` 일봉을 보조 경로로 연결합니다.
- 실제 관측일을 보존하며 Yahoo 비공식/지연 EOD 경로로 표시합니다.

## v9.115 MARKET_MASTER 서버 영속화
- 인증된 POST `appendMarketBriefingObservations`가 `MARKET_MASTER` 시트에 관측값을 append-only 저장합니다.
- `(series_id,trading_date,session,observed_at,received_at)` 동일 관측은 중복 저장하지 않습니다.
- GET `getMarketBriefingMaster`로 기간/series별 원장을 조회할 수 있습니다.
- provider가 observed timestamp를 주지 않으면 `observed_at`을 비워 두고 `RECEIVE_ONLY`로 저장합니다.
- 브라우저 localStorage만으로는 예약 브리핑 간 연속성이 보장되지 않으므로, 이 API가 서버측 연속 원장의 기반입니다.

## v9.116 MARKET_MASTER 검증 및 MARKET_SNAPSHOTS 연속성

- `received_at`과 선택적 `observed_at`은 timezone이 포함된 ISO timestamp만 허용하며 서버에서 UTC ISO로 정규화합니다. `observed_at > received_at` 행은 저장하지 않고 `rejected` 및 사유별 건수로 반환합니다.
- `timestamp_quality`와 `lag_seconds`는 클라이언트 값을 신뢰하지 않습니다. 저장 시와 기존 시트 조회 시 모두 정규화 timestamp로 재계산하고, 유효하지 않은 기존 행은 `invalid` 건수로 구분해 제외합니다.
- `MARKET_SNAPSHOTS`는 `(trading_date, checkpoint)` 최초 1건만 저장하는 불변 시트입니다. checkpoint별 `as_of` KST 기준시각, values/scenario JSON을 서버에서 검증하며 손상된 행을 빈 snapshot으로 바꾸지 않습니다.
- `getMarketBriefingSnapshots`로 서버 snapshot/scenario를 local runtime에 hydrate합니다. snapshot 조회만 실패한 경우 기존 MARKET_MASTER/provider 동기화는 계속하고 `snapshotSync.status=error`로 구분합니다.
- access token 사용 시 동일 조회가 인증 POST로 전환되므로 `getExchangeRateHistory`, `getMarketBriefingMaster`, `getMarketBriefingSnapshots`를 POST read-action 목록에도 연결했습니다.
- checkpoint 생성 후에는 `releaseAndPersist`를 사용해 로컬 불변 snapshot과 서버 저장을 연결합니다. 병합 후 GAS 9.116과 정적 웹을 함께 재배포해야 합니다.

## v9.117 F00001 NAV 및 스냅샷 백업 수정

- 한화 기준가격 API의 `startDate` 제외 경계를 반영해 실제 누락일 전날부터 조회하며, 원래 누락 범위의 날짜만 저장합니다. 조회 실패·범위 밖 응답은 기존 데이터에 쓰지 않습니다.
- 스냅샷 쓰기 전 백업은 `sheet.copyTo()` 대신 새 백업 시트에 기존 값을 복사합니다. 백업이 완료되지 않으면 원본 스냅샷 쓰기도 중단합니다.
- 병합 후 GAS 9.117과 정적 웹을 함께 재배포하고, F00001 2026-09-16·2026-09-18 복구 및 기존 수동 스냅샷 보존을 확인해야 합니다.

## v9.118 펀드 NAV 증분 처리·누락 현황·손익 연결

- F00001/F00002/F00003 복구는 날짜별 NAV·평가금액·가격이력·Snapshot 상태를 한 번 읽어 비교하고, 전체가 정상인 날짜를 Snapshot 재구성 전에 제외합니다. 요청 chunk는 GAS의 32일 제한에 맞춰 불필요한 7일 왕복을 줄입니다.
- NAV만 존재하거나 가격이력·Snapshot이 빠진 부분 완료 상태는 필요한 파생 단계만 보완합니다. 확정 NAV가 도착하면 기존 `FUND_NAV_CARRY*`를 갱신하며 `MANUAL` 가격·Snapshot과 다른 자산은 보존합니다.
- 좌수 설정을 열 때 외부 API 없이 최신 확정 NAV, 입력 필요일, 임시 평가일, 정상 입력일, 비공시·0좌 제외 현황을 표시합니다. 누락 날짜와 손익그래프 경고에서 해당 수기입력 화면으로 이동할 수 있습니다.
- 운영 반영에는 GAS 9.118과 정적 웹/Service Worker `20260921-3`을 함께 재배포해야 합니다. 실제 `stageElapsedMs` 전후값과 운영 F00001/F00002/F00003 데이터 연결은 배포 후 확인합니다.

## GAS v9.126 후속 오류 수정 배포 (2026-09-23)

- 해외 주식·ETF 과거 가격은 Yahoo Finance 일봉에서 요청 거래일의 regular close가 정확히 확인된 경우에만 `YAHOO_REGULAR_CLOSE`로 저장합니다. 현재가나 다른 날짜 값으로 대체하지 않습니다.
- Toss `INDICATIVE` 현재가는 화면 표시에는 유지하되 가격이력 및 확정 스냅샷 쓰기 대상에서 제외합니다.
- 백업 Properties 재사용은 레지스트리 원본 관계, 실제 백업 시트 존재 및 내용 서명이 모두 일치할 때만 허용합니다.
- GAS 코드와 웹 기대 버전이 모두 `9.126`이므로 GAS 웹 앱과 정적 웹을 함께 재배포해야 합니다.

## GAS v9.139 손익 정합성·펀드 좌수 초기 조회 개선 (2026-09-30)

- 손익 그래프는 `SOURCE_INCOMPLETE`·`UNCHECKED`를 저장 Snapshot 오류로 간주하지 않으며, Snapshot 서명이 같은 날짜의 진단 결과는 브라우저 세션에서 재사용합니다.
- 펀드 좌수 초기 조회는 Snapshot 전체를 읽지 않고 완료 날짜 목록 대신 건수만 반환합니다. `performance`에서 조회 단계와 PRICE_HISTORY/SNAPSHOT 읽기 행 수를 확인할 수 있습니다.
- 운영 반영에는 GAS v9.139와 정적 웹을 함께 재배포해야 합니다.

## GAS v9.140 Snapshot 정합성 cache 원자료 revision (2026-09-30)

- 거래이력·가격이력·펀드 NAV·펀드 좌수·환율·종목코드가 변경되면 정합성 원자료 revision을 갱신하며, 웹은 revision이 일치하는 진단 결과만 재사용합니다.
- 운영 반영에는 GAS v9.140과 정적 웹을 함께 재배포해야 합니다.

## GAS v9.141 Snapshot·펀드 복구 후속 보강 (2026-09-30)

- Snapshot 상세행 쓰기와 직접 편집도 정합성 revision을 갱신하고, `PRICE_SUSPICIOUS`를 성과 계산에서 제외합니다.
- 펀드 좌수 현황은 MANUAL 대표 가격을 우선하며 복구 결과는 건수 우선·상세 lazy 표시로 변경됩니다.
- 운영 반영에는 GAS v9.141과 정적 웹 cache `portfolio-cache-20260930-3`을 함께 재배포해야 합니다.

## GAS v9.142 날짜·영향범위 정합성 cache invalidation (2026-10-01)

- Snapshot은 해당 날짜, 가격·환율·거래·펀드 NAV·좌수는 carry/보유 상태를 고려해 최초 영향일부터 이후 날짜, 종목 매핑은 전체 범위를 invalidate합니다.
- 백업 생성과 revision 갱신을 분리하고 실제 원자료 쓰기 성공 후에만 revision을 확정합니다.
- 운영 반영에는 GAS v9.142와 정적 웹 cache `portfolio-cache-20261001-1`을 함께 재배포해야 합니다.

## GAS v9.143 정합성 revision 장기 운영 안전성 (2026-10-01)

- revision state는 직렬화 7,000자 이내로 compact하고 제거되는 date/range revision을 `all`로 승격해 stale cache를 방지합니다.
- legacy/malformed property는 전체 재진단 state로 이관하며, 날짜 편집은 old/new 및 다중 범위를 보수적으로 invalidate합니다.
- legacy 펀드 가격행은 유일한 종목명 매핑일 때만 F코드를 복원합니다.
- 운영 반영에는 GAS v9.143과 정적 웹 cache `portfolio-cache-20261001-2`를 함께 재배포해야 합니다.

## GAS v9.144 구조 변경·초기 진단 cache 보호 (2026-10-01)
- tracked source 시트의 행·열 삽입/삭제를 설치형 `onChange` trigger로 감지해 보수적으로 integrity cache를 무효화합니다.
- 이미 cache된 blocking 진단은 최초 손익 그래프 렌더 전에 반영하고, 좌수 편집기를 새로 열 때 이전 복구 상세·재처리 상태를 초기화합니다.
- 운영 반영에는 GAS v9.144와 정적 웹 cache `portfolio-cache-20261001-3`을 함께 재배포해야 합니다.

## GAS v9.145 integrity migration revision 정수화 (2026-10-01)
- 신규·legacy·malformed revision state의 migration revision을 정수로 생성하고, 기존 소수 revision state도 전체 재진단 state로 안전하게 이관합니다.
- 운영 반영에는 GAS v9.145와 정적 웹 cache `portfolio-cache-20261001-4`를 함께 재배포해야 합니다.

## GAS v9.146 tracked source 구조 변경 보호 (2026-10-01)
- `REMOVE_GRID`·`OTHER`는 source identity를 사후 판별할 수 없어 전체 invalidate하고, tracked source의 행·열 및 시트 생성은 증분 cache correctness를 직접 보호합니다.
- integrity change trigger는 현재 spreadsheet 기준으로 중복을 제거하며 자동화 상태 점검에서도 누락을 복구합니다.
- 운영 반영에는 GAS v9.146과 정적 웹 cache `portfolio-cache-20261001-5`를 함께 재배포해야 합니다.

## GAS v9.147 history 진단 일관성·펀드 대표행 순위 (2026-10-01)
- 기간 진단 도중 source revision이 바뀌면 stale 진단을 화면과 cache에 합치지 않고 history부터 최대 한 번 재조회합니다.
- 펀드 가격·Snapshot 대표행은 `MANUAL > FUND_NAV > 일반/carry > FUND_NAV_CARRY_INPUT_REQUIRED` 순위를 공통 적용합니다.
- 운영 반영에는 GAS v9.147과 정적 웹 cache `portfolio-cache-20261001-6`를 함께 재배포해야 합니다.

## GAS v9.148 history summary cache·retry 실패 정리 (2026-10-01)
- integrity cache는 날짜·상태·복구 가능 여부만 저장하고 120,000자 상한에서 오래된 entry부터 제거하며, 기존 v1 상세 cache는 삭제합니다.
- revision 재시도 실패 시 정상 화면을 복원할 수 없으면 stale chart·table·warning·상태를 제거합니다.
- 운영 반영에는 GAS v9.148과 정적 웹 cache `portfolio-cache-20261001-7`을 함께 재배포해야 합니다.

## 정적 웹 retry 빈 결과 정리 (2026-10-01)
- revision 재조회가 빈 원본 또는 빈 정규화 범위로 끝나면 이전 정상 화면을 복원하고, 복원본이 없을 때만 stale chart·table·warning·상태를 제거합니다.
- GAS 변경은 없으며 정적 웹 cache `portfolio-cache-20261001-8`만 재배포합니다.

## GAS v9.149 Snapshot raw 충돌·임시 rollback backup 정책 (2026-10-01)
- Snapshot 복구는 dedupe view의 signature가 아니라 raw `date + canonical code/name` 그룹을 공통 판정합니다. 동일 행 중복과 MANUAL 없는 유일 expected 일치만 자동 정리하고, MANUAL·미확정 충돌·원자료 부족은 원인을 남겨 보존합니다.
- 쓰기 뒤 `SpreadsheetApp.flush()` 및 raw integrity 재진단이 `VALID`인 경우에만 성공으로 확정합니다.
- 시스템 `*_백업_*`은 위험한 쓰기 직전의 임시 rollback artifact입니다. 정상 완료본은 즉시 삭제하고 registry에서도 제거하며, 전체 복구 완료/명시 유지보수에서는 검증된 과거 완료본과 복구 완료된 실패본도 정리합니다. active·미복구 실패·수식 참조·사용자/UNKNOWN 백업은 보존합니다.
- 운영 반영 후 GAS v9.149와 정적 웹 cache `portfolio-cache-20261001-9`를 재배포하고, 먼저 백업 유지보수 dry-run에서 보호/삭제 후보를 확인한 다음 apply를 실행합니다. 이어 전체 Snapshot consistency repair를 실행하고 완료 후 integrity 상태와 system backup 0개를 확인합니다.
- Headless workflow는 `github.event.schedule`을 runner에 전달해 지연 실행에서도 cron slot의 거래일을 사용하며 수동 `--date`를 우선합니다. `MORNING` 비교지수 조회는 거래일 전일까지로 제한하고, 환율 `CONFIRMED`/`NO_DATA`는 정상 응답으로, `MISSING_SOURCE`/`INVALID_SCHEMA`는 운영 오류로 구분합니다.
- 정상 write는 대상 범위 read-back 검증 뒤 방금 만든 rollback backup만 FAST PATH로 제거합니다. orphan·수식 참조·과거 backup을 포함하는 전체 workbook 점검은 명시 유지보수와 전체 Snapshot repair 완료 시에만 수행합니다.
- Google Sheets 파일당 10,000,000 cell 한도를 기준으로 backup 생성 전 용량을 검사하며, tall/narrow backup은 열을 먼저 축소한 뒤 행을 확장해 transient peak도 제한합니다. Snapshot 비교는 날짜·코드·숫자·source를 canonicalize하고 savedAt 차이는 제외합니다.

## GAS v9.150 Snapshot operation backup 수명주기 (2026-10-02)

- 다일자 Snapshot 작업의 rollback backup은 작업 중 `CREATED`로 유지하고, 전체 작업의 검증 성공 시에만 `COMPLETED` 처리 후 즉시 삭제합니다.
- 작업 중 하나라도 실패하면 backup을 `WRITE_FAILED`로 보존하며, 같은 실패 operation ID는 재사용하지 않습니다.
- 정적 웹은 history repair의 첫 실패 중단 동작을 반영한 cache `portfolio-cache-20261002-1`과 함께 배포합니다.

## GAS v9.151 Snapshot backup provenance 및 validated recovery (2026-10-02)

- 재사용 backup의 system provenance를 registry 상태 전환에서도 보존하고, 전체 Snapshot consistency repair가 완전 성공한 경우에만 과거 `WRITE_FAILED`/중단 `CREATED` system backup을 정리합니다.
- 일반 유지보수는 복구 증명 없이 실패·중단 backup을 보존하며, signature가 달라진 등록 완료본도 자동 삭제하지 않습니다.
- 정적 웹은 cache `portfolio-cache-20261002-2`와 함께 배포합니다.

## GAS v9.152 validated recovery source 격리 (2026-10-02)

- 전체 Snapshot consistency repair의 `validatedRecovery` 정리는 Snapshot source의 등록된 실패·중단 rollback backup에만 적용합니다. 다른 source의 실패 또는 진행 중 backup은 해당 증명으로 삭제하지 않습니다.
- 정적 웹은 cache `portfolio-cache-20261002-3`과 함께 배포합니다.

## GAS v9.153 Snapshot duplicate cleanup read-back 검증 (2026-10-02)

- 중복 정리 전부터 존재한 빈 행·식별자 없는 행은 보존하면서, intended/actual 비교에는 동일한 유효 Snapshot 행 기준을 적용해 정상 정리를 실패로 오인하지 않습니다.
- 정적 웹은 cache `portfolio-cache-20261002-4`와 함께 배포합니다.

## GAS v9.154 validated operation 및 capacity cleanup 보호 (2026-10-02)

- 전체 Snapshot consistency repair의 stale rollback 정리는 실제 `VALID` 재진단을 통과한 operation ID에만 한정합니다. skip·범위 밖·다른 operation backup은 보존합니다.
- 셀 부족 자동 cleanup도 registry signature와 실제 backup content signature가 일치하는 시스템 backup만 삭제합니다.
- 정적 웹은 cache `portfolio-cache-20261002-5`와 함께 배포합니다.

## GAS v9.155 빈 expected 중복 복구 및 operation backup 검증 (2026-10-02)

- 원자료 계산 결과가 비어도 source 오류 없이 raw `EXACT_DUPLICATE`만 존재하면 공통 Snapshot write 경로로 한 행만 보존하고 raw 중복 재진단을 수행합니다.
- 동일 operation backup은 실제 content signature가 registry signature와 일치할 때만 재사용하며, 불일치하면 기존 손상본을 보존하고 새 안전 backup을 생성합니다.
- 정적 웹은 cache `portfolio-cache-20261002-6`과 함께 배포합니다.

## GAS v9.156 operation backup cleanup signature 재검증 (2026-10-02)

- 성공 operation backup을 삭제하기 직전 registry signature와 실제 backup content signature를 다시 비교합니다. 불일치하거나 signature가 없는 backup은 sheet와 registry record를 모두 보존합니다.
- 정적 웹은 cache `portfolio-cache-20261002-7`과 함께 배포합니다.

## GAS v9.157 Snapshot 최종 검증 lifecycle (2026-10-02)

- 거래 저장 후 Snapshot rebuild가 부분 실패하면 거래 backup을 `WRITE_FAILED`로 보존하고 성공 응답·자동 cleanup을 차단합니다.
- 일일 가격 저장·날짜 복구·backfill Snapshot write는 연관 write와 최종 integrity 검증 성공 뒤에만 operation backup을 완료·정리합니다.
- 내용이 완전히 동일한 MANUAL 물리 중복은 `EXACT_DUPLICATE`로 축약하되 서로 다른 MANUAL 충돌은 계속 보호합니다.
- 정적 웹은 cache `portfolio-cache-20261002-8`과 함께 배포합니다.

## GAS v9.158 backfill 최종 Snapshot 검증 (2026-10-02)

- backfill은 Snapshot 및 연관 가격이력 write 후 `SpreadsheetApp.flush()`와 `diagnoseSnapshotIntegrity()`를 실행하고 `VALID`일 때만 operation backup을 완료·정리합니다.
- non-VALID 또는 가격이력 write 실패 시 성공 집계를 하지 않고 rollback backup을 `WRITE_FAILED`로 보존합니다.
- 정적 웹은 cache `portfolio-cache-20261002-9`와 함께 배포합니다.

## GAS v9.159 Snapshot/Toss 진단 정합성 (2026-10-03)

- Snapshot integrity 진단은 cleanup과 동일한 canonical duplicate 분류를 사용해 savedAt·표현 차이 중복과 expected 단일 일치 행을 자동 복구 가능 상태로 판정합니다. 브라우저 integrity cache는 `portfolio.historyIntegrity.v3`로 갱신합니다.
- Toss 연결 진단은 OAuth와 실제 market endpoint 단계를 분리하고, OAuth 성공 뒤 실제 endpoint가 403인 경우에만 IP allowlist 안내를 표시하며 005930 현재가 smoke 결과를 화면에 표시합니다.
- Toss 진단은 token cache를 HTTP 200으로 간주하지 않고 OAuth를 1회 실제 호출하며, 005930 smoke의 빈 결과·종목 누락·가격/timestamp 오류를 별도 code로 기록합니다.
- 일반 성공 cleanup은 같은 source의 과거 검증된 `COMPLETED` backup만 정리하고 `CREATED`/`WRITE_FAILED`는 보호합니다. `WRITE_FAILED`는 최종 `VALID`가 명시된 Snapshot operation ID에 한해 maintenance에서 정리하며, 시트가 없는 system registry record는 명시적 maintenance에서 제거합니다.
- 신뢰 가능한 독립 KR 거래일 helper가 없어 일별 누락은 기존 평일 후보 계산을 유지하고 휴장일 포함 가능성을 명시합니다. 정적 웹은 cache `portfolio-cache-20261003-1`과 함께 배포합니다.


## GAS v9.160 backup cleanup 검증 선행 (2026-10-03)

- `_cleanupCurrentSystemBackup()`은 현재 `COMPLETED` backup의 source sheet 존재, 실제 backup sheet 존재, registry signature 일치를 먼저 검증한 뒤에만 같은 source의 과거 `COMPLETED` rollback을 정리합니다.
- 현재 backup이 누락됐거나 signature가 다르면 과거 검증 가능한 rollback은 삭제하지 않습니다. 일반 성공만으로 `CREATED`/`WRITE_FAILED`를 삭제하지 않으며, `WRITE_FAILED` 정리는 최종 `VALID`가 명시된 Snapshot operation ID에 한정합니다.
- GAS와 웹 기대 버전은 `9.160`으로 동기화합니다. 정적 웹은 `settings_fetch.js?v=20261003-1`, Service Worker cache `portfolio-cache-20261003-2`를 함께 배포합니다.

## GAS GitHub Actions 자동배포 (2026-10-03)

- `.github/workflows/gas-deploy.yml`은 PR에서는 검증만 수행하며 운영 배포 job은 절대 실행하지 않습니다. `main`에 `src/gas/apps_script.gs` 변경이 반영되고 `GAS_AUTO_DEPLOY_ENABLED=true`인 경우에만 자동으로 운영 GAS 배포를 실행합니다. 수동 실행(`workflow_dispatch`)은 기본 `dry_run=true`이며, 최초 연결 확인 후 실제 배포 시에만 `false`로 실행합니다. PR 검증은 운영 concurrency에 들어가지 않으며, 수동 dry-run도 실제 운영 배포와 별도 concurrency 그룹을 사용합니다.
- 배포 스크립트는 Apps Script API로 현재 프로젝트 전체 파일을 먼저 읽고, 대상 `SERVER_JS` 한 파일만 저장소의 `src/gas/apps_script.gs`로 교체한 뒤 manifest와 다른 GAS/HTML 파일은 원문 그대로 다시 전송합니다. 현재 deployment가 이미 같은 소스면 새 version을 만들지 않고 종료합니다.
- 기존 웹앱 URL을 유지하기 위해 새 deployment를 만들지 않습니다. 현재 deployment의 `manifestFileName`을 보존한 채 새 Apps Script version을 만든 뒤 같은 deployment ID가 새 version을 가리키도록 갱신합니다. 배포 후 deployment version과 웹앱 `getSettings().gasVersion`을 다시 확인합니다.
- Apps Script API는 service account를 지원하지 않으므로 사용자 OAuth refresh token을 GitHub Secrets에 저장해야 합니다. OAuth 범위는 `https://www.googleapis.com/auth/script.projects`와 `https://www.googleapis.com/auth/script.deployments`만 사용합니다.
- Google Cloud에서 Apps Script API를 활성화하고 Apps Script 사용자 설정에서 API 접근을 허용합니다. OAuth 클라이언트를 만든 뒤 offline access로 위 두 scope를 승인하여 refresh token을 발급합니다. OAuth 동의 화면이 Testing이면 refresh token이 7일 만료될 수 있으므로 장기 자동화는 Internal 또는 In production 상태를 사용합니다.
- GitHub Repository Variables:
  - `GAS_AUTO_DEPLOY_ENABLED` — 초기에는 `false` 또는 미설정. dry-run과 최초 실제 배포 성공 후 `true`로 바꾸면 이후 GAS 소스가 main에 merge될 때 자동배포가 실행됩니다.
  - `GAS_SCRIPT_ID` — Apps Script 편집기 → 프로젝트 설정 → Script ID.
  - `GAS_WEB_APP_URL` — 기존 운영 웹앱 `/exec` URL. 기존 브리핑 workflow에서 사용 중인 값을 그대로 재사용합니다.
  - `GAS_SERVER_FILE_NAME` — 선택. Apps Script 프로젝트에 SERVER_JS 파일이 여러 개이고 `apps_script`가 아닌 경우 실제 대상 파일명을 지정합니다.
  - `GAS_DEPLOYMENT_ID` — 선택. 비우면 `GAS_WEB_APP_URL`의 `/macros/s/{deploymentId}/exec`에서 자동 추출합니다.
- GitHub Secrets:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REFRESH_TOKEN`
  - `GAS_ACCESS_TOKEN` — 기존 GAS 요청 인증을 사용 중이면 현재 Secret을 그대로 재사용합니다.
- 최초 설정 후 `GAS_AUTO_DEPLOY_ENABLED`는 `false` 또는 미설정 상태로 둡니다. Actions → `gas-deploy` → Run workflow에서 먼저 `dry_run=true`로 인증·Script ID·deployment·대상 SERVER_JS를 확인합니다. 성공하면 `dry_run=false`로 한 번 실행하여 현재 main의 GAS v9.160을 운영 배포에 반영하고, 마지막으로 `GAS_AUTO_DEPLOY_ENABLED=true`를 설정합니다. 이후에는 GAS 소스가 포함된 main merge만 자동 배포를 수행합니다.


## GAS 자동배포 clasp 인증 전환 및 Node 24 (2026-10-06)

- 운영 배포 로직은 기존 Apps Script REST API 방식을 유지합니다. `clasp push`로 프로젝트 전체를 직접 덮어쓰지 않습니다. 기존 manifest/비대상 GAS·HTML 파일 보존, 기존 deployment ID 유지, 새 version 생성, `webApp=verified` 사후 검증 규칙도 그대로 유지합니다.
- Google Cloud에서 직접 만든 Testing OAuth 앱의 7일 refresh token 제한을 피하기 위해 인증만 Google 공식 `@google/clasp`의 기본 OAuth 자격증명으로 전환합니다. 최신 `clasp login`으로 생성한 `.clasprc.json` 전체 내용을 GitHub Repository Secret `CLASPRC_JSON`에 저장합니다.
- `CLASPRC_JSON`은 최신 clasp v3의 `tokens.default` 형식과 기존 local clasp 형식을 지원합니다. 여러 사용자 토큰이 있는 경우 `default` 사용자를 명시적으로 사용합니다. Secret 내용이나 refresh token은 로그에 출력하지 않습니다.
- 전환 절차:
  1. 자동배포 전환 중에는 `GAS_AUTO_DEPLOY_ENABLED=false`로 둡니다.
  2. Windows PowerShell에서 최신 Node.js 환경으로 `npx @google/clasp@latest login`을 실행해 본인 Google 계정으로 로그인합니다. Apps Script API 사용자 설정은 계속 ON이어야 합니다.
  3. `%USERPROFILE%\.clasprc.json` 전체 내용을 GitHub Repository Secret `CLASPRC_JSON`으로 등록합니다. 채팅·이슈·PR에는 내용을 붙이지 않습니다.
  4. #445 병합 후 Actions → `gas-deploy`를 `dry_run=true`로 수동 실행해 OAuth/Script/deployment 조회를 확인합니다.
  5. 성공 후 `dry_run=false`로 한 번 실행합니다. 현재 운영 소스가 이미 동일하면 새 version 생성 없이 웹앱 endpoint 검증만 수행하는 것이 정상입니다.
  6. clasp 경로가 정상임을 확인한 뒤 기존 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` Secrets를 삭제하고 `GAS_AUTO_DEPLOY_ENABLED=true`로 다시 활성화합니다.
- GitHub Actions의 Node.js 20 deprecation 경고를 제거하기 위해 저장소 workflow의 `actions/checkout`과 `actions/setup-node`를 v7로 올리고 Node 실행 버전을 24로 맞춥니다. GAS/web 회귀검사도 Node 24에서 실행해 호환성을 검증합니다.
