# Issue #860 — GAS v9.289 후속 운영 배포 절차

> 2026-11-09 준비. **v9.289는 #734 거래원장 v2 운영 이관 완료 후에만 배포**합니다.
> 소스 후보를 생성하고 CI를 통과해도 실제 성능 개선이나 운영 배포 완료가 아닙니다.

## 버전·정확 소스

| 버전 | 역할 | Git blob (전체 GAS SERVER_JS) |
| --- | --- | --- |
| 9.287 | 현재 마지막으로 검증된 운영본 (Apps Script 344) | `e2f5239746598754305eb603bc33651f5c36d914` |
| 9.288 | #734 거래원장 v2 14열·ID·CAS·FX 및 수동 이관 | `9e8584032daf896c5cffedb02041b604ee82ed07` |
| 9.289 | #860 스냅샷 가격이력 2회→1회 읽기·단계별 시간 측정 | `e6c0d8eba5eba8012ae761de7f436e86601b63d9` |

v9.289는 #1072, #1073, #1074, #1076 전체 소스 동등성·source-only
검증 후 **별도 정확 SHA**로 등록되었습니다. 다섯 기존 함수만 변경합니다:
`getPriceHistoryRow`, `_getPriceSourceByDate`,
`_buildSnapshotRowsFromTradeAndPriceHistory`, `saveDailyPriceHistory`,
`runDailyFundValuations`. 거래원장 migration apply/restore와 Writer·백업은
v9.288 대비 원문 불변입니다.

## 1. 필수 선행: #734 이관 실제 완료

1. [#734 Runbook](./TRADE_LEDGER_V2_MIGRATION_RUNBOOK_20261110.md)의
   v9.288 독립 수동 dry-run→실제 버전 게시·readback을 수행합니다.
2. 사용자 GAS 편집기에서 `runTradeV2MigrationPreflight` 확인 후
   별도 일회성 소유자 승인, `runTradeV2MigrationApply` 실행합니다.
3. 금융 원본 `거래이력`의 **기존 A:K 338행 불변**, L/M 불확실
   과거 환율을 추정 입력하지 않음, N 영구 ID 338건/중복0,
   journal `APPLIED`, 독립 migration backup 보존을 확인합니다.
4. v9.288가 실제 웹앱 게시 소스이고 HEAD가 다른 Writer에 의해
   변형되지 않았는지, 운영 Writer 및 lease가 유휴인지 별도 확인합니다.
5. #734 E2E 미검증 또는 journal `PREPARED/WRITING/PARTIAL`이면
   **v9.289 배포 보류**. 9.289 내의 migration 수동 함수는 v9.288
   releaseVersion 승인을 그대로 요구하므로, 미완료 원장의 복구를
   후속 버전에 떠넘기면 안 됩니다.

## 2. v9.289 전용 수동 dry-run

[gas-deploy GitHub Actions](https://github.com/cyyoung111-dev/portfolio/actions/workflows/gas-deploy.yml)
→ `Run workflow`, `main`, 입력값:

- `first_gate_phase = none`
- `dry_run = true`
- `use_9289_close_perf = true`
- `approve_9289 = false`
- `confirm_9288_migration = false`
- `use_9287_fund_hotfix = false`, `use_9288_trade_v2 = false`
- 기타 승인 플래그 모두 `false`

이 단계는 후보 SHA, 현재 HEAD/게시 source, Google OAuth,
전체 inventory를 읽지만 금융원장/GAS/텔레그램에 쓰지 않습니다.
**dry-run PASS만으로 실배포 승인·원본 이관 완료가 아닙니다.**

## 3. 실제 배포 (소유자 명시 승인)

#734 이관 후 모든 선행검증이 확인된 경우 **다시** `Run workflow`:

- `first_gate_phase = none`, `dry_run = false`
- `use_9289_close_perf = true`
- `approve_9289 = true` (v9.289 후속 운영 배포 별도 승인)
- `confirm_9288_migration = true` (journal APPLIED 및 복구 상태 재확인)
- 9.287·9.288 후보 및 다른 버전 승인 플래그는 `false`

코드는 배포 전 **세 층**을 각각 확인합니다.

1. 기존 보호된 GAS 배포 inventory 통과. 미검증 웹앱/Writer는 차단.
2. `issue860-v9289-trade-v2-live-gate.mjs`: **인증된 읽기 전용
   `getAutomationStatus` + `getTrades` 정확 2회**; 게시 GAS
   `9.288`, 거래원장 v2 프로토콜, ledger SHA-256 revision,
   영구 ID 338/338 중복0 검사. **원본 행·ID·개인 내용 로그 출력 금지**.
3. 배포 스크립트가 기존 게시 소스 **9.288** 및 별도 소유자 확인
   `confirm_9288_migration=true`를 다시 요구. 불일치하면
   content PUT/versions POST/deployment PUT 전에 중단합니다.

배포 후: Apps Script HEAD·published exact source, 버전 readback,
`getAutomationStatus`, 거래원장 ID와 주식·펀드·Snapshot 원가/평가,
기존 배포 rollback 경로를 대조합니다. 실운영에서 가격/NAV
Writer 소스가 달라졌거나 재계산 결과가 불일치하면 즉시 차단·조사합니다.

## 4. 정규 마감 성능·종결 기준

운영 19:33 `runDailyPortfolioClose1900` 최초 실행의
`ISSUE860_CLOSE_STAGE` BUILD/PLAN/WRITE/INTEGRITY 시작·종료,
독립 펀드 작업의 `ISSUE860_FUND_STAGE` VALUATION 타이밍을
**실제 Apps Script 실행기록**과 동기화로그로 비교합니다.

- 첫 실행은 **360초 미만 완료**, Watchdog 재시도 의존 없음.
- `priceOk/fundOk=true`, `closeState=COMPLETE`, 당일 39종
  (거래/상장수량이 변경되면 실제 기대수), 원가+손익=평가,
  중복 0, 펀드 NAV의 공표일/이월 구분 정확.
- 8개 빈 백업 및 1개 `CREATED` 백업은 아직 실행 UID/원본 복사
  시점이 확인되지 않았으므로 삭제·복구에 사용하지 않음.
- 최초 실행 TIMEOUT 뒤 Watchdog으로 회복했다면
  `RECOVERED`이며 `FIRST_RUN_SUCCESS`가 아닙니다.

**이 문서·소스 변경으로 GAS 운영 배포, 거래원장 이관,
텔레그램 전송, 백업 삭제를 수행하지 않습니다.**
