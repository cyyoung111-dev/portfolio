# NH PLUG 한국장 16:00 보유 주식·ETF 종가 커버리지 — 오프라인 계약

**상태: 순수 검증 함수·합성 fixture. 실제 NH API 및 GAS의 보유종목·원장에 아직 연결하지 않았습니다.**

## 기존 운영 코드 재사용 및 분리

- 기존 `scripts/diagnose-krx-held-coverage.mjs` 및 GAS `handleGetKrxHeldCloseCoverage`는 **KRX 공식 원천의 거래일별 보유종목 커버리지**를 집계합니다. 이를 변경하지 않습니다.
- 새 `auditNhHeldCloseCoverage`는 NH 제공 **당일 잠정 정규장 종가**의 **보유종목 전체 커버리지**를 별도로 검사합니다. 이 값으로 공식 KRX 종가나 원장·Snapshot을 갱신하지 않습니다.
- 검증된 종목 분모를 정수 37개 등으로 고정하거나 NH 응답에서 역산하지 않습니다. 대상일의 **GAS 거래원장 기준 보유량 및 종목마스터**가 각각 검증·생성된 스냅샷을 요구합니다.

## 입력 정규화 계약 (미연결)

- `ledgerSnapshot`: `source=GAS_VERIFIED_ASOF_LEDGER`, `asOfDate=해당 거래일`, `verified=true`, `positions=[{code,quantity}]`; 여러 계좌에 동일 종목을 보유하면 1개 종목으로 합산합니다.
- `masterSnapshot`: `source=GAS_VERIFIED_CODE_MASTER`, `asOfDate=해당 거래일`, `verified=true`, `items=[{code,kind,market,currency,listingState,listingStateAsOf}]`. `STOCK/ETF`·KRX 국내·KRW·6자리 코드만 포함하고 펀드·외국시장 등은 분모에서 분리합니다.
- `observations`: NH 시세 제공 시각·원본 거래일과 대상일, KRX 정규장 구간, NH 원천이 명시된 가격 정규화 행만 검증합니다. NXT/시간외/과거 종가/실시간 현재가/공식 확정으로 오표기된 값은 반려합니다.
- 입력 `verified=true`는 호출자가 공급하는 **선행 검증의 주장**일 뿐입니다. 실제 생산 GAS의 보유수량·종목마스터 생성과 인증된 출처 확인까지 입증하지 않으며, 운영 연결 시 독립 검증해야 합니다.

## 실패 시 엄격한 차단

| 상황 | 처리 |
|---|---|
| 동일 종목 여러 계좌 보유 | 합산하되 분모는 한 종목 |
| 당일 원천일자 불일치·미조회 | 미확보 |
| 동일 종목 가격 행 2건 이상 | 전체 자료를 신뢰할 수 없으므로 해당 종목 차단 |
| 마스터 중복·원장에만 있는 코드 | 차단 및 문제 건수 표시 |
| 거래정지·상장폐지·확정되지 않은 상장상태 | 전일종가를 대신하지 않고 해당 종목 미확보로 유지 |
| 해외주식·펀드·잔여수량 0 | 검증된 코드마스터 유형에 따라 국내 종가 분모에서 제외 |
| 국내 거래소/통화 정보 불일치 | 명시적 오류, 조용한 제외 금지 |
| 예기치 않은 NH 코드·허위 가격·15:30 이전 또는 선택된 브리핑 기준시각(최대 16:10) 이후 수신 | 커버리지 불충족 |
| 보유종목 0건·휴장·미확인 달력 연도 | 정상 완료로 선언하지 않음 |

응답은 **시장별/전체 건수·사유별 건수만** 반환합니다. 실제 계좌번호·종목코드·종목명·수량·가격을 CI 로그에 출력하지 않습니다.

## 실운영 반영 전 남은 검증

