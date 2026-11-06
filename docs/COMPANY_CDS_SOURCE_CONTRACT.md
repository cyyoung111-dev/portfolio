# 기업별 5년물 CDS 원천 계약 (source-only)

**목표:** 미국 AI 9개 기업과 국내 삼성전자·SK하이닉스의 신용위험을 각 회사 분석에 병렬 연결합니다. 본 PR에서는 운영 브리핑/Telegram에 가격을 삽입하지 않으며, 금융 원본에 쓰지 않습니다.

## 회사별 연결

- **미국 9사:** MSFT, AAPL, GOOGL, AMZN, META, NVDA, MU, ORCL, SNDK (기존 `AI_NINE`과 동일한 9개)
- **국내 2사:** 005930 삼성전자, 000660 SK하이닉스 (기존 `DART_SEMICONDUCTORS`와 동일)
- **국가 CDS는 별도 거시 지표:** 한국 외평채 CDS는 삼성전자나 SK하이닉스 **개별 기업 CDS가 아닙니다.** 미국 국채 CDS 또한 미국 기업 CDS가 아닙니다.

주식 코드·SEC CIK·DART 고유번호만으로 CDS 발행사/채무의 참조법인을 인증하지 않습니다. CDS reference entity의 독립 식별자(RED/LEI/ISIN 등), 모·자회사 구분, 선순위 여부가 확인되기 전까지 11개사 개별 CDS 수치는 `REFERENCE_ENTITY_NOT_MAPPED`로 유지합니다.

## 출처 후보와 제한

| 출처 | 데이터 | 실제 사용 기준 |
| --- | --- | --- |
| ICE Clear Credit 공개 5Y 결제가격 | 일정한 종목의 5년물 단일법인 **EOD price** (예: 98, 101 등) | **bp CDS 프리미엄이 아닙니다.** coupon/할인곡선/회수율 등 검증 없이 EOD price를 bp로 표시하거나 변환하지 않습니다. 원천 이용약관 확인 필요 |
| DTCC SEC 공개 거래 보고 | 개별 거래의 원시 스프레드/쿠폰/upfront | 직접 보고된 **running spread**의 단위·notation·수정/취소 이력 확인 전에는 bp 미표시. 거래값은 딜러 5Y 종가와 다름 |
| LSEG/ICE/S&P 등 검증된 회사별 5Y CDS 호가 | 라이선스 제공되는 5Y par mid spread | 동일 참조법인·senior unsecured·USD·재구조화 조항·정확일 확인 후 운영 도입 검토. 일부는 구독 필요 |
| DART/SEC 재무제표 | 부채·FCF·CAPEX·지배지분 등 | CDS와 **연결해서 해석할 재무 사실**일 뿐 CDS 스프레드 대체 수치 아님 |

