# 1차 패치안: 구조 안정화(무중단)

목표: 동작/화면 변경 없이, 파일 구조 관리 리스크를 자동 점검 가능한 상태로 만든다.

## 적용 항목
1. `scripts/check-web-structure.mjs` 추가
   - `src/web/index.html`의 로컬 `<script defer src="...">` 경로 존재 여부 검증
   - `src/web/**/*.js` 내용 해시 기반 중복 파일 검출
   - `index.html` 기준 미참조 JS 파일 수를 경고 출력

2. `package.json`에 실행 스크립트 추가
   - `npm run check:web-structure`

## 기대 효과
- include 누락/오타를 커밋 전에 즉시 탐지
- 내용 중복 파일이 다시 유입되는 문제 예방
- 미참조 파일 누적 상태를 경고로 가시화

## 비범위(이번 패치에서 하지 않음)
- 런타임 include 순서 변경
- `views/*` ↔ `features/*` 대규모 이동
- UI/스타일 변경

## 다음(2차) 권장
- canonical 경로(예: `features/*`) 확정 후 브리지 파일 단계적 제거
- 수동 스모크 체크 자동화(E2E 최소 시나리오)
