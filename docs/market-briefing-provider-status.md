## 2026-11-14 Issue #734: GAS 실행 UID·17시 지표 제공원 실운영 선행조건

### GAS: Process API는 실행 상태를 제공하지만 실제 실행 UID는 제공하지 않음

- Google Apps Script `processes.listScriptProcesses` 공식 `Process` 스키마는 `projectName`, `functionName`, `processType`, `processStatus`, `userAccessLevel`, `startTime`, `duration`만 제공한다. **실행별 고유 UID, Script Properties Writer lease token, 백업 소유권은 제공하지 않는다.** 타임스탬프/함수명 근접성은 감사 후보일 뿐 정확한 실행-Writer 연결 증거가 아니다. `e.triggerUid`도 **트리거 고유 ID**이지 실행마다 생성되는 실행 UID가 아니다.
- 조회하려면 사용자 소유 `clasp` OAuth refresh token에 `https://www.googleapis.com/auth/script.processes` scope가 필요하다. 2026-11-10 read-only scope 감사에서 기존 `CLASPRC_JSON`의 `PROCESS_SCOPE_MISSING` 확인. repo 변경만으로 권한 부여·토큰 교체를 대행할 수 없다.
- 사용자 PC에서 같은 Google 계정으로 필요할 때만 `npx clasp login --extra-scopes https://www.googleapis.com/auth/script.processes`를 실행하고 권한을 승인할 수 있다. 새로 발행된 개인 `.clasprc.json`/refresh token **원문은 채팅·Issue·로그에 공유하지 않고**, 사용자 본인만 GitHub Actions `CLASPRC_JSON` secret을 업데이트한다. 그 후 기존 [OAuth scope audit](https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue734-process-scope-audit-readonly.yml) → [writer process status READ ONLY](https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue734-writer-terminal-evidence-readonly.yml) 순서로 수동 검증한다.
- 이 과정에서 확인 가능한 것은 명시된 함수의 *실행 상태·시간*, **정확한 lease 소유권 아님**. Writer-gate 정리를 자동 승인하거나 Apps Script를 재배포하면 안 된다. 향후 **실행마다 생성한 별도 상관관계 ID**를 시작/종료 및 Writer 체크포인트에 모두 원자적으로 남기는 것은 운영 GAS 변경·실증을 수반하므로 별도 배포 심사 대상.

공식 근거: https://developers.google.com/apps-script/api/reference/rest/v1/processes · https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses · https://developers.google.com/apps-script/guides/triggers/events · https://github.com/google/clasp/blob/master/README.md

### 17:00 거래대금/VKOSPI: 데이터 자체보다 시각·기준일·단위·이용권한 확인이 핵심

- **KRX 무료 일별 Open API:** 실제 2026-11-13 21:28 KST 대상일 5개 경로가 HTTP 200/0행. 익영업일 공개 전에는 17:00 당일 수치로 사용하지 않는다. KRX의 별도 계약형 종가(16:00/18:10) 분배상품은 무료 Open API와 구별한다.
- **한국투자증권 KIS 업종 현재지수:** `FHPUP02100000`, `/uapi/domestic-stock/v1/quotations/inquire-index-price`, 시장구분 `U`, KOSPI `0001` / KOSDAQ `1001`, `acml_tr_pbmn` 필드가 존재한다. 그러나 현재 GitHub/GAS에 **독립 KIS 계정·액세스토큰 연결 없음**, 응답 필드만으로는 **정확한 시세 거래일·정규장 확정 시각·KRW 환산 배수·대표지수 구성 거래대금과 시장 전체 총액의 범위**가 자동 증명되지 않는다. 같은 KIS의 기간·분봉 API와 기준 날짜를 교차하고 차일 KRX 정식 공시로 수치·단위 검산해야 한다. KIS 응답은 승인 전 기존 `KRX_OFFICIAL` 값으로 가장하거나 대체하지 않음.
- **코스콤 실시간 업종지수:** `/v3/market/realtime/index/{marketcode}/{issuecode}/index`, `accTrdval` 필드는 **원 단위**로 공식 명세되며 거래시각 `trdTm` 포함. 단, 별도 유료 API 계약/인증, 15:30 정규장 구분, 재배포 조건을 충족해야 한다. KIS와 코스콤을 합산하거나 비교 인증 없이 표기하지 않는다.
- **VKOSPI:** KRX 무료 일별 파생지수 API의 대상일 실제 공표까지 보류. 17:00 당일 이용이 가능한 라이선스·출처·날짜·시각·지수 정체성이 확인된 피드 미연결. 코스콤 파생상품 지수/변동성지수선물 **상품목록이 현물 VKOSPI 제공을 입증하지는 않는다.** 웹페이지에 숫자 하나가 보인다는 이유만으로 정기 자동화·텔레그램에 편입하지 않는다.
- **52주 신고가·신저가:** 공식 KRX 252거래일 원시 OHLC 검증 완료와 권리조정 완료는 **별개**. KIS 기간별 시세 `FHKST03010100`의 수정주가 옵션 `FID_ORG_ADJ_PRC=0`은 공급 후보이나 개인 계정·250일 이상 페이지네이션·전체 종목 권리조정·데이터 라이선스가 검증되지 않았으므로 공식 시장 전체 숫자 게시 금지.

