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
