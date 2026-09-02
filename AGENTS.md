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
