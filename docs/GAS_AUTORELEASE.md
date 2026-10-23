# #507 — 매일 무인 실행과 새 GAS 자동 배포

이 변경은 소스/검증 후보다. PR 병합·운영 배포·원본 복구를 실제 수행했다는 뜻이 아니다. 기존 #632 감시 PR 및 #630 서명 진단과 목적이 다르며 해당 PR을 덮어쓰지 않는다.

## 매일 실행

기존 설치형 hourly 트리거를 유지한다. `runPendingTradeSnapshotRebuild`의 원천 날짜 탐색만 500행 단위로 읽으며, 120초 예산 경계에서 날짜·행 위치·원천 hash만 Script Properties `trade_snapshot_date_scan_v1`에 저장한다. 최소 후보 날짜 3개(처리 2개 + 잔여 증명 1개)만 보관해 다년 이력에서도 상태 크기는 일정하다. 금융 금액·계좌·원장 행은 저장하지 않는다. 다음 자동 실행이 이어 읽는다. 같은 실행의 KST 날짜 계산도 행마다 반복하지 않는다.

첫 수집 후 같은 청크들을 두 번째로 읽어 SHA-256을 비교한다. 날짜 범위·KST 날짜·source revision·시트 크기 변경은 재시작하고, 같은 크기의 내용 변경도 두 번째 서명 비교로 보류한다. 수집 완료 전에는 금융 writer·pending 날짜 이동·deferred 해제를 하지 않는다. 원천 부족·충돌에 관한 기존 날짜별 진단/백업/MANUAL 보호는 유지한다. 날짜 3개 순서는 기존 전체 수집기의 처음 3개와 비교 검증하며, 다음 cursor부터 다시 탐색한다.

worker의 240초 예산은 다음 날짜 **진입 전** 확인한다. 단일 Sheets 호출·이미 실행 중인 기존 날짜별 writer는 강제 선점할 수 없으므로, 모든 원인의 6분 시간 초과를 해결했다고 주장하지 않는다. 과거 실측 DATE_SOURCE_COLLECTION 병목을 줄이는 패치이며 배포 후 실제 phase·처리 날짜·실행시간을 확인해야 한다. 계속 원천이 바뀌는 상황은 보류/경보 대상이다. GAS ScriptLock에 참여하지 않는 외부 Sheets writer와 완전한 CAS/다중시트 원자성을 제공하지는 않는다.

## 최초 한 번 할 설정

1. PR의 전체 CI·최신 리뷰 확인 후 사용자가 병합을 승인한다. 운영 전체 소스는 v9.244에서 v9.255 후보로 바뀌므로, 중간 릴리스의 보호 변경도 함께 검토한다. #507 과거 원본의 자동 복원·삭제 권한을 주는 작업이 아니다.
2. GitHub `portfolio-production-gas` Environment는 **main만** 허용하고 기존 환경 secrets `CLASPRC_JSON`, `GAS_ACCESS_TOKEN` 및 GAS 관련 vars를 유지한다. repo/org에 중복 운영 secrets를 두지 않는다. 정례/자동 실행에 매번 Required reviewer 승인이 걸려 있으면 무인 운영이 되지 않으므로 실제 정책을 확인한다.
3. OAuth 동의 화면 Production, Desktop OAuth offline 동의·scope, 토큰 자동 교환을 한 번 확인한다. 사용자 도메인/유료 서버/서비스 계정 키는 추가하지 않는다. OAuth 동의 철회·정책 변경은 자동 재동의할 수 없는 예외다.
4. **저장소 Actions Variable** `GAS_AUTO_DEPLOY_ENABLED`를 문자열 `true`로 한 번 설정하면 자동 배포가 켜진다. 미설정/다른 값이면 꺼져 있다. 이 도구 연결은 변수·Environment 관리자 설정을 바꿀 수 없으므로 설정 완료를 주장하지 않는다. 변수는 secret 값이 아니다. 활성화는 다음 main push의 전체 CI 성공부터 적용되며, 이미 끝난 run을 자동 소급 배포하지 않는다.
5. GitHub Actions 실패 알림과 GAS 트리거 실패 메일을 확인한다. #632의 매일 감시가 병합되면 시간 초과·실행 공백을 독립 감시한다. 알림 수신 설정을 새로 만들거나 메일을 발송하지 않는다.

