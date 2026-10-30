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


## 공개 개발자 구현 비교 (동일 지수, 서로 다른 API 코드)
- **NH PLUG 공식 카탈로그 검사:** `scripts/nh-domestic-index-catalog-probe.mjs`는 공개 `krstock/openapi.json`만 GET 1회 조회하여 독립 현물지수 endpoint 후보와 ETF `Output_4`를 구분한다. **로그의 endpoint 후보는 실조회/운영 확정이 아니며 NH 토큰·거래원장·GAS를 사용하지 않는다.** 테스트는 모의 OpenAPI 문서만 사용한다.
- **한국투자증권 공식 예제:** `/uapi/domestic-stock/v1/quotations/inquire-index-price`(TR `FHPUP02100000`), `FID_COND_MRKT_DIV_CODE=U`; `FID_INPUT_ISCD=0001` 코스피, `1001` 코스닥, `2001` 코스피200. 원문: https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_index_price/inquire_index_price.py . **KIS 전용 코드이며 NH에 전용 금지.** 별도 키·토큰·공표시각/라이선스 검증이 없으면 운영 연결 불가.
- **FinanceDataReader:** `KS11`(코스피), `KQ11`(코스닥), `KS200`(코스피200) 일별 지수. https://github.com/FinanceData/FinanceDataReader . **비NH 시계열**이며 당일 NH 종가로 승격하지 않는다.
- **pykrx/KRX:** 코스피 `1001`, 코스피200 `1028` 등의 KRX 지수 코드와 `get_index_ohlcv_by_date`; 조회 시점·지수명 매핑 오류 가능성이 있어 일자/코드/종가 엄격 검증. https://github.com/sharebook-kr/pykrx . **KIS의 `1001`과 pykrx의 `1001` 의미는 다르다.** 
- **Koscom 시장지수 전문 API:** `GET /v3/market/realtime/index/{marketcode}/{issuecode}/index`, 응답의 `trdPrc`(지수), `trdTm`(거래시각), `cmpprevddPrc`(전일 대비). https://koscom.gitbook.io/open-api/api/marketv3/index/realtime ; 전용 인증·이용 조건과 KOSPI200 정확한 코드 별도 확인 필요.
- **NH 실시간 채널:** 공식 국내주식 채널 `oc/nc/mc`는 종목코드 체결가(주식/ETF)이고 `uB`는 채권지수다. 코스피/코스닥/코스피200 전용 현물지수 스트림을 확인한 것은 아니다. https://github.com/PLUG-OpenAPI/nhplug-sdk/blob/main/docs/realtime_channels.md .

### 운영 결정 게이트
1. NH가 정본 API에서 **KOSPI·KOSDAQ·KOSPI200 각각의 독립 코드·거래일·확정 종가**를 제공하는지 먼저 확인한다. 공개 사양에 필드만 있는 단계에서는 `NH 미검증`.
2. 기존 중앙 GAS OAuth 24시간 캐시 재사용, 최소 읽기전용 실응답으로 `endpoint+코드+지수명+날짜+종가+기준시각` 검증. 하나라도 빠지면 운영 브리핑에는 `미확보`.
3. NH가 미지원이면 KIS/Koscom은 **명시적 비NH 참고지표로만 별도 표시**할 수 있다. 사용자가 지정한 NH 단일 운영 종가 및 KRX/Yahoo 익거래일 독립 감사 규정은 변경하지 않는다.
4. 가격이력·손익·Snapshot·정규장 마감/장전 브리핑에 다른 공급원을 NH로 위장하여 자동 대체하는 기능은 추가하지 않는다.


## 비NH 3대 지수 일별 종가 연결 (FDR 캐시, 2026-10-30)
- 사용 범위: **지수 벤치마크/텔레그램 브리핑만**, 국내외 보유종목 가격·손익원장·Snapshot에는 영향 없음. NH PLUG 주식·ETF 정규장 종가는 계속 독립 운영 기준.
- FinanceDataReader `KS11/KQ11/KS200`는 최근 버전에서 `FinanceData/fdr_krx_data_cache` 공개 연도별 CSV(`year_ks11/year_kq11/year_ks200`)를 이용한다. 출처: https://github.com/FinanceData/FinanceDataReader/blob/master/src/FinanceDataReader/krx/data.py 및 https://github.com/FinanceData/fdr_krx_data_cache . 포트폴리오의 같은 공통 어댑터 `src/web/domain/market/domestic_index_eod.js`가 브리핑과 그래프를 공급한다.
- **중요 확인:** 2026-10-30 당일 13:19 KST FDR 지수 파일에도 10/30 행이 존재했다. 해당 행은 장중 갱신일 수 있으므로 **당일 종가로 사용 금지**. 공개 GitHub 해당 연도/지수 파일의 마지막 변경 커밋시각이 해당 거래일 **15:40 KST 이후**임을 확인해야 공개 EOD 참고값으로 채택한다. 시각 출처 미확보·미게시·과거일만 존재·중복·양수 아님·비정상 스키마는 `미확보`.
- 실시간 지수 API/웹소켓은 연결하지 않았다. 해당 캐시가 16:30보다 늦게 갱신되면 **16:30 브리핑에는 당일 국내 지수가 미확보**로 남을 수 있다. 당일 16:30 확정값을 보장하려면 별도 **실제 장마감 직후 공식 EOD 공급원(KRX 유료/공식 분배망 등)** 확보가 필요하다. 16:30 예정 브리핑을 FDR의 장중 데이터로 채우는 것은 금지.
- 차트: FDR 출처를 `FDR·KRX 참고 종가`로 명시하며, 캐시 실패 시 GAS의 `KRX_OFFICIAL + confirmedClose`인 행만 사용한다. `YAHOO_UNVERIFIED_DAILY`를 FDR/KRX 확정값으로 바꾸지 않는다.
- 날짜별 휴장일엔 전일 값을 당일 종가로 승격하지 않고 미확보로 처리. 동일 일자/중복행은 제거가 아니라 오류로 중단. 개별 가격 데이터의 KRX/Yahoo 익거래일 감사 정책은 유지한다.
- 남은 운영 검증: 공개 GitHub API CORS·rate limit, 실제 다음 마감 시 공개 커밋시각/지수 3개 실조회, 전일 KRX 공시가격과 일치 및 API 캐시 주기/이용약관, 화면 모바일 조회, Telegram 실수신. CI 모의검사만으로 실운영 완료 주장 금지.