1. GAS의 날짜별 실제 거래원장 및 코드마스터에서 **읽기 전용**으로 대상일 보유종목 스냅샷을 산출하고, 거래원장/코드마스터 버전·생성 시각을 추적·검증합니다.
2. NH `currentDaily`의 실제 응답 `bsop_date`·`stck_clpr`, 주식/ETF 분류 및 조회 제한을 실계정으로 검증합니다.
3. 당일 보유종목 전체를 **읽기 전용**으로 조회해 누락·중복·거래정지 예외·종목코드를 감사하고 16:00 전 수집 완결성 측정.
4. 메시지 PR #701과 연결하고 공식 확정이 아닌 **잠정 정규장 종가**로만 표시. 평가손익은 매수원가·보유수량 날짜 정합성이 확인될 때까지 표시 금지.
5. 전체 CI, 최신 독립 리뷰 및 별도 승인 전 운영 GAS·GitHub Actions·Telegram 예약·기존 원장 수정 금지.

**테스트 성공은 모의 데이터 처리 성공이지 실제 사용자 계좌의 종가 수집 성공은 아닙니다.**


## PR #705·#706 연결 안전 게이트 (2026-10-29)

PR #704의 auditNhHeldCloseCoverage는 검증 완료된 거래원장·코드마스터와 대상 거래일별 상장상태·NH 당일 KRX 정규장 시세가 필요합니다. PR #705와 #706은 이러한 증거를 모두 갖추지 못했습니다.

| 출력 공급자 | 출력 상태 | 추가 확인해야 하는 근거 |
|---|---|---|
| #705 기존 GAS 개별 호출 브리지 | CANDIDATE_NON_ATOMIC_UNVERIFIED / verified:false | 원자적 스냅샷, 과거 상장상태, 원천 이력 |
| #706 ScriptLock 이중읽기 제안 | READ_ONLY_PROPOSAL / verified:false | 외부 Sheets API·직접편집·ABA 경쟁, 상장상태 |
| #704 NH 국내 종가 검사 | 미검증 원장 직접 거부 | 원천 검증 이전에는 완료 불가 |

새 모듈 scripts/nhplug-held-coverage-integration-gate.mjs는 #705와 #706 형태의 후보에 대해 항상 BLOCKED_SOURCE_UNVERIFIED를 반환합니다. 사용자가 후보의 verified를 임의로 true로 바꾸거나 ACTIVE 상태를 주입해도 안전 게이트에서 전송·금융데이터 변경은 금지됩니다.

새 회귀 테스트는 **실제 #704 auditNhHeldCloseCoverage 생산 함수**와 #705/#706의 알려진 출력 형식을 재현한 합성 데이터로 검증합니다. 외부 PR 브랜치 소스는 직접 import하지 않았으므로 이 단계는 버전간 E2E 검증이 아니라 **경계 계약 검사**입니다. 이후 PR 병합 시에는 실제 공급자 구현과 함께 통합 테스트를 다시 실행해야 합니다.

NH 실 API·GAS 운영 데이터·텔레그램과 연결되지 않았으며, 원장·시세·토큰은 CI 로그에 남기지 않습니다. 원자적 원천 증거와 거래정지 상태의 유효일을 확인하기 전에는 어떠한 입력도 자동으로 verified:true로 승격하지 마세요.


## 종목코드 유효일·과거 거래정지 상태 검사 (2026-10-29)

PR #704에 `scripts/nhplug-listing-asof-contract.mjs`를 추가했습니다. **현재 마스터의 ACTIVE 상태를 과거 시점에 그대로 적용하지 않습니다.**

입력 코드마스터의 국내 보유종목별로 다음 이력을 요구하는 합성 계약입니다.

