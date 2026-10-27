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
