# 4차 진행: strict 게이트 시작

이번 단계는 CI에서 미참조 JS를 경고가 아닌 실패로 승격해 구조 드리프트를 방지한다.

## 적용 항목
- `scripts/check-web-structure.mjs`
  - `--fail-on-unreferenced` 옵션 추가
  - 미참조 JS 파일 목록 상세 출력
- `package.json`
  - `check:web-structure:strict`
  - `check:web:ci` (`strict 구조 점검 + 문법 점검`)
- `.github/workflows/web-check.yml`
  - CI 실행 명령을 `npm run check:web:ci`로 변경

## 기대 효과
- PR 단계에서 미참조 파일 유입을 즉시 차단
- 로컬(완화) / CI(엄격) 점검 정책 분리

## 비범위
- UI/기능 변경 없음
