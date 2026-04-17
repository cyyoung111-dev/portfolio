# 10차 진행: manifest 동기화 자동화

이번 단계는 include 순서 변경이 의도된 경우, manifest 갱신을 수동 편집하지 않고 명령으로 동기화할 수 있게 한다.

## 적용 항목
- `scripts/update-web-manifest.mjs` 추가
  - `src/web/index.html` 로컬 defer script 목록을 읽어
  - `src/web/script-manifest.json`을 자동 재생성
- `package.json`
  - `sync:web-manifest` 추가
- `scripts/check-web-manifest.mjs`
  - 불일치 시 `npm run sync:web-manifest` 안내 메시지 출력

## 기대 효과
- 의도된 include 변경 시 작업 절차 단순화
- manifest/실제 include 불일치 해결 시간 단축

## 비범위
- include 순서 자체를 자동으로 변경하지는 않음
