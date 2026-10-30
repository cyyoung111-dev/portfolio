# NH 지수 소스 조사 및 운영 규칙 (2026-10-30)

## 국내 현물 3지수의 NH 연결 상태
- **추가 확인 (공식 OpenAPI 명세 기준 2026-10-15):** NH 국내주식 `POST /krstock/quote/v1/etfCurrent` (입력 `Input_0.iem_cd`, ETF 종목코드)의 **`Output_4`에 실제 국내 지수 관련 응답 필드** `bstp_cls_code`(지수코드), `bstp_kor_isnm`(업종명), `prpr_nmix`(지수), `prdy_vrss`(등락폭), `jisukpgubun`(1 코스피/2 코스닥)가 명시됨. 출처: https://www.nhplug.com/openapi-docs/krstock/openapi.json 의 `etfCurrent` 응답.
- 이 경로는 **ETF에 연결된 지수 참고값**을 반환할 수 있는 후보이며, KOSPI/KOSDAQ/KOSPI200 각각의 공식 코드·동일 지수 정체성·일자·당일 정규장 확정 종가 및 API 실제 반환 여부를 보장하지 않음. 특히 `Output_4`에는 별도 지수 기준일·확정 상태 필드가 없어 그 자체로 `NH_OPERATING_CLOSE` 승격 금지.
- 기존 `nhplug-close-readonly-diagnostic.mjs`가 이미 수행하는 `etfCurrent(069500)` 응답을 **추가 호출 없이** 분석하도록 후보 검사를 보강함. 모의 응답 테스트는 계약 확인일 뿐 운영 실수치 조회 증거가 아니며, 중앙 GAS 캐시 bearer로 기존 동일 조회를 재사용한 실제 `Output_4` 확인/공식 지수코드 대조는 미완료.
- NH 지원 범위를 확정하기 위해: ETF 식별→기존 cached-token **읽기전용 호출 1회 이하** (가능하면 기존 조회 재사용)→응답의 `Output_4` 코드/업종명/거래소/값 검증→현물 지수 동일성 및 거래일·확정시각 검증→확인 시에만 운영 연결. 무응답이면 미지원 단정 없이 기술지원 확인. **신규 토큰 발급·별도 동시 조회 금지**.
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
