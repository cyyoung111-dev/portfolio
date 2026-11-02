# GAS v9.281 → v9.282 최초 writer gate 전환: 배포 차단선

## 운영 증거 (2026-11-02 KST)

- [게시 소스 감사 #41442800080](https://github.com/cyyoung111-dev/portfolio/actions/runs/41442800080): 운영 deployment 개정번호 336, 전체 게시 소스와 프로젝트 HEAD 모두 승인된 **v9.281** blob `ebe697563e94cf49e514037353260fce70ae1d57`. 신규 writer gate runtime GET 미실행, 감사 BLOCKED.
- [수동 dry-run #41446204818](https://github.com/cyyoung111-dev/portfolio/actions/runs/41446204818): `dry_run=true`, `approve_9282=false`, `approve_9283=false`, 성공; GAS 프로젝트·버전·deployment 무변경. 후보 v9.282 Git blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134` 승인된 소스임을 확인한 것뿐, legacy writer와 트리거 종료 또는 gate bootstrap 안전성의 증거는 아님.

## 발견한 배포 경계 결함

현재 배포기는 수동 `approve_9282=true`만으로 승인된 무계측 v9.281 웹앱에서 stateful gate가 포함된 v9.282로 소스를 교체할 수 있다. 그러면 미초기화 writer gate에서 기존 작업을 차단할 수 있고, 과거 배포·비계측 실행·외부 Sheets writer가 계속 열려 있을 수도 있다. 수동 승인 체크박스는 이 실행들의 실제 격리 및 복구 계획을 증명하지 않는다.

## 본 PR에서 차단하는 범위

- `deploy-gas.mjs`의 실배포 흐름에서 *현재 게시된 소스에 gate 변수가 없고 새 후보에 gate가 있는 경우* `GAS_FIRST_GATE_CUTOVER_UNVERIFIED`로 **GAS 콘텐츠 PUT/버전 POST/deployment PUT 이전에 중단**.
- 기존 정확한 버전 및 승인 전체 blob 검증, 수동 9.282/9.283 승인 조건, 구 writer gate 제거 rollback 차단은 보존.
- 읽기 전용 `GAS_DEPLOY_DIAGNOSTIC_ONLY`와 `dry_run=true`는 계속 운영 현황 확인 가능. 이미 동일 gate를 보유한 두 승인 소스 사이의 배포에는 새 차단을 적용하지 않음.
- 관련 회귀는 `check-gas-deploy.mjs`의 기존 CI에서 정품 v9.281/v9.282 소스로 판정하고, 검사 위치가 버전 생성·배포 쓰기보다 앞서는지 확인.
- **자동으로 배포를 승인하는 플래그, 자체 발행 증빙, 단순 시간 경과에 따른 우회 경로는 추가하지 않는다.** 승인했더라도 이 PR만으로 최초 gate 배포는 계속 차단된다.

## 차단 해제 전 독립 확인이 필요한 것

1. 유지보수 창과 사용자 영향, 현재 트리거 스케줄 및 지연 작업, 서비스 가용성 보장/복구 순서.
2. Apps Script **전체 웹앱/실행 API 배포**와 프로젝트 편집 권한, 모든 실행자·버전의 완료 증빙. Process API 403·빈 목록·경과 시간은 완료 증빙 아님.
3. GAS 밖 Sheets API 및 수동 입력과 별도 automation writer 통제 증빙.
4. v9.282 최초 gate bootstrap 안전성, 동일 releaseId, 미초기화 진입 차단과 서비스 정상화의 구체적인 단계별 통제, 비계측 v9.281로 되돌리지 않는 **forward-recovery**.
5. 위 근거를 별도 PR에서 리뷰해 이 interlock을 안전한 운영 확인 절차로 대체하고, 사용자에게 **v9.282 배포 승인**을 다시 명시적으로 받은 뒤 실제 배포. 금융 원본 복구/수정은 별도 승인.

이 문서는 운영 증빙 **누락 상태**를 기록하며, 배포·금융 원본 변경·NH OAuth 재발급·Telegram 발송을 실행하거나 승인하지 않는다. Issue #507, #860 참고.
