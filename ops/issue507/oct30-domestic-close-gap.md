# Issue #507 — 2026-10-30 국내 37종목 종가 누락과 NH/KRX 경로 검증

## 연결된 현재 포트폴리오 Sheet의 직접 읽기 결과 (2026-10-31 KST)

- 2026-10-26~29: 날짜별 `스냅샷` **39행**, `가격이력` **39행**.
- 2026-10-30: `스냅샷` **39행**(중복 종목코드 없음), `가격이력` **2행**(F00001/F00002 NAV).
- 10/30 스냅샷에서 **37개 국내 주식/ETF 전부 `KRX_CARRY@2026-10-29`**, 평가단가는 전일과 동일. 나머지 두 펀드만 10/30 확정 NAV와 동일한 값으로 업데이트.
- `동기화로그` (2026-10-30 19:34 KST) `PORTFOLIO_CLOSE PRICE_ERROR` → `KOSPI 2026-10-30 (0/1종목)`; 20:37 `WATCHDOG_RETRY state=ERROR, priceDate=, krxClosed=false`. 펀드만 별도 `FUND_DEFERRED_START` 수행.
- 과거 백업에는 F00001/F00002 전일 carry가 남아 있지만, 현재 두 펀드 NAV/평가액이 맞아 과거 F00001 단건 복구 모듈은 **재실행 금지**. 과거 78행 백업 묶음을 39행 운영 Snapshot에 그대로 복원 금지.

## 생산 코드에서 확인한 원인 경계

- 고정 운영 GAS 9.281의 `fetchDomesticRegularCloses(items,date)`는 **NH PLUG 우선, 부족분 KRX 보조**로 설계되어 있음.
- `fetchNhRegularCloses`의 결측·날짜 불일치·토큰/HTTP 오류·55초 제한 등은 호출자에게 개별 실패 원인/커버리지로 영속 기록되지 않음. KRX fallback도 10/30에 성공하지 않아 `_assessDailyKrxStockClose`의 그룹별 최소 유효성 검사에서 실패.
- **NH가 10/30에 왜 37개 당일 종가를 공급하지 못했는지는 미확인**: NH 인증/계정권한/Rate limit/응답 스키마/시간 제한/시점별 데이터 여부를 사실처럼 단정하지 않음. 10/26~29 저장 이력에 NH 출처가 보이지 않더라도 그 이유는 원본 영속 처리 기록만으로 분리할 수 없음.
- 10/30은 정상 거래일이므로 `KRX_CARRY@2026-10-29`를 당일 시장 종가로 승격해서는 안 됨. 수집실패가 있어도 과거 확정 종가·매수원가·수량·거래원장은 덮어쓰지 말 것.

## 신규 감사 (READ ONLY)

`scripts/issue507-oct30-domestic-close-readonly.mjs`:
1. 운영 GAS의 현재 `getAutomationStatus`와 `diagnoseSnapshotIntegrityRange(strictReadonly=1)` 결과로 **v9.281/v9.282 및 원천 digest/revision 전후 불변성**을 검증.
2. 기존 `getHistoryDetail(2026-10-30)`와 `getPriceHistory(2026-10-30, 해당 코드)`의 정확 날짜 비교로 국내 종목 누락·이월·공식 종가 형태가 아닌 저장 행을 건수로 표시. 이 요약은 GAS API의 논리적 개별 코드 기준이며 **원본 시트의 물리 행 중복 검증과 다름**.
3. `getNhAuthStatusProxy`는 **토큰을 발급하지 않는 상태 조회**로 현재 enabled/tokenCached만 표시. 10/30 당시 인증 상태의 소급 증거가 아니며, 실패해도 `UNVERIFIED` 표시.
4. 접근 토큰·NH 자격증명·원본 종목 가격·수량·계좌·원천 digest를 로그 출력하지 않음. 현재 저장 원천 존재는 거래소 공식 최종 확정이나 실제 NH 응답 증빙과 구별.
5. 10/30 국내 종가가 누락돼 있으면 진단 JSON에 `DOMESTIC_CLOSE_INCOMPLETE`를 출력하고 워크플로는 **비정상 종료**, CI 성공과 운영 완료를 혼동하지 않음.

수동 실행은 [issue507-oct30-domestic-close-readonly](https://github.com/cyyoung111-dev/portfolio/actions/workflows/issue507-oct30-domestic-close-readonly.yml)에서 `main` 선택 → `Run workflow`, 보호 환경 `portfolio-production-gas` 승인 조건 그대로. PR/CI에서는 합성 검증만 수행하고 live job은 skipped.

**다음 실제 수정 단계:** NH 당일 종가 실패 사유를 비민감 reason code로 남기는 계측/알림 설계, 37개 실보유 대상별 거래일·가격·출처 검산, KRX 다음날 원천 교차검증, 변경 범위·백업·승인 확정 후에만 과거 `가격이력` 및 해당 날짜 `Snapshot` 원본 보정을 검토. **수집 장치 승인·영속 쓰기·GAS 운영 배포는 별도 절차**입니다.
