# 거래원장 v2 338건 이관 및 복구 — 2026-11-10 운영 실행 절차

> #734 · 개발·복구 검증 선행. **이 문서와 GAS v9.288 후보는 원본에 자동으로 쓰지 않습니다.**
> 2026-11-09 마지막 **실증 운영본은 v9.287 / Apps Script 344**입니다. 11/09 마감은
> **19:33 첫 실행 타임아웃 후 Watchdog 복구로 COMPLETE** 됐으므로, 첫 실행 무중단 성공이라고
> 판단하지 않습니다. 11/10 이관은 Writer 유휴·원본 정합·별도 승인·실제 배포 검증이 전제입니다.
> PR #1070 병합으로 **v9.288의 수동 배포 선택/승인 경로는 이미 준비**됐습니다.
> 다만 코드 병합은 GAS 게시 또는 거래원장 실이관을 의미하지 않습니다.

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
   수동 옵션을 도입했습니다. **운영 배포는 아직 실행됐다는 증거가 없으므로 미완료**입니다.
   사용자는 [GAS 배포 워크플로](https://github.com/cyyoung111-dev/portfolio/actions/workflows/gas-deploy.yml)의
   `Run workflow`에서 `main`, `first_gate_phase=none`, `dry_run=true`,
   `use_9288_trade_v2=true`, `approve_9288=false`, 나머지 후보·승인 옵션 `false`로
   **먼저 무변경 검증**합니다. dry-run의 inventory/Writer 상태와 현재 게시 버전,
   소스 정확 해시를 대조한 뒤에만 별도 **실배포 승인**(`dry_run=false`,
   `approve_9288=true`)을 검토하며 배포 결과의 HEAD/게시/웹앱 readback을 반드시 확인합니다.
   **`approve_9288=true`는 거래 338건을 이관하는 승인이 아닙니다.**
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
- [PR #1074](https://github.com/cyyoung111-dev/portfolio/pull/1074)의 **v9.289는 성능 진단 후속 소스 후보**이며
  현재 allowlist에서 배포 차단된 상태입니다. v9.288을 건너뛰거나 동일 버전으로
  배포해 v2 원장 이관의 복구·Writer 기준을 변경하지 마세요.
- 이관 후에도 기존 거래 수정·삭제/PC·모바일 동시편집은 별도 v2
  E2E 검증 후 허용합니다. 이관을 먼저 하자는 요청과 운영 편집
  무결성 보증은 서로 다른 완료 조건입니다.
