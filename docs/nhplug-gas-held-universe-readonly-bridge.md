# NH PLUG 보유종목 날짜별 GAS 읽기 전용 브리지

## 목적·현황

운영 GAS v9.275는 scripts/deploy-gas.mjs에서 전체 소스 blob SHA를 검증합니다.
이 PR은 기존 운영 GAS를 수정하지 않고 이미 존재하는 getTrades와
getCodeListReadOnly 인증 API를 POST 읽기 전용으로 이용하는 외부 Node
브리지를 준비합니다.

## 구현 및 검증

- fetchGasHeldUniverseCandidate({date,url,token,fetchImpl}):
  - script.google.com의 승인된 /macros/s/{deployment}/exec HTTPS URL만 허용
  - 잘못된 토큰으로 getCodeListReadOnly 호출 시 반드시 인증 실패가
    반환되는지 먼저 검사. 기존 GAS의 인증 비설정 호환 모드는 fail-closed
  - getTrades → getCodeListReadOnly → getTrades 순서로 조회하고 앞뒤
    거래행 SHA256 지문 일치 검사. 네트워크·인증 오류 시 재시도/쓰기 없음
  - GAS 종목코드 단위 buy/sell/split/reverse_split 계산과 비교한
    날짜별 보유종목 후보를 메모리에 반환
- 합성 테스트는 기존 GAS _calcCodeHoldingsAtDate·_applyHoldingTrade
  리듀서의 실제 소스 함수를 VM에서 실행해 브리지 수량과 비교
- 원장·종목명·거래금액·토큰은 로그/CI/artifact에 기록하지 않음

## 중요한 보수적 제약

1. 두 GAS 읽기 호출은 단일 transaction이 아니므로 원장 재조회가
   일치하더라도 완전한 원자성을 입증하지 못합니다.
   결과는 CANDIDATE_NON_ATOMIC_UNVERIFIED / verified:false로 고정.
2. GAS 종목마스터는 대상 날짜의 상장 상태를 제공하지 않습니다.
   listingState는 UNKNOWN, listingStateAsOf는 null로 유지합니다.
   따라서 PR #704의 공식 보유 커버리지 준비 완료로 승격하지 않습니다.
3. getTrades는 전체 거래내역을 클라이언트 메모리에 반환합니다.
   실운영에서는 한 번의 인증된 GAS ScriptLock 안에서 최소한의
   날짜별 코드만 반환하는 단일 읽기 전용 엔드포인트가 더 안전합니다.
4. 이 작업은 실계정 GAS 호출을 수행하지 않았고, GAS 원본 파일,
   가격이력·Snapshot·거래원장·TFL·Telegram 예약을 변경하지 않았습니다.

## 다음 단계

- 인증 필수·ScriptLock 보호·읽기 전용 GAS 단일 endpoint 설계 및 별도 검토
- GAS v9.275 전체 소스 리뷰/버전 bump/해시 승인과 운영 배포 안전 게이트
- PR #704의 종목마스터/거래정지 상태 및 사용자 데이터 기준일 검증
- NH 실제 장마감 종가 조회·GAS provenance·Telegram 운영 검증
