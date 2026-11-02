# 국내 거래대금 정식 원천 연결 준비 — 2026-11-02 (KST)

## 현재 범위
- KRX OpenAPI 공식 문서의 `idx/kospi_dd_trd`, `idx/kosdaq_dd_trd`에서 `BAS_DD`, `IDX_NM`, `ACC_TRDVAL` 확인.
- 거래대금은 API 원화 정수로 수신하고 화면에서 조원으로 표시. 대표지수 구성 대상의 누적 거래대금이므로 ETF·ETN 등을 포괄한 별도 **시장 전체 총거래대금**과 같다고 단정하지 않는다.
- 현재 `scripts/closing-krx-turnover.mjs`은 승인된 KRX 키가 실행 환경에 있을 때만 직접 읽는 **독립 선택형 어댑터**. 키가 없거나 마감 전·원천 미제공·날짜 불일치면 미확보. 예제 숫자는 테스트 fixture일 뿐 실데이터가 아니다.
- 텔레그램 **실전 출력, 16:50 precompute, QC, GAS 운영과는 미연결**. 본 단계는 프로덕션에 값이 나온다고 주장할 수 없다.

## 운영 연결 전 필요한 검증
1. 기존 KRX 인증키는 중앙 GAS Script Properties에 저장됨. GitHub로 키를 복제하는 방식은 피하고, 중앙 GAS에 거래대금만 제한적으로 반환하는 읽기 전용 응답 계약을 먼저 설계한다. 기존 GAS v9.282 이후 버전/배포 정책 및 승인 절차를 별도 PR에서 처리한다.
2. 17:00 당일 공개 가능 여부, `ACC_TRDVAL` 단위와 표본 범위, 대표지수 수치와 KRX 시장 합계 일치 여부를 독립 검산한다.
3. 17:00에 값이 아직 공시되지 않으면 전 영업일 값을 당일로 표시하지 않는다. 발송 게이트·Claim/SENT 유지, 로그에 인증키·원문 거래대금 비노출.
4. 투자자별 KOSPI·KOSDAQ 외국인·기관 순매수는 KRX 정보데이터시스템에 공식 화면이 있으나, 현재 승인된 OpenAPI 필드/자동 조회 계약은 확인하지 못했다. 임의 URL/비공식 크롤러로 실운영에 넣지 않는다.
5. 예탁금·신용잔고는 금융투자협회 등 공식 통계의 제공 방식·공표시각을 확인한 뒤, 기준일·단위 구분하여 별도 구현한다.

공식 원천:
- https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES001_S2.cmd?BO_ID=EREKZauXnMmxyIlqzeDN
- https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- https://data.krx.co.kr/