- `securityId`: 종목코드가 재사용되는 경우 다른 증권을 혼동하지 않도록 증권 단위의 별도 식별자
- `listingEvidence`: `source=KRX_OFFICIAL_HISTORY`, `verified=true`, `recordId`, 동일 `securityId/code`
- `codeValidFrom`: 코드 효력 시작일(포함)
- `codeValidUntilExclusive`: 코드 효력 종료일(미포함), 없으면 `null`
- `periods`: `{state,from,untilExclusive}`의 시간순 목록. `ACTIVE`, `SUSPENDED`, `DELISTED` 상태로 관리하며 겹치는 구간은 거부
- 대상일의 상태 구간이 정확히 하나이고 해당일 기준의 `listingState`·`listingStateAsOf` 메타데이터와 일치할 때만 ACTIVE를 허용

**거부 사유를 구분합니다:** 거래정지는 `SUSPENDED_HELD_CODES`, 상장폐지는 `DELISTED_HELD_CODES`, 코드 만료는 `CODE_EXPIRED`, 아직 유효하지 않은 코드는 `CODE_NOT_YET_EFFECTIVE`, 상태 이력 미확보·중복·기간 공백은 별도 코드로 반환합니다. 거래정지는 NH 가격이 없는 경우에도 `NH_CLOSE_MISSING`과 구분합니다.

이력은 과거 일자에 대해 평가합니다. 예를 들어 2026-10-28 ACTIVE, 2026-10-29 SUSPENDED이면 28일의 ACTIVE 상태가 29일 현재 정지상태로 덮어써지지 않습니다.

**중요한 출처 제약:** 위의 `source` 이름과 `verified:true`만으로 실제 KRX의 공식 이력을 인증할 수 없습니다. 현재 PR에서 이 필드는 합성 fixture이며, 실제 운영에서 독립적으로 검증된 종목코드·상장상태 이력 공급자와 원본 레코드 검증을 연결하기 전에는 사용자가 임의 생성한 이력을 신뢰해서는 안 됩니다. PR #705/#706은 여전히 해당 과거상태 증거를 제공하지 않으며 #704의 `verified:true` 입력을 만족하지 못합니다.

정상·정지·상장폐지·기간경계·코드 재사용 식별자 불일치·중첩·과거 상태 판정은 `scripts/check-nhplug-listing-asof-contract.mjs`에서 실제 커버리지 함수로 검증합니다. 실 NH·GAS·Telegram 호출은 없습니다.


## 종목코드 변경·합병·분할·ETF 청산 처리 (합성검증, 2026-10-29)

국내 보유종목의 상장 상태가 ACTIVE인 것만으로 **원장상 원래 보유종목 코드와 현재 거래 가능한 코드가 같은 증권**이라고 간주하지 않습니다.

- `scripts/nhplug-corporate-action-asof-contract.mjs`는 대상일 현재 기업행위 확인 기록을 요구합니다.
- 입력 `corporateActionEvidence`는 단일 `securityId`와 `code`, 원본 `recordId`, `coveredFrom/coveredThrough`, `events`의 시간 순 배열을 사용합니다. 인증된 공식 KRX 기업행위 이력을 **미리** 확보한 것으로 인정하지 않습니다. 이 PR에서는 합성 fixture뿐입니다.
- `CODE_CHANGE`: 같은 증권 식별자의 종목코드 이전만 의미합니다. 대상일 이후의 코드 교체는 기존 코드 보유수량을 자동 치환하지 않으며, 원장 보정 증빙 없이는 양쪽 코드 모두 차단합니다.
- `MERGER`: 피합병회사와 합병회사의 `securityId`가 달라야 합니다. 합병 비율·현금교부·과거 매입원가는 이 함수로 추정하거나 재계산하지 않습니다.
- `SPINOFF`: 분할신설회사 증권 식별자를 별도로 기록하고 배분된 신주·기존 수량·취득원가 증빙을 확인하기 전 자동 매핑하지 않습니다.
- `SPLIT` / `REVERSE_SPLIT`: 기초 주식 수량 비율 정보를 정수로 검증하지만 원장의 과거 수량을 다시 계산하지 않습니다. 일치 증빙이 없으면 차단합니다.
- `ETF_LIQUIDATION` / `DELISTING`: 최종 NAV·청산금·현금 수취일·세금을 모의로 계산하지 않으며, **종가 누락**이 아니라 별도 정산 확인 필요 상태로 표시합니다.
- 발효일 **이전**의 역사적 보유상태는 나중에 발생한 기업행위로 덮어쓰지 않습니다. 같은 날짜에 복수 기업행위가 발생하면 순서를 임의로 정하지 않고 차단합니다.

