# Final Cleanup TODO (Post-Merge)

현재 브랜치는 PR 충돌 완화를 위해 레거시 경로와 신규 경로를 일부 병행 유지하고 있습니다.

아래 항목은 **머지 안정화 이후** 정리 권장 순서입니다.

## 1) 중복 경로 정리
- [ ] `src/web/features/management/mgmt_editor.js` 제거 여부 확정
  - 유지 기준: 타 브랜치가 계속 legacy 경로를 직접 수정하는 경우
  - 제거 기준: `index.html` 포함 경로가 신규 경로로 완전히 전환된 경우

- [ ] history 경로 단일화
  - 현재: `src/web/views/views_history*.js` (legacy) + `src/web/features/history/views_history*.js` (new)
  - 목표: 한 경로만 유지 (권장: `features/history/`)

## 2) include 경로 최종 확정
- [ ] `src/web/index.html`에서 history/editor 로딩 경로 단일화
- [ ] 미사용 include 없는지 재점검

## 3) 자동 점검 재실행
- [ ] `node --check` 전체 실행
- [ ] inline handler(`onclick/onchange/onkeydown`) 잔존 점검
- [ ] 중복 top-level 함수명 점검

## 4) 수동 스모크 체크
- [ ] 히스토리 탭 모드 전환/새로고침/디버그 닫기
- [ ] 구글시트 URL 저장/해제/Enter 저장
- [ ] 탭 재동기화 버튼 및 상태 배지
- [ ] 상단 액션 버튼(업데이트/현재가/가져오기/초기화)

## 5) 문서 마감
- [ ] `SMOKE_CHECKLIST.md` 결과 반영
- [ ] PR 본문에 최종 경로 구조 기록