출처: [ICE Clear Credit Settlement Prices](https://www.ice.com/cds-settlement-prices), [DTCC SEC repository](https://www.dtcc.com/repository-and-derivatives-services/repository-services/sec), [LSEG CDS 시계열 질의 예시](https://community.developers.lseg.com/discussion/89377/how-can-i-get-historical-cds-spread-for-a-list-of-tickers-i-am-interested-in-5-years-maturity-an/p1), [한국은행 CDS 용어 설명](https://www.bok.or.kr/portal/bbs/P0000795/view.do?menuNo=200557&nttId=218120).

## 브리핑 데이터 필드

- 회사 / 참조법인 ID / 신용계약 구분 / 통화 / 만기 / 선순위 / 재구조화 조항
- CDS 스프레드(bp) / 실제 **관측일** / 출처 유형(5Y 종가 par quote vs 4.4~5.6년 거래 보고) / 원천 ID
- 전월·3개월·1년 변화는 **동일 기업·동일 출처·동일 계약 정의·동일 스프레드 정의**의 실제 관측점만으로 bp 차이를 계산합니다. 중간값 보간/전일치 이월 금지
- 5Y 개별 기업 데이터가 없으면 `미확보(회사 CDS)`로 두고 국가 CDS, ICE EOD price, fixed coupon, upfront를 해당 회사 CDS premium 칸에 넣지 않습니다.
- CDS가 상승해도 바로 부도 확률/영구손실 확정으로 해석하지 않고, 부채 만기·차입 비용·FCF의 질·AI CAPEX 현금부담·유동성 변화와 대조합니다.

## PR 진행 조건

1. 11개 회사에 대해 참조법인/계약 식별자 실증
2. 일별 5Y 값의 실수신 및 **bp 단위·가격 정의·정확한 기준일·출처** 확인
3. 같은 기준으로 최근 1개월 및 최소 1년 추세 확보 가능 여부 점검
4. 수집률/오래된 관측/비연속 자료 상태를 문구화한 뒤, 기존 장전/마감 브리핑의 선택적 지표로만 통합

현재 이 모듈은 검증 계약·대상 목록·상태 전용 함수만 존재하며 **실제 기업 CDS 스프레드 11개를 확보했다고 주장하지 않습니다.**


## 2026-11-06 KST 실제 원천 확보 진단 (운영값 아님)

읽기 전용 GitHub Actions 확인:

- SEC 신용파생 공개 파일 목록: **359건** ([실행 #42210303397](https://github.com/cyyoung111-dev/portfolio/actions/runs/42210303397)).
- 최신 확인 파일 `SEC_CUMULATIVE_CREDITS_2026_11_05.zip`: 공개 인덱스 `rowCount=2071`, 실제 CSV **2,071행**, ZIP **152,899 bytes**. 공개 URL은 [DTCC 원천 S3](https://kgc0418-tdw-data-0.s3.amazonaws.com/sec/eod/SEC_CUMULATIVE_CREDITS_2026_11_05.zip), [CSV 컬럼 확인 #42210597277](https://github.com/cyyoung111-dev/portfolio/actions/runs/42210597277).
- 전체 2,071행 중 `Spread-Leg 1` 비어 있지 않은 행 **342**, `Fixed rate-Leg 1` 입력 **1,765**. 표기법 값은 `1`/ `3`/ `4` 등이므로 원시 숫자를 곧장 bp로 표시할 수 없음.
- 발행사 **문자열**로만 검색한 후보는 MSFT 7, GOOGL 7, AMZN 11, META 13, NVDA 28, ORCL 25, SK하이닉스 1행; AAPL/MU/SNDK/삼성전자 0행. 이 후보 수는 유효한 CDS 거래 수가 **아님**.
- 그중 `Spread-Leg 1` 존재, notation `3`/ `4`, 실행시각~만기잔존기간 약 **4.4–5.6년**까지 좁힌 1차 후보는 **GOOGL 1, META 1, NVDA 3, ORCL 4행**. 나머지 기업은 해당 날짜에 이 기준의 후보 0행. [원천 후보 필터 실행 #42210998333](https://github.com/cyyoung111-dev/portfolio/actions/runs/42210998333).
- 필터 뒤에도 발행사 법인/계약 참조 ID, 원자료 `Action type` (`NEWT`, `CORR`, `EROR`, `MODI`, `TERM`), 계약 조항, 실제 보고 스프레드 의미/단위, 수정·취소를 재구성하지 않았으므로 **현재 11사 유효한 5년물 CDS bp 값은 0건 검증**.
- DTCC의 **직접 보고된 거래**와 ICE/딜러의 5년물 **일별 파 스프레드 종가**는 별개입니다. 동일 날짜라도 거래가 없으면 결측이며, 근사치로 보충하지 않습니다.
- Investing.com 일부 종목 CDS 히스토리 페이지의 존재는 확인했지만, 데이터의 저장·재배포·자동 활용에는 사이트의 저작권/이용제한이 있어 **무단 스크래핑 경로로 채택하지 않습니다**.

**후속 파서의 입장 조건:** 공식 원천 스키마의 spread notation 확인 → corporate single-name UPI/참조법인 매핑 → 잔존 만기/통화·seniority 확인 → 원거래 ID와 정정·취소 이벤트 적용 → 동일일 거래의 검증된 스프레드 중앙값 산출 → 최소 1년 연속성/결측 비교. 이 조건 전에는 자동 발송에 CDS 수치 삽입 금지.

## 2026-11-06 KST — 15개 DTCC 원천 파일의 거래 단위 검증

실제 공식 공개 파일 검증은 Python read-only 파서 `scripts/audit-dtcc-company-cds-readonly.py`에 반영했습니다. 검증 기준: `Action type=NEWT`, `Event type=TRAD`, USD 표시, 단일법인 선순위 `UPI FISN=NA/CDS Corp SN Sr`, 결산일이 아닌 **실제 체결일**, 해당 기업의 REDID 및 이름 일치, 4.4~5.6년 잔존만기, 패키지/비표준 계약 제외, 숫자 단위 명시, 보유 중인 원천 파일의 오류·정정 계보를 확인하고 일반 계약 종료·변경은 과거 체결에서 소급 삭제하지 않음.

공개 보고 `Spread notation-Leg 1=3`은 **소수점 비율(decimal)**, `4`는 **bp**를 뜻합니다. 따라서 `0.0087`은 보고된 계약의 스프레드 *필드값*으로서 87bp로 읽을 수 있습니다. 다만 모두 별도 `Other payment amount`가 함께 보고돼 있어 이 값만으로 완전히 표준화한 5년물 **par CDS 스프레드**를 얻었다고 주장하지 않습니다. 코드도 par quote 검증 건수를 **0**으로 유지합니다. 관련 공식 자료: [ASIC 파생상품 보고 규정 CDE 표](https://www.legislation.gov.au/F2022L01706/2024-10-21/2024-10-21/text/original/epub/OEBPS/document_1/document_1.html).

| 기업 | 2026-11-05 적격 신규 거래 | 보고된 계약 스프레드 중앙값(시장 종가 아님) | REDID |
| --- | ---: | ---: | --- |
| Alphabet (GOOGL) | 1 | 87bp | 0C27GT |
| Meta (META) | 1 | 114bp | UZEAAG |
| NVIDIA (NVDA) | 3 | 133bp | 6D76CM |
| Oracle (ORCL) | 3 | 305bp | 6EC42L |

Oracle 원시 후보 4건 중 `MODI/NOVA`인 1건을 신규 거래 계산에서 제외했습니다. `Other payment amount`가 존재하는 계약 스프레드를 호가/결제 가격과 동일시하지 않습니다.

DTCC 공식 인덱스에서 최근 **15개 공개 파일(2026-10-22 ~ 2026-11-05)**을 다시 받아 중복 원천 ID 제거 후 38,323개 거래 이벤트/레코드를 검사했습니다. 해당 기간 안에서 확인된 정정·취소·변경 연결은 원거래에 반영했습니다. **이후 날짜에 공개될 수정 신고는 아직 알 수 없습니다.** [실제 검증 실행 #42213752739](https://github.com/cyyoung111-dev/portfolio/actions/runs/42213752739).

| 기업 | 직접 보고된 적격 거래가 있었던 날짜 수/15 | 10/22 거래 중앙값 | 11/05 거래 중앙값 | 두 관측일 차이 |
| --- | ---: | ---: | ---: | ---: |
| Alphabet | 7 | 79bp | 87bp | +8bp |
| Meta | 9 | 118.5bp | 114bp | -4.5bp |
| NVIDIA | 6 | 116bp | 133bp | +17bp |
| Oracle | 6 | 314bp | 305bp | -9bp |

**중요한 구분:** 나머지 7사는 `ISSUER_REFERENCE_UNMAPPED`이며 실제 거래가 0건임을 증명하지 않습니다. 관측이 없는 날짜에 이전 거래값을 채우지 않습니다. 기간 차이는 거래를 관측한 날끼리의 비교이며, 매 영업일 5년물 CDS 종가 변동으로 해석하지 않습니다.

**후속 조치:** 다른 일자 아카이브에 대한 수정·취소 재조회, 기업별 참조법인 REDID의 독립 교차검증, 각 CDS 계약별 지급구조·재구조화 조항 검증, 1개월·3개월·1년 시계열의 거래일 결측률 확인 후 운영 브리핑 반영 여부 판단. 11개 기업에 대해 확정적인 5Y dealer/par quote 원천이 확보되기 전까지 운영 CDS 확정값은 공란으로 둡니다.

## 2026-11-06 KST — 원시 계약 스프레드 약 1개월 시계열 확장

2026-10-02~2026-11-05의 **DTCC 공개 파일 35개**, 중복 원천 ID 제외 **70,944 레코드**를 `--history 2026-11-05 35`로 실수신했습니다. 정정·취소·변경 계보를 35개 파일 사이에서 확인했고 이후 날짜의 정정 가능성은 그대로 남아 있습니다. [읽기 전용 실제 검사 #42214174515](https://github.com/cyyoung111-dev/portfolio/actions/runs/42214174515)

| 기업 | 보고된 적격 계약 스프레드가 나타난 날짜 수 / 공개 파일 35개 | 한 달 비교 기준 거래일 | 해당일 거래 중앙값 | 11/05 거래 중앙값 | 변화 |
| --- | ---: | --- | ---: | ---: | ---: |
| Alphabet | 10 | 10/03~10/09 미관측 | - | 87bp | 미산출 |
| Meta | 15 | 10/06 | 92.125bp | 114bp | +21.88bp |
| NVIDIA | 11 | 10/08 | 79bp | 133bp | +54bp |
| Oracle | 11 | 10/05 | 246.25bp | 305bp | +58.75bp |

**표의 변화는 시장 CDS 호가의 1개월 변화가 아닙니다.** 이는 실제 거래가 보고된 날의 원시 계약 스프레드 중앙값에 대한 두 시점 비교입니다. 1개월 전 목표 거래일(최신 관측일로부터 30일 전) ±3일 내에 거래가 없으면 미산출, 여러 거래일이 있으면 정확한 기준일을 우선한 후 최근접 실제 관측일을 결정적으로 선택합니다. 모든 레코드에 별도 현금 지급금액이 보고된 상태이므로 표준화된 par CDS 신용프리미엄으로 단정하지 않습니다.

**운영 금지 상태 유지:** RED 독립 매핑, 계약 재구조화 조항, 현금 지급 방향 및 경제적 등가 스프레드, 이후 정정분까지 충분한 재검증과 3개월·1년 관측률 평가가 끝나기 전에는 장전·마감 브리핑의 확정 CDS 값으로 승격하지 않습니다.

## 2026-11-06 KST — 독립 RED 검증의 한계와 공식 이력 확보

- **독립 법인 검증:** S&P Global의 정식 RED for CDS는 참조법인·참조채무·승계 사건 및 RED-LEI 연결을 제공하는 권위 있는 서비스입니다. 서비스 접근 권한 없이 DTCC의 회사명·6자리 REDID를 **공식 독립 검증 완료**로 승격하지 않습니다. [S&P Global RED for CDS](https://www.spglobal.com/market-intelligence/en/solutions/products/red-cds).
- 보조적인 공개 자료로 Clarus의 SBSDR issuer parameter list에 `ORACLE COP-6EC42L`와 `6D76CMAA2`가 관측되어 Oracle과 NVIDIA 일부 RED 계열이 외부 목록과 부합할 가능성은 확인했습니다. 다만 이 목록의 추출·검증 체계와 법인 승계 관리가 정식 RED와 동등하다고 검증되지 않아 **secondary-only**, 법인 독립승인 상태는 0/11로 유지합니다. [Clarus 공개 참고 목록](https://eval.clarusft.com/api/rest/v1/ParameterOptions?parameter=issuer&service=SBSDRVolume).
- 공식 DTCC 누적 공개 파일 인덱스 실검증: 기준일 2026-11-05, 전체 파일 359개(2025-11-05~2026-11-05), 30일 30개, 90일 89개, 365일 358개. **이는 시장가치 평가 시계열 확보를 뜻하지 않고 공개 ZIP 파일 존재만 뜻합니다.** [Actions 실조회 #42217012314](https://github.com/cyyoung111-dev/portfolio/actions/runs/42217012314).
- 공개 파일 89개(2026-08-08~2026-11-05)를 실제 다시 받아 식별자 중복 제거 후 **173,442 레코드** 검사. 적격 신규 단일법인 선순위 계약의 스프레드가 관측된 거래일은 GOOGL 33일, META 28일, NVDA 29일, ORCL 32일. [89파일 실조회 #42217294284](https://github.com/cyyoung111-dev/portfolio/actions/runs/42217294284).
- 90일 구간이 3개월(91일) 비교 목표일 2026-08-06 및 ±3일보다 늦게 시작할 수 있어, 더 이른 파일까지 포함하는 120개 파일 검사 단계로 확장. 보간 금지, 실제 관측일이 없으면 3개월 변화량 `null`.
- **당시 단계에서는** 1년 거래 레코드 전수 검증 전이었으며, 이후 아래의 359개 파일 전수 검사와 수정 후 재검산까지 완료했습니다.

## 2026-11-06 KST — 359개 DTCC 공개 파일 전수 거래·정정 검증

- 2025-11-05~2026-11-05: 공식 공개 SEC_CR ZIP **359개**를 전부 실제 읽어 **491,599**개 공개 CSV 행 스캔. 회사명·REDID가 동시에 맞는 원시 거래 및 연결된 정정·취소 계보를 **2,966**개 이벤트로 축소해 메모리 사용을 제한했습니다. [Actions 실수신 #42218577794](https://github.com/cyyoung111-dev/portfolio/actions/runs/42218577794).
- 연결된 거래 이력에서 적격 신규·표준 계약 스프레드가 실제 보고된 날짜: **GOOGL 51일, META 61일, NVDA 46일, ORCL 83일**. 그 외 7사는 **RED 법인 독립 검증 미완료** 상태를 유지해 0건 거래로 잘못 해석하지 않습니다.
- 3개월(91일) 전후 ±3일 관측 거래 중앙값 변화: GOOGL +29bp(8/6), META +28bp(8/5), NVDA +59bp(8/6), ORCL +111bp(8/5). 해당 값은 **고정된 5년물 CDS par 호가가 아니라 서로 다른 거래의 원시 계약 스프레드 중앙값 차이**입니다. 별도 지급금액·거래 빈도·계약조건 차이를 통제한 총신용비용 지표가 아닙니다.
- **1년(365일) 변화량은 4개 기업 모두 `null`입니다.** 단, 아래에서 확인한 공개 아카이브 시작일 제약(2025-11-05 이전 자료 미확보) 때문에 기준일 ±3일 범위 전체를 검사하지 못했습니다. 따라서 거래가 없었다고 단정하지 않습니다.
- 읽기 전용 경량 파서 `scripts/audit-dtcc-year-filtered-readonly.py`는 최대 4개 공개 ZIP만 동시 요청하며 수집 각 날짜의 연결 사건만 보관합니다. 공개 파일의 중복 원천 ID 충돌·정정/오류 연쇄를 실패로 처리하는 자체 테스트를 전체 CI에 연결했습니다. **원천 파일 이후에 도착할 정정 이벤트는 아직 반영할 수 없음**을 명시합니다.
- 독립 RED 매핑·법인 승계의 권위 있는 S&P Global RED 서비스 접근은 아직 확보되지 않았으며, 기관별 공식 5년물 par CDS 종가도 **0/11** 확인 상태입니다. 완전한 라이선스 기반 RED/호가가 확보되기 전에는 *CDS 확정치*를 장전·마감 브리핑에 자동 삽입하지 않습니다.

- 생명주기 검증 강화: 보고 오류·정정(`EROR`·`CORR`)은 과거 잘못 보고된 가격을 보수적으로 제외할 수 있지만, **계약 종료(`TERM`) 또는 일반 계약 변경(`MODI`)만으로 유효하게 체결된 과거 거래 자체를 소급 삭제하지 않습니다.** 공식 SEC/DTCC 보고 이벤트 정의와 자체 회귀 테스트로 구분했습니다. [359개 파일 재검증 #42219210778](https://github.com/cyyoung111-dev/portfolio/actions/runs/42219210778)에서 집계 결과가 그대로 유지됐습니다. [SEC Regulation SBSR 관련 FAQ](https://www.sec.gov/rules-regulations/staff-guidance/trading-markets-frequently-asked-questions/frequently-asked-questions-regulation-sbsr).

## 2026-11-06 KST — 최신 Codex P2 3건 수정 및 기준일 커버리지 상태

- 최신 Codex P2 ① **동일 식별자의 연결 정정 이벤트 충돌**을 법인명/RED 필드가 빠진 정정행에서도 잡도록, 아카이브 전체 식별자를 정규화하여 동일 ID·상충 내용 시 즉시 실패 처리. 원거래가 다르지만 동일 정정 ID인 두 행을 순서 바꿔 주입하는 반례 추가.
- P2 ② **체결일과 공개 아카이브 날짜 구분:** 파일이 11월 7일에 배포되어도 유효 거래의 `Execution Timestamp=11월 6일`이면 11월 6일 관측치로 집계. `observationDateBasis=EXECUTION_TIMESTAMP_UTC` 기록.
- P2 ③ **365일 비교 ±3일 범위:** 공개 파일 탐색 시작을 `as_of-382일`로 확장(365+3+14일의 허용/지연신고 여유), 최대 다운로드 410건을 제한. 실제 `year1CoverageStart=2025-11-02`인데 최초 공개 아카이브가 `2025-11-05`라면 `year1Status=ARCHIVE_WINDOW_INCOMPLETE`; 이는 **거래 미관측 확정과 다릅니다.**
- 수정 후 [359개 공개 파일 재검증 #42223515244](https://github.com/cyyoung111-dev/portfolio/actions/runs/42223515244): 491,599행·기업 관련 2,966행, 관측일 GOOGL 51/META 61/NVDA 46/ORCL 83, 3개월 원시 계약 중앙값 비교 +29/+28/+59/+111bp. **1년 비교 모두 null, 사유 `ARCHIVE_WINDOW_INCOMPLETE`**, 공식 5Y par CDS 호가 0건.
- P2 생산함수 회귀 및 [전체 CI #42223358210](https://github.com/cyyoung111-dev/portfolio/actions/runs/42223358210) 성공. 정식 RED 독립검증 0/11, CDS dealer par quote 0/11, 금융 원본/Telegram/GAS 변경 없음. 최신 독립 재리뷰 및 병합 승인은 별도 단계.

## 2026-11-06 KST — 거래 ID 전역 검증·UTC 체결일 집계 공통 구조

이전 Codex P2의 **파일 간 상충 거래보고 ID**와 **rolling 분석의 ZIP 날짜 집계**는 각각의 국소 패치가 아니라 양쪽 파이프라인에 재사용되는 공통 함수로 변경했습니다.

- **전역 ID 검사:** `audit-dtcc-company-cds-readonly.py`의 `register_source_ids(rows, fingerprints)`가 기업명/RED 관계 추출 **이전**, 원천 CSV의 모든 `Dissemination Identifier`와 정규화 행 내용에 대한 SHA-256 지문을 기록합니다. 파일 내부 및 **서로 다른 파일에 같은 ID·다른 내용**이 나오면 `DTCC_GLOBAL_ID_PAYLOAD_CONFLICT`로 중단하며, 완전히 같은 행의 재공시는 중복 제거합니다. 365일 스트리밍 파서는 전체 원천 약 49만 행의 지문만 유지하고 기업/연결 정정 행 2,966개를 별도 저장하므로 원천 전체 CSV 행을 연간 메모리에 적재하지 않습니다.
- **공통 관측 오라클:** `execution_observations(rows, latest_archive_date)`는 실제 `Execution Timestamp`(UTC)로 날짜를 생성합니다. 기존 `--history`(15~120개)와 `audit-dtcc-year-filtered-readonly.py`(연간)는 이 함수를 공유합니다. ZIP 파일 공개일은 다운로드 커버리지 표시에만 사용합니다.
- **회귀 테스트:** 원거래 `1001` 및 별도 비대상 `3002`의 상충 `CORR ID=4000`이 서로 다른 날짜 ZIP에 분산되고 회사명/RED가 누락된 사례를 상반된 입력 순서 모두 거부합니다. 별도의 11/06 체결 거래가 11/07 ZIP에만 있는 사례는 두 경로에서 11/06 관측값으로 유지합니다.
- **실제 독립 재검증:** [GitHub Actions #42225950861](https://github.com/cyyoung111-dev/portfolio/actions/runs/42225950861)에서 공개 ZIP **359개·491,599행**을 수정한 전역 ID 체크와 공통 관측 오라클로 재수신해 성공했습니다. 관련 이벤트 **2,966개**, GOOGL/META/NVDA/ORCL 관측일 **51/61/46/83일**, 3개월 원시 계약 스프레드 거래 중앙값 변화 **+29/+28/+59/+111bp** 유지. 1년 변화는 공개 파일 시작일 제약으로 네 기업 모두 `year1Status=ARCHIVE_WINDOW_INCOMPLETE`입니다.
- `dealerParQuotesVerified=0`, `licensedRedReferenceMappingsVerified=0` 유지. 해당 값은 시장 5년물 CDS 종가가 아니며, 장전·마감 운영 브리핑 또는 금융 원본에 자동 반영되지 않습니다.
- 단기 및 연간 원천 검증 작업의 일시적 GitHub Actions 경로는 검증 후 **main과 같은 workflow blob으로 원복**했습니다. 본 PR은 상위 PR #983에 의존하는 Draft 상태이며 main 병합·GAS·Telegram·시트 변경은 없습니다.