`auditNhHeldCloseCoverage`는 상장상태 이력을 통과한 보유종목에 대해 기업행위 이력을 다시 확인합니다. 상장상태가 ACTIVE이고 NH 가격이 있더라도 해당 기업행위 정합성이 불충분하면 `readyForProvisionalMessage=false`이며 `NH_CLOSE_MISSING`과 구별합니다.

단순 `verified:true`나 `source=KRX_CORPORATE_ACTION_HISTORY`는 실제 공식자료 인증을 보장하지 않습니다. 실제 GAS 거래원장·기업행위 원천·청산 지급내역을 읽고 서로 일치시키는 **별도 신뢰 경계**가 확보될 때까지 이 코드는 보고서·가격이력·Snapshot을 변경하지 않습니다.


## 기업행위 전후 원장 수량·매입원가·현금 검산 (2026-10-29)

추가한 `scripts/nhplug-corporate-action-ledger-reconciliation.mjs`는 금융 데이터를 쓰지 않는 수학적 검산 함수입니다. PR #704의 기존 기업행위 차단 규칙은 **그대로 유지**합니다.

- 거래 전후 스냅샷은 `GAS_READONLY_ASOF_UNVERIFIED`이고 날짜·ledgerFingerprint·원본/승계 코드와 고유 증권 식별자를 요구합니다. 서로 다른 계좌의 집계나 수동 원장 수정에 대해 원자적 증명은 제공하지 않습니다.
- 주식 수량은 소수점 **4자리까지** 정수로 바꿔 정확하게 비교하고, 취득원가는 **원 단위 정수**로 비교합니다. 가격 추정·평균매입단가 역산·세무 원가배분은 수행하지 않습니다.
- **코드 변경:** 기존 코드 잔여수량 0, 승계 코드 기존 보유 0, 이전/이후 수량 및 총 취득원가 일치를 검사합니다. 숫자가 일치해도 원본 거래내역 확인 전 `ARITHMETIC_MATCH_PROVENANCE_UNVERIFIED`로 차단합니다.
- **분할/역분할:** 정수 비율로 수량만 비교하며 취득원가가 보존되는지 확인합니다. 단주가 생기는 경우에는 임의 반올림하지 않고 `FRACTIONAL_UNIT_SETTLEMENT_REQUIRED`로 차단합니다. 단주정산금의 원가배분은 별도 증빙이 필요합니다.
- **합병:** 승계회사 보유수량과 피합병회사 잔여가 맞더라도 실제 신주 교환비율·현금 교부·취득원가 조정 근거가 없으므로 `MERGER_EXCHANGE_TERMS_UNVERIFIED`로 보류합니다.
- **인적분할:** 분할신설회사 주식이 장부에 생겼더라도 신주 배정비율과 매입원가 배분이 확인되지 않으면 `SPINOFF_BASIS_ALLOCATION_UNVERIFIED`입니다.
- **ETF 청산:** 청산금 원장 입금액과 별도 청산금 청구증빙의 금액이 같아도 원본 지급내역·최종 NAV를 신뢰할 수 없으므로 `ETF_CASH_MATCH_ENTITLEMENT_UNVERIFIED`로 남깁니다. 실제 현금 수취·원금 회수·손익·세금의 최종 확정은 별개입니다.
- **상장폐지:** 반드시 현금 지급을 전제할 수 없으므로 `DELISTING_SETTLEMENT_METHOD_UNVERIFIED`로 보류합니다.

