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
