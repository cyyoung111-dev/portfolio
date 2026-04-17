## Summary
- [ ] 변경 목적/배경을 한 줄로 설명
- [ ] 런타임(UI/기능) 변경 여부 명시

## Quality Gate (required)
- [ ] `npm run check:web:ci` 통과
- [ ] `src/web/index.html` include 변경 시 영향 범위 설명
- [ ] 전역 함수/inline handler 관련 변경 시 회귀 체크 완료

## Manual Smoke (when UI/flow changed)
- [ ] 히스토리 탭 진입 및 모드 전환
- [ ] 현재가 편집기 열기/닫기
- [ ] 설정 저장/탭 동기화 동작 확인

## Notes
- 리팩터링/정리성 변경이라면 사용자 동작 영향이 없음을 명시
