# 시장 브리핑 provider 상태

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
- K200_NIGHT는 당일 tradingDate + NIGHT session + FINAL + NIGHT_FINAL을 모두 만족해야 장전 준비 완료로 본다.

## KIS 원칙

- KIS는 선택적 live 입력이며, 공식 장전 완료 판정은 KRX `NIGHT_FINAL` 원자료를 우선합니다.
- 실제 수신 raw frame을 먼저 저장한다.
- 알려지지 않은 TR 또는 field count 불일치는 `QUARANTINED` 처리한다.
- `MARKET_CLS_CODE`나 K200 야간선물 필드 위치를 추측해 하드코딩하지 않는다.
- 06:00은 실제 마지막 수신값이 검증된 경우에만 `NIGHT_FINAL`, 20:15는 세션 진행 중이면 `LIVE`로 취급한다.
