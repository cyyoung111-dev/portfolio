# Issue #507 — GAS v9.282 통합 릴리스 사전 후보

기준 main `6b7e0dbb`, PR #782~#784. **실제 배포/원본 수정 목적의 승인된 소스가 아닙니다.**

## 준비된 것
- `scripts/prepare-issue507-proposed-release.mjs`는 기존 승인된 GAS v9.281 및 #783의 555개 함수 진입·종료 gate, #782의 F00001 단건 G:K 복구를 **메모리에서만 결합**합니다.
- 후보 헤더와 명시적 `gasVersion` 응답을 9.282로 동시 변환하고, 새 `releaseId`를 후보/버전에 결합합니다. 변경 허용 범위가 헤더·응답 버전·gate ID뿐임을 역변환 테스트로 검증합니다.
- 후보 전체 소스 Git blob 해시와 SHA-256은 시험용 manifest에서 계산합니다. **배포 승인 해시 목록에는 자동 추가하지 않습니다.**
- `scripts/check-issue507-proposed-release.mjs`는 생산 소스 승인 유지, 후보의 신규 버전 배포 거부, JavaScript 파싱, 미초기화 gate의 doPost/수동 refresh/Snapshot 실행 차단을 검증합니다.
- 후보를 파일로 저장하거나 외부로 전송하지 않으며, GAS API·NH API·Sheets·Secrets·ScriptProperties를 호출하지 않습니다.

## 남은 운영 선행조건
1. 실제 v9.282 통합 소스 전체를 검토할 별도 릴리스 PR을 작성합니다. `src/gas/apps_script.gs`, `scripts/deploy-gas.mjs`의 정확한 승인 blob, 웹 `EXPECTED_GAS_VERSION`, 관련 API와 `DEPLOYMENT.md`를 함께 업데이트하고 전수 검증해야 합니다. 이 프리뷰는 해당 파일을 수정하지 않습니다.
2. **미초기화 gate는 서비스 진입을 차단합니다.** 새 버전이 운영으로 배포되면 기존 웹/API·트리거가 중단될 수 있어, 사용자 영향/유지보수 창/독립 롤백/전환 중 쓰기 금지 계획이 필요합니다. 안전한 초기화·이전 배포 비활성화 절차가 정해지기 전에는 운영 배포하지 않습니다.
3. 모든 계정·버전·예전 배포의 종료와 외부 Sheets writer 중단을 실제 독립 확인해야 합니다. Process API 403, 7분 경과, 빈 lease만으로 증명하지 않습니다.
4. 운영 gate 안전 격리 및 quiescence 확인, F00001 2026-10-30 전체 39행 실원천 재검산, 별도 사용자 승인, native 백업과 readback을 통과하기 전에는 Snapshot 쓰기를 금지합니다.
5. F00002 NAV 입력대기 경고, 다른 38행, 다른 날짜, NAV·가격이력·원장은 보존합니다. 실패 시 자동 재시도·rollback·운영 재개를 금지하고 별도 검사합니다.

본 작업의 완료 조건은 **오프라인 통합 후보/검사 성공**입니다. 실제 배포 가능, 운영 정상화 또는 금융 복구 성공으로 표시하지 않습니다.
