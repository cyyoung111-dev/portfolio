# 6차 진행: inline handler 참조 가드

이번 단계는 `src/web/index.html`의 inline 이벤트 핸들러(onclick/onchange/oninput 등)에서 호출하는 함수가 실제 전역에 존재하는지 자동 점검한다.

## 적용 항목
- `scripts/check-web-inline-handlers.mjs` 추가
  - `src/web/index.html`의 `on*="..."` 핸들러를 수집
  - 핸들러 내부 함수 호출명을 추출
  - `src/web/**/*.js`의 전역 함수 선언(`function`) 또는 `window.xxx =` 할당과 대조
  - 누락 시 실패 처리
- `package.json` 점검 체인 확장
  - `check:web-inline`
  - `check:web`, `check:web:ci`에 inline handler 검사 포함

## 기대 효과
- HTML inline 핸들러 오타/삭제 누락을 CI 단계에서 조기 차단

## 비범위
- inline handler 제거(이벤트 위임 전환) 자체는 이번 단계 범위 아님
