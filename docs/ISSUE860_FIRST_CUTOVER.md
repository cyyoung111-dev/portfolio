# v9.281 → v9.282 최초 gate 전환

사용자는 자동 수집·거래 저장의 일시 중지, 배포, 검증, 재개를 승인했다.
이 절차는 금융 원본 수리·과거 백필·Telegram 재발송 승인이 아니다.
일반 `deploy-gas.mjs`의 최초 gate 차단은 유지하며, 아래 명시적 수동 경로만 추가한다.

## 배포하는 두 프로필

- 기반 소스: 기존 `src/gas/apps_script.gs`의 정확한 승인 blob `9c1a5f31d1abc4b44f7da9af7a50fe3f15967134`.
  금융 계산·웹 버전·응답 계약은 변경하지 않는다.
- 최종 소스: 기반 소스 끝에 editor 전용 `issue507ResumeWriters`가 기존 private
  `issue507ResumeWriters_`를 호출하는 별칭만 붙인 정확한 blob `edd6e79c885600767b8cfe9ab9c81576ec15fa69`.
  끝이 underscore인 함수는 실제 editor 선택 목록에 나타나지 않아 재개할 수 없었던 경로를
  보완한다. 기존 drain·receipt·승인 capability 검사를 그대로 거치며 새 HTTP 경로는 없다.
  유지보수 프로필에는 재개 별칭이 없고, 기존 정상 배포·읽기 감사는 정확한 최종 blob도
  인식한다. 기반 소스 및 기존 frozen preview/proposal pin은 변경하지 않는다.
- 유지보수 소스: 위 소스의 gate 입구에 무조건 거부를 삽입하고 #923 editor 도구를
  **같은 SERVER_JS 파일 안에** 합친 정확한 blob `5ba7f40aa5ee9236a69a2c4077874bc19f3a9156`.
  기존 555개 진입점은 기존 OPEN 속성이 있어도 실행되지 않는다. 인증된 GET
  `getWriterGateStatus`와 명시적 editor 도구만 사용한다. 일반 getSettings/화면/쓰기 서비스는
  유지보수 동안 이용할 수 없다. HEAD의 기존 트리거도 차단되지만, 구버전 고정 트리거는
  별도 중지 전까지 실행될 수 있으므로 전체 중지로 오인하지 않는다.
- 추가 파일/manifest 변경/미승인 소스/알 수 없는 version은 게시하지 않는다.
  유지보수 프로필을 일반 릴리스 허용목록에 넣지 않는다.
- 이전 유지보수 blob `0b2778afae5b1ffdeceb342c6d6e708ba919cc88` 및
  `a88919ab3fe15c9624b2096fc4dfe52041f7d6d2`는 inspect와 gate 전 abort,
  새 유지보수 프로필로의 bootstrap 전진 갱신에만 허용한다. 이전 프로필에서 직접 finalize는
  거부한다. 일반 배포 허용목록에 유지보수 소스를 추가하지 않는다.

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
| inspect | 정확한 유지보수/최종 소스·목록과 인증된 gate 상태만 조회 | dry_run=true, approve_9282=false |
| none | 기존 일반 배포 | 최초 전환 차단 유지 |

각 phase의 dry_run=true는 조회·계획만 수행한다. 기존 NH 활성화·과거 KRX 진단 등
일반 배포 후 작업은 최초 전환 phase에서 실행하지 않는다. 새 버전 생성 후 그 불변 소스와
전체 파일을 다시 읽고, 최신 main과 직전 상태를 재확인한 뒤 기존 배포 ID를 갱신한다.
inspect는 dry_run=false를 거부하며 콘텐츠/버전/배포 쓰기를 호출하지 않는다.
실패 출력은 고정 단계·고정 원인 코드·생성 버전 번호만 추가로 기록한다.
인증값·응답 본문·공급자 오류 원문·URL은 출력하지 않는다. 공개되지 않은 원인 문자열은
UNVERIFIED로 치환한다. 인증 거부와 버전 미검증을 구분하며 실패를 성공으로 바꾸지 않는다.