**운영 전환 순서:** (1) 데이터 이용권한 및 동일일 실조회 2개 시장 확보 → (2) 16:50–17:05 KST 날짜·시장 코드·정규장 완료·단위 검증 → (3) KRX 익영업일 공시치 교차 대사 → (4) 모의 Telegram·회귀 검증 → (5) 기존 브리핑과 GAS 원본에 영향 없는 별도 승인 후 채택. 현재는 프로덕션 소스/키·Writer·브리핑 일정 변경 **0건**.

공식 근거: https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/domestic_stock/domestic_stock_examples.py · https://koscom.gitbook.io/open-api/api/marketv3/index/realtime · https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA002.jsp · https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd

---

## 2026-11-13 Issue #734: 17:00 VKOSPI·시장 거래대금 원천 정책

**공식 API 실증:** #43425414981에서 2026-11-13 밤 21:28 KST 현재 KRX 5개 일별 엔드포인트의 11/13 응답은 HTTP 200 / 0행, 직전 거래일 11/12은 정확히 조회됐다. 이는 당일 일별데이터 미공표(T+1)이며 인증키·NAV·GAS 마감 오류가 아니다.

**수정:** 장마감 코드의 기본 KRX Open API VKOSPI/거래대금 조회는 T+1 발행 기준을 먼저 확인한다. 17시 같은 날 미공표이면 호출하지 않고 KRX_TPLUSONE_NOT_PUBLISHED 진단만 남긴다. 전일값을 오늘값으로 표시하지 않는다. 독립적으로 승인된 적시성 원천을 나중에 주입할 수 있도록 통로는 남겼다.

| 제공원 | 17시 당일 가능성 | 판단 |
|---|---|---|
| KRX 일별 Open API | 불가, 익영업일 공개 | 익일 원천 감사만 사용 |
| 기존 NH PLUG | 종목·선물 조회는 입증, VKOSPI·시장별 전체 거래대금은 미검증 | 원천 스키마가 없으면 불가 |
| KIS 국내업종 현재지수 FHPUP02100000 | KOSPI 0001 / KOSDAQ 1001, acml_tr_pbmn 누적거래대금 필드 존재 | 별도 KIS 계정/토큰 미연결, 운영 실조회 필요 |
| 코스콤 실시간 업종지수 | accTrdval 누적거래대금 필드 존재 | 별도 시장정보 이용 계약 필요 |
| 당일 VKOSPI | 별도 검증된 공인/라이선스 원천 없음 | 임의 표기 금지 |

참고: https://apiportal.koreainvestment.com/apiservice-summary ; https://koscom.gitbook.io/open-api/api/marketv3/index/realtime ; https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO002.jsp

**운영 연결 조건:** 16:50~17:05 KST 실제 인증 조회, 기준 거래일, 시장별 코드, 정규장/시간외 구분, KRW 단위, 수신시각, KRX 익일 확정치와 대사를 통과한 원천만 추가한다. 라이선스 미확인 제공원의 재배포를 포함하지 않는다.

---
## 2026-10-30 운영 정책 변경 — K200 야간선물 NH PLUG 단일 기준

