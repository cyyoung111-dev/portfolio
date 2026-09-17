# 시장 브리핑 provider 상태

기준: 2026-09-18, 저장소 코드에서 검증된 경로만 기록한다.

| series | 현재 경로 | 상태 | 비고 |
|---|---|---|---|
| KOSPI | Toss market-indicators | 연결됨 | 기존 GAS 지원 |
| KOSDAQ | Toss market-indicators | 연결됨 | 기존 GAS 지원 |
| SPX | Yahoo `^GSPC` | 연결됨 | EOD/비공식 endpoint |
| NDX | Yahoo `^NDX` | 연결됨 | EOD/비공식 endpoint |
| KOSPI200 | collector 계약 존재 | 미연결 | GAS 실제 symbol mapping 미구현 |
| SOX | Yahoo `^SOX` | 연결됨 | Yahoo 비공식 EOD/지연 지수 경로 |
| VIX | Yahoo `^VIX` | 보조 연결됨 | CBOE 1차 원천은 후속 연결; Yahoo는 보조 EOD/지연 경로 |
| USDKRW | collector 계약 존재 | 미확정 | 현재 GAS 공개 action과 응답형식 검증 필요 |
| K200_NIGHT | KIS H0MFCNT0/H0MFASP0 계약 | 런타임 검증 대기 | raw frame 보존 후 field-count/schema 일치 시에만 semantic parse |

## KIS 원칙

- 실제 수신 raw frame을 먼저 저장한다.
- 알려지지 않은 TR 또는 field count 불일치는 `QUARANTINED` 처리한다.
- `MARKET_CLS_CODE`나 K200 야간선물 필드 위치를 추측해 하드코딩하지 않는다.
- 06:00은 실제 마지막 수신값이 검증된 경우에만 `NIGHT_FINAL`, 20:15는 세션 진행 중이면 `LIVE`로 취급한다.