## 현재 운영의 기본 경로: 기존 예약 ID·일정 보존

2026-11-05 실조회에서 기존 예약의 배포가 게시 개정337→338을 따라가는 것을 확인했다.
UI가 캐시한 11개와 달리 실제 Trigger API/새로고침 UI에는 **12개**가 있으며,
추가 1개는 `runDeferredFundAfterPortfolioCloseFailure`, 10분 주기, 같은 운영 배포에 연결돼 있다.
이는 사업일·소유 실행·UID를 가진 펀드 재시도 예약이다. 임의 삭제/재생성/UID 치환/큐 초기화는
하지 않는다. 아래 방식은 모든 예약이 검증된 HEAD 또는 현재 운영 배포를 따를 때만 사용한다.
알 수 없는 handler/다른 배포/타 계정/실행 중 작업이 있으면 통과시키지 않는다.

1. 원본 시트의 **확장 프로그램 → Apps Script**로 editor를 연다. Apps Script 홈에서 직접 연
   editor에서는 실제로 `getUi() from this context` 오류가 발생했다. 연결 경로에서 입력창의 실제
   표시를 확인했다. source를 임의 편집하거나 macro/manifest/권한을 추가하지 않는다.
2. 새 bootstrap을 dry-run/실행하고 exact HEAD/게시 pin·manifest·배포 목록을 확인한다.
   원래 예약의 편집 대화상자에서 HEAD/운영 배포 연결과 일정·알림을 새로고침 UI로 확인한다.
   모든 source가 hard-deny 유지보수 프로필이므로 일반 함수·HTTP·예약 쓰기는 차단된다.
3. `issue860BootstrapPreservePrompt`에 schema=1, releaseId=현재 release, operationId,
   uiEvidence, productionVersion=UI 관측 개정, productionBindingSha256=실제 운영 배포 ID의
   SHA256, triggers를 입력한다. 각 항목은 handler, binding=HEAD/PRODUCTION, event,
   source, sourceId, schedule을 기록한다. 실제 id는 Trigger API에서 채운다.
   상시11개의 일정 스키마는 기존과 같고 추가 deferred만
   `{kind:"MINUTELY",minutes:10,timezone:"Asia/Seoul"}`을 허용한다.
4. 입력 후 잠금 안에서 ID·함수·이벤트·원본을 다시 대조하고
   `issue860_preserved_triggers_v1` 기록만 저장·재조회한다. 기존 trigger와 펀드 예약 속성은
   수정하지 않는다. 기존 삭제/복원 journal과 병용할 수 없으며 어느 모드든 섞이면 실패 폐쇄한다.
5. 모든 actor/버전의 실행·일시중지·지연·알 수 없음 상태를 필터 조회한다. 원본/스크립트 ACL,
   외부 writer/편집기/배포 경로를 독립 확인한다. 최근50개/단순 7분 경과로 대체하지 않는다.
   실제 확인 후 기존 `issue860BootstrapRolloutPrompt`로 5분 이내 독립 증빙을 기록한다.
6. `issue860BootstrapInitialize`는 실제 목록이 기록과 같고 독립 증빙이 유효할 때만 DRAINING을
   초기화한다. 예약은 그대로 유지하고 restore를 실행하지 않는다. 기존 gate/receipt를 지우지 않는다.
7. 7분 연속 관찰, 30분 freshness, active0, 승인 capability 부재를 확인한다.
   최신 독립 증빙과 `issue860BootstrapRenewBarrier`로만 barrier를 명시 갱신한다.
   gate 상태는 preservedTriggers.count/productionVersion/productionBindingSha256/
   inventoryUnchanged를 제공하며 ID·원본·사업일·금융값은 로그로 출력하지 않는다.
