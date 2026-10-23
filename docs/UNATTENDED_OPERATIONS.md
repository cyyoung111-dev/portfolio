# 무료·도메인 없는 무인 운영: 실행과 배포의 인증 경계

2026-10-23 KST 점검. 이 문서는 활성화 완료 증명이 아니다. 새 GAS 배포·원본 복구는 이번 변경에 포함하지 않는다.

## 확인된 현재 상태

- 점검 기준 main `a9373ae7123d7fb1899f8b90a914c7d103fa4cc5`. 열린 PR #630은 23일 기대행 서명 **진단**이며 이 문서/프로세스 모니터와 파일 충돌이 없다. 병합하지 않았다.
- #629 보호 환경 이관과 #631 비밀값 오류 분류는 이미 병합됐다. 다시 토큰을 만들거나 이전 작업을 반복할 이유는 없다.
- [OAuth 감사 #39900963389](https://github.com/cyyoung111-dev/portfolio/actions/runs/39900963389), attempt 2의 live-readonly job `120257876358` 성공. JSON 파싱·refresh token 교환·Process API 호출까지 검증됐다. 최신 50건 표본은 COMPLETED 4 / FAILED 4 / TIMED_OUT 42, 최신 TIME_DRIVEN 완료 2026-10-23 14:02 KST. 전체 이력 통계나 Snapshot 내용 정상의 증거가 아니다.
- 최신 인계의 실운영 웹앱 v9.244와 저장소 GAS v9.254는 다르다. 이 점검에서는 새 인증 호출이나 배포로 재측정하지 않았다. main/CI/Pages 성공으로 운영 GAS가 바뀌었다고 판단하지 않는다.
- #507 최신 인계에는 deferred 29일, 원천 부족 6일, 누락 5일·충돌 18일, COMPLETED 백업 0이 남아 있다. 과거 원본을 무인 복원·삭제할 근거가 없다.
- [기존 main 운영 상태 #39896537840](https://github.com/cyyoung111-dev/portfolio/actions/runs/39896537840), status-only job `120228224973`의 12:44 KST 기록도 직접 확인했다. v9.244, 마감/감시/백필 트리거 각 1개, hourly CLOCK 1개, pending 10/10·10/22, deferred 29일, 공식 KRX 10/22 대비 Snapshot 10/21, overall ERROR였다. worker는 12:02 시작·12:06 `DATE_SOURCE_COLLECTION`에서 마지막 기록을 남겨 STALE_RUNNING_TIMEOUT_SUSPECTED였고 00:30은 KRX_PRICE_SOURCE_OR_COVERAGE 실패였다. 이후 14:02 Process COMPLETED와 다른 관측 시점이다. 이 기록으로 현재도 같은 단계에 멈춰 있다거나 특정 함수가 42건 TIMEOUT의 전부 원인이라고 단정하지 않는다.
- `gas-deploy.yml`의 deploy job은 의도적으로 workflow_dispatch만 허용한다. `deploy-gas.mjs`는 사용자 OAuth refresh token을 **자동 교환**하고 소스 blob·프로젝트 전체 파일·새 버전·웹앱 응답을 검증한다. 매번 access token을 사람이 갱신할 구조는 아니다.

## 선택한 경로

| 대상 | 실행 위치·인증 | 사람 없이 가능한 범위 | 남는 경계 |
|---|---|---|---|
| 매일 수집·마감·재처리 | 기존 GAS 설치형 시간 트리거, 생성자 Google 권한 | 한 번 설치·동의 후 자동 실행, 기존 잠금/큐/재시도 사용 | 권한 철회·할당량·원천 불충분·시간 초과는 별도 장애 |
| 외부 운영 감시 | GitHub 표준 Linux runner, main 보호 환경 | 기존 02:30 KST KRX 감시 + 03:17 KST Process API 감시 | GitHub 예약 자체 지연/누락/중단 가능 |
| Sheets 직접 읽기 | GitHub OIDC → WIF → 전용 서비스 계정 → Sheets API | 사용자 refresh token·서비스 계정 JSON 키 없이 매 실행 단기 토큰 | GCP 프로젝트/IAM/API·대상 시트 공유 최초 설정 필요, 현재 미구현/미활성 |
| 새 GAS 소스 배포 | Apps Script API + 사용자 OAuth | 최초 동의 후 토큰 자동 교환을 이용한 CI 배포는 가능 | 서비스 계정 지원 안 됨. 현재 안전 정책상 수동 dispatch, 자동 배포 미활성 |

현재 금융 writer는 GAS 한 곳에 유지한다. WIF로 Sheets 쓰기를 추가하면 GAS ScriptLock에 참여하지 않아 같은 셀 경합·중복·다중 시트 불일치 위험이 생긴다. 인증 교체가 Snapshot 복구의 정확성을 해결하지 않는다. 따라서 WIF의 첫 도입 범위는 **별도 읽기 전용 감시**로 한정하는 것이 안전하다. 기존 계산·날짜/코드·NAV/MANUAL 보존 규칙을 다른 writer로 재구현하지 않는다.

## 이번에 구현한 자동 감시

기존 `issue-507-worker-execution-audit.yml`을 재사용한다. 별도 서버·도메인·새 credential 없이 병합 뒤 main에서 매일 03:17 KST 실행한다. PR은 합성 계약만 수행하며 실인증 job은 main의 schedule/push/workflow_dispatch만 허용하고 `portfolio-production-gas`를 요구한다.

`--health-check`는 다음을 비정상 종료와 Step Summary로 드러낸다.

- 시간 트리거 실행이 보이지 않음(타 계정 소유권 때문에 안 보일 수도 있어 '실행 안 됨'으로 단정하지 않음).
- 최근 시간 트리거가 3시간 넘게 오래됐거나 미래 시각임.
- 조회된 표본 중 최근 24시간에 FAILED / TIMED_OUT / CANCELED가 존재함.
- 10분 넘게 RUNNING / PAUSED / DELAYED이거나 상태가 확인되지 않음.
- OAuth/권한/API/응답 실패. API가 401/403을 반환해도 health는 통과하지 않는다.

최근 50건 한 페이지만 보므로 빠진 과거 실패·전체 일별 성공률은 증명하지 못한다. 프로세스 COMPLETED도 GAS가 잡은 업무 오류·BUSY·원천 보류를 뜻할 수 있다. **PROCESS_HEALTHY는 Snapshot 정상 판정이 아니다.** 기존 nightly의 큐·원장·Snapshot 점검과 함께 해석한다.

네트워크/429/5xx만 최대 3회, 1초·2초 간격으로 재시도한다. 각 요청 30초 제한, job 4분 제한. 영구 4xx·JSON/스키마 오류는 반복하지 않는다. 인증 교환·Process API 읽기 외의 쓰기/배포/복구를 재시도하지 않는다. 응답 본문·토큰·계좌·프로젝트명은 로그에 내보내지 않는다. 별도 artifact도 올리지 않는다.

GitHub Actions의 실패 알림 수신은 계정 Notifications 설정에서 **한 번** 활성화해야 한다. 기존 GAS 트리거 실패 메일도 보조 신호다. 이 변경은 이메일/Issue를 자동 전송하지 않는다. 동일 장애가 매일 지속되면 실패가 매일 남으며 상태 변화만 알리는 별도 중복 억제 저장소는 추가하지 않았다. GitHub 예약 자체가 실행되지 않을 때는 이 모니터도 알릴 수 없다.

## OAuth: 매번 수동 갱신은 제거 가능, 영구 무인 보장은 불가

자체 Desktop OAuth client는 유료 서버나 사용자 도메인 없이 쓸 수 있다. External/Testing 상태에서 Sheets/Apps Script 범위 refresh token은 통상 7일 만료하므로 **Publishing status를 In production으로 전환하고 그 상태에서 발급한 offline 동의 토큰인지 관리자가 최초 확인**해야 한다. 프로젝트 실설정은 이 점검 도구로 확인할 수 없다. Production 전환은 Google 검증 면제나 무기한 보증을 뜻하지 않는다. 개인 사용 예외/검증 필요 여부도 실제 동의화면·요청 scope 기준으로 확인한다.

현재 deploy/audit는 refresh token으로 access token을 자동 발급한다. 일상 GAS 트리거는 이 GitHub 토큰에 의존하지 않는다. OAuth 철회·클라이언트 삭제·계정/정책 변경·토큰 수 제한 등에 따른 invalid_grant는 자동 재동의할 수 없으므로 사람의 재승인이 남는다. 무한 재발급이나 repository secret 복원으로 처리하지 않는다.

`GAS_ACCESS_TOKEN`은 웹앱의 자체 공유 비밀이고 Google OAuth access token과 다른 인증이다. Script Properties와 Environment secret의 값을 일치시켜야 한다. 값을 채팅/Issue/로그에 붙이지 않는다. GAS API에 새 인증 범위가 추가되면 트리거 생성자의 추가 동의가 필요할 수 있다.

## WIF → Sheets를 도입할 때의 구체적 설정

현재 GCP 관리자 연결·프로젝트 ID·WIF provider가 확인되지 않았으므로 임의 생성하거나 운영 시트를 공유하지 않았다. 도입 시 다음 최초 설정이 필요하다.

1. 기존 Google Cloud 프로젝트에서 IAM/STS/IAM Credentials/Sheets API를 준비한다. 유료 Compute, Cloud Run, Scheduler, 서비스 계정 키, 별도 도메인을 만들 필요는 없다. 조직 정책/관리자 권한은 별도 확인한다.
2. 읽기 전용 전용 서비스 계정을 만들고 대상 스프레드시트 하나만 Viewer로 공유한다. 프로젝트 Editor/Owner 권한이나 domain-wide delegation을 주지 않는다. Sheets 읽기는 `https://www.googleapis.com/auth/spreadsheets.readonly` scope로 제한한다.
3. GitHub issuer `https://token.actions.githubusercontent.com`의 OIDC provider에 `google.subject=assertion.sub`, repository_id / repository_owner_id / ref / workflow_ref를 매핑한다. 숫자 repository_id `1173051817`, owner_id `265674906`, `refs/heads/main` 및 승인된 정확한 workflow_ref를 Google 측 attribute condition으로 제한한다. 이름만 신뢰하지 않는다. Environment를 쓰면 sub가 branch형에서 environment형으로 바뀌므로 sub만 보고 main을 보장하지 않는다.
4. 해당 저장소 principalSet에만 그 서비스 계정의 `roles/iam.workloadIdentityUser`를 허용한다. 모든 pool principal이나 모든 GitHub 저장소에 열지 않는다.
5. main-only job에만 `contents: read`, `id-token: write`를 부여하고 공식 `google-github-actions/auth`로 `token_format: access_token`, 위 서비스 계정·Sheets 읽기 scope를 지정한다. provider/SA 식별자는 vars, 출력 access token은 메모리/마스킹 범위에서만 사용한다. PR 코드에는 OIDC 발급·운영 job을 허용하지 않는다.
6. 테스트 시트로 정상 읽기/잘못된 ref 거절/권한 없는 시트 거절/429 backoff/응답 유실 검사를 먼저 수행한다. 운영 writer는 이전하지 않는다. GCP 콘솔 설정과 실제 토큰 성공까지 확인하기 전 활성화 완료로 보고하지 않는다.

## 새 GAS 완전 자동 배포는 별도 릴리스 과제

Apps Script API는 서비스 계정으로 동작하지 않으므로 WIF의 SA 단기 토큰을 CLASPRC_JSON 대신 넣어도 배포가 되지 않는다. 지원되는 현실적인 경로는 **사용자 OAuth의 자동 refresh + 승인된 main 변경의 CI 배포**다. 현재 안전 차단을 없애는 것만으로 완료되지 않는다.

특히 `projects.updateContent`는 프로젝트 HEAD를 바꾼다. 설치형 트리거는 웹앱 배포 버전과 독립적으로 저장된 프로젝트 코드를 사용하므로, deployment PUT 전이라도 HEAD 변경이 자동 작업에 영향을 줄 수 있다. 웹앱 버전 되돌림만으로 트리거 코드까지 롤백됐다고 할 수 없다. 기존 script/API writer 경합·수동 편집도 조정해야 한다.

자동 배포를 활성화하는 별도 PR은 다음을 만족해야 한다.

- 기존 #507 원본 보호 문제와 배포 후보 버전 차이를 해소/격리하고 사용자에게 구체적 릴리스의 영향을 제시한다. 현재 인계의 live v9.244에 미검증 v9.254를 즉시 올리지 않는다.
- main의 검증된 릴리스 커밋만 대상으로 전체 CI·유효 리뷰·전체 소스 pin·manifest/권한 비교를 강제한다. 이번 사용자의 무인 요구는 향후 자동화를 준비할 근거이며 기존 미해결 데이터 복원까지 승인한 것은 아니다.
- 외부 PR 코드를 실행하는 `workflow_run`에 배포 secrets를 주지 않는다. 배포는 별도의 보호된 main 환경, 직렬 concurrency, 오래된 커밋 차단, 명시된 릴리스만 사용한다. 사람의 매회 Environment 승인을 요구하면 '완전 자동'이 아니므로 초기 정책에서 구별한다.
- 인증/대상/파일/버전 사전 확인을 배포 job에 자동 통합하여 사람이 매번 dry-run하지 않게 한다. updateContent/version POST를 응답 유실 때 맹목 재시도하지 않는다. 이미 배포된 소스는 재배포하지 않고 버전 200개 제한·미사용 버전 관리 정책을 갖춘다.
- 이전 **HEAD 전체 파일**과 deployment 설정의 복구 자료를 안전하게 보관하고, HEAD와 웹앱 둘 다 검증한다. 배포 후 getSettings/getAutomationStatus·트리거 존재·새 자동 실행 결과를 확인한다. 코드 롤백과 금융 데이터 롤백은 분리한다. 검증 실패 시 금융 데이터를 자동 복원하지 않는다.

따라서 이번 변경 후에도 새 GAS 배포는 수동 dispatch 상태다. 운영·권한 관리자 최초 설정과 안전한 릴리스 전환 없이 '토큰 영구 불필요 + 모든 GAS 새 코드 자동 배포 + 모든 데이터 장애 자동 복구'를 보장할 수 없다.

## 무료 한도와 복구 가능성

- 저장소는 public이다. 표준 GitHub-hosted Linux runner는 무료이나 larger runner는 유료다. private로 바꾸면 GitHub Free의 월 2,000분/500MB artifact 등 한도와 보호 환경 지원 플랜을 다시 확인한다. 외부 금융 자료를 public artifact/log에 올리지 않는다. 유료 리소스·결제 설정을 이번 작업에서 만들지 않았다.
- GAS 일반 계정: 실행당 6분, 트리거 총 실행시간 90분/일, URL Fetch 20,000/일, 트리거 20개/사용자/스크립트, 속성 9KB/값·500KB/저장소, 버전 200개. 매시간 6분을 쓰면 24×6=144분으로 **worker 하나만으로도** 90분을 넘는다. 반복 예약 증가는 해결책이 아니다.
- 실제 42 TIMEOUT의 단계 원인은 현재 표본만으로 확정할 수 없다. 기존 worker의 phase checkpoint와 실제 live 소스를 확인해 날짜 탐색/원천 수집 등 병목을 특정한 뒤, 6분 전에 종료·진행상태 저장·다음 실행 재개가 가능하도록 별도 최소 패치해야 한다. main 개선이 live에 배포됐다고 가정하지 않는다.
- 원장 변경 감지 → pending 날짜 수집 → 최대 2일 진단 → 원천 부족 deferred 보존 → 날짜 cursor commit 경로가 있다. 재실행 날짜/코드 멱등성, MANUAL/확정 NAV 보호, 원장 서명, 백업 source-at-copy/완료 상태를 만족한 작업만 자동 처리한다. source 부족·충돌을 0/빈 결과로 덮거나 큐에서 삭제하지 않는다.
- Sheets API는 읽기/쓰기 각각 프로젝트당 분당 300회, 사용자당 분당 60회. 429는 제한된 지수 backoff, batch 읽기·전송량 제한으로 대응한다. Sheets API 자체 추가 사용료는 없고 IAM API도 무료다. 이 사실이 임의의 Google Cloud 제품 과금까지 없애는 것은 아니다.
- GitHub schedule은 지연·누락될 수 있고 public 저장소 활동이 60일 없으면 비활성화된다. 가짜 커밋으로 회피하지 않는다. GAS를 주 스케줄러로 유지해 GitHub 중단이 일일 실행을 멈추지 않게 한다. GAS/Google 계정·권한·할당량 장애와 GitHub 감시 장애의 동시 발생에는 완전한 무인 복구 보장이 없다.
- 손상된 역사 자료의 진실을 자동으로 만들 수는 없다. #507 과거 보류일은 신뢰할 원천·정확한 날짜/코드·백업과 별도 복구 범위가 확정될 때까지 보존한다. 매일 사람이 복구하도록 설계하지 않되, 사람 판단이 필요한 상태를 자동 '성공'으로 숨기지 않는다.

## 사람이 최초 확인할 항목 / 이후 예외

최초: GitHub Environment main-only 실제 정책, repo/org 중복 secret 제거, OAuth Production/동의 범위, Actions 실패 알림, 설치형 트리거 생성자·중복·권한, 필요 시 WIF IAM/시트 Viewer 공유, 안전한 릴리스 전환 승인. 현재 연결은 secret 목록/값·Environment 실제 정책·GCP 관리 설정을 조회할 수 없다. #507 인계의 사용자가 보고한 secret 제거와 성공한 런타임 검사를 구분한다.

일상: 정해진 트리거·감시·access token 자동 refresh·일시 네트워크 재시도는 사람이 매일 할 필요가 없다. 예외: OAuth 동의 철회/새 scope, 계정 정책, 원천 미확보/데이터 충돌, 할당량 초과, 예약 중단, 안전한 코드 롤백 실패에는 관리자 조치가 남는다. 아직 병합되지 않은 모니터·미구현 WIF·미활성 자동 배포를 완료로 표시하지 않는다.

## 공식 근거

- [Apps Script API: 프로젝트·배포와 서비스 계정 미지원](https://developers.google.com/apps-script/api/concepts)
- [설치형 트리거: 생성자 계정, 예약·실패 알림](https://developers.google.com/apps-script/guides/triggers/installable)
- [Apps Script 할당량](https://developers.google.com/apps-script/guides/services/quotas)
- [Google OAuth refresh token 만료·Testing 7일](https://developers.google.com/identity/protocols/oauth2#expiration)
- [GitHub → Google WIF 구성](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [공식 GitHub 인증 action: access_token_scopes와 SA impersonation](https://github.com/google-github-actions/auth)
- [Sheets API 한도·비용·backoff](https://developers.google.com/workspace/sheets/api/limits)
- [IAM API 무료](https://cloud.google.com/iam/pricing)
- [GitHub Actions 무료 범위·private 할당량](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub schedule 지연/누락·60일 비활성](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub 보호 환경과 플랜 제약](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
