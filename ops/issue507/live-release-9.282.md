# GAS v9.282 릴리스 PR — 운영 미배포

실제 `src/gas/apps_script.gs`에 555개 기존 함수의 이름·인수·본문을 보존하는 inline 진입 guard와 gate·F00001 복구를 통합했다.
생성기는 고정 v9.281 원문에서 결정적으로 재생성하고 승인 blob·API/웹 버전·manifest를 검증한다.
이전 preview 생성기는 `reference/gas-v9.281.gs`를 사용한다. preview/생산 승인을 혼동하지 않는다.

## Bootstrap과 정상 서비스

- 첫 진입이 ScriptLock 안에서 OPEN metadata를 생성한다. 일반 요청은 원래 본문으로 진행하고 종료 receipt를 남긴다.
- OPEN은 legacy 실행 종료 증빙/금융 복구 승인이 아니다. 복구는 기존 독립 증빙·7분 barrier·active 0·fresh quiescence·정확한 39행 검산·일회 승인·native 백업/readback을 모두 요구한다.
- 종료 증빙은 실행별 소유 key에 금융 ScriptLock 없이 먼저 저장한다. cleanup 경합/실패 후에도 다음 진입이 증빙을 검증·정리하므로 24건 capacity 누적 차단을 방지한다. 증빙 없는 강제종료는 임의 해제하지 않는다.
- 이미 존재하는 DRAINING/알 수 없는 releaseId/손상된 상태를 초기화로 덮지 않는다. quota·잠금·metadata readback 실패는 명시적으로 차단한다. 배포 승인 전 기존 gate 속성 부재/일치 및 Properties 여유를 운영자가 확인해야 한다.
- 인증된 `getWriterGateStatus`는 DRAINING에서도 metadata 상태만 반환한다. 토큰·원본·승인 binding은 반환하지 않으며 금융 시트를 읽거나 쓰지 않는다.
- gate를 켜기 위해 NH 토큰을 발급하거나 Telegram을 전송하거나 트리거를 재설치하지 않는다. 원래 생산 로직은 버전 필드와 진입 guard 외에 변경하지 않는다.

## 버전 전환

기존 감사의 23개 위치를 release-9.282.json에서 하나씩 분류했다. 생성기의 FROM_VERSION 9.281은 불변 baseline이므로 보존한다.
현재 GAS/API/웹 기대 버전은 9.282다. 운영 클라이언트와 허용목록에는 9.282를 반영하고 기존 9.281 호환을 보존해 main 병합~GAS/Pages 전환 사이 실패를 막는다.
그 밖의 허용 버전은 기존 계약 그대로다. 신규 미검증 버전을 포괄 허용하지 않는다. 순차 배포 창이 닫힌 뒤 이전 버전 호환 제거는 별도 PR로 다룬다.

## 배포 별도 승인 차단

- `main` 병합과 Quality Check 성공은 **GAS v9.282 운영 배포 승인으로 취급하지 않습니다.** `workflow_run` 자동배포는 v9.282의 프로젝트/버전 변경 전에 `GAS_9282_EXPLICIT_MANUAL_RELEASE_REQUIRED`로 중단합니다.
- 실제 배포는 별도 승인 후 GitHub Actions `gas-deploy`의 **수동 workflow_dispatch**, `dry_run=false`, `approve_9282=true` 선택이 모두 필요합니다. 기본값은 `dry_run=true`, `approve_9282=false`입니다. 운영 환경 승인과 최신 `main`·전체 소스 해시 검증도 그대로 적용합니다.
- 명시적 승인 없는 실행, 자동 트리거 및 수동 `approve_9282=false` 요청은 OAuth 토큰 획득·GAS 프로젝트 호출·원본 시트 변경 전에 차단합니다. 진단 및 dry-run은 무배포입니다.
- 9.282 배포 중 일부가 이미 게시된 후 실패했다면 gate가 없는 9.281로 **자동 복원하지 않습니다**. 이전 HEAD뿐 아니라 **이전 웹앱 deployment versionNumber의 실제 소스**를 별도 검사합니다. 둘 중 하나라도 gate 누락·상이한 releaseId·소스 조회 미확인이면 `GAS_GATE_REMOVAL_ROLLBACK_BLOCKED`로 **어떠한 롤백 PUT 전에 중단**하고, 독립 운영 증빙과 gate 보존형 forward-recovery를 별도 검토합니다. HEAD만 gate가 있고 게시본이 무계측인 첫 실패 후 재시도도 명시적 차단 사례입니다.

## Rollback

gate를 없애는 v9.281 이하 배포는 deploy-gas의 생산 mutation 이전 검사로 거부한다. dry-run은 진단만 가능하다.
운영 장애 때 gate/active/승인 상태를 지우거나 과거 무계측 코드로 즉시 되돌리는 방식은 지원하지 않는다.
승인된 후속 버전의 forward rollback으로 기존 business 로직을 복원하되 gate를 보존하고 상태 migration을 별도 검증한다.
이미 DRAINING인 상태의 원상복귀는 독립 실행 종료·승인 capability 부재 확인 후 기존 resume 경로만 사용한다.
현재 소스 재배포는 동일 소스 no-op 경계다. 배포 성공과 bootstrap 정상/자동 예약/NH·Telegram 운영 성공은 별도 실증해야 한다.

## 테스트 경계

기존 금융 단위 fixture는 생성된 진입 한 줄만 제거해 잠금·metadata mock을 금융 계산 검사에서 분리한다.
본문/시간대/원천/보존 검증은 그대로이며, 신규 LIVE 검사는 원문 전체를 그대로 실행해 555개 차단·cold OPEN·무권한 복구 차단·인증 상태 조회·rollback 거부·단건 복구를 검증한다.
기존 preview 검사도 유지한다. 합성 fixture는 실제 원본 검산/실행 종료/백업 성공의 증거가 아니다.

**금지 유지:** 승인 전 병합, 운영 GAS/Pages 배포, 운영 Properties 변경, 금융 원본 쓰기, 실제 복구 및 Telegram 발송.