8. finalize dry-run/실행은 정확한 bootstrap/최종 소스·배포 inventory, readiness 및 보존 기록의
   **운영 배포 ID 해시**를 현재 API 대상과 대조하고 게시 직전 다시 확인한다. 개정 번호와
   배포 ID는 다르다. 개정이 바뀌어도 같은 배포의 예약 연결은 유지되므로 기록을 재작성하지 않는다.
9. 최종 DRAINING 아래 금융 기준13개 범위와 기존 예약12개 ID/설정 보존을 대조하고,
   승인된 `issue507ResumeWriters`로 OPEN 후 버전·인증·운영 상태를 독립 재조회한다.
   새 수동 금융 재계산/Telegram 재발송을 실행하지 않는다.

gate 전 취소는 보존 기록과 현재 목록이 정확히 같고 gate가 없을 때만 기존 abort로 허용한다.
한 번 DRAINING이 영속화되면 기존 forward recovery 원칙을 따른다.

## 기존 대체 경로: 명시적 삭제·복원

아래 절차는 정확히 상시11개만 있고 추가 예약이 없다는 별도 조건에서만 적용한다.
현재 운영의 deferred 예약이 있는 상황에서는 사용하지 않는다.

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

   **설정이 50개를 넘어 UI가 읽기 전용일 때:** 같은 계정으로 프로젝트에 연결된 원본
   스프레드시트를 열고 editor의 `issue860BootstrapPreparePrompt`를 실행한다. 원본 시트에
   표시되는 입력창에 위 manifest JSON만 입력한다. id는 실제 Trigger API로 채운다.
   별도 설정 속성을 쓰지 않고 기존 atomic prepare가 잠금 아래 실제 목록을 다시 확인한 뒤
   복원 저널만 저장한다. 취소/잘못된 JSON/불일치/중복 실행은 트리거를 변경하지 않는다.
   시트 셀·인증값은 읽거나 쓰지 않는다.
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

   UI가 읽기 전용이면 editor의 `issue860BootstrapRolloutPrompt`에서 같은 JSON을 입력한다.
   모든 actor/버전 종료와 외부 writer·편집기 격리를 **실제로 확인한 후에만** 사용한다.
   도구는 true/근거/확인 시각을 만들어주지 않으며 기존 gate 스키마·5분 이내 확인 시각,
   PAUSED/0개 또는 RESTORED/정확한 새11개, 기존 gate가 있으면 DRAINING/active0을
   다시 확인한다. 검증 후 해당 rollout 속성 하나만 저장·재조회한다. 갱신 뒤에는 기존
   Initialize/RenewBarrier와 7분 관찰 절차를 따른다.

   입력창은 잠금 획득 **전**에 열고 응답 후 상태를 다시 검사한다. Apps Script 입력창은
   실행을 중단하며 기존 LockService 잠금은 유지되지 않기 때문이다.
   [Google Ui 공식 문서](https://developers.google.com/apps-script/reference/base/ui).
   입력 JSON·원본 ID·비밀값을 실행 로그/PR/이슈에 붙여넣지 않는다.
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

1. finalize 실제 실행. 위 최종 v9.282 전체 소스의 불변 버전만 게시한다.
   HEAD/게시 소스 및 기존 배포 ID 재조회, 잘못된 인증 거부, 인증된 gate DRAINING 유지 확인.
   **이 실행은 writer를 재개하지 않는다.**
2. gate OPEN 전에 모든 actor 격리·저널 RESTORED·새 HEAD 트리거 11개 및 후보 소스 일치를
   다시 확인한다. 원장·가격·Snapshot·NAV의 중지 후 기준과 재조회가 일치하는지 대조한다.
   metadata 복원 완료를 금융 데이터 정상화라고 주장하지 않는다.
3. 별도 승인된 재개 범위 안에서 editor의 `issue507ResumeWriters` 실행.
   기존 `issue507ResumeWriters_`의 drain·완료 영수증·수리 승인 부재를 재검증한다.
   실패하면 속성을 지워 우회하지 않는다.
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
