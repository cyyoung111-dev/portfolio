# Issue #507 — 2026-10-30 39행 보존형 선택적 종가 재평가 계획 (source-only)

## 현시점 실운영 사실

- 공식 수동 진단 [#41180725667](https://github.com/cyyoung111-dev/portfolio/actions/runs/41180725667): 운영 GAS 9.281, 국내 보유 37개(주식 16/ETF 21) 모두 10/30 KRX 정확일 공식 종가 제공 가능, 결측·전일 이월·원장 고아·마스터 중복 0. 저장 가격이력은 **국내 0/37**.
- 연결된 실제 Google Sheet 10/30 `스냅샷 A16325:L16363`: 물리 39행(국내 이전 10/29 종가 carry 37, F00001/F00002 정상 NAV 2), 날짜/종목코드 중복 0. 당일 `가격이력 A8130:F8131`의 NAV 2건과 `펀드기준가격 A661:I662` 날짜·평가금액 일치.
- 기존 `recoverPendingKrxClose`의 `_targetedKrxRecoveryPreflight_`는 스냅샷 0건만 허용하므로 39행에는 `TARGET_NOT_EMPTY` 제약. 범용 `saveDailyPriceHistory`의 무조건 재실행은 비승인.
- #796/#797는 별도 승인 후 main에 순차 병합: #796 `cd22099573863aae710fc106c7f4a730ceab715c`, #797 `21868950f69d69ffb87ffeda38286c93b33d217f`. GAS 생산 원본 Git blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`는 불변.

## PR #798의 새로운 검산 오라클

`scripts/issue507-oct30-scoped-valuation-plan.mjs`는 **순수 JavaScript** 사전 계획이며 HTTP/Google Sheets/GAS/시트 쓰기 호출이 없습니다.

1. 정확한 10/30 보유 37코드와 Ledger 수량·매수원금, 39 물리 스냅샷, NAV 펀드 2행, 기존 가격이력 NAV 2행, 37개의 공식 KRX/KRX_OTP 양수 가격을 **동일 메모리** 안에서 검사합니다. 날짜 불일치, 가격 source mismatch, 중복 코드, 잔고 drift, NAV 수정 시 전체 중단.
2. 실제 생산 `_buildSnapshotRowsFromTradeAndPriceHistory`의 **KRW 환산 평가 공식**과 일치: `priceKrw = Math.round(price * 1)`, `evalAmt = Math.round(priceKrw * qty)`, `pnl = evalAmt - costAmt`, `pct = Number((pnl/costAmt*100).toFixed(2))`, `evalUnit = Number((evalAmt/qty).toFixed(2))`. 소수 좌수와 손실 종목을 포함해 확인합니다.
3. 기존 12열 스냅샷의 국내 37행에서 **G~K(평가단가·평가금액·손익·수익률·출처)만 바꾸는 후보 행** 및 정확일 `가격이력` 국내 37건 insert 계획을 **메모리 내부**에서 생성합니다. `A~F(날짜·코드·명·수량·매수단가·매수원금)`와 L(저장일시), F00001/F00002 2행 및 당일 NAV 가격이력 2행은 수정 대상에서 제외합니다.
4. 출력 가능한 `summary`에는 건수와 `safeToApply=false`만 있습니다. `privatePlan`은 가격·코드·수량·계좌 관련 값을 포함할 수 있어 **로그/PR/이슈/웹/API/텔레그램에 절대 기록하지 않습니다**.
5. 동결된 GAS 실제 생산 함수를 source-level로 대조하고 합성 예시/오류 변이 테스트로 정확한 계산·소스·종가·원장·NAV 검증. 실제 가격 취득, 운영 GAS 코드/버전/배포/금융 원본/네트워크 작업 **0건**.

## 향후 실행 전 필수 별도 승인

이번 PR은 writer 구현이 아닙니다. 후속 승인된 작업은 10/30 원천 37개 가격을 비공개로 같은 GAS 실행 내부에서 확인하고, 실운영 거래원장·좌수·NAV·원가·가격이력·스냅샷의 fresh row/readback을 보호 환경에서 점검해야 합니다. 555 writer gate, 기존/외부 writer 차단·ScriptLock, 재시도/부분실패/백업 signature/롤백, GAS v9.282 후보 version pins, 제3자 감시 및 승인된 릴리스의 안전성 검증이 필수입니다.

- Source-only PR 병합 승인은 **운영 GAS 배포나 과거 금융 원본 수정 승인이 아닙니다**.
- 스프레드시트의 표시 timezone `America/Los_Angeles`와 생산 GAS `Asia/Seoul` 경계에서 정확 날짜/시간값 검증이 반드시 필요합니다.
- 운영 GAS의 실제 37 가격값을 확보해 각각 검증한 적 없으며, 현재 priceHistory 0/37과 37 carry 상태가 유지됩니다.