- **확정 운영 기준:** 해당 야간 거래일 NH PLUG **06:00:00 KST 마지막 체결값**을 장전 브리핑의 유일한 야간선물 수치로 사용합니다. 거래일·근월물 계약·06:00 시각·양수·틱 검증은 유지합니다.
- **KRX 야간선물 재검증 불필요:** KRX `getKrxK200NightClose`/공식 `NIGHT_FINAL`이 없더라도 NH 기반 텔레그램 장전 브리핑에 장애로 반영하지 않습니다. 기존 별도 `market-briefing-headless`의 06:15 KRX 야선·09:15 T+1 야선 재확인 cron 및 manual KRX 야선 checkpoint는 사용 중단합니다. 정규장 16:30·장후 20:15 브리핑은 유지합니다.
- **공식 정산가 구분:** NH PLUG 수치는 **06:00 운영 확정 기준 체결값**이지 KRX 공식 정산가가 아닙니다. 해당 날짜의 검증된 NH 값이 없다면 `미확보`로 표시하고 전일 값/KRX 값으로 자동 대체하지 않습니다.
- 텔레그램 07:40~08:10 장전 경로는 기존 중앙 GAS NH 토큰 재사용 및 날짜별 1회 발송 보호를 유지합니다. 이번 변경은 NH 토큰 신규 발급을 유발하는 진단을 추가하지 않습니다.
- **아래 2026-10-27 이하 내용은 과거 구현 이력**입니다. 야간선물의 KRX 필수·T+1 재검증 규정은 위 정책으로 대체됐으며, KRX 정규장 가격·Snapshot 검산은 별개로 유지됩니다.

---

## 2026-10-27 야간 거래일 및 장전 기준 정정

- KRX 공식 야간거래 안내서에 따라 야간 거래일은 **새벽 종료일**입니다. 10/27 아침 브리핑이 요구하는 야간 세션은 BAS_DD=10/27이며, 10/26 원천을 10/27의 최신 야간 확정값으로 바꾸지 않습니다.
- 06:15 NIGHT_FINAL 및 MORNING은 대상일과 동일한 sourceDate를 조회·검증합니다. 09:15 T+1 catch-up은 기존 일정 해석에서 선택한 과거 대상일 자체를 조회하며 07:30 발행 성공으로 취급하지 않습니다.
- MORNING은 정확한 야간 세션·공식 출처·확정 상태와 **실제 receivedAt <= 07:30 KST**를 모두 요구합니다. 확정 조건을 낮추지 않습니다. 이전 날짜/기존 과거 품질 표식은 승인하지 않습니다.
- 원천가 미확보는 EXACT_NIGHT_SESSION_NOT_AVAILABLE, 같은 날짜 공식 확정값이 기준시점 이후 수신된 경우는 RECEIVED_AFTER_CUTOFF로 구분합니다. 후자는 당일 07:30에 이미 알았던 값으로 소급 발행하지 않습니다.
- KRX 일별 OpenAPI는 모든 API를 익영업일 08시 갱신한다고 안내합니다. 이 원천만으로 당일 최신 야간 종가를 07:30에 확보한다고 보장할 수 없습니다. 제때 제공하는 원천과 날짜·세션·수신 증거를 확보하기 전까지 NOT_READY를 유지합니다.
- 근거: https://openapi.krx.co.kr/contents/OPP/COMM/faq/OPPCOMM004.cmd 및 https://open.krx.co.kr/contents/OPN/01/01041401/한국거래소%20파생상품시장%20야간거래%20안내.pdf (2025-06-05, 17쪽).

# 시장 브리핑 provider 상태

## 2026-10-17 국내 당일 종가 provider 전환 게이트

