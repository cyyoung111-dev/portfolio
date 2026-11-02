# Issue #507 — Apps Script 배포 목록 읽기 전용 조사

## 목적과 범위
- 운영 GAS 게시판 감사 [#41442800080](https://github.com/cyyoung111-dev/portfolio/actions/runs/41442800080): 게시 v9.281, deployment 개정번호 336. 정상적인 BLOCKED 판정.
- 수동 [dry-run #41446204818](https://github.com/cyyoung111-dev/portfolio/actions/runs/41446204818): 실제 소스 HEAD/게시가 모두 v9.281이며 v9.282 후보는 운영에 미배포.
- PR #862에서 최초 v9.281 → v9.282 stateful writer-gate 실배포를 차단하므로, 다음 단계는 **모든 배포 경로 중 확인되지 않은 기존 배포가 남아 있는지 읽기 전용으로 조사**하는 일이다.

## 워크플로
- `.github/workflows/issue507-deployment-inventory-readonly.yml`
- `main` 수동 실행 전용 `workflow_dispatch`, 보호 환경 `portfolio-production-gas`, 배포 쓰기와 공용 `gas-production-deploy` 직렬화.
- `scripts/issue507-deployment-inventory-readonly.mjs`는 clasp OAuth refresh 후 Apps Script 공식 `GET projects.deployments.list`만 호출. 응답의 모든 페이지(최대 10쪽 × 50개)를 따라가며 목록/스키마/중복/페이지 토큰을 확인한다.
- 공식 근거: https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/list
- OAuth의 **refresh token 교환만 POST**이고 GAS API는 GET만 수행한다. GAS/Sheets/Trigger/버전/Deployment에 대한 **쓰기 0회**.
- 운영 로그는 배포 ID/URL/설명, 계정, OAuth/비밀정보, 원천 응답을 출력하지 않고 `deploymentCount`, 실행 API/웹앱 엔트리포인트 수, 기존 운영 배포 존재 여부와 추가 배포 가능성만 집계.
- 예상 운영 배포 ID는 `GAS_DEPLOYMENT_ID` 또는 설정된 웹앱 URL로 대조. 실제 배포 수는 아직 미확인이다. 빈 목록/누락/추가 배포/미정 유형/부분 페이징은 `BLOCKED` 또는 `UNVERIFIED`.
- [수동 감사 #41454759788](https://github.com/cyyoung111-dev/portfolio/actions/runs/41454759788)에서 인증된 GET 단계가 호출됐지만, 기존 스키마 검사가 `ISSUE507_DEPLOYMENT_INVENTORY_SCHEMA_UNVERIFIED`로 중단. **실제 배포 수와 서버 응답의 어느 필드가 실패했는지는 로그에 없음**. 따라서 HEAD 객체가 원인이라는 가정은 아직 확인되지 않았다.
- [공식 GAS 배포 가이드](https://developers.google.com/apps-script/concepts/deployments)의 특수한 `HEAD` 배포는 자동 생성되고 특정 불변 코드 버전과 연결되지 않는다. `HEAD`만은 8자 미만의 ID와 `versionNumber` 부재·0, 엔트리포인트 생략을 허용한다. 다른 ID의 버전·진입점 불명 상태는 계속 차단한다. HEAD에 공개 엔트리포인트가 있다면 다른 배포와 동일하게 격리 대상으로 차단한다.
- 실제 응답을 공개하거나 비공개 deployment ID/URL/token을 덤프하는 대신, 실패 코드를 `SCHEMA_LIST_UNVERIFIED`, `SCHEMA_ID_UNVERIFIED`, `SCHEMA_VERSION_UNVERIFIED`, `SCHEMA_ENTRY_POINTS_UNVERIFIED` 등으로 분리해 다음 실행에서 **정확한 실패 범주만** 식별한다. 단, 원인 구분 성공과 운영 writer 격리 증빙은 다른 문제다.
- [수동 실행 #41455872350](https://github.com/cyyoung111-dev/portfolio/actions/runs/41455872350)에서 `ISSUE507_DEPLOYMENT_INVENTORY_SCHEMA_VERSION_UNVERIFIED`가 확인됐다. 개별 배포 ID·개수·버전 원문은 공개되지 않았으므로 정확한 항목과 값은 미확인이다. 공식 REST `DeploymentConfig.versionNumber`는 정수 필드이나 요청한 LIST 응답에서는 어떤 배포에 양의 정수가 없었던 것으로만 판정한다.
- 이 사례를 위해 **양의 정수 버전번호가 없는 일반 배포를 목록에서 버리지 않고 끝까지 읽어** `unverifiedVersionedDeploymentCount`와 전체 배포·진입점 개수로 보고하되, `status=BLOCKED`, `reason=VERSION_METADATA_UNVERIFIED`, `releaseAuthorized=false`로 강제한다. 단일 예상 웹앱이 확인돼도 버전 미확인 배포가 하나라도 있으면 운영 전환 불가. 추가로 실제 GAS 쓰기/금융 원본 변경/트리거 변경 없음.
- 누락된 버전이 기존 비활성화 배포인지, 비계측 구버전인지, Google API 직렬화 특성인지는 목록만으로 확정하지 않는다. 운영 재검토 전에는 이 미확인 배포를 안전하다고 분류하지 않는다.
- 예상된 배포 하나만 보이더라도 `INVENTORY_ONLY`이며 **releaseAuthorized=false**, `allActorsAndVersionsTerminatedVerified=false`, `externalSheetsWritersExcludedVerified=false`, `editorSessionsExcludedVerified=false` 유지.

## 실제 운영 배포 목록 (2026-11-02 22:54 KST)

[수동 감사 #41457015647](https://github.com/cyyoung111-dev/portfolio/actions/runs/41457015647)에서 **실제 전체 목록 조회는 완료**, 기존 정책에 따라 BLOCKED(exit 2)로 종료됐다.

| 실제 항목 | 결과 |
| --- | ---: |
| 전체 배포 / WEB_APP entry | 4 / 4 |
| 예상 운영 배포 | 1 (발견) |
| 추가 공개 웹앱 배포 | 3 |
| 버전 정보 미확인 일반 배포 | 1 |
| HEAD / EXECUTION_API / ADD_ON / unknown entry | 모두 0 |
| REST pagination | 1페이지, 전체 확인 |
| releaseAuthorized / GAS·금융 원본 쓰기 | false / 모두 0 |

위 **3개는 추가 웹앱 진입점이 있는 배포**라는 뜻이며 실제 외부 사용 여부나 폐기 가능 여부를 뜻하지 않는다. Google 공식 문서에 따르면 버전 배포를 보관하면 기존 사용자가 영향을 받을 수 있으므로 사용자 확인·별도 승인이 필요하다: https://developers.google.com/apps-script/concepts/deployments

### 다음 읽기 전용 상세 GET 검증 (이 PR)

- 기존 LIST 결과와 **배포 ID별 공식 GET**(`projects.deployments.get`)을 인메모리로 비교한다: https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/get
- 목록 버전 미확인 1개가 상세 조회에서 정상 버전을 갖는지, 나머지 3개의 버전 또는 진입점이 목록과 불일치하는지 **개수만** 보고한다.
- `detailGetRequestedCount`, `detailGetCheckedCount`, `detailGetUnverifiedCount`, `detailVersionRecoveredCount`, `detailVersionStillUnverifiedCount`, `detailVersionConflictCount`, `detailEntryPointMismatchCount` 등 정수 카운트를 기록한다. 원본 ID/배포 URL/설명/원본 JSON은 로그에서 제외한다.
- 상세 GET으로 버전이 확인돼도 LIST의 원래 `VERSION_METADATA_UNVERIFIED`와 추가 배포 3개에 대한 `BLOCKED`는 유지한다. 상세 정보 일치 자체는 과거 writer 제거·사용자 접근 격리의 증거가 아니다.
- 개별 GET 실패/미일치/응답 누락 시에도 `releaseAuthorized=false`; GAS 콘텐츠/버전/배포·시트·트리거 변경은 하지 않는다. **실행 검증은 PR 병합 후 최신 main의 별도 수동 감사로 확인해야 한다.**

## 배포별 웹앱 접근·실행 권한 조회 (2026-11-02)

[수동 감사 #41458389102](https://github.com/cyyoung111-dev/portfolio/actions/runs/41458389102): 배포 4개/WEB_APP 4개를 상세 `GET`으로 모두 조회했다. 조회 실패 0, LIST/DETAIL 버전 상충 0, 진입점 상충 0, 목록·상세 모두 버전번호를 확인할 수 없는 배포 1개, 추가 WEB_APP 3개. `BLOCKED`, `releaseAuthorized=false`. 확인된 수치는 **배포 메타데이터의 존재**이지 누가 사용 중인지 또는 어떤 권한인지 판단한 결과가 아니다.

[공식 REST WebAppConfig](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments)의 `webApp.entryPointConfig.access`와 `executeAs`를 기존 4건 GET 결과에서 읽기 전용으로 집계한다.

- 접근 범위: MYSELF / DOMAIN / ANYONE(로그인 사용자) / ANYONE_ANONYMOUS(비로그인 포함) / 미확인
- 실행 주체: USER_ACCESSING / USER_DEPLOYING / 미확인
- 예상 운영 배포와 추가 배포를 구별하여, 추가 배포 중 익명 접근 가능 건수·로그인 사용자 접근 가능 건수·배포자 권한 실행 건수·익명 접근과 배포자 권한이 겹치는 건수만 보고한다.
- 개별 deployment ID/URL·설명·계정·토큰·원본 REST JSON은 로그에 남기지 않는다. 누락되거나 공식 enum과 다른 값은 `unknown`으로 집계하고 `BLOCKED`를 유지한다.
- `ANYONE_ANONYMOUS` 또는 `USER_DEPLOYING`만으로 취약점이 확정되지는 않는다. 하지만 외부에서 호출할 수 있는 기존 구버전이 배포자 권한으로 실행될 가능성은 사용자 영향/접근 통제 관점에서 별도 검토해야 한다.
- 기존 배포를 자동으로 비활성화/삭제하거나 POST·PUT·Sheets 수정·텔레그램 전송하지 않는다. **상세 권한 집계가 성공해도 releaseAuthorized=false**.

## 배포된 불변 소스 원문 읽기 전용 분류 (2026-11-02 23:11 KST)

[최신 권한 감사 #41459639729](https://github.com/cyyoung111-dev/portfolio/actions/runs/41459639729), main `f13e74a7bc34`에서 실제 GAS 4개 WEB_APP 전부 `ANYONE_ANONYMOUS` + `USER_DEPLOYING`; 추가 3개 역시 모두 익명 접근·배포자 실행. 상세 배포 GET 4/4, 버전/진입점 불일치 0, LIST·상세 모두 versionNumber 불명 1개. 이는 **취약점이나 실제 사용 여부를 증명하지 않지만**, 과거 코드 버전이 익명 호출 가능하다는 위험 검토 필요성을 확인한다.

본 PR의 다음 진단은 Google 공식 `GET projects.getContent?versionNumber=N`로 **양의 정수 불변 버전**에 해당하는 GAS 소스를 메모리에서만 검증한다. 공식 문서: https://developers.google.com/apps-script/api/reference/rest/v1/projects/getContent

- 기존 승인 소스의 해시와 정확히 일치하는 **v9.281 기존 운영 원문**과 **v9.282 신규 writer gate 승인 원문** 여부만 내부 분류한다. 그 외는 `unreviewed`로 집계하며 gate가 없다고 확정하지 않는다.
- LIST에서 버전 미확인 배포는 HEAD 내용을 대신 읽어 잘못 연결하지 않는다. `sourceGetSkippedUnversionedCount`에 계산하여 **차단 유지**. 버전별 중복 소스 GET을 줄이고 최대 12개의 고유 버전만 조회하며 상한 초과도 미확인.
- 파일의 원문, 배포 ID/URL, 버전번호, blob/hash, secret, 작성자 정보는 로그에서 제외하고 소스 분류 건수만 보고한다.
- `sourceKnownLegacy9281Count`, `sourceKnownReviewedGate9282Count`, `sourceUnreviewedCount`, `sourceGetUnverifiedCount` 등 집계는 공개하되, **소스 일치만으로 writer/트리거/외부 Sheets API 격리 또는 v9.282 배포 승인 주장 금지**.
- 운영 GAS 콘텐츠·버전·트리거·금융 원본에 대한 변경 요청은 없다. OAuth 토큰 교환 외 GAS API는 GET만 호출한다. 차단 상태·releaseAuthorized=false·기존 세 웹앱 유지.

## 배포 코드 버전별 감사 결과 (2026-11-02 23:20 KST)

[실제 수동 감사 #41461024423](https://github.com/cyyoung111-dev/portfolio/actions/runs/41461024423)에서 승인 전 `GET projects.getContent?versionNumber`를 사용해 서로 다른 불변 코드 버전 3개를 모두 조회했다. 1개는 **승인된 v9.281 legacy 원문**과 정확히 일치했고, 2개는 보유한 승인 v9.281/v9.282 원문 어느 것과도 일치하지 않았다. 다른 1개의 배포는 LIST·DETAIL에서 모두 버전번호를 확인할 수 없으므로 코드 GET 대상으로 지정할 수 없었다. 비인가 또는 취약한 소스라고 단정하는 것이 아니라 **리뷰하지 않은 코드**로 보수적으로 분류했다.

당시 접근 권한은 4개 전부 `ANYONE_ANONYMOUS` 및 `USER_DEPLOYING`. 실제로 호출되는 URL인지, 내부에 어떤 쓰기 함수가 있는지, 배포자 누구인지에 대한 증거는 없음. `BLOCKED`, `releaseAuthorized=false`.

### 본 PR: 운영 웹앱과 추가 웹앱의 소스 분류 분리

현재 감사의 1/2/1 건수는 **고유 소스 버전 수**이므로 정확한 현재 운영 URL과 추가 3개 URL의 귀속 관계를 알 수 없다. 따라서:
- `expectedDeploymentSourceClassification`은 예상 운영 배포 ID의 소스가 정확히 승인된 v9.281인지, 승인 v9.282인지, 미검토 소스인지, 조회 불가/버전 미확인인지 문자열 enum 하나로만 반환.
- `additionalDeploymentKnownLegacy9281Count`, `additionalDeploymentReviewedGate9282Count`, `additionalDeploymentUnreviewedSourceCount`, `additionalDeploymentVersionUnverifiedCount`, `additionalDeploymentSourceGetUnverifiedCount`, `additionalDeploymentSourceLimitUnverifiedCount`, `additionalDeploymentSourceNotInspectedCount`는 추가 접근 가능한 배포의 **배포별 건수**를 반환. 같은 소스 버전이 두 URL에 쓰여도 배포 수는 각각 계산하고 내부 고유 버전 GET 중복 제거는 유지.
- 개별 배포 ID/URL, 원본 소스·SHA/버전 숫자·인증정보는 출력하지 않으며, Source GET 한도와 실패는 여전히 차단.
- 결과가 어떻든 운영 writer gate 최초 cutover 승인이나 기존 배포 격리 증거로 삼지 않는다. 실제 운영 배포의 보관/삭제는 사용자에게 영향을 줄 수 있으므로 별도 증빙·승인 전에는 금지.
- Codex P2 리뷰에서 LIST v336과 DETAIL v337처럼 **조회 사이에 버전이 바뀌는 경우** 이전 LIST 승인 소스를 현재 배포에 잘못 귀속할 위험을 발견했다. 소스 대조를 실행하더라도 배포별 DETAIL 조회 완료 여부, 양의 정수 버전, LIST/DETAIL 버전 일치, 엔트리포인트 일치가 모두 확인되지 않으면 `DETAIL_METADATA_UNVERIFIED`로 귀속을 차단한다. 같은 버전의 다른 배포가 승인됐다는 이유로 예외를 만들지 않는다.

## 미검토 불변 소스의 쓰기 표면 정적 힌트 검사 (2026-11-03)

[수동 감사 #41524387649](https://github.com/cyyoung111-dev/portfolio/actions/runs/41524387649), 최신 main `f106ccd73d38cb05f84a057108f158ce2cd73f63`:
- 예상 운영 WEB_APP은 승인된 기존 v9.281 원문과 **정확히 일치**.
- 추가 WEB_APP 3개 중 **미검토 불변 소스 2개**, 버전정보 미확인(소스 조회 대상 제외) 1개. 이 3개 모두 `ANYONE_ANONYMOUS` 및 `USER_DEPLOYING`.
- `BLOCKED`는 정상 안전 차단. 기존 URL을 자동 종료하거나 비인가 위험을 확정하지 않는다.

이번 변경은 버전이 확인된 **미검토 소스 2종**에 대해서만 승인된 `getContent?versionNumber` 응답 본문을 메모리에서 검사하여, 제한된 **텍스트 출현 신호**의 존재 건수를 익명으로 집계한다.

- 웹 진입점 `doGet`, `doPost` 선언 형식, Spreadsheet 관련 `.setValue(s)`·`.appendRow`·`.clearContent` 등, Script Properties 변경, 트리거 생성/삭제, `UrlFetchApp.fetch` 문구의 유무를 각 **고유 불변 소스 버전 단위**로 집계한다.
- 소스 원문/배포 ID/URL/버전번호/SHA/사용자·OAuth/금융 데이터는 출력하지 않는다. 실제 원문을 다운로드하여 새 파일로 저장하지 않고 기존 REST GET 응답의 메모리 내용만 검사한다.
- **매우 중요한 한계:** 이 검사는 AST·실행 가능성·인증 경계·호출 그래프를 검증하지 않는 단순 정적 문자열 검사다. 주석/문자열에 있는 코드를 실제 쓰기 경로로 오인할 수 있고, 동적 호출·간접 호출 등을 누락할 수 있다. *양성/음성 모두 안전·취약성·실사용 여부의 증거가 아니며 자동 배포 승인을 허용하지 않는다.*
- 버전번호 미확인 배포 1개는 HEAD를 대신 검사하지 않고 계속 미확인으로 처리한다. 다른 GAS 프로젝트·트리거·외부 Sheets API writer 경합도 이 검사로 알 수 없다.
- 모든 결과에서 `releaseAuthorized=false`, 최초 writer-gate 설치 차단, 수동 운영 아카이브 금지, 금융 원본·트리거·NH·Telegram 무변경을 유지한다.

## 이 조사로는 증명되지 않는 것
1. 다른 GAS 프로젝트·다른 계정의 배포, 편집기, 수동 시트 편집 및 Sheets API 외부 writer가 차단됐는지.
2. 모든 기존 실행자/버전이 종료됐는지. 공식 `processes.listScriptProcesses`는 별도의 script.processes OAuth 범위가 필요하며, 예전 audit 403이나 빈 결과는 종료 증거가 아니다: https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses
3. 현재 사용자에게 보이는 `ScriptApp.getProjectTriggers()` 목록이 프로젝트 전체 사용자/트리거 목록을 대표하는지.
4. 초기 writer gate bootstrap 이후 서비스 정상화 및 무계측 v9.281로의 롤백 방지가 검증됐는지.

## 승인 분리
이 PR과 워크플로의 성공은 **운영 배포 또는 금융 원본 복구의 승인 근거가 아니다**. PR #862 최초 gate 차단, v9.282 수동 승인, v9.283 다음 릴리스와 금융 원본 쓰기는 별도 단계다. 실제 실행도 이 PR의 `main` 병합 후 **별도 수동 호출**을 해야 한다.

오프라인 검증: `node scripts/check-issue507-deployment-inventory-readonly.mjs` (`npm run check:ci`에도 포함). 테스트는 익명 합성 원천만 사용하고 실제 인증정보/금융 API에 접근하지 않는다.
