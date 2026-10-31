# Issue #507 — 인메모리 2시트 복구·부분실패·롤백 실험 (운영 접근 없음)

## 범위
- PR #800 통합 source-only 위에 `scripts/issue507-oct30-two-sheet-inmemory-sandbox.mjs`와 `scripts/check-issue507-oct30-two-sheet-inmemory-sandbox.mjs`를 추가했습니다.
- 현물 `스냅샷`과 `가격이력` 시트를 **읽거나 쓰지 않습니다**. 함수는 Google Sheets adapter/서비스/인증정보를 받지 않으며 입력 배열은 처음에 완전히 깊은 복제하여 메모리 내에서만 작업합니다. 실제 GAS writer, 백업 시트, LockService, 555개의 gate 및 외부 Sheets API writer의 동작은 변경하지 않습니다.
- 검증에 쓰이는 가격/펀드/코드/거래원장은 100% 가상 데이터입니다. 실제 KRX 2026-10-30 공식 정확일 커버리지 37/37은 실시간 가격값 확인/저장과 구분해야 합니다.

## 모의 실행의 단계
1. 날짜 2026-10-30, Snapshot 39(국내 37·NAV 2), 가격이력 2(NAV 2), 다른 날짜 센티널 행과 후보 privatePlan을 복사하고 사전 signature를 SHA-256으로 메모리에서 계산합니다. 해시 원문·종목코드·수량·가격은 외부 로그/PR 응답에 노출하지 않습니다.
2. **기존 독립 검산기** `verifyIssue507Oct30PostState`로 37개 계획 입력이 실제 생산 GAS 평가 공식 및 NAV·수량·매입원금 보호와 일치하는지 사전 검증합니다.
3. 가상 가격이력 37건 insert → 가상 국내 37행 변경 → 사후 readback → 다른 날짜 전체 행 원형 증명을 수행합니다. 성공 요약도 `SIMULATED_READBACK_MATCH`이며 `safeToFinalize=false`, `realFinancialWrites=0`입니다.
4. 첫 가격이력 저장 중단(일부 5건, ACK 유실 1건), 가격이력 전체 성공 뒤 Snapshot 실행 전 중단, Snapshot 8건 후 중단, Snapshot 전체 후 응답 유실, 사후 NAV 변조 시 **두 시트 모두 가상 백업 상태로 복원**하여 원본 해시와 일치하는지 확인합니다.
5. 가상 복원 실패 시 `SIMULATED_ROLLBACK_UNVERIFIED`, 외부 API writer 가정 시 `SIMULATED_EXTERNAL_CONFLICT_UNRESOLVED`로 중단합니다. 외부 writer가 덮어쓴 값은 임의 백업으로 덮지 않으며 승인된 완료 마커 또는 자동 재시도는 어떤 경우에도 부여하지 않습니다.
6. 실제 백업·원장 락/555 gate/외부 writer 차단/권한·운영 토큰/부분 실패 후 수동 복구는 **모두 미실행**입니다. 이 모의 실행에 성공해도 실제 GAS 배포나 원본 수정의 승인이 되지 않습니다.

## 운영상 추가 주의
- Google Sheets `LockService`는 외부 Sheets API 쓰기를 배타적으로 막지 않으므로, 실제 운영 writer는 별도 외부 쓰기 배제 증빙과 시트 CAS(변경 직전 값 일치), 동일 작업 ID 두 시트 백업 및 실제 복원 readback이 필요합니다.
- 전체 10/30 복구 이전에 PriceHistory 또는 Snapshot의 다른 날짜 행·수식, NAV 2건, 원장·좌수·원가를 변경해서는 안 됩니다.
- 단일 GAS 프로세스의 두 시트 수정은 원자 트랜잭션이 아님. 응답이 유실되면 실제 원본 변경 여부를 확인할 때까지 **자동 재시도하지 않아야 합니다**.
- 실제 운영 복구는 최신 승인된 버전·NH/KRX 공식 출처·고정 39행·555 gate·백업 서명/복원·운영 승인 창을 모두 충족하는 별도 릴리스/작업으로만 진행합니다.