- **KRX OpenAPI 일별통계:** T일 정규장 종가는 *다음 KRX 영업일 08시 이후* 공식 일별 수집. 10/16 금요일 종가는 10/19 월요일 08시 이후 원천 재확인 대상이며, 미게시 0행/직전일 이월은 **T일 공식 종가로 저장 금지**. 종목·Snapshot 검증의 기대분모는 고정 숫자가 아니라 **대상일 거래원장·코드마스터 및 펀드 생애주기**에서 계산.
- **Toss 현재가:** `fetchPricesToss` 값은 `priceType=REALTIME,status=INDICATIVE`. 실제 10/15 운영 가동 시 OAuth 토큰 캐시는 있었으나 005930과 시장·환율 API 모두 403 `ip-not-allowed`, **37종목의 10/16 일봉 검증 근거가 아님**. 10/17 새 LIVE 진단에서도 접근 상태를 먼저 재확인해야 함.
- **Toss 일별 캔들:** `fetchHistoricalPricesToss`의 `DAILY_CANDLE/UNVERIFIED_CLOSE`는 원천 응답 날짜가 정확하더라도 **대상일 실보유 전체의 공식 KRX 정합성**을 증명하지 못하며 GAS에서 이미 확정 상태와 분리.
- **네이버 개별 종목:** 현 저장소에는 대상일 국내 실보유 종목 전체에 대한 네이버 일자별 시세 수집·ETF 포함 거래일 보정·액면분할/원주가 비교 계약이 없음. 공개 FinanceDataReader의 NAVER 경로 존재만으로 기존 GAS 공급원 연결 성공이라고 판단하지 않음.
- **통합 원칙:** 16:40~19:00 표시용 T일 `PROVISIONAL`과 차일 08:30 이후 **대상일 전체 국내 실보유 공식 종가 확보, 거래원장 수량 일치, 대상일 전체 Snapshot `VALID`**로 검증하는 `FINAL_KRX`는 서로 다른 데이터 계약. 2026-10-16 당시 관측한 37종목/39행은 그날만의 검산 값이며, 다른 날짜의 고정 분모가 아님. 임시 값은 기존 공식 PRICE·Snapshot 및 확정 완료 마커에 미기록. 전일값은 요청 T일 신선 데이터로 승격 금지.
- **작업 상태:** 이번 수정은 LIVE Toss 운영 진단 재실행과 문서 계약만 수행. 새로운 증권사/OAuth·외부 서버, 신규 시세 공급원, GAS 소스/버전/가격이력/자동화 트리거 변경 **없음**. 기존 보유 37종목 T일 잠정 커버리지 검증은 provider 정상화 후 별도 수집 검증 필요.

---


기준: 2026-10-08, 저장소 코드에서 검증된 경로만 기록한다.

| series | 현재 경로 | 상태 | 비고 |
|---|---|---|---|
| KOSPI | Toss market-indicators + KRX 공식 지수 일별매매정보 | 연결됨 | Toss는 PARTIAL 보조, 16:00 이후 KRX exact-date 공식 종가만 FINAL |
| KOSDAQ | Toss market-indicators + KRX 공식 지수 일별매매정보 | 연결됨 | Toss는 PARTIAL 보조, 16:00 이후 KRX exact-date 공식 종가만 FINAL |
| SPX | Yahoo `^GSPC` | 연결됨 | EOD/비공식 endpoint |
| NDX | Yahoo `^NDX` | 연결됨 | EOD/비공식 endpoint |
| KOSPI200 | Yahoo `^KS200` | 보조 연결됨 | 장전은 직전 확정 종가, KRX_FINAL/EVENING은 optional |
| SOX | Yahoo `^SOX` | 연결됨 | Yahoo 비공식 EOD/지연 지수 경로 |
| VIX | Yahoo `^VIX` | 보조 연결됨 | CBOE 1차 원천은 후속 연결; Yahoo는 보조 EOD/지연 경로 |
| VKOSPI | KRX Open API `idx/kospi_dd_trd` | 연결됨 | 기존 단일 `getBenchmark(VKOSPI)` 경로를 브리핑 collector에 연결; 당일 마감 체크포인트에서는 exact-date KRX 값을 FINAL로 정규화 |
| DXY | Yahoo `DX-Y.NYB` | 연결됨 | 달러인덱스 EOD/지연 보조 데이터 |
| UST10Y | Yahoo `^TNX` | 연결됨 | 미 10년물 수익률 보조 데이터 |
| WTI | Yahoo `CL=F` | 연결됨 | WTI 선물 EOD/지연 보조 데이터 |
| GOLD | Yahoo `GC=F` | 연결됨 | 금 선물 EOD/지연 보조 데이터 |
| BTC | Yahoo `BTC-USD` | 연결됨 | BTC/USD EOD/지연 보조 데이터 |
| UST2Y | 없음 | 미연결 | Yahoo의 `ZT=F`는 2년물 선물 가격이므로 현물 2년물 수익률 `UST2Y`로 오표기하지 않음 |
| USDKRW | GAS `getExchangeRateHistory` → `환율이력` 시트 | 연결됨(저장 원자료) | `날짜|통화|환율` 확정 행만 조회; 시트 부재/스키마 오류는 missing |
| SAMSUNG / SKHYNIX | KRX exact-date 종가 + 기존 가격이력 | 연결됨 | 마감은 KRX exact-date REGULAR_CLOSE만 FINAL, 장전은 직전 확정값 보조 |
| K200_NIGHT | KRX `drv/fut_bydd_trd` + 선택적 KIS live | 공식 일별 종가 연결됨 | exact BAS_DD·야간시장·KOSPI200 선물·단일 최근 미만기 월물·양수 종가만 `NIGHT_FINAL` |

