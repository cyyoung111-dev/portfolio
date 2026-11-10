# 거래원장 v2 338건 이관 및 복구 — 2026-11-10 운영 실행 절차

> #734 · 개발·복구 검증 선행. **이 문서와 GAS v9.288 후보는 원본에 자동으로 쓰지 않습니다.**
> **운영 v9.288 / Apps Script 345 실제 게시 완료 (11/10 01:12 KST)**.
> [실배포 #42651714952](https://github.com/cyyoung111-dev/portfolio/actions/runs/42651714952)의
> GAS·웹앱 readback은 v9.288 성공, 이후 NH 부가 진단 타임아웃으로 workflow가
> 실패 표시됐습니다. [04:23 실행 #42682944711](https://github.com/cyyoung111-dev/portfolio/actions/runs/42682944711)도
> 운영 HEAD·게시 웹앱 모두 v9.288을 재확인했으며, **모든 후보 false여서 새 배포는 없었습니다**.
> **반복 재배포하지 마세요.** 거래원장 338건 L:N 이관은 아직 미실행입니다.
> 11/09 마감은 첫 실행 타임아웃 후 Watchdog 복구한 결과입니다.

## 1. 이관 범위와 불변조건

- 출처: 실제 운영 GAS의 `SS_ID`와 연결된 `거래이력` 시트. 최초 338개의
  실제 거래 데이터 행, 기존 A:K 11개 열의 값·수식·행순서·원가를 바꾸지 않습니다.
- 신규 열만 추가: **L=외화단가, M=매입환율, N=거래ID**.
  과거 11열 원장에 없는 외화 원단가/과거 환율은 추정하지 않습니다.
  N에는 기존 거래 행의 순번과 값에 기반한 영구 ID 338개를 중복 없이 부여합니다.
- 이관은 거래 내역의 경제적 거래 자체를 수정하지 않으므로 과거 Snapshot 재계산을
  임의로 시작하지 않습니다. `_tradeLedgerContentFingerprint_`(A:K 기준)는 전후 동일합니다.
- **원본 시트 이름·시트 ID 유지**: 시트를 교체하거나 기존 A:K를 전체 지우지 않습니다.
- 신청·복구 함수는 GAS 편집기에서 소유자가 **수동으로** 실행하는 비공개 함수.
  `doGet/doPost` 경로에는 apply·restore가 없습니다.

## 2. 준비 순서 (실제 원장에 쓰기 전)

1. 11/09 야간 GAS v9.287 **최종** 마감 `COMPLETE`, fund NAV 및 Snapshot
   중복/누락 0을 독립 조회로 대사합니다. 기존 기록은 **19:33 첫 실행 타임아웃 →
   20:37 Watchdog 성공 → 21:00:16 FUND_DEFERRED_DONE**이며 정상 첫 시도는 아닙니다.
   이관 직전에는 별도로 **진행 중 Writer/lease·구 트리거 0**을 확인합니다.
   이 증거가 없으면 다음 단계도 보류합니다.
2. 11/10 운영 v9.288 **전체 소스 해시 승인, CI/정적 검토, GAS dry-run,
   기존 WEB_APP·HEAD·배포 인벤토리·구 Writer 트리거 격리, 실제
   배포 게시/버전 readback**을 마칩니다.
   [PR #1070](https://github.com/cyyoung111-dev/portfolio/pull/1070)은 정확한
   v9.288 후보 Git blob `9e8584032daf896c5cffedb02041b604ee82ed07`을
   allowlist에 추가하고, `gas-deploy.yml`의 **`use_9288_trade_v2` 및 `approve_9288`**
   수동 옵션을 도입했습니다. **운영 배포는 11/10 01:12 KST에 완료**됐습니다.
   [dry-run #42644629982](https://github.com/cyyoung111-dev/portfolio/actions/runs/42644629982)와
   [실배포 #42651714952](https://github.com/cyyoung111-dev/portfolio/actions/runs/42651714952)를 마쳤습니다.
   배포 버전=345, 게시 웹앱=9.288입니다. **재배포 작업은 불필요**합니다.
   04:23 재실행에서 후보 전부 false로 `GAS_9285_EXPLICIT_MANUAL_RELEASE_REQUIRED`
   거절된 것은 배포 버전이 되돌아갔다는 증거가 아닙니다.
   **`approve_9288=true`는 거래 338건을 이관하는 승인이 아닙니다.**
   [2026-11-10 00:26 KST dry-run #42644629982](https://github.com/cyyoung111-dev/portfolio/actions/runs/42644629982)는
   **SUCCESS**였습니다. 읽기 전용 배포 인벤토리는 `INVENTORY_ONLY`, 추가
   접근 가능한 배포 0, 미승인 소스 0으로 확인됐습니다. `releaseAuthorized=false`는
   해당 **감사기가 자체적으로 배포를 승인하지 않는다는 뜻**이지
   `INVENTORY_ONLY`에 의한 GitHub Actions 차단이 아닙니다.
   실제 워크플로는 인벤토리 `BLOCKED`일 때 중단됩니다.
   반대로 `INVENTORY_ONLY`는 이전 실행·외부 Writer·편집자 격리가
   증명됐다는 뜻도 아닙니다.
   배포 전 별도 [#734 실운영 상태 읽기 전용 검증](https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue734-v9288-live-readiness-readonly.yml)과
   `gas-deploy`의 `Verify live 9.287 settled close and legacy ledger` 단계를
   통과해야 합니다. 현재 9.287 `getAutomationStatus`의 마감·펀드 완료,
   미처리 Writer 플래그 0, 구 트리거 중복 0, `getTrades` 기존 338건을
   인증된 POST 읽기 전용 호출 2회로 확인합니다.
   이것은 **저장된 운영 상태**의 검사로, 모든 외부 Writer의 실시간
   실행 UID·GAS 편집 세션까지 보증하지 않습니다.
3. GAS 운영 편집기에서 `runTradeV2MigrationPreflight`를 **읽기 전용**으로 실행:
   `gasVersion=9.288`, `schemaWidth=11`, `sourceRows=338`,
   `journalStatus=NONE`(또는 이전 RESTORED),
   `spreadsheetId`, `sheetId`, `sourceDigest`,
   `sourceSignature`, `targetRevision` 값을 확인합니다.
   반드시 `SS_ID`와 사용자 원본 스프레드시트의 실제 ID가 일치해야 합니다.
4. 백업용 셀 여유가 `sourceMaxRows*sourceMaxColumns` 이상인지 확인합니다.
   이관 코드는 용량 확보를 위해 기존 백업을 자동 삭제하지 않습니다.
   연결된 원본을 또 백업하는 `copyTo`이므로 추가 용량이 필요합니다.

## 3. 명시적 일회성 승인과 이관

운영 GAS Script Properties에 소유자 승인 시점의 아래 JSON을
**단일 키** `trade_v2_migration_approval_v1`로 등록합니다.
값을 추정하거나 하드코딩하면 안 됩니다.

```json
{
  "approvedFor": "APPLY",
  "releaseVersion": "9.288",
  "userApproved": true,
  "writerIsolationConfirmed": true,
  "approvedDate": "<실제 실행일 YYYY-MM-DD (KST)>",
  "operationId": "mig_UNIQUE_OPERATION_123456789",
  "spreadsheetId": "<preflight.spreadsheetId>",
  "sheetId": 1633060044,
  "expectedRows": 338,
  "expectedSourceDigest": "<preflight.sourceDigest>",
  "expectedSourceSignature": "<preflight.sourceSignature>",
  "expectedTargetRevision": "<preflight.targetRevision>"
}
```

- `approvedDate`는 **GAS 편집기에서 실제 Apply/Restore를 실행하는 날의 KST 날짜**여야 합니다.
  목표일 11/10 또는 이전 preflight 날짜를 그대로 복사하지 마세요.
- `operationId`는 이번 실행에서만 사용하는 고유 값(접두 `mig_`,
  영숫자/underscore/hyphen 12~64자)입니다.
- `sheetId` 예시는 기존 연결 파일의 시트 ID이며 **실제 실행 시
  preflight의 최신 값을 그대로 사용**해야 합니다.
- `writerIsolationConfirmed`는 **실제 old Writer/trigger/다른 GAS endpoint
  경합이 차단됐다는 증거를 확인한 후에만 true**로 설정합니다.
- 저장 후 `runTradeV2MigrationApply()`를 GAS 편집기에서 한 번 실행합니다.
  코드는 ScriptLock/Writer gate, sheet ID/행수·11열 헤더,
  A:K 서명·전체 거래 digest/target revision을 재검증합니다.
- 백업 이름은 `거래이력_v2_백업_<operationId>`로 보존합니다.
  전체 원본 시트 복제본의 서명이 원본과 일치해야 작업을 시작합니다.
- 작업 상태는 Script Properties의 `trade_v2_migration_journal_v1`에
  `PREPARED → WRITING → APPLIED` 순서로 저장됩니다.
  수동 실행에 성공해도 원본 N열 338개 고유 ID·기존 A:K 338건 불변
  및 원장 revision을 **별도 읽기 검증**합니다.
- 동일 operationId로 재실행하면 재쓰기 없이
  `alreadyDone=true`인지 확인합니다. 데이터가 달라졌다면 강제 중단합니다.

## 4. 실패·하드 타임아웃·복구

- 하드 타임아웃을 포함해 `PREPARED/WRITING` 상태가 남으면
  기존 원장과 backup을 보존하고 임의 재실행/새 이관을 **중단**합니다.
  상태를 운영 완료로 추정하지 않습니다.
- 백업 해시·A:K 원본 338건 동일성과 신규 L:N 각 셀의
  예측 가능한 원상태/예상 ID만 검사합니다.
  외부 편집·행수 변경·A:K 수정·백업 드리프트가 발견되면
  **복구를 수행하지 않고 사람의 검토가 필요**합니다.
- 별도 승인 JSON을 동일 `operationId`와 원본 preflight 서명,
  `approvedFor: "RESTORE"`로 변경합니다.
  `userApproved:true`, `writerIsolationConfirmed:true`,
  오늘 날짜 등 다른 필수 필드는 유지합니다.
- GAS 편집기에서 `runTradeV2MigrationRestore()` 실행:
  **원래 없던 L:N 내용만 지우고**, A:K 값·수식/순서를 유지합니다.
  원본 전체 서명 및 11열 복귀가 검증되면
  journal은 `RESTORED`가 됩니다. 백업 삭제는 **절대 하지 않습니다**.
- `RESTORE` 과정도 중단되면 journal `RESTORING`으로 남으며
  동일 승인으로 재시도할 수 있습니다. 다음 적용은 **새 operationId로
  새 승인 및 preflight**가 확인된 후에만 가능합니다.

## 5. 개발 검증 증거와 배포 판단

- `scripts/check-gas9288-trade-v2-migration-apply-restore.mjs`
  338행의 실제 GAS 코드 실행을 인메모리 모의 Google Sheets/Properties/
  ScriptLock 대상으로 검증합니다. 승인 누락, 백업, Idempotent
  재실행, 2개 ID 기록 뒤 타임아웃, 부분 이관 복구, A:K 변조
  차단, 타인의 N열 변경 감지, stale source, lock 경합을 검사합니다.
- **테스트 성공은 운영 금융 시트 338건 이관 또는 실제 Script Properties
  등록을 의미하지 않습니다.** 승인된 v9.288 전체 소스와 운영
  Writer 격리, 현장 복구 테스트/원장 readback까지 별도로 증명해야 합니다.
- 11/09 독립 Google Sheets 복제본 백업은 원본 A:N **338건·셀 차이 0**을
  증명한 예비 자료일 뿐, **Apply 함수가 생성·서명·보존해야 하는 이관 저널 백업의
  대체물이 아닙니다**. 백업의 실제 최신성·문서 ID·sheetId를 다시 검증하세요.
- [PR #1078](https://github.com/cyyoung111-dev/portfolio/pull/1078)의 v9.289는
  정확 소스 SHA를 등록한 **별도 수동 승인 후보**이며 운영 미게시입니다.
  v9.288 거래원장 이관 저널 `APPLIED`, A:K 불변·338개 고유 ID, 현재
  Writer 상태 확인이 완료되기 전에는 9.289를 배포하지 않습니다.
- 이관 후에도 기존 거래 수정·삭제/PC·모바일 동시편집은 별도 v2
  E2E 검증 후 허용합니다. 이관을 먼저 하자는 요청과 운영 편집
  무결성 보증은 서로 다른 완료 조건입니다.


## 6. 11/10 Writer Gate Active 14건 — 별도 수동 복구 후보 (실행 전 독립 승인)

- 사용자 GAS 실행 UI 원본 4개 200행 기록에서 `issue507_writer_gate_v1.active`
  14건 모두 동일 함수 실행시간 범위에 단일 대응하며 실행 상태는 **14건 모두 TIMEOUT**.
  일치 근거는 [#734 기록](https://github.com/cyyoung111-dev/portfolio/issues/734#issuecomment-6760454303).
  이것은 실행이 종료됐다는 독립 증거이며 금융작업이 정상 완료됐다는 뜻은 아님.
  완료 영수증 속성 `issue507_writer_end_v1_*`은 별도 확인 당시 **0건**.
- Google `script.processes` API 조회는 [#42753249586](https://github.com/cyyoung111-dev/portfolio/actions/runs/42753249586)에서 실패.
  [#42761118950](https://github.com/cyyoung111-dev/portfolio/actions/runs/42761118950)은 기존 OAuth에
  `script.processes` 범위가 없음을 실제로 확인. **이 권한을 새로 요청하지 않고도**
  UI 종료 증거를 별도 검토할 수 있지만 UID→Gate token 연결은 확정하지 못함.
- 운영 Gate 최신 실조회 [#42754844673](https://github.com/cyyoung111-dev/portfolio/actions/runs/42754844673):
  `mode=OPEN`, `activeCount=14`. 이는 *실행 중*을 의미하지 않지만 이관
  `TRADE_V2_MIGRATION_WRITER_NOT_QUIESCENT` 차단을 의미.
- **새 복구 함수는 운영 v9.288에 배포되지 않음**.
  `ops/issue734/targeted-timeout-gate-recovery.gs`는 검증용 소스만 제공.
  기존 `ops/issue507/writer-gate.gs`, 거래원장 마이그레이션 함수 및 게시된
  Apps Script 345 코드를 **수정하지 않음**.
- 정상 종료 영수증을 사후에 위조하거나 `completed`를 거짓으로 증가시키지
  않고, 14개의 **정확히 일치하는 stale active**만 대상 후보로 삼음.
  활성/배포/타임스탬프/기존 백업이 바뀌면 변경을 거부.

### 실제 복구의 승인·실행 경계

1. 운영 원본 A:K 338건/백업·서명 보존, 현재 Writer Gate
   `OPEN / 14 exact matches` 및 지난 실행 목록의 종료 여부를 재조회.
   기존 트리거·외부 웹앱·편집자/다른 writer들이 **일시 격리되었다는
   독립된 증거**가 없으면 중단. 진행 중인 금융 ledger/snapshot flag가
   있거나 원본 11열/338건에서 바뀌면 중단. 사용자의 파일 공유는
   외부 Writer 격리를 증명하지 않음.
2. 작업자가 운영과 같은 Apps Script 프로젝트에 위 후보 `.gs` 소스를
   **별도 임시 파일**로 등록(게시 웹앱 배포 변경 금지)하고
   `issue734PreviewTimedOutGateRecovery`를 단 한 번 실행. 결과
   `MATCHED_BUT_NOT_AUTHORIZED`, `activeCount=14` 및
   `originalGateDigest`를 확인. 함수는 속성이나 금융 자료에 쓰지 않음.
   수동 편집을 통해 원본 `Code.gs`를 교체하거나 기존 배포를 손대지 말 것.
3. 완전한 외부 writer 격리와 사용자 재승인이 확인됐을 경우에만
   Script Properties `issue734_stale_gate_recovery_approval_v1`에 다음
   **실제 일회 승인**을 등록(사실과 다른 `externalWritersExcluded=true`
   기입 금지). `approvedDate`는 실행 당시 실제 KST 날짜,
   `expectedGateDigest`는 *최신 Preview* 결과 그대로 사용.

   ```json
   {
     "approvedFor": "PRUNE_EXACT_14_TIMED_OUT",
     "releaseVersion": "9.288",
     "userApproved": true,
     "externalWritersExcluded": true,
     "approvedDate": "<실제 실행일 YYYY-MM-DD (KST)>",
     "expectedGateDigest": "<최신 Preview 원본 Gate digest>"
   }
   ```

4. `issue734CommitTimedOutGateRecovery`를 **한 번만** 수동 실행.
   기존 `_issue507GateAtomic_` ScriptLock 내부에서
   release/버전/14개 실행명·startedAt/새로운 active 유무/영수증 유무/
   금융 pending/원본 11열 338건/승인 날짜·digest를 재확인.
   원본 Gate JSON을 `issue734_writer_gate_before_20261110_v1`에
   별도 보존·readback하고, 사후조사용
   `issue734_writer_gate_repair_audit_v1`을 기록.
   `issue507_writer_gate_v1.active`의 검증된 stale 14건만 제거하고
   **정상 종료 receipt/finished/completed 기록을 조작하지 않음**.
   그 외 새로운 active가 하나라도 생기면 **전체 중단**.
   결과 `PRUNED`와 새 Gate `activeCount=0`을 별도로 확인.
   하드 타임아웃·중간 오류 시 **다시 실행하거나 백업 Gate를
   덮어씌우지 말고** 감사/원본을 보존 후 수동 복구 판단.
5. 사후 `getWriterGateStatus` read-only 재확인. 외부 Writer 격리,
   원본/백업 용량 및 338건 최신 Preflight 해시를 재검증한 후에만
   별도 `trade_v2_migration_approval_v1` 일회성 승인 및
   `runTradeV2MigrationApply` 실행.
   `trade_v2_migration_journal_v1=APPLIED`, A:K 원본/공식 원가 불변,
   N열 고유 ID 338건, PC·모바일 v2 E2E까지 별도 검증.
6. 복구용 임시 GAS 파일을 정리하고 HEAD/published 소스 일치 및
   원래 Writer 트리거/배포 정상 운영을 복원·검증.
   백업/감사 속성은 삭제하지 않음.

**중요:** 이 복구는 시간 초과로 고아가 된 Gate 기록의
*원본 보존형 정리*이지 정상 완료 증명이나 금융 데이터 복구가 아닙니다.
GitHub 소스 테스트 PASS만으로 운영 Script Properties가 정리됐다고
주장하거나 `writerIsolationConfirmed`를 설정해서는 안 됩니다.


## 7. 2026-11-10 임시 금융 Writer 중단 승인 — DRAINING 원장 이관 경로

사용자가 포트폴리오 웹앱·GAS 금융 Writer의 일시 중단을 명시적으로 승인했습니다.
기존 6절의 OPEN 단발복구 방식은 DRAINING에서 실행할 수 없으므로
**이번 중단을 실행할 경우 반드시 이 절에 따른 전체 경로를 사용**합니다.
이 기능은 GitHub 비배포 수동 operator 소스만 추가한 것이며
CI/PR 병합 자체는 운영 속성·GAS 배포·트리거·금융 원장을 바꾸지 않습니다.

1. 같은 Apps Script 프로젝트의 **Issue734_Recovery.gs 전체 내용**을
   최신 ops/issue734/targeted-timeout-gate-recovery.gs 파일 내용으로
   교체해 저장합니다. 기존 소스에 추가로 이어붙이거나 Code.gs를 교체하면
   함수 중복/운영 코드 손상을 초래할 수 있습니다.
2. 원본 338행, 11열 A:K, Gate OPEN/기존 stale 14건, 이전 잔존 journal
   없음, 다른 Writer/편집자·외부 배포가 금융 시트를 수정하지 않음을
   확인합니다. 과거 실행 완료 근거와 **현재 작동 중인 Writer의 배제**는
   구분해야 합니다. 특히 17:00 장마감 전후는 피합니다.
3. 편집기에서 **issue734StartWriterMaintenancePause** 1회 실행.
   스크립트 Lock으로 원 Gate를 별도 속성에 원문 백업한 뒤
   mode=DRAINING/active=14로 설정합니다. 신규 같은 GAS 프로젝트 Writer는
   GATE_MAINTENANCE 차단될 수 있고 예약 트리거는 실패로 기록될 수 있습니다.
   트리거를 삭제하거나 웹앱 배포를 변경하지 않습니다.
   결과 로그 DRAINING, activeBefore=14, activeAfter=14 확인.
4. 읽기 전용 getWriterGateStatus로 DRAINING/14를 확인하고 **7분 이상**
   관찰합니다. 그 후 **issue734PreviewTimedOutGateRecovery**를
   실행해 MATCHED_BUT_NOT_AUTHORIZED / activeCount=14 /
   새 originalGateDigest를 확인합니다.
   기존 OPEN 사전검사 해시를 DRAINING 승인에 재사용하지 않습니다.
5. 다른 프로젝트/레거시 배포/편집자도 실제로 Writer 경합이 배제됐다는
   독립 확인 후에만 Script Property **issue734_stale_gate_recovery_approval_v1**
   (6절 승인 JSON과 동일, 단 최신 digest 및 실제 KST 실행일 사용)을 승인합니다.
   사실과 다른 externalWritersExcluded=true를 입력해서는 안 됩니다.
   **issue734CommitTimedOutGateRecovery** 1회 실행 후
   PRUNED/14 및 Gate DRAINING/active0,
   원본 Gate 두 백업/감사 속성 보존을 readback 검증합니다.
6. **issue734DrainedTradeV2Preflight**를 실행해
   11열, 338건, journal NONE, spreadsheetId, sheetId,
   sourceDigest, sourceSignature, targetRevision을 새로 확보합니다.
   기존 OPEN 전용 runTradeV2MigrationPreflight/Apply는 사용하지 않습니다.
   3절의 승인 스키마를 사용해 Script Property
   **trade_v2_migration_approval_v1**을 실제 KST 날짜·새 서명·고유
   operationId로 승인하며, writerIsolationConfirmed=true는 DRAINING 및
   모든 외부 Writer 격리를 실증한 경우에만 설정합니다.
7. **issue734DrainedTradeV2Apply** 단 1회 실행.
   원본 게시 v9.288 이관 본문과 동일한 금융 검증·백업·원장 L:N ID 쓰기
   경로를 사용하지만 신규 Writer가 차단된 DRAINING/active0 및
   복구/중단 감사 증거를 추가로 요구합니다.
   APPLIED, assignedIds=338, backup 보존, A:K 기존 값·수식/원가
   불변, N 338개 고유 ID, journal APPLIED를 별도로 확인합니다.
   실패·부분쓰기면 DRAINING 유지, 임의 Apply 재실행/OPEN 강제 금지.
   4절 별도 Restore 승인 후 **issue734DrainedTradeV2Restore**만 사용합니다.
8. 확인 완료된 APPLIED 상태에서만
   **issue734ResumeWritersAfterApplied** 실행.
   원본 A:K/백업·L:N 338건 재검증, stale Gate audit와 journal 확인,
   1회성 승인 두 개 폐기 후 Gate OPEN 재개.
   실행 결과 OPEN/active0/338건 및 실제 웹앱·GAS 예약 기능 정상성을
   재검증합니다. 원본 백업/감사 속성은 보존합니다.

### 중단을 취소하거나 이관 실패 시
- **이관 전**, 또는 Restore 이후 journal RESTORED/원본 11열로 돌아온
  상태에서는 7분 장벽 후 **issue734AbortWriterMaintenancePause**
  실행을 통해 Gate OPEN 복귀가 가능합니다.
- 고아 Active 14건 정리 전에 취소하면 기존 14건이 그대로 남습니다.
  정리한 후 취소하면 Active0 및 기존 11열 상태로 재개합니다.
- migration journal PREPARED/WRITING/PARTIAL/RESTORING 상태에서는
  강제 재개를 거부합니다. 원본·독립 backup을 유지하고 Restore가
  완료된 후에만 재개합니다.
- 중간 감사 상태 PREPARED/ABORTING/RESUMING 등에서 오류가 발생하면
  수동 속성 편집/재시도 없이 원본 증거를 보존하고 별도 검토합니다.
- DRAINING 중 실패한 자동화 예약 실행은 정상 재개 후에도 자동으로
  재실행된다고 가정하지 않습니다.

**중요:** Github 코드/CI와 별도 운영 Gate 실제 변경 여부를 구분합니다.
운영 상태가 실제 DRAINING으로 읽히기 전에는 중단 완료를 주장할 수 없으며,
APPLIED journal과 338개 유일 ID, 원본 A:K 불변, OPEN 재개까지 확인되기
전에는 이관 완료를 주장할 수 없습니다.
