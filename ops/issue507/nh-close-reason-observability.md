# Issue #507 — NH 정규장 종가 수집 비민감 실패 원인 계측

## 확인된 문제
- 현재 보유 국내 주식 16개·ETF 21개는 모두 종목코드 마스터에 있습니다.
- 2026-10-30 기준 37개 종목 가격이력 누락, 같은 날짜 Snapshot은 전부 `KRX_CARRY@2026-10-29`. 가격 오류가 없는 F00001/F00002 확정 NAV는 별개입니다.
- 생산 v9.281 및 후보 v9.282 기존 `fetchNhRegularCloses`는 캐시 미스 건당 1초 대기, 전체 55초 예산, 인증 실패 시 이후 종목 차단, 응답 미존재/날짜 불일치 때 무로그 반환입니다. 10/30 당시 NH 통신 결과/실제 지연은 기록되지 않아 역사적 원인은 여전히 **UNKNOWN**입니다.

## 별도 적용 제안 (기존 GAS v9.282 동결 유지)
**이 PR은 `src/gas/apps_script.gs` 원본을 변경하지 않습니다.** `scripts/issue507-nh-close-reason-source-proposal.mjs`가 기존에 검토된 blob SHA `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`를 검증한 뒤, 메모리 안에서만 `fetchNhRegularCloses`에 고정 enum 집계를 삽입한 차기 릴리스 후보를 구성합니다. 수집 순서, 캐시 키, 중앙 토큰, 요청 페이싱, HTTP API, 응답 가격/날짜/출처, KRX fallback, 예외 시 기존 중단 동작은 그대로 유지합니다. 함수 1회 종료 시 기존 GAS `Logger.log`에 오직 한 번:
`[NH_CLOSE_REASON_SUMMARY] {"mode":"NH_REGULAR_CLOSE_REASON_COUNTS","date":"YYYY-MM-DD","inputCount":N,"returnedCount":M,"reasons":{...},"containsRawProviderData":false}`
- enum: `EXACT_DATE_CONFIRMED`, `CACHE_HIT`, `BUDGET_EXCEEDED`, `PRIOR_AUTH_BLOCKED`, `AUTH_BLOCKED`, `RATE_LIMITED`, `NETWORK_ERROR`, `PROVIDER_ERROR`, `OUTPUT_EMPTY`, `DATE_MISMATCH`, `SCHEMA_INVALID`, `DUPLICATE_DATE`, `INVALID_PRICE`, `IDENTITY_MISMATCH`, `INVALID_CODE`, `SESSION_NOT_READY`, `UNSUPPORTED_MARKET`, `FUND_SKIPPED`, `INVALID_ITEM`, `CREDENTIALS_MISSING`, `INVALID_REQUEST_DATE`.
- `inputCount`는 호출 시 항목 수, `returnedCount`는 캐시값 포함 확보 건수입니다. 사전 자격증명 미구성 시 `reasons.CREDENTIALS_MISSING=1`은 **함수 호출 차단 사건 1건**이므로 개별 항목 37건과 동일하지 않습니다.
- 인증 및 HTTP 오류 원문, 응답 본문, token/URL, 종목코드·이름·가격·거래원장·원천 digest는 로그/결과에 포함하지 않습니다. 무작위 provider 오류문으로 로그를 오염시키지 않습니다. `Logger`가 없거나 실패해도 종가 수집 결과는 바꾸지 않습니다.
- **계측 시각과 실제 과거 사고 시각을 혼동하면 안 됩니다.** 이 로그는 배포 후 발생하는 수집 호출에만 적용되며 10/30 당시 실패 사유를 소급 복원하지 않습니다.

## 회귀 및 배포 경계
`scripts/check-issue507-nh-close-reason-source.mjs`는 **메모리에서만 생성한 계측 적용 제안 함수**와 고정 v9.281 함수를 모두 Node VM에서 동일한 가상 입력·가상시간·가상 NH API·가상 Cache로 실행해, 반환값/호출횟수/1초 페이싱 불변을 확인합니다. 0.4/0.7초 지연, 첫 401/429, 네트워크 오류, 빈 시계열, 전일 날짜, 스키마·가격·코드 불일치, 캐시 전부 hit, 자격증명 미구성을 포함합니다. 로그에서는 비밀값·가격·종목코드 비노출을 독립 단언합니다. **실제 NH/GAS/시트/Telegram 호출 및 금융 원본 쓰기 0건**입니다.

이 PR은 **이미 검토된 GAS 9.282 원본을 변경하지 않으므로 기존 immutable source hash 검증을 유지합니다.** 차후 제안 코드를 실제 GAS에 반영하는 별도의 릴리스 PR을 작성하는 경우에는 기존 9.282 코드 리뷰·source digest·운영 승인을 자동 승계할 수 없습니다. 신규 source hash, reviewer, 555 writer gate 및 무중단 bootstrap/rollback을 재검증하고 사용자 별도 병합·운영 배포 승인을 받아야 합니다. 555 entrypoint writer gate, F00001 이미 NAV 일치, F00002 10/30 NAV 확정, 39행 보존 원칙은 변경하지 않습니다. 이 PR을 병합하거나 CI에 성공하더라도 금융 Snapshot/가격이력 복구는 허용되지 않습니다. #507
