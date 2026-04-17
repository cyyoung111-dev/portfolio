# 9차 진행: script-manifest 가드

이번 단계는 `src/web/index.html`의 로컬 defer script 로딩 순서를 명시 파일로 고정해, 의도치 않은 include 순서 변경을 CI에서 탐지한다.

## 적용 항목
- `src/web/script-manifest.json` 추가
  - 로컬 defer script 목록/순서를 기준선으로 저장
- `scripts/check-web-manifest.mjs` 추가
  - `index.html`의 로컬 defer script 목록과 manifest를 1:1 비교
  - 개수/순서 불일치 시 실패 처리
- `package.json`
  - `check:web-manifest` 추가
  - `check:web`, `check:web:ci` 체인에 manifest 검사 포함

## 기대 효과
- include 순서 실수(의존성 깨짐 가능성)를 PR 단계에서 조기 감지

## 비범위
- ESM 전환/번들러 도입은 이번 단계 범위 아님
