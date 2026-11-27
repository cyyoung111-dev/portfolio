# NH PLUG 운영 범위 — 시세 조회 전용 (2026-11-28 KST)

## 사용자 운영 원칙
- NH는 시장 데이터 공급원. 주문·정정·취소, 자동매매, 수수료 요율에 따른 손익 모델은 도입하지 않는다.
- 전체 증권사·계좌의 기존 거래원장 및 기존 실제 수수료/세금 입력, 자산평가, Snapshot은 유지. NH 매매 가정치 또는 빈 계좌 응답으로 덮어쓰지 않는다.
- 이전에 준비된 계좌·금융소득 읽기 전용 진단은 삭제하거나 자동 실행 범위를 늘리지 않는다. 실제 NH 거래/계좌 활용이 필요할 때만 별도 대사한다.

## 11/19 명세 개정과 영향
공식 https://www.nhplug.com/llms.txt (개정 2026-11-19), https://www.nhplug.com/openapi-docs/common/openapi.json.
통합 실현손익 조회의 신규 경로는 /common/inquiry/v1/tradingPnl, dailyTradingPnl, periodPnl, periodPnlDetail이다. 기존 국내 실현손익 API 병행 이용은 사용자 수신 공지상 12/1까지. 코드 검색에서 이들 기존/신규 손익 API 호출을 찾지 못했고, 웹 calcRealizedPnl은 rawTrades로 계산한다. 검색은 전체 운영 GAS 원문 및 실제 운영 호출을 증명하지 않으므로 미확인 범위를 유지한다. 신규 네 손익 API 및 가정 수수료를 시장 데이터 전용 포트폴리오에 불필요하게 연결하지 않는다.

## 시세 계약 점검
기존 국내 현재가, ETF 현재가, 일별 종가 / 해외 현재가, 정규장 일봉, 지수·환율 일봉의 요청 필드와 응답 블록을 공식 공개 명세에 대조한다. 해외주식 period의 count/xtick=0001/gubun=3/market_cls=1와 symbolIndexFxPeriod의 array_cnt/xtick=001/gubun=1을 혼동하지 않는다. 기존 정규장 종가 및 데이터 기준일 검증 유지.
해외선물 후보는 /gbfuture/quote/v1/current와 /gbfuture/quote/v1/symbolDetail. exnm=FCME, 정확한 계약 종목코드, last/pcls/cur, bday/tdtm 및 장시작/종료/업데이트 필드 계약 확인. bday+tdtm 시간대/거래일 귀속, 월물 선택/roll, 실제 권한·응답·지연 여부가 확인되기 전에는 현재 시세로 표시하거나 Yahoo를 대체하지 않는다. 공개 명세 점검은 계좌 조회나 인증된 시세 성공이 아니다.
공개 명세 진단은 www.nhplug.com/openapi-docs/의 GET만 사용한다. 기존 공개 master PR 검사와 함께 검증. 신규 예약·개인 계좌 호출·토큰 발급·주문·금융 쓰기 없음.

## 운영 지속성
공식 이용안내 https://www.nhplug.com/about-openapi 는 3개월 단위 미거래 시 익월 첫 영업일 자동해지 조건을 명시. 조회만 사용하는 실계좌에도 동일한지 NH의 안내 확인이 필요하다. 해지 방지를 위한 거래를 생성하지 않으며, 기존 인증/연결 상태 점검과 타 원천 fallback을 유지한다. GAS/Google OAuth 변경 제외.
