# 시장 브리핑 provider 상태

기준: 2026-09-18, 저장소 코드에서 검증된 경로만 기록한다.

| series | 현재 경로 | 상태 | 비고 |
|---|---|---|---|
| KOSPI | Toss market-indicators | 연결됨 | 기존 GAS 지원 |
| KOSDAQ | Toss market-indicators | 연결됨 | 기존 GAS 지원 |
| SPX | Yahoo `^GSPC` | 연결됨 | EOD/비공식 endpoint |
| NDX | Yahoo `^NDX` | 연결됨 | EOD/비공식 endpoint |
| KOSPI200 | Yahoo `^KS200` | 보조 연결됨 | Toss 공식 identifier는 미확정; Yahoo EOD/지연 경로 사용 |
| SOX | Yahoo `^SOX` | 연결됨 | Yahoo 비공식 EOD/지연 지수 경로 |
| VIX | Yahoo `^VIX` | 보조 연결됨 | CBOE 1차 원천은 후속 연결; Yahoo는 보조 EOD/지연 경로 |
| USDKRW | GAS `getExchangeRateHistory` → `환율이력` 시트 | 연결됨(저장 원자료) | `날짜|통화|환율` 확정 행만 조회; 시트 부재/스키마 오류는 missing |
| K200_NIGHT | KIS H0MFCNT0/H0MFASP0 계약 | 런타임 검증 대기 | raw frame 보존 후 field-count/schema 일치 시에만 semantic parse |

## KIS 원칙

- 실제 수신 raw frame을 먼저 저장한다.
- 알려지지 않은 TR 또는 field count 불일치는 `QUARANTINED` 처리한다.
- `MARKET_CLS_CODE`나 K200 야간선물 필드 위치를 추측해 하드코딩하지 않는다.
- 06:00은 실제 마지막 수신값이 검증된 경우에만 `NIGHT_FINAL`, 20:15는 세션 진행 중이면 `LIVE`로 취급한다.
