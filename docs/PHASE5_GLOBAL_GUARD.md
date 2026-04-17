# 5차 진행: 전역 함수명 충돌 가드

이번 단계는 classic script 환경에서 발생하기 쉬운 전역 함수명 충돌을 CI에서 조기 차단한다.

## 적용 항목
- `scripts/check-web-globals.mjs` 추가
  - `src/web/**/*.js`를 스캔하여 top-level `function` 선언명 수집
  - 동일 함수명이 여러 파일에 존재하면 실패 처리
- `package.json` 점검 체인 확장
  - `check:web-globals`
  - `check:web`, `check:web:ci`에 globals 검사 포함

## 기대 효과
- 파일 분리/병합 과정에서의 전역 네임 충돌 사고 예방
- classic script 기반 구조의 안정성 강화

## 비범위
- 모듈 시스템(ESM) 전환은 이번 단계 범위 아님
