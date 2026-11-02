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

## 이 조사로는 증명되지 않는 것
1. 다른 GAS 프로젝트·다른 계정의 배포, 편집기, 수동 시트 편집 및 Sheets API 외부 writer가 차단됐는지.
2. 모든 기존 실행자/버전이 종료됐는지. 공식 `processes.listScriptProcesses`는 별도의 script.processes OAuth 범위가 필요하며, 예전 audit 403이나 빈 결과는 종료 증거가 아니다: https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses
3. 현재 사용자에게 보이는 `ScriptApp.getProjectTriggers()` 목록이 프로젝트 전체 사용자/트리거 목록을 대표하는지.
4. 초기 writer gate bootstrap 이후 서비스 정상화 및 무계측 v9.281로의 롤백 방지가 검증됐는지.

## 승인 분리
이 PR과 워크플로의 성공은 **운영 배포 또는 금융 원본 복구의 승인 근거가 아니다**. PR #862 최초 gate 차단, v9.282 수동 승인, v9.283 다음 릴리스와 금융 원본 쓰기는 별도 단계다. 실제 실행도 이 PR의 `main` 병합 후 **별도 수동 호출**을 해야 한다.

오프라인 검증: `node scripts/check-issue507-deployment-inventory-readonly.mjs` (`npm run check:ci`에도 포함). 테스트는 익명 합성 원천만 사용하고 실제 인증정보/금융 API에 접근하지 않는다.
