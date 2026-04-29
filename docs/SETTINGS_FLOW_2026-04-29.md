# Settings 모듈 호출/책임 맵 (2026-04-29)

## 목적
`src/web/features/settings` 하위 파일의 책임 경계를 명확히 하여 P1 항목(호출 그래프/역할 문서화)을 즉시 수행합니다.

## 파일별 1차 책임
- `settings.js`: Settings UI 진입/기본 이벤트 결선(화면 orchestration)
- `settings_net.js`: 네트워크/API 관련 설정값 검증/보조
- `settings_persistence_utils.js`: 로컬 저장/복원 유틸
- `settings_sync.js`: 수동 동기화 실행 로직
- `settings_tabsync.js`: 탭 간 동기화/브로드캐스트 처리
- `settings_fetch.js`: 원격 fetch 및 결과 정규화

## 호출 흐름(개념)
1. 사용자 입력/클릭은 `settings.js`에서 수집
2. 값 검증/변환은 `settings_net.js` 및 `settings_persistence_utils.js` 경유
3. 동기화 요청은 `settings_sync.js`가 실행
4. 원격 데이터 요청/수신은 `settings_fetch.js`가 담당
5. 결과 반영/탭 전파는 `settings_tabsync.js` 또는 `settings.js`가 마무리

## 경계 규칙(즉시 적용 권고)
- UI 조작 코드는 `settings.js`에만 둔다.
- 원격 호출(fetch/XHR)은 `settings_fetch.js` 외 파일에서 직접 실행하지 않는다.
- LocalStorage 직접 접근은 `settings_persistence_utils.js`를 통해서만 수행한다.
- 탭 브로드캐스트 관련 API(`storage`, `BroadcastChannel`)는 `settings_tabsync.js`로 제한한다.

## 다음 단계
- 함수 단위로 `@module` 주석을 추가해 책임 자동 추출이 가능하도록 정리
- 간단한 mermaid 다이어그램으로 호출 방향(단방향 의존) 명시