## 16:30 국내 종가 우선순위 보완 (2026-10-30)
- KRX 공식 OpenAPI에는 KOSPI 시리즈 및 KOSDAQ 시리즈 일별시세 종가 `CLSPRC_IDX`, 날짜 `BAS_DD`가 명시되어 있다. 저장소의 운영 GAS `getBenchmarks`는 이미 16:00 KST 이후 같은 거래일의 공식 `KOSPI/KOSDAQ`만 확인하도록 설계되어 있다. 공식 API 문서: https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- KRX의 **별도 계약형 시장 데이터 분배상품**은 주간 1차 종가 **16:00**, 2차 **18:10** 전송한다고 공식 안내하지만, 이는 *무료 KRX OpenAPI의 16:00 게시 보장*이 아니다. 출처: https://openapi.krx.co.kr/contents/OPP/DATA/OPPDATA002.jsp
- 16:30 마감 텔레그램은 기존 GAS의 `getBenchmarks(KOSPI,KOSDAQ,KOSPI200; from=to=당일; fresh=1)` 한 번만 추가 호출해 `seriesMeta.source=KRX_OFFICIAL`, `confirmedClose=true`, `officialDate=당일`, `series[].source=KRX_OFFICIAL`, 정확히 같은 거래일의 유일한 유효 값인 경우에만 **KRX 공식 종가**로 표시한다.
- 동일 지수/거래일에 KRX 확정값이 있으면 FDR 게시 후 참고값보다 우선한다. KRX가 미게시·인증 오류·시계열 불명확이면 기존 FDR `FDR_KRX_CACHE`를 독립 증빙해 사용하며 미확보면 결측 그대로 표시한다.
- KOSPI200은 GAS 공식 지수 제공 여부가 미검증이므로 `source=YAHOO` 등 타 공급원 결과를 공식 KRX로 승격하지 않는다. NH 지수 공급원으로 표시하지 않는다. KRX 공식 응답이 실제로 `KOSPI200`에 대해 증명되기 전에는 FDR 후보만 가능.
- 손익그래프에서도 동일 날짜 KRX 공식 종가가 FDR 캐시에 덮어써지는 우선순위 버그를 수정했다.
- **실조회 미완료**: 무료 KRX OpenAPI가 16:30 당일 실제 값 반환하는지(서비스 승인키, 게시 시점), KOSPI200 공식 경로/현재 거래일, 브라우저 수치·텔레그램 송신 결과는 추가 운영 검증이 필요하다.

## 마감 브리핑: 독립 지수 게이트 및 수동 실행 복구 (2026-10-30)
- 전송 허가 조건: NH 미국지수 정규장 완료 일봉 1건 이상, **또는** KRX 공식 당일 종가/FDR 장후 게시 일봉으로 확인된 국내 지수 1건 이상. FRED/CBOE 참고값만으로는 전송 불가. 미국 NH 누락 시 미국 부분은 미확보로 표시하고 국내 지수 발송은 차단하지 않음.
- 국내 지수는 `NON_NH_DAILY_INDEX`이며, KRX `CONFIRMED_REGULAR_CLOSE` 또는 FDR `PUBLISHED_EOD_REFERENCE`로 지수코드·거래일·실수치·출처를 검증. NH 주식·ETF 종가로 위장하거나 거래원장/스냅샷을 수정하지 않음.
- 기존 16:30·16:50에 16:38·17:02 KST 예약 실행 추가. 예약 실행 자체는 GitHub best-effort이므로 지연·누락 가능. 날짜별 `telegram-close-claim-YYYY-MM-DD` 아티팩트 확인 후 claim을 먼저 업로드하고 1회 발송. 재시도 중복 발송 차단 우선.
- **수동 복구:** GitHub Actions → Telegram closing market briefing → Run workflow → Branch: main. 한국 거래일 16:30–17:09 KST에만 허가. 오래된 날짜, 휴장일, 검증 지수 0건, 이미 claim된 날짜, main 외 실행은 발송 불가. 외부 스케줄러나 별도 GAS 트리거는 이번 변경에 설치하지 않음.
- 2026-10-30 16:56 KST 당시 해당 마감 워크플로 당일 실행 미확인. 10/30 장전 run #40989811565는 예약보다 늦게 시작하여 TELEGRAM_SCHEDULE_LATE. 다중 cron만으로 확정 발송 보증 불가. 운영 실행/텔레그램 실제 수신/16:30 KRX 당일 종가 실조회는 별도 검증.
- 수정 범위: 마감 워크플로 스크립트·스케줄 YAML·테스트 및 이 문서. NH 신규 토큰 발급, 기존 GAS/가격이력/Snapshot 변경 없음.
