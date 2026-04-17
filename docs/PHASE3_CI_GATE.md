# 3차 진행: CI 품질 게이트 시작

이번 단계는 로컬 점검 명령(`npm run check:web`)을 PR/메인 브랜치에도 자동 적용하는 것이다.

## 적용 항목
- GitHub Actions 워크플로우 추가: `.github/workflows/web-check.yml`
- `src/web/**`, 점검 스크립트, `package.json` 변경 시 자동 실행
- 실행 명령: `npm run check:web`

## 기대 효과
- 리뷰 전에 누락되는 include/문법/중복 이슈를 PR 단계에서 자동 차단
- 로컬과 CI의 점검 기준 일치

## 비범위
- 기능/화면 변경 없음
- 배포 파이프라인 자체 변경 없음
