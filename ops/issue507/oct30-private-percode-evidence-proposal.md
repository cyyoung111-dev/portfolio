# Issue #507 — 2026-10-30 개별 KRX 종가 비노출 사전증빙 제안

## 현시점에 실제 확인한 사실 (2026-10-31 KST)

- 보호된 수동 운영 진단 [#41180725667](https://github.com/cyyoung111-dev/portfolio/actions/runs/41180725667): `getKrxHeldCloseCoverage` 집계 결과 STOCK 16/16·ETF 21/21·전체 공식 정확일 37/37, 결측/이월/마스터 중복/고아 원장 0. 저장 가격이력은 0/37이라 기존 `DOMESTIC_CLOSE_INCOMPLETE`가 지속.
- 연결된 **실제** 포트폴리오 Google Sheet의 `스냅샷` A16325:L16363, `가격이력` A8130:F8131, `펀드기준가격` A661:I662 및 10/29 전일 스냅샷 A16286:L16324를 GET만으로 비교. 10/30 실제 39행은 종목코드 전부 고유, 국내 37 `KRX_CARRY@2026-10-29`, 펀드 2 `FUND_NAV`. 국내 37개 전부 평가단가와 수량이 10/29와 동일, 펀드 F00001·F00002의 NAV·평가금액과 10/30 가격이력이 일치. 물리 39행 및 2개 NAV 증빙은 기존 PR #796 합성 테스트와 구분되는 실제 원본 읽기 결과.
- 생산 GAS 동결 blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`: `handleGetKrxHeldCloseCoverage`는 `fetchPricesKrx`를 이용해 실제 코드별 날짜·출처·양수 가격을 확인하되 응답은 **건수 집계만** 반환. 다른 `getKrxOfficialStockCloses`는 삼성전자·SK하이닉스 고정 샘플에 한정. 따라서 공식 종가 *값 37개 전체*가 챗·Actions 로그·원본 가격이력에 확보됐다고 말할 수 없음.
- 연결된 Google Sheet의 메타데이터 타임존은 `America/Los_Angeles`로 확인. 이 감사를 위해 가격·날짜를 서식/타임존 변환 없이 ISO 날짜 표시값으로 비교했으며, 미래 GAS writer는 `CONFIG.TIMEZONE=Asia/Seoul`와 거래일 교차검증 필수. 이 메타정보가 곧 10/30 누락 원인이라는 증거는 없음.

## 이번 별도 PR 범위

- `scripts/issue507-oct30-private-percode-proof-proposal.mjs`의 **문자열로만 보관되는** 후보 GAS 내부 헬퍼는 정확한 날짜 `2026-10-30`을 고정하고, 당일 보유 집합 37코드(주식 16/ETF 21), 스냅샷 39 실제 행(국내 37 전일 이월, 정상 NAV 2), 국내 가격이력 0과 펀드 가격이력 2, KRX 및 KRX_OTP의 37개 개별 양수 가격·당일 거래일·1:1 코드 일치를 같은 메모리 실행 안에서 검증하도록 제안.
- 성공 반환에는 코드/가격/수량·계좌가 없으며 `safeToWrite=false`. 미확정일·허위/혼합 출처·전일 carry·중복 코드·전량매도·잘못된 가격·NAV 변조를 fail-closed 처리. 민감 데이터의 로그·HTTP 응답 출력 금지.
- `scripts/check-issue507-oct30-private-percode-proof.mjs`는 동결된 실제 GAS blob 해시를 검증하고 **실제 생산 `handleGetKrxHeldCloseCoverage`를 VM에서 합성 37코드로 실행**, 후보 헬퍼의 성공/19개 실패 변이/원본 불변성 검증. 네트워크·NH 신규 토큰·금융 쓰기·GAS 배포 전부 0.
- 이 PR은 기존 미병합 PR #796의 별도 scoped 사전검사와 충돌하지 않도록 `main`에서 독립 분기했음. 양쪽 모두 `package.json`을 수정했기 때문에 추후 병합 순서에 따라 CI 명령을 재통합해야 하며, 이전 검사가 사라지면 병합 금지.

## 아직 미확인 및 배포 금지사항

- 이 설계는 원본 실데이터 **37개 가격값을 요청하거나 확보하지 않았고**, 신규 GAS 액션을 추가·배포하지도 않았음. 실제 리드백을 하려면 보호된 운영 환경에서 승인된 GAS read-only 내부 계측·버전/출처 manifest·실패 로그 최소화/토큰 보호 검증을 별도 릴리스로 수행해야 함.
- 기존 `recoverPendingKrxClose`는 Snapshot 0행인 날짜만 처리하므로 39행 대상 적용 불가. 신규 선택적 writer는 원본 백업 서명, 잠금, 555 writer gate 및 재시도/롤백, 별도 사용자 승인 필요.
- 10/30 국내 가격이력 37 insert/스냅샷 국내 37 revalue 추정은 **계획상의 대상 규모**이며 아직 어떤 원본 가격도 작성·변경하지 않았음. 펀드 NAV 2건, 기존 가격이력, 좌수·원가·거래원장 100% 보호를 전제로 함.
