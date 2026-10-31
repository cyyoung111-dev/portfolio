# Issue #507 — 2026-10-30 KRX 37종목 실조회 1회·비노출 개별 확인 GAS 후보

## 확인된 운영 상태 (2026-10-31 KST)

- 통합 [PR #800](https://github.com/cyyoung111-dev/portfolio/pull/800)은 승인된 squash 방식으로 main `28975b772f55a95e6bd15dd47a2752e7c055fdb9`에 **병합 완료**. 병합 후 Quality, Web, Pages 및 GAS validation SUCCESS이고 실제 GAS deploy 단계는 **SKIPPED**. 금융 원본 값 수정은 하지 않음.
- GAS의 **운영 본문** `src/gas/apps_script.gs` Git blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`은 불변. 기존 `handleGetKrxHeldCloseCoverage`는 대상일 공식 KRX 37/37 건수 증빙에는 성공했지만 개별 **수치**를 외부 API로 반환하지 않습니다.
- 실제 가격이력 2026-10-30 국내 정확일 0/37, Snapshot 국내 37행 `KRX_CARRY@2026-10-29`, 펀드 NAV 2건 정상. 단순히 소스 37/37 확인했다고 영업일 실제 37개 종가를 저장/복구한 것은 아님.

## 이번 제안 범위

신규 `scripts/issue507-oct30-private-live-readonly-probe-proposal.mjs`은 **GAS에 배포되지 않은** `PRIVATE_LIVE_READONLY_FUNCTION`을 문자열로 제공합니다. 운영 `doPost`/웹 API/시트 원본/트리거/재무 writer에는 **추가하지 않았습니다**.

향후 별도 승인된 제한된 실행 환경에서만 내부 private 함수 `_issue507Oct30PrivateLiveReadOnlyProof_`로:

1. GAS의 실제 `getCodeItems`, `_getDailyHeldCodeItems`, `_isKrxDailyCloseTarget_`를 통해 거래일 2026-10-30 기준 **국내 보유 37종목**을 계산합니다.
2. 운영 Snapshot 물리 39행과 가격이력 물리 2행(이 날짜만)을 읽어 기존 [#797의 사전검사 모듈](https://github.com/cyyoung111-dev/portfolio/pull/797) `_issue507Oct30PrivateQuoteProof_`가 요구하는 펀드/이월/시장 구성이 유지되는지 검증합니다.
3. `fetchPricesKrx(held,date)`를 **1회** 호출하여 얻은 **각 종목별 실제 숫자·정확일·KRX/KRX_OTP 출처**를 **동일 실행 메모리 안에서만** 기존 private 검증 함수에 전달합니다. 현재 CI는 외부 KRX 대신 합성 quote map을 사용하므로 **실제 37개 가격값은 아직 취득하지 않았습니다**.
4. KRX 조회 전후 대상일 Snapshot+가격이력 39/2 값이 완전히 일치하는지 재검사합니다. 동시 외부 writer 변경 시 중단합니다. 이 재읽기는 Snapshot 외의 전체 원본 무변경·스크립트잠금·백업·롤백 보증과 다릅니다.
5. 결과는 대상일/건수/검증 범위 및 `writeAuthorized:false`, `financialWrites:0`만 반환합니다. **원천 코드 37개, 개별 종가, 수량·계좌, 원장 내용, 원본 digest, URL, GAS 토큰, 인증키를 응답·Actions 로그·이슈에 남기지 않습니다**. API 호출을 연결하기 전 인증·권한·동시실행/timeout 정책의 별도 검증이 필요합니다.

## 검증

- `scripts/check-issue507-oct30-private-live-readonly-probe.mjs`는 동결된 **실제 운영 GAS** `_getDailyHeldCodeItems`, `_isKrxDailyCloseTarget_`, `handleGetKrxHeldCloseCoverage`, `_krxHeldTargetCloseEvidence_` 함수를 VM에서 실행합니다. private 함수와 기존 source-only 개별 quote 검증기도 합성 데이터로 실제 실행합니다.
- 날짜·종목별 출처·0원/NaN·결측·고아·ETF/주식·NAV·이월·가상 외부 writer 간섭에 대해 실패 폐쇄하고, 성공 시 한 KRX 호출만 발생하며 웹/GAS/재무 데이터에 실제 쓰기 코드가 없음을 점검합니다.
- `check:ci`에 등록하여 기존 #796–#800 테스트와 함께 실패 시 CI를 중단합니다.

## 배포/원본 수정 승인 경계

이 PR은 **실제 종가 숫자 조회 실행 단계의 선행 소스 후보**일 뿐, 승인된 GAS 배포나 금융 원본 복구 프로그램이 아닙니다. 후보 내부의 boolean/건수만으로 실원천값·물리 시트 보호/555 gate·원장 수량·가격이력 증빙이 운영에서 참이라고 주장하지 않습니다.

실운영 접근 전에 ① 별도 GAS 배포 승인 및 버전 핀/인증/권한 설정, ② 정확일·개별 종가 KRX 공식 조회 성공, ③ Snapshot/펀드 NAV 보존과 전후 시트 안정성, ④ 555 writer gate/외부 Sheets API writer 배제, ⑤ 금융 원본 백업·락·rollback·사후 복구 계획을 따로 검증해야 합니다. **이 PR은 병합 승인 전 미병합이고, 원본 금융 데이터 수정은 어떤 경우에도 별도 사용자 승인 대상입니다.**
