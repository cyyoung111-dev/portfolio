# Agent Notes

## 언어 및 결과 보고

- 사용자에게 전달하는 설명, 진행 상황, 요약, 테스트 결과, 경고 및 오류 보고는 항상 한국어로 작성한다.
- Git 커밋 메시지는 한국어로 작성한다.
- Pull Request 제목, 본문 및 섹션 제목은 한국어로 작성한다. 영문 제목 대신 `변경 목적`, `수정사항`, `테스트`와 같은 한국어 섹션 제목을 사용한다.
- 소스 코드 식별자, API 명칭, 파일 경로, 터미널 명령어 및 로그 원문은 번역하면 정확성이 떨어질 수 있으므로 원문을 유지한다.

## 저장소 유지관리

- When changing `src/gas/apps_script.gs`, update all GAS version references in the same change:
  - the header title version near the top of `src/gas/apps_script.gs`
  - the top changelog block in `src/gas/apps_script.gs` with the current date and summary
  - the `gasVersion` value returned by `handleGetSettings()`
  - `EXPECTED_GAS_VERSION` in `src/web/features/settings/settings_fetch.js`
- Keep operational deployment notes in `DEPLOYMENT.md` current when deployment, GAS redeploy, public-data API, or web-root behavior changes.

## 토큰 효율과 근거 확인

- 이전 대화와 기존 보고 내용을 반복하지 말고, 현재 요청에 필요한 변경·검증·주의사항만 간결하게 보고한다.
- 진행 상황은 별도 설명이 필요한 긴 작업에서만 짧게 알리고, 단순 조사·수정·검사는 중간 설명 없이 완료 결과로 보고한다.
- 저장소 사실은 먼저 `rg`, `git diff`, 관련 파일 열람 또는 테스트로 확인한 뒤 답하고, 확인하지 못한 내용은 추측하지 말고 `확인하지 못함`으로 명시한다.
- 외부·최신 정보가 필요한 요청은 실제 검색 결과를 근거로 작성하며, 검색할 수 없으면 확인할 수 없다고 밝힌다.
- 테스트 로그 전체를 답변에 반복하지 말고, 실행한 정확한 명령과 통과·실패·환경 제약만 요약한다.
- 사용자 확인 항목은 자동 검사로 확인할 수 없는 항목과 이번 변경 범위에 해당하는 항목만 안내한다.

## 모든 후속 PR에 적용할 영구 품질 게이트

- 모든 변경은 [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md)의 공통 품질 기준을 따른다. PR #471뿐 아니라 앞으로의 모든 작업·Codex 검토·GAS 운영 변경에 적용한다.
- 변경 전 최신 HEAD/기준 브랜치/호출자·피호출자/공유 상태 및 트리거/과거 관련 PR을 확인하고, 검증 가능한 실패 사례와 기존 정상 사례를 모두 지정한다.
- **Safety(중복·손상·잘못된 완료 방지)**와 **Liveness(차단·실패 후 재시도·대기열 진행)**를 별도 계약으로 확인한다. 새 잠금·예외·스킵 조건에는 반드시 반대 실행 경로와 복구 경로 테스트를 추가한다.
- 문자열 패턴 검사와 CI 녹색 표시만으로 안전성을 선언하지 않는다. 핵심 로직은 생산 함수를 호출한 동작 검사, 가상 시계/동시 실행 시뮬레이션, 이전 결함 회귀 및 대표 변이 테스트로 검증한다.
- 기존 데이터·Snapshot·NAV·가격이력의 멱등성, 날짜 경계, 이전 PR 기능 회귀를 확인한다. 테스트의 ‘스킵’과 실제 ‘통과’, 코드 병합과 GAS 배포·운영 데이터 검증을 구분한다.
- 리뷰 댓글은 신규/구버전/outdated/실제 재현 여부를 확인한다. 관련 지적은 공통 원인을 먼저 찾아 묶어서 수정하며, 연속 2회 새로운 구조적 P1/P2가 생기면 코드 조각 수정·무의미한 재리뷰 대신 설계/검증 모델을 다시 검토한다.
- 가능한 한 하나의 독립 계약에 대한 작은 PR을 선호하며, 사용자의 토큰·리뷰 한도를 아끼기 위해 충분한 사전 자동 검증 후 최신 HEAD로 Codex 리뷰를 요청한다.
