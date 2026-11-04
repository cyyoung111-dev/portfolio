# 브리핑 자동 기동: Google Apps Script 독립 시계

**상태: 코드/CI 준비 단계, 실제 Google 프로젝트 생성 및 트리거 활성화 전.** 기존 포트폴리오 운영 GAS v9.282에는 이 코드를 넣지 않습니다. 새 Cloudflare 계정이나 서버가 필요하지 않으며 **기존 Google 계정에 독립 Apps Script 프로젝트 1개**를 사용합니다.

## 작동 방식

- 별도 GAS 설치형 시간 트리거는 `briefingClockTick`을 약 5분 간격으로 실행합니다. 첫 설치와 인증 후 매일 수동 실행이 필요 없습니다.
- 장전: 07:20–07:38 최초 기동, 07:45–07:59 복구, 08:00–08:05 마지막 복구(KST, 시계 판정 시간)
- 마감: 16:35–16:54 최초 기동, 17:05–17:24 복구, 17:35–17:49 마지막 복구(KST)
- 각 시간대에서 GitHub의 **기존** `telegram-morning-punctual-arm.yml` 또는 `telegram-close-punctual-arm.yml`의 `workflow_dispatch(ref=main)`를 최대 1회 승인받습니다. GitHub 자체 예약 실행은 그대로 보조 경로로 유지합니다.
- 복구 전에 GitHub Actions Artifact에서 당일 `-sent`, 원 Claim을 순서대로 조회합니다. `-sent`가 있으면 재기동하지 않고, Claim만 있으면 **전송 결과 불명으로 판정하고 재기동하지 않습니다.** 둘 다 없을 때만 복구 기동합니다.
- 08:12–08:29 / 18:02–18:19에 `-sent`를 확인합니다. 없으면 당일 한 번 `BC_MORNING_SENT_NOT_CONFIRMED` / `BC_CLOSE_SENT_NOT_CONFIRMED` 예외로 기록합니다. GAS 자체의 실패 이메일 알림 설정이 켜져 있어야 사용자가 통지받을 수 있습니다.
- GitHub API dispatch 204는 **발송 성공이 아닙니다.** 실제 성공은 기존 `Send` 단계와 `-sent` 증빙을 반드시 별도로 확인해야 합니다.
- GitHub runner가 정시 실행되지 않는 상황까지 완전히 제거하지는 못합니다. GAS와 GitHub 중복 기동은 원래의 공통 concurrency, 거래일/시간 검사, 날짜별 Claim에 의해 차단됩니다. 한국 휴장일은 생산 GAS의 KRX 확정 휴장 달력(2026·2027년)을 동일하게 적용해 기동과 발송 누락 경보 모두 건너뜁니다. 달력 미확인 연도는 fail-closed로 차단합니다.

## 최초 1회 연결

1. 기존 Google 계정으로 https://script.google.com/home/projects/create 에서 **별도의 독립 프로젝트**를 생성합니다(현재 포트폴리오 운영 프로젝트에 추가 금지).
2. 기본 `Code.gs` 전체를 이 폴더의 [Code.gs](./Code.gs) 내용으로 교체하고 저장합니다.
3. 프로젝트 설정 → 스크립트 속성에 아래 **두 항목**을 본인이 직접 등록합니다.
   - `BRIEFING_CLOCK_GH_TOKEN`: GitHub fine-grained personal access token. **Repository access = Only select repositories → `cyyoung111-dev/portfolio`**, **Repository permissions → Actions: Read and write**만 부여합니다. 토큰은 채팅, GitHub 코드/Issue, 로그에 적지 않습니다.
   - `BRIEFING_CLOCK_ENABLED`: `true` (운영 승인 및 테스트 후 활성화)
4. Apps Script 편집기에서 `briefingClockInstall` 함수를 **최초 1회 실행하여 Google 권한을 승인**합니다. 해당 프로젝트에 `briefingClockTick` 5분 트리거가 정확히 1개인지 `briefingClockStatus`로 확인합니다. 이후 정기적인 사용자 실행은 필요 없습니다.
5. 최초 거래일: GitHub Actions의 독립 기동 run → 07:40/17:00 `prepare` → dated Claim → Send → `-sent` artifact를 확인합니다. 2거래일 연속 오전·마감 실제 수신 및 데이터 확보율 검증 후 운영 정상으로 분류합니다.

**비활성화/롤백:** `briefingClockDisable`을 한 번 실행하면 Enabled=false로 바꾸고 이 프로젝트의 `briefingClockTick` 트리거만 삭제합니다. 기존 GitHub 예약 스케줄, 금융 원장, GAS 운영 프로젝트는 그대로 유지합니다. `BRIEFING_CLOCK_GH_TOKEN`은 운영 중단 시 설정에서 삭제하거나 GitHub에서 폐기할 수 있습니다.

## 보안·제약

- 네트워크 목적지는 하드코딩된 GitHub `actions/artifacts` 조회와 두 워크플로 `/dispatches`뿐입니다. HTTP 리디렉션을 따라가지 않습니다.
- 시트, NH API, Google Drive, Telegram 전송, 금융 원본 쓰기, 운영 GAS 배포를 실행하지 않습니다.
- 자격증명은 이 독립 GAS의 Script Properties에만 보관하고, 성공·실패 로그에 토큰/응답 본문을 출력하지 않습니다.
- GitHub 401/403/5xx, JSON 이상, 조회 실패에서는 **발송 여부 확인 불가로 fail-closed**입니다. 승인 여부가 불명확한 POST가 다시 시도되더라도 GitHub의 원 Claim은 재전송을 막습니다.
- GAS 시간 트리거는 초 단위 정시성을 보장하지 않습니다. `everyMinutes(5)`는 분산 기동용으로만 사용합니다. <https://developers.google.com/apps-script/guides/triggers/installable>
- GitHub Actions Write 최소권한과 `workflow_dispatch`: <https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event>
- 수정 시 `node scripts/check-briefing-gas-scheduler.mjs`로 실제 생산 GAS 함수를 모의 서비스에서 회귀 실행하고, `src/gas/apps_script.gs`의 2026·2027 KRX 휴장 달력과 정확히 대조합니다. 생산 달력에 연도가 추가되면 이 독립 GAS 코드도 업데이트 및 재승인해야 합니다.

## 현재 운영 분리

- Cloudflare 초안 `ops/briefing-external-scheduler`는 기존 미활성 설계로 남기며 새 GAS가 운영되기 전 임의 가동하지 않습니다.
- 현재 운영 GAS v9.282와 금융 writer 게이트/trigger restoration은 별도 과제입니다. 독립 시계 적용을 이유로 그 코드를 자동 배포하거나 Google Sheets 데이터를 변경하지 않습니다.
- 이 PR의 병합/CI만으로 Google Apps Script 프로젝트, 설치형 트리거, GitHub 토큰이 생성되지는 않습니다.