## 이후의 자동 릴리스

승인된 main push → quality-check 전체 성공 → gas-deploy의 workflow_run → 출처/branch/event/최신 main SHA 확인 → 동일 커밋의 전체 검사 → OAuth 자동 refresh → 대상·전체 소스 pin·manifest 검사 → HEAD/불변 버전·기존 deployment 갱신 → getSettings와 getAutomationStatus 버전 교차확인 순서다. 사람이 매번 토큰을 갱신하거나 별도 dry-run/배포 버튼을 누를 필요가 없다. 명시적 main workflow_dispatch dry-run은 최초 점검/장애 진단용으로 남긴다.

PR 실행·fork·실패 CI·다른 workflow·과거 커밋은 자동 배포할 수 없다. 자격증명은 main 보호 환경 job에서만 사용한다. 배포 직전과 공개 직전에 최신 main을 재확인하고 production concurrency는 취소 없이 직렬 처리한다. HEAD와 웹앱이 모두 같은 소스일 때만 이미 배포됨으로 간주한다. 새 버전 POST나 금융 쓰기는 맹목 재시도하지 않는다. source pin에 없는 코드/버전은 실패한다.

사용자 OAuth 자동 refresh를 이용하며 GitHub OIDC→WIF→서비스 계정으로 Apps Script 배포 인증을 대체하지 않는다. [Apps Script API는 서비스 계정 미지원](https://developers.google.com/apps-script/api/concepts)이다. [workflow_run은 secrets에 접근할 수 있어](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) upstream PR/fork를 명시적으로 거부한다.

## 배포 실패와 복구

배포 중 원래 HEAD 파일과 기존 deployment 설정을 메모리에 보관한다. 실패하면 현재 HEAD가 본 작업의 후보/원본 중 하나이고 deployment도 본 작업의 이전/새 버전 중 하나일 때만 되돌린다. 다른 편집·배포가 발견되면 자동 덮어쓰기를 중단한다. 공개 PUT 응답이 유실될 수 있어, 새 버전을 만든 뒤 실패하면 이전 deployment 설정을 재지정하고 HEAD와 deployment를 다시 읽어 확인한다. 금융 데이터/원장/가격/NAV/FX/백업은 자동 롤백하지 않는다.

runner/GAS 강제 중단, 네트워크 장기 단절, 동시 외부 편집은 메모리 기반 복구로 보장할 수 없으므로 실패를 숨기지 않는다. 실패/롤백 불확정 때 다음 변경을 배포하기 전에 이전 코드·버전 상태를 확인한다. 미사용 버전은 생성될 수 있으며 Apps Script 200버전 한도에 도달하면 안전하게 실패한다. 증거 없는 자동 버전/백업 삭제는 추가하지 않는다.

## 운영 확인 기준

- CI 합성 검사와 실제 배포/트리거/금융 복구 상태를 각각 보고한다.
- 실제 배포 후 v9.255 HEAD·웹앱/automation 응답, 기존 트리거 수·시간대, 다음 hourly 수집 진행과 완료/보류 상태를 확인한다.
- pending/deferred 전후 날짜, 원본 범위 밖 보존·MANUAL·정확한 원천 검증을 확인하기 전 #507 복구 완료로 표시하지 않는다.
- 별도 도메인·유료 서버·새 스케줄러는 없다. 공개 저장소의 표준 GitHub Linux runner 및 기존 GAS를 사용한다. 무료 GAS 실행/일일 할당량, GitHub 예약 지연·60일 비활성, OAuth 철회는 여전히 운영 제약이다.
