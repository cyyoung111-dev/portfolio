# v9.281 → v9.282 최초 gate 전환

사용자는 자동 수집·거래 저장의 일시 중지, 배포, 검증, 재개를 승인했다.
이 절차는 금융 원본 수리·과거 백필·Telegram 재발송 승인이 아니다.
일반 `deploy-gas.mjs`의 최초 gate 차단은 유지하며, 아래 명시적 수동 경로만 추가한다.

## 배포하는 두 프로필

- 최종 소스: 기존 `src/gas/apps_script.gs`의 정확한 승인 blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`.
  금융 계산·웹 버전·응답 계약은 변경하지 않는다.
- 유지보수 소스: 위 소스의 gate 입구에 무조건 거부를 삽입하고 #923 editor 도구를
  **같은 SERVER_JS 파일 안에** 합친 정확한 blob `0b2778afae5b1ffdeceb342c6d6e708ba919cc88`.
  기존 555개 진입점은 기존 OPEN 속성이 있어도 실행되지 않는다. 인증된 GET
  `getWriterGateStatus`와 명시적 editor 도구만 사용한다. 일반 getSettings/화면/쓰기 서비스는
  유지보수 동안 이용할 수 없다. HEAD의 기존 트리거도 차단되지만, 구버전 고정 트리거는
  별도 중지 전까지 실행될 수 있으므로 전체 중지로 오인하지 않는다.
- 추가 파일/manifest 변경/미승인 소스/알 수 없는 version은 게시하지 않는다.
  유지보수 프로필을 일반 릴리스 허용목록에 넣지 않는다.

## 공통 사전 조건

1. 최신 main의 CI·동일 HEAD 독립 리뷰 완료, 이 변경의 main 병합 확인.
2. 원래 배포 336/v9.281, 전체 소스와 manifest·배포 ID·테스트 배포 ID 대조.
   테스트 배포는 소유자 UI에서 확인한 고유 ID의 SHA256으로 정확히 고정한다.
   missing version/설명/문자 HEAD만으로 분류하지 않는다. REST LIST·DETAIL은
   운영 배포 1개와 정확한 테스트 배포 1개만 허용하고 다른 항목/페이지/충돌은 차단한다.
   테스트 URL /dev 여부만으로 공개 접근·사용처 격리를 인증하지 않는다.
3. 다른 배포자·편집기·외부 배포 작업이 소스를 바꾸지 않도록 통제한다.
   공유 GAS 배포 잠금은 해당 Actions 배포만 직렬화하며 모든 actor 격리의 증거가 아니다.
4. 실제 트리거 UI 설정 11개(함수·이벤트·원본·기존 배포·주기·KST 시각·실패 알림)를
   기록한다. 코드 기본값이나 과거 실행 시각으로 실제 설정을 추정하지 않는다.
5. 시작 전 원장·가격·Snapshot·NAV의 대상 범위 읽기 전용 기준을 확보하고,
   자동 작업 중지/재개로 누락될 수 있는 예약을 기록한다. 금융 수리를 자동 실행하지 않는다.

## Actions 입력

`gas-deploy` → Run workflow → main. 기존 dry_run/approve_9282 외에
`first_gate_phase`를 추가했다. 기본 none이며 기존 배포 경로의 재감사 차단을 유지한다.
각 단계는 새 main 실행을 사용한다. 승인 없는 실제 단계는 거부한다.

| phase | 의미 | 실제 실행 입력 |
|---|---|---|
| bootstrap | 일반 진입점 전부 거부하는 유지보수 소스 게시 | dry_run=false, approve_9282=true |
| finalize | 검증된 DRAINING 아래 기존 승인 v9.282 소스 게시 | dry_run=false, approve_9282=true |
| abort | gate 초기화·트리거 삭제 **이전만** v336/v9.281 복원 | dry_run=false, approve_9282=true |
| none | 기존 일반 배포 | 최초 전환 차단 유지 |

각 phase의 dry_run=true는 조회·계획만 수행한다. 기존 NH 활성화·과거 KRX 진단 등
일반 배포 후 작업은 최초 전환 phase에서 실행하지 않는다. 새 버전 생성 후 그 불변 소스와
전체 파일을 다시 읽고, 최신 main과 직전 상태를 재확인한 뒤 기존 배포 ID를 갱신한다.

## 유지보수·초기화·복원

1. bootstrap dry-run 후 실제 bootstrap을 실행한다. Summary/로그의 성공만 보지 말고
   HEAD·게시 소스 일치, 잘못된 인증 거부, 인증된 gate 상태 UNINITIALIZED를 확인한다.
   이때부터 일반 웹 화면/호출이 차단된다. 아직 v336 고정 트리거는 전체 중지 증거가 아니다.
2. Script Properties에 `issue860_ui_trigger_manifest_v1` JSON을 설정한다. 스키마는
   [트리거 도구 안내](ISSUE860_TRIGGER_MAINTENANCE.md)와 동일하되 id는 editor 함수가
   실제 Trigger API에서 채운다. UI에서 확인한 schedule과 originalDeployment를 제공한다.
   실제 원본 spreadsheet ID는 같은 계정의 Script Properties 안에서만 다루고 로그/커밋에 넣지 않는다.
3. editor에서 `issue860BootstrapPrepare` 실행. 원래 목록·복원 저널 저장/재조회 완료 확인.
   **중지 취소 가능 시점:** 저널 PREPARED, 원래 ID 11개 모두 그대로, gate 미초기화일 때
   abort dry-run/실행으로 v336·HEAD v9.281을 복원할 수 있다. 버전 336의 실제 소스와 manifest를
   재확인한다. 복원 저널은 감사 기록으로 보존하고 gate/수리/금융 속성을 지우지 않는다.
4. editor에서 `issue860BootstrapPause` 실행. 저널 PAUSED 및 소유 계정 목록 0개 확인.
   타 계정 트리거·단순 트리거·편집기·타 프로젝트/직접 Sheets writer는 별도 통제가 필요하다.
5. Google 실행 UI에서 **모든 actor와 모든 버전**의 기존 작업이 종료됐음을 확인한다.
   원본/보존/성능수집 프로젝트 및 외부 writer/편집기/배포 경로를 확인하고 독립 근거를 남긴다.
   화면의 최근 50개만 보거나 7분 경과만으로 증명하지 않는다. 미확인 actor가 있으면 중지 유지.
6. 실제 독립 확인 후에만 `issue507_writer_gate_rollout_v1`을 기록한다. 기존 gate의 스키마를 쓴다:
   releaseId는 현재 승인 release, oldDeploymentsDisabled/externalWritersBlocked/editorsBlocked=true,
   legacyDrainEvidence는 kind=EXECUTIONS_UI, scope=ALL_PROJECT_ACTORS_AND_VERSIONS,
   terminalOnly=true와 실제 근거 reference, verifiedAt은 실제 확인 시점의 UTC epoch milliseconds.
   도구가 이 사실을 자동으로 인증하지 않는다. 미확인 사실에 true를 입력하지 않는다.
7. editor에서 `issue860BootstrapInitialize` 실행. PAUSED·소유 트리거 0개·5분 이내 rollout 증빙일
   때만 DRAINING을 영속화한다. 기존 상태/영수증을 지우거나 OPEN으로 초기화하지 않는다.
8. `issue860BootstrapRestore` 실행. 실제 후보의 gate 검증 함수를 사용해 동일 release/DRAINING/
   active=0을 확인하고, 기록된 일정·원본으로 새 HEAD 트리거를 복원한다. UI에서 새 대상·시각·
   실패 알림도 대조한다. 재설치된 타이머의 임의 실행 분은 원래와 달라질 수 있다.
9. barrier에서 연속 7분 이상 관찰한다. 이는 독립 종료 증거의 추가 조건일 뿐 대체하지 않는다.
   rollout/barrier가 30분을 넘으면 finalize를 차단한다. 최신 독립 증빙으로 rollout을 갱신하고
   `issue860BootstrapRenewBarrier`를 명시적으로 실행해 다시 7분 관찰한다. active/미확인 목록은
   지우지 않는다. 단순 재실행으로 barrier를 초기화하지 않는다.
10. finalize dry-run으로 exact bootstrap HEAD/게시, 정확한 배포 목록,
    firstCutoverReady=true, gate DRAINING/active=0/수리 승인 없음을 확인한다.

## 최종 게시·재개·실제 검증

1. finalize 실제 실행. 원래 승인된 v9.282 전체 소스의 불변 버전만 게시한다.
   HEAD/게시 소스 및 기존 배포 ID 재조회, 잘못된 인증 거부, 인증된 gate DRAINING 유지 확인.
   **이 실행은 writer를 재개하지 않는다.**
2. gate OPEN 전에 모든 actor 격리·저널 RESTORED·새 HEAD 트리거 11개 및 후보 소스 일치를
   다시 확인한다. 원장·가격·Snapshot·NAV의 중지 후 기준과 재조회가 일치하는지 대조한다.
   metadata 복원 완료를 금융 데이터 정상화라고 주장하지 않는다.
3. 별도 승인된 재개 범위 안에서 editor의 기존 `issue507ResumeWriters_` 실행.
   이 함수도 기존 drain·완료 영수증·수리 승인 부재를 재검증한다. 실패하면 속성을 지워 우회하지 않는다.
4. 잘못된 인증 거부/올바른 인증, getSettings와 자동화 상태의 v9.282, gate OPEN,
   트리거 누락·중복 없음과 실제 새 버전 실행을 각각 확인한다. 설정·원장·Snapshot·가격·NAV의
   날짜/코드/수량/값은 읽기 전용으로 대조한다. 가격조회 self-heal/수리/재계산/Telegram 재발송 금지.
5. 유지보수 중 누락된 정상 예약은 별도 원인·대상 범위·승인 하에 처리한다.
   #734의 F00002 불일치와 #826 마감 미수신은 버전 업으로 해결됐다고 표시하지 않는다.

## 실패·전진 복구

- 소스·manifest·목록·main 충돌은 변경 전 차단한다. 예상치 못한 source/version은 덮어쓰지 않는다.
- HEAD만 유지보수 소스로 바뀌고 게시가 v9.281이면 같은 bootstrap을 재시도해 앞으로 완료한다.
- 최종 게시 중 HEAD만 최종 소스로 바뀌어 editor 도구가 사라졌다면, bootstrap phase는 승인된
  HEAD/게시 조합에서 유지보수 프로필을 재설치할 수 있다. 게시가 최종 프로필이면 DRAINING/
  active=0/수리 승인 없음을 요구한다. OPEN 서비스에 재설치하지 않는다.
- 중지/초기화 이후에는 abort 불가. gate 없는 v9.281로 되돌아가 stateful 영수증을 우회하지 않는다.
- 생성·게시 응답 유실/읽기 검증 실패는 성공으로 표시하지 않고 오류를 남긴다.
  생성 중 트리거의 불명확한 pending intent를 삭제하거나 자동 재생성하지 않는다.
  모든 작업 종료/정확한 후보 수의 독립 대조 없이는 운영자가 해결 완료로 표시하지 않는다.
- 새 Apps Script 버전의 보관/영구삭제, 금융 원본 복원, gate/저널 초기화는 이 도구에 없다.

## 검증 범위

새 검사는 실제 555개 함수의 유지보수 거부, 인증, 실제 editor 상태 전이·stale 증빙·barrier 갱신,
승인·dry-run·단계·소스 pin, readback 전 게시 금지, 상태 충돌, 응답 유실 및 전진 복구,
gate 전 abort 허용/초기화 후 거부, 워크플로의 일반/최초 경로 분리를 검증한다.
운영 증빙과 실제 배포/재개 성공은 해당 run 및 독립 재조회로 별도 기록한다.
