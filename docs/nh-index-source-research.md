# NH 지수 소스 조사 및 운영 규칙 (2026-10-30)

## 국내 현물 3지수의 NH 연결 상태
- 국내 KOSPI, KOSDAQ, KOSPI200 현물지수의 NH PLUG 공식 endpoint/요청필드/코드/실수치는 확인되지 않음. 공문서 API 카탈로그는 국내주식/ETF 현재가·일자별 API는 열거하지만 국내 현물지수 조회 전용 API는 보이지 않음: https://www.nhplug.com/apiservice
- NH 가격 API로 KOSPI200 선물, ETF, 보유 개별종목 가격을 현물지수 대신 사용하지 않는다.
- 기존 GAS getBenchmarks 국내 두 지수는 KRX+Yahoo 공급원이며 NH라고 재표시 불가.
- 정확한 NH API 요청·응답·실거래일 확인 전엔 숫자 대체를 하지 않음. 필요시 NH 공식 지원팀에 endpoint 제공 여부 확인 후 캐시된 토큰으로 저빈도 읽기 전용 시험.

## 다른 운영 사례 참고
- OpenTerminal: 별도 source adapter/캐시/실패 처리: https://github.com/ErTasselli/OpenTerminal
- market-data-hub: 여러 공급원 연결 및 커버리지/품질 검증: https://github.com/selvaz/market-data-hub/blob/main/docs/ARCHITECTURE.md
- 다우: FRED DJIA 종가, https://fred.stlouisfed.org/series/DJIA
- VIX: Cboe 공식 일별 종가, https://www.cboe.com/tradable_products/vix/vix_historical_data
- SOX: FRED NASDAQSOX (원천 Nasdaq PHLX Semiconductor Price Index) https://fred.stlouisfed.org/series/NASDAQSOX. Nasdaq의 재배포 및 라이선스 조건은 운영 공개 전 별도 확인.
- 다우/VIX/SOX는 비NH 참고값으로만 별도 표시. NH 지수 수치/평가손익/Snapshot/발송 필수 게이트로 승격하지 않음.
- VKOSPI, DXY 등은 동일 정체성과 라이선스/공개시간 확인 전까지 미검증. DXY와 다른 달러지수 혼용 금지.
- 다른 공급원 실패 또는 구 거래일 결과가 나오면 미확보. KRX/Yahoo는 원칙적으로 다음 거래일 NH 종가 독립 검산에만 사용.