모든 결과에서 `ledgerVerified=false`, `accountLineageVerified=false`, `readyForCoverage=false`, `canWriteLedger=false`, `canWriteSnapshot=false`, `canSendTelegram=false`를 반환합니다. 입력 거래내역·가격·계좌정보를 로그/결과에 출력하지 않습니다.

이 검산은 합성 fixture를 통한 **산술 일치**만 의미합니다. 기존 GAS reducer의 세무/단주 처리나 실제 기업행위 원본의 출처·원자성에 대한 승인이 아니며, 별도 독립 리뷰와 운영증빙 전에는 #704 커버리지 검사에서 계속 차단합니다.


## 기업행위 원본 증빙과 GAS 거래원장 행 연결 검사 (2026-10-29)

새 `scripts/nhplug-corporate-evidence-ledger-links.mjs`와 `scripts/check-nhplug-corporate-evidence-ledger-links.mjs`는 기존 PR #704에만 추가한 **읽기 전용·합성 검사**입니다.

- GAS v9.275 거래원장 11개 열의 실제 구조(`날짜/거래유형/계좌/종목명/종목코드/수량/단가/자산유형/메모/비율/단주정산`)를 그대로 검증합니다. 데이터 자체는 편집하지 않습니다.
- 전체 조회 원장 해시(SHA-256)와 매 행 해시, 행 위치, 기업행위 ID, 계좌별 증빙 ID, 효력일 및 원장상 종목코드 일치 여부를 검사합니다.
- 영향받는 계좌 목록과 증빙 문서가 **계좌당 정확히 하나씩** 존재해야 하고, 연결한 거래행이 중복되거나 누락돼서는 안 됩니다. 기존 GAS 원장에는 기업행위 자체의 고유 ID가 없으므로 모든 연결은 **별도 주석/증빙 후보**이며 거래원장의 원자성을 보장하지 않습니다.
- 동일한 효력일·종목·계좌에서 유사 거래가 더 발견되었는데 행사 증빙과 연결되지 않은 경우, 임의의 시장매수·매도로 판단하지 않고 `LEDGER_EVENT_ROWS_UNLINKED`로 보수적 차단합니다.
- **코드 변경**은 원본 코드 매도와 승계 코드 매수가 동일 계좌에서 동일 수량인지 확인합니다. **분할·역분할**은 원장에 기입된 비율과 기업행위 기록의 정수 비율을 교차 비교합니다.
- **ETF 청산**은 계좌별 해당 종목의 출고 처리와 별도의 현금 수취 증빙(계좌·기업행위 ID·수취일·원화 금액)을 확인합니다. 금액 자체는 최종 NAV/지급사실로 인증하지 않습니다.
- **합병·인적분할·상장폐지**의 복잡한 교환·정산을 현재 일반 매수/매도 GAS 행으로 자동 추정하지 않으며, 독립된 명시적 이벤트 원장/확인 기록 없이는 `EVENT_LEDGER_MAPPING_UNSUPPORTED`로 거부합니다.

각 출력은 계좌번호·종목명·종목코드·수량·단가·해시를 노출하지 않고 **오류 사유와 확인 건수만** 반환합니다. 모든 합성 검사가 일치해도 `sourceVerified=false`, `canPromoteCoverage=false`, `canWriteLedger=false`, `canWriteSnapshot=false`, `canSendTelegram=false`입니다. 임의로 작성 가능한 해시나 `KRX_ACTION_RECORD_CLAIM_UNVERIFIED` 문자열은 공식 원본 입증이 아닙니다.

본 계약은 실제 원장/공식 KRX 증빙에 연결되지 않았으므로 금융 원장 변경이나 운영승인을 자동으로 생성하지 않습니다. 추후 실배포하려면 원장 조회의 인증·원자성, 이벤트 증빙 원본의 서명 또는 신뢰 가능 출처, 계좌별 기준일 보유량 완전성을 별도로 대조해야 합니다.
