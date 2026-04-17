# 2차 진행: 점검 체인 강화

이번 단계는 구조 변경 없이, 배포 전 점검을 한 번에 실행할 수 있도록 체크 체인을 정리한다.

## 추가 사항
- `npm run check:web-syntax`
  - `src/web/**/*.js` 전체에 대해 `node --check` 문법 점검 실행
- `npm run check:web`
  - 구조 점검(`check:web-structure`) + 문법 점검(`check:web-syntax`)을 연속 실행

## 기대 효과
- 점검 명령 표준화로 누락 방지
- 로컬/CI에서 동일한 품질 게이트 사용 가능

## 비범위
- UI/기능 변경 없음
- include 순서 변경 없음
