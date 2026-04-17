# 11차 진행: DOM contract 가드

이번 단계는 `event_delegation.js`에서 사용하는 주요 DOM id와 실제 렌더링 템플릿의 id 정의가 서로 어긋나는 문제를 정적 검사로 조기 탐지한다.

## 적용 항목
- `scripts/check-web-dom-contract.mjs` 추가
  - `src/web/app/event_delegation.js`의 `clickHandlers`, `enterEscapeHandlers` key를 수집
  - `src/web/index.html` + `src/web/**/*.js`에서 `id="..."` 정의를 수집
  - 핸들러에서 참조하는 id가 정의되지 않았으면 실패 처리
- `package.json`
  - `check:web-dom-contract` 스크립트 추가
  - `check:web`, `check:web:ci` 체인에 DOM contract 검사 추가

## 기대 효과
- 이벤트 위임 id 변경/오탈자 시 CI에서 즉시 감지
- 런타임에서 버튼/입력 핸들러가 묵묵히 동작하지 않는 회귀를 사전 차단

## 비범위
- 실제 클릭/입력 동작을 브라우저에서 실행하는 E2E 테스트는 이번 범위 아님
