# Issue #507 — 2026-10-30 KRX 원천 완전성과 선택적 원본 복구 사전조건

## 운영 원천 확인

- 공식 [수동 보호 진단 #41180725667](https://github.com/cyyoung111-dev/portfolio/actions/runs/41180725667), main `50056432cbe8fa99908086454bde575154f4cb89`: 실제 운영 GAS **9.281**.
- 기존 가격이력 진단: `DOMESTIC_CLOSE_INCOMPLETE`(기대한 exit 2), 국내 `37/37 KRX_CARRY@2026-10-29`, 당일 가격이력 `0/37`, Snapshot `39`행, F00001/F00002 `FUND_NAV` `2/2` 확인.
- 새 KRX 독립 진단: **공식 정확일 KRX 37/37**, 주식 **16/16**, ETF **21/21**, 결측·이월·중복 마스터·고아 원장 **모두 0**, `ready=true`.
- 위 37/37은 생산 GAS `getKrxHeldCloseCoverage`가 실제 보유 종목을 재구성한 뒤, `fetchPricesKrx`가 정확한 요청일의 `KRX` 또는 `KRX_OTP` 가격 및 양수를 갖는 코드만 집계한 **기능 조회 시점의 증거**입니다. 이 API 출력은 **종목별 가격/수량/계좌 데이터를 포함하지 않습니다**. 따라서 금융 원본의 37개 실제 가격값 자체는 아직 확보·검산되지 않았고, 이 증거만으로 원본 쓰기는 허용할 수 없습니다.

## 기존 복구 루트의 안전상 한계

- `_targetedKrxRecoveryPreflight_`는 스냅샷 `snapshotRows !== 0`인 날짜를 의도적으로 `TARGET_NOT_EMPTY`로 거부합니다. 10월 30일에는 해당 날짜 스냅샷이 39행 있으므로 기존 `handleRecoverPendingKrxClose(apply=1)` 경로가 직접 해결책이 아닙니다.
- 일반 `saveDailyPriceHistory(date)` 재실행은 국내외 보유·펀드·기존 평가를 공통 재구성하므로, 승인 없는 실행은 **기존 39행과 정상 NAV 2행을 손상할 수 있습니다**. 현재 원본 시트에 대한 쓰기/대량 백업 복원/전일 carry의 당일 공식 종가 승격을 금지합니다.
- 37개 국내 종목만 대상이고 F00001/F00002와 거래원장·좌수·장부원가·과거 이력을 보존해야 합니다. 향후 새 선택적 writer는 **독립된 새 GAS 소스·버전/manifest·555개 writer gate/lock·백업/롤백** 및 별도 승인/검증이 필요합니다.

## 이번 PR 범위 — 순수 read-only 사전평가

- `scripts/issue507-oct30-selective-recovery-preflight.mjs`: 이전 두 진단의 정형 결과(스냅샷 논리 39/국내 이월 37/펀드 2 NAV/가격이력 국내 0/공식 KRX 37)를 결합해 일치성 검산 및 미래 복구 범위를 **37개 가격이력 insert와 37개 스냅샷 국내 재평가 대상으로만** 표현합니다. 실제 37개 개별 가격/원본 물리행 중복은 확인하지 못했음을 명시합니다.
- `scripts/check-issue507-oct30-selective-recovery-preflight.mjs`: 실제 고정 GAS 승인 blob 해시 및 기존 `_targetedKrxRecoveryPreflight_`의 빈 스냅샷 계약을 소스로 검증합니다. 중복, 전일 이월, NAV 변조, 날짜 틀림, 출처 결측, 시장별 미완료 및 source drift를 합성 오라클로 검증합니다.
- 새 소스는 **GAS에 반영되지 않고**, 외부 조회·NH 토큰 발급·금융 쓰기·텔레그램 전송·운영 배포 **모두 0**. `safeToApply=false`, `perCodeExactClosePriceEvidence=false`로 결론을 제한합니다. PR에 포함된 검사 통과는 복구 가능 가격의 최종 검증이 아닙니다.

## 다음 승인 전제

1. 정확일 KRX 실원천의 **개별 37개 (종목코드·날짜·가격·출처)** 증빙을 비공개/읽기 전용으로 확보하고 당일 보유 37과 1:1 조인, 영구 원본 비노출 점검.
2. 10월 30일 물리 스냅샷 39행과 역사 2행, F00001·F00002 금액/좌수·장부원가의 백업 서명 확보.
3. 신규 **선택적 37행 복구** 제안 GAS를 별도 승인 소스로 구성하고, 거래원장 변경·펀드 NAV/좌수 변경·동시 writer·부분 실패/복구/검증 불일치에서 전체 중단.
4. 전체 CI + 최신 Codex 리뷰 + 별도 **병합 승인과 운영 배포·금융 원본 쓰기 승인** 전에는 실운영 적용 금지.
