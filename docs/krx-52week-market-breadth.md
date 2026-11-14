# KRX 52-week market breadth — 252 trading-session data contract

## 2026-11-14 #734: 종목기본정보 원천 권한·판정 프로세스 보완

- **실증 문제:** [run #43591485713](https://github.com/cyyoung111-dev/portfolio/actions/runs/43591485713)은 원래 워크플로 SUCCESS였으나 실제 결과는 `status=SOURCE_UNVERIFIED`, `KOSPI=KRX_SERVICE_APPROVAL_REQUIRED`, KOSDAQ 미조회였다. GitHub 초록색 상태를 데이터 취득 성공으로 오판할 위험이 있었다.
- **실조회 보완:** [main run #43592555155](https://github.com/cyyoung111-dev/portfolio/actions/runs/43592555155)는 동일 기본정보 API에서 이번에는 HTTP **401**을 반환해 기존의 공통인증 실패 판단이 다시 KOSDAQ 독립 검사를 막았다. KRX는 서비스별 승인에 따라 401/403을 반환할 수 있어 **HTTP 상태만으로 공통 인증키 오류·서비스 권한·IP 제한을 확정할 수 없다**. 이를 반영해 **401과 403 모두** 각 시장별로 정확히 한 번씩 체크하고, `401=KRX_HTTP401_ACCESS_DENIED`, `403=KRX_HTTP403_ACCESS_DENIED`로 원인 추측 없이 기록한다. 키 자체 부재·429 호출 제한일 때만 두 번째 호출을 중단한다. 어떠한 경우에도 자동 재시도/가격 원본 쓰기/종목정보 업로드는 없다.
- **정상 가동 판정:** 두 원천 모두 성공하고 KRX 252일 현재 종목 전체에서 공식 상장일/식별자 대사가 충족된 경우에만 일회성 감사 워크플로 0 반환. `SOURCE_UNVERIFIED`, `ARCHIVE_STALE`, `PARTIAL_OR_IDENTITY_CONFLICT`은 **명시적 non-zero**로 종료해 GitHub 결과를 미검증 상태로 표시한다. 공식 권리변동·수정 OHLC·거래정지 원인까지 입증되지는 않으므로 녹색 상태에서도 `publicationAllowed=false`는 유지.
- **다음 외부 선행조건:** KRX 홈페이지에서 유가증권·코스닥 **종목기본정보 각각 서비스 활용신청과 승인 확인** 후 단 한 차례 읽기 전용 재실행. 코드 수정을 반복해 403을 우회하거나 보유 인증키·Sheet를 변경하지 않는다.

## 2026-11-14 #734: 상장일 공식 원천 대조 준비 — KRX 기본정보 2종 (일회성 승인점검)

**KRX 공식 추가 원천:**
- 유가증권 `/svc/apis/sto/stk_isu_base_info` [공식 안내](https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=PiwgMdTwmsenXhmqqxuj)
- 코스닥 `/svc/apis/sto/ksq_isu_base_info` [공식 안내](https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=CifLHplnUFMgpHIMMPXs)

**검증기:** [`scripts/krx-52week-listing-metadata-readonly.mjs`](../scripts/krx-52week-listing-metadata-readonly.mjs)와 [일회성 감사 워크플로](../.github/workflows/krx-52week-listing-audit-readonly.yml).
- 기존 252/252 암호화 KRX OHLC 저장을 GitHub Actions runner 안에서만 복원하고, 동일 기준거래일 `basDd`의 **공식 종목기본정보**를 두 경로에서만 읽기 전용 호출한다. `ISU_SRT_CD`(단축 6자리), `ISU_CD`(표준 12자리), `LIST_DD`(상장일), `SECUGRP_NM`·`KIND_STKCERT_TP_NM`(증권/주식 종류)을 엄격하게 점검한다.
- 신규 관측종목의 최초 유효 OHLC 날짜와 **실제 상장일**을 비교해 52주 창 안에 상장한 경우와 이미 상장된 뒤 비정상적으로 늦게 관측된 경우를 구분한다. 관측 후 공백 종목도 상장일과 비교하지만 **공백 원인을 거래정지·상장폐지·분할·종목코드 변경으로 확정하지 않는다**. 상장일이 기존 확인된 시세보다 뒤이면 시계열/종목식별자 충돌로 진단한다. 당일 OHLC 미존재 종목의 가격은 임의 보정하지 않는다.
- 연결 성공 여부는 기본정보 API **서비스별 이용 승인**에 종속된다. 기존 `KRX_AUTH_KEY`에서 시세 2종이 된다고 기본정보 2종의 승인도 있다고 추측할 수 없다. 공식 안내상 서비스 활용신청 후 관리자 승인이 필요하다. [KRX 이용절차](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp). 미승인 시 `KRX_SERVICE_APPROVAL_REQUIRED`로 분류하고 자동 재호출하지 않는다.
- 이 워크플로는 **cron 없음**, 모듈/워크플로의 `main` 변경 시 최초 1회 및 명시적 수동 호출만 허용. 운영 KRX 수집, NAV, GAS, Sheets, Portfolio 원본, Telegram, Secrets, 예약 정의를 수정하지 않는다. **공식 API 원본/가격/종목별 상장정보 아티팩트 업로드 없음**. 콘솔에는 상장일별 일치/불일치 집계와 고정 상태값만 출력.
- 성공하더라도 `marketWideCertified=false`, `publicationAllowed=false`: 상장일 일치만으로는 과거 액면분할·무상증자 권리조정과 거래정지 공식 이력, 전 시장 모집단 및 라이선스가 증명되지 않는다. **실제 52주 공인 지표 발행은 계속 차단**한다.

## 2026-11-14 #734: 전 종목 모집단 제외 사유 진단 (source-only)

- [`audit52WeekHistoryEligibility`](../scripts/krx-52week-market.mjs)은 오늘 KRX 원시 OHLC에 포함되는 **각 종목**을 기존 252거래일 봉으로 추적한다. 기존 `countNewHighsAndLows`의 엄격한 과거 251영업일 모집단과 계산 결과는 **수정하지 않는다**.
- `fullHistory`: 252거래일 모두 거래 가능한 고가·저가 존재(기존 52주 raw count의 모집단). `lateFirstObservedContinuous`: 252일 창 중간에 처음 나타난 뒤 오늘까지 봉이 끊기지 않은 종목; **신규상장 후보일 뿐 상장확정이 아님**. `interruptedAfterFirstObserved`: 첫 관측 이후 누락일이 있는 종목; 거래정지·종목 식별자 변경·공시 이벤트·원본 부재를 **구분하지 못한 진단 후보**. `oneDayOnly`는 과거 봉이 아예 없어 첫날 신고가로 부를 수 없는 종목이다.
- `shortHistoryCandidateHighs/Lows`는 `lateFirstObservedContinuous` 중 **첫 관측 이후의 구간**에만 한정한 원시 고가/저가 참고 수치로, 공식 52주 신고가·신저가 **합산에서 제외**한다. 출력에는 실제 가격·금융 보유정보·계좌를 싣지 않는다. `observedToday`와 `noValidOhlcToday`도 구분해 거래정지일 가능성이 있는 당일 미거래를 그날의 최저가로 합성하지 않는다.
- 전체 진단은 `source-only` 수집 완료 후 암호화된 OHLC 아카이브와 함께 출처 요약에만 기록된다. 반드시 `publicationAllowed=false`, `marketWideCertified=false`, `listingEventsVerified=false`로 제한한다. 테스트의 합성 불연속 기록/IPO 후보를 진짜 상장 및 분할 공시로 추정하지 않는다.
- **다음 실증 조건:** KRX 상장일·거래정지·종목변경 공식 이력과 날짜별 1:1 매칭, 기업행위 수정 고/저가(KIS 등) 검증, 보통주/우선주/ETF/ETN 분모 명확화 및 합법적인 전체시장 재배포 승인. 승인 전 기존 52주 브리핑 발행 차단 유지.
- **기존 NH PLUG 근거 재점검:** [국내 기간별 시세 공식 SDK 예제](https://github.com/PLUG-OpenAPI/nhplug-sdk/blob/main/snippets/krstock/period/period.py)는 `market_cd=KRX`, `view_main_yn=Y`, `Output_1` 및 이어조회만 명시. **수정주가/원시주가 선택·권리조정 여부가 명시되지 않아** KIS 수정주가를 대체할 수 없다. KIS의 `inquire-daily-itemchartprice` `0=수정`와 별도의 `inquire-daily-price` `1=수정` 예제가 상충하므로, **서로 다른 TR의 flag를 혼용하지 않는다** ([KIS period](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py), [KIS 30-day](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_price/inquire_daily_price.py)).

## 2026-11-14 #734: KIS 수정주가 252일 정합성 검증 구현 (OFFLINE audit only)

**실행한 프로세스 점검:** [2026-11-14 05:57 KST 실제 source-only run #43506294072](https://github.com/cyyoung111-dev/portfolio/actions/runs/43506294072)에서 252/252 KRX 원시 OHLC가 *추가 요청 0건*으로 검증되었다. KRX 봉 저장/암호화·공식 익일 데이터의 출처가 문제인 것은 아니다. 예약 시각(전일 23:30) 대비 실제 GitHub schedule은 약 6시간 27분 지연되었지만, 이 수집기는 **데이터를 작성·발행하지 않는 source-only**이며 현재 필요한 마지막 KRX 완성 거래일(2026-11-12) 기준으로 실행되었다. GitHub schedule 지연은 다른 NAV 워크플로의 실시간 기동까지 보증하지 않는다.

**추가한 소스-비교 단계:** [`scripts/krx-52week-kis-adjusted-audit.mjs`](../scripts/krx-52week-kis-adjusted-audit.mjs).
- 공식 KIS 기간별시세 `FHKST03010100`, 경로 `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`, KRX `J`, **`FID_ORG_ADJ_PRC=0`은 수정주가** (1은 원시가격). 영업일 252개를 **100/100/52개 정확한 KRX 날짜 범위**로 3개 요청으로 계획한다. 실제 KIS의 한 번의 응답 최대 100행이라는 제한을 반영했다.
- KIS `output2`의 영업일·수정 고가·저가·종가를 날짜별 252/252 고유성/양수/OHLC 포함관계로 검증한다. 공휴일·부분응답·중복·대상일 불일치·원시 OHLC 기준 최신 고가/저가/종가 불일치는 **fail closed**.
- 기존 252일 KRX archive와 동일 종목의 원시/수정 신고가·신저가 판정을 **읽기 전용 1종목 감사**로 대조한다. 합성 2:1 분할 사례에서 raw 신고가 NO → adjusted 신고가 YES, 허위 최신가·부분 기간·중복 응답 거부를 회귀검증한다.
- **본 PR에는 KIS 계정/앱키/실제 토큰, 실조회, 전체 종목 수집/속도제한 대응, 라이선스 및 ETF/우선주/신규상장 모집단 검증이 없다.** 보유자료·GAS·Sheets·Telegram·Secret·운영 예약 변경도 없다. 그래서 신규 audit 결과는 `marketWideCertified=false`, `publicationAllowed=false`이며 공식 52주 통계로 홍보하지 않는다.
- 실제 연결은 (1) KIS 개발자 계정·시세 사용조건과 rate-limit 확보, (2) 1~3개 권리변동 종목의 수정주가 252일 live 응답·KRX 최신가 대사, (3) 야간 별도 source-only 일별 증분 + 전종목 정밀한 종목코드·IPO·거래정지 분모 정의, (4) 승인된 전체시장 조정 통계 교차 검증, (5) 기존 브리핑과 독립한 추가 CI·릴리스 심사 순서이다.
- 과거 raw 252일 기록이 완전하더라도 수정주가 쪽 데이터는 기업행위 발생 후 **과거 값이 소급 변경**될 수 있다. KIS를 사용할 때는 조회 시각·as-of·원본 검증 범위를 함께 기록해야 한다. 가격 비교 하나만으로 모든 권리변동이 검증됐다고 할 수 없다.

공식 KIS 예시: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py .

## Purpose and boundaries

This pipeline computes the **number of individual KOSPI and KOSDAQ stocks making a strictly new 52-week intraday high or low** from 252 complete, validated KRX stock-daily OHLC sessions. This is not the same as:
- a price/52-week range for an index, VIX, or seven selected assets;
- a one-day KRX advance/decline (A/D) count;
- an official exchange-published market-wide high/low count.

`scripts/krx-52week-market.mjs` requires an *exact* 252-session window in both markets, uniquely dated and without hidden holidays or duplicates. Today's high must **exceed** the maximum high from the previous 251 market sessions to count as a new high; today's low must be **below** the previous 251-session minimum to count as a new low. Ties are not counted. Only stocks with all 251 historical daily OHLC observations are eligible: recent listings, suspensions and changed identifiers are excluded from counts. The output identifies the eligible and excluded universe. Values are **raw KRX OHLC, not corporate-action-adjusted**; do not present them as split-adjusted or a KRX-certified market statistic.

## Incremental source-only collector

Workflow: [`.github/workflows/krx-52week-history.yml`](../.github/workflows/krx-52week-history.yml).

- Main-only, protected existing `KRX_AUTH_KEY`; accepts only KRX official KOSPI stock and KOSDAQ stock daily routes. No GAS URL/token, user positions, account data or Telegram token.
- Each completed **date-pair** is validated together; no partial market/date mixing.
- Fetches at most **60 still-missing sessions** per main push or scheduled execution, or 12/30/60 on manual dispatch. Rate-limit/auth responses stop the batch. On a fully populated 252-day window the normal run fetches **zero** historical date pairs; next KRX open-day publication rolls the window by one.
- The GitHub repository is **public** and the KRX OPEN API terms prohibit redistribution of data received from KRX. Starting with the reviewed sealed-source migration, `krx-52week-archive` stores **only authenticated AES-256-GCM-encrypted, gzip-compressed raw OHLC** (`history.k52e`) plus a derived audit summary (60-day retention). Runner-local plaintext history is NEVER uploaded. The existing protected `KRX_AUTH_KEY` derives the archive key via HKDF without adding another external service or secret; **rotate the KRX key only after the latest archive is re-sealed or backed up**, otherwise old ciphertext becomes unreadable. A compromised source key also compromises historic ciphertext.
- The migration permits precisely one known prior validated plaintext artifact run **#43433853869**, then all future runs must authenticate and decrypt the sealed archive. Earlier public plaintext artifacts are **not automatically deleted** by this update; they require an independently verified retention/cleanup decision and should not be described as already removed. No commits or workbook writes.
- **One scheduled source-only run at 23:30 KST Monday–Friday.** The previous 18:40 daily poll was redundant because daily KRX Open API is T+1: 11/13 21:28 KST live proof returned HTTP 200 and zero rows for all five 11/13 stock/index routes, but verified 11/12 source. Removing 18:40 also avoids waking the existing NAV workflow around the 19:00 portfolio-close critical section. GitHub schedule is best-effort; its failure remains a **shared scheduling failure domain**, not an independently guaranteed backup.
- The release-eligible count is **the prior completed KRX open session, after 08:15 KST on its next KRX open day**. Friday data first becomes eligible Monday morning (unless KRX holiday); source responses still must match exact published dates. No same-day 17:00 KRX VKOSPI or turnover is inferred.
- Existing archive validation failure stops the run; it does **not** silently reset history and publish false counts.
- Before the full 252-day source archive exists, the result is explicitly `HISTORY_INCOMPLETE`, with `markets=null`; zero or last-known values must never replace missing history.
- Calendar: production GAS-confirmed KRX holiday map for 2026/2027; the narrow 2025 October–December overlap uses reviewed dates including the 2025-12-31 KRX year-end closure. Dates outside the reviewed calendar fail closed.

## Raw-OHLC quality audit (diagnostic, not adjusted values)

A complete source window is **necessary but insufficient** for an adjusted
market-wide 52-week high/low statistic. The source-only collector now emits
`quality.status=RAW_DISCONTINUITY_REVIEW_REQUIRED` only after 252/252 source
dates pass. For each market it reports:

- `observedToday`, `eligible`, `eligiblePct` and `shortHistory`:
  short-history/suspended/new codes are excluded from a *continuous 251-session*
  historical high/low test, and this denominator is disclosed.
- `discontinuityCodes`: eligible securities with a raw close-to-close move
  exceeding **31% in absolute value** anywhere in the 252-day window. This
  flags a **potential price-basis discontinuity**, not a verified share split,
  rights adjustment or corporate event. A 30% limit-day move does not trigger
  it. The 31% threshold is a conservative *screen*, not a reconstruction.
- `flaggedHighs`, `flaggedLows`, and `flaggedExtremes`: which counted raw
  extrema require further action/source investigation. Public stock codes and
  the date/direction of the last suspicious change are recorded; no price
  adjustments or source-derived share counts are invented.

**Verified 2026-11-12 raw baseline:** 252 complete sessions, KOSPI eligible
793/911 (87.0%), KOSDAQ 1366/1753 (77.9%). Eligible names with a raw >31%
session: KOSPI 6, KOSDAQ 29. Suspect raw newly-low counts: KOSPI 1,
KOSDAQ 2. These are *candidates to investigate*, not three certified corporate
actions or an authorization to subtract three and call the remaining 47
fully adjusted. The primary raw 52-week counts remain unchanged; **Telegram
integration stays disabled** until separate official corporate-action/adjusted
price comparison and universe methodology are verified.

## 2026-11-13 #4 methodology decision — raw source complete, official adjusted breadth NOT certified

- **Completed:** KRX Open API source-only 252/252 observed sessions and
  reproducible 31%-jump/eligible-universe quality audit. Real raw highs/lows:
  KOSPI 4/25, KOSDAQ 6/25 on 2026-11-12. Never promote this to an
  *adjusted market-wide 52-week* high/low value or 17:00 Telegram.
- **Verified caution examples:** 009140 2026-10-20 bonus-issue ex-rights,
  290650 2026-10-26 bonus-issue ex-rights, and 475460 2026-09-16
  bonus-issue ex-rights correspond to three flagged raw new lows.
  See https://alphasquare.co.kr/home/stock-issue?code=009140&type=disclosure ,
  https://www.bosoop.com/disclosures/20261023900853/ ,
  https://dartbrief.com/disclosures/20260915900714 .
  **Do not compute an adjusted result by simply subtracting three.**
  Not all 35 suspicious returns are confirmed corporate actions; smaller
  rights impacts can occur without exceeding the 31% screen.
- **Official source limitation:** daily raw-OHLC KRX OPEN API does not expose
  split-adjusted historical prices. KRX Data Marketplace historical
  period-range screens offer an adjusted-price option, but their output
  must be separately licensed/approved; do not scrape or silently substitute
  a source/asset without a verified permission, identifier, as-of, history
  adjustment factor and value/market reconciliation.
- **Universe choice:** continuous 251 preceding sessions excludes 118/911
  KOSPI and 387/1753 KOSDAQ current-session codes. The 22.1% KOSDAQ
  exclusion makes it unfit as a market-wide breadth label. Distinguish
  new listings, trading halts, code changes, delistings and corporate actions
  using confirmed listing/event references before redefining the denominator.
- **Done means:** approved adjusted high+low histories for each eligible
  security or official equivalent provider counts; certified time basis
  through the latest T+1 release; verified 52-week rule/universe including
  IPOs; exact source/date comparison and permitted redistribution.
  Without that full evidence the existing source-only gate and diagnostic
  are the final responsible state. This is a **blocked data-source
  dependency**, not a daily portfolio/GAS reconciliation failure.

## Operational proof required before briefing integration

1. Source-only workflow run and archive pass for both markets; inspect the **actual API response** schemas (especially KRX daily high/low) and API failure codes.
2. **Completed 2026-11-13**: source-only run #43427452090 restored 248 and fetched the last four pairs, proving 252/252 official raw OHLC market sessions (2025-11-03–2026-11-12). Preserve the real historical range and distinct eligible/excluded universe. Continue to independently compare an adjusted 52-week high/low benchmark where possible; full dates alone do not certify market-wide adjusted breadth.
3. Validate impact of splits, consolidations and ticker changes before describing this as a market-wide fully adjusted statistic.
4. Only then optionally connect the dated summary to the 07:40/17:00 Telegram formatter with source/quality badges, without slowing primary delivery or reopening the current close/NAV writer.

The workflow itself **does not** deploy GAS, change the portfolio/financial ledger, send Telegram, or authorize a synthetic 52-week count.
