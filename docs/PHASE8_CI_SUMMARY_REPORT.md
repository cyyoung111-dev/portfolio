# 8차 진행: CI 요약 리포트 단계

이번 단계는 web-check 결과를 CI Summary에 남겨서, PR 리뷰 시 현재 상태를 빠르게 파악할 수 있게 한다.

## 적용 항목
- `scripts/check-web-report.mjs` 추가
  - `src/web` JS 파일 수
  - `src/web/index.html` 로컬 defer include 수
  - inline handler 수
  를 Markdown으로 출력
- `package.json`
  - `check:web:report` 추가
- `.github/workflows/web-check.yml`
  - `Web check summary` 스텝 추가 (`$GITHUB_STEP_SUMMARY` 기록)

## 기대 효과
- PR 리뷰에서 "현재 구조 상태"를 숫자로 즉시 확인
- 품질 게이트 결과의 가시성 향상

## 비범위
- 런타임/UI 변경 없음