## Readiness 원칙

- 07:30 필수 발행 게이트는 KOSPI/KOSDAQ/KOSPI200/K200_NIGHT/SPX/NDX/SOX/VIX/USDKRW로 유지한다.
- VKOSPI/DXY/UST10Y/WTI/GOLD/BTC/삼성전자/SK하이닉스는 중요 보조지표로 수집·표시하되 한 provider 장애가 브리핑 전체 발행을 막지는 않는다.
- 실제 provider가 없는 UST2Y/NVDA/MU/수급/breadth는 `PLANNED`로 분리하여 항상 PARTIAL이 되는 잘못된 QC를 방지한다.
- K200_NIGHT는 당일 tradingDate 및 동일 sourceDate + NIGHT session + FINAL + NIGHT_FINAL을 모두 만족해야 장전 준비 완료로 본다.

## KIS 원칙

- KIS는 선택적 live 입력이며, 공식 장전 완료 판정은 KRX `NIGHT_FINAL` 원자료를 우선합니다.
- 실제 수신 raw frame을 먼저 저장한다.
- 알려지지 않은 TR 또는 field count 불일치는 `QUARANTINED` 처리한다.
- `MARKET_CLS_CODE`나 K200 야간선물 필드 위치를 추측해 하드코딩하지 않는다.
- 06:00은 실제 마지막 수신값이 검증된 경우에만 `NIGHT_FINAL`, 20:15는 세션 진행 중이면 `LIVE`로 취급한다.


## 2026-11-03 — 지연 GitHub schedule의 역사적 MARKET_MASTER 쓰기 방지

- [실제 headless schedule #41521897257](https://github.com/cyyoung111-dev/portfolio/actions/runs/41521897257)에서 `EVENING` 예약은 **11월 2일 20:15 KST(11:15 UTC)**였으나 실행 시작은 **11월 3일 05:44 KST(20:44 UTC)**였다. GitHub 지연은 약 9시간 29분이었으며, 로그에 `NOT_READY`, `published=false`, `masterPersistence.saved=15`가 기록됐다. Snapshot 발행은 없었으나 지연 수집이 MARKET_MASTER 변경을 시도할 수 있었다.
- `scripts/run-market-briefing-headless.mjs`의 CLI는 보호된 workflow가 GitHub API에서 읽은 `run.created_at`과 예약 cron(UTC)의 최근 slot을 비교한다. **90분 초과 지연**, 예약 시각 누락 또는 미지원 cron이면 GAS·provider 호출 전에 `STALE_SCHEDULE_BLOCKED` 또는 `SCHEDULE_ANCHOR_UNVERIFIED` 진단과 exit 1을 반환한다. `gasCalls=0`, `financeWrites=0`, `telegramSends=0`은 이 차단 분기의 동작 보장값이다.
- 슬롯과 checkpoint가 정상이고 예약시각에서 90분 이내인 자동 실행은 기존 수집/발행 로직을 그대로 이용한다. `workflow_dispatch`의 명시적 checkpoint는 입력된 trading_date와 기존 승인/품질 검증을 유지하며 **이 지연 스케줄 차단만 적용하지 않는다**. 수동 실행은 해당 유효 시간대의 실제 데이터가 준비되어야 계속 가능하다.
- 이는 GitHub 예약 실행을 정시에 만들지 않는다. 17:00 마감 메시지 또는 07:40 장전 메시지의 **실제 수신 성공을 증명하지도 않는다**. Telegram claim/발송 검증은 별도로 확인한다. 지연 발생과 원천 누락은 각각 원인을 구분해서 운영 진단해야 한다.
- CI에서 정확히 위 실측 일정과 경계값(90분 허용, 91분 차단), CLI의 **자격증명 없는 지연 실행**이 provider/GAS 호출 전에 차단되는지 검증한다. 이 PR은 운영 GAS 버전, Snapshot, 토큰, 기존 금융 원본을 변경하지 않는다.
