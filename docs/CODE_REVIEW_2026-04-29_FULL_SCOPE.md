# 전체 검토 리포트 (코드 + 폴더/파일 구조) — 2026-04-29

## 1) 요청 해석
- "코드뿐만 아니라 폴더/파일까지 전체 검토" 요청으로 이해하고, 다음 3축으로 점검했습니다.
  1. 저장소 구조(디렉터리/역할 분리)
  2. 파일 단위 책임 분리/응집도
  3. 기존 정적 검사 게이트 통과 여부

## 2) 저장소 구조 점검

### 최상위
- `src/`: 실행 코드(웹 + GAS)
- `scripts/`: 정적 검사/리포트 자동화
- `docs/`: 리뷰/문서
- `.github/workflows/`: CI 워크플로우
- `index.html`: 엔트리 포인트

### `src/` 하위 역할
- `src/web/`: 프런트엔드 앱 본체
  - `app/`: 부트스트랩/이벤트 위임
  - `core/`: 공통 UI/로그/스토리지/색상
  - `domain/`: 포트폴리오/상태/마이그레이션
  - `features/`: 업무 기능별 모듈
  - `shared/`: 테이블/테마 공용
  - `styles/`: 스타일 베이스
  - `views/`: 화면 렌더링 로직
- `src/gas/`: Apps Script 배포 대상 코드

## 3) 파일 단위 검토 결과

### 강점
1. **기능 경계가 디렉터리로 비교적 명확함**
   - `features/master`, `features/settings`, `features/trade` 등 업무 도메인 기반 분리가 되어 있어 탐색성이 좋습니다.
2. **품질 게이트 스크립트 분리 운영이 잘 됨**
   - DOM 계약/문법/전역 오염/인라인 핸들러 등 체크 포인트가 `scripts/`로 분리되어 유지보수에 유리합니다.
3. **웹 코드와 GAS 코드 분리**
   - `src/web` vs `src/gas` 분리가 명확해 배포 타깃 혼동 가능성이 낮습니다.

### 리스크/개선 포인트
1. **`views/` 집중도 과다**
   - `src/web/views`에 파일이 다수 몰려 있고, 일부 파일은 렌더 + 상태 + 이벤트가 혼재할 가능성이 큽니다.
   - 개선: 화면별 `render/handlers/state` 서브모듈로 분할 권장.

2. **`features/settings` 파일 수 대비 책임 경계 재점검 필요**
   - `settings.js`, `settings_sync.js`, `settings_fetch.js`, `settings_tabsync.js`, `settings_persistence_utils.js` 등은 이름상 책임이 겹칠 여지가 있습니다.
   - 개선: 데이터흐름 기준(입력/검증/저장/동기화/UI)으로 계층 문서화.

3. **엔트리포인트 이원화 확인 필요**
   - 루트 `index.html`과 `src/web/index.html`이 공존합니다.
   - 개선: 실제 배포/개발에서 어떤 파일이 canonical entry인지 `README` 또는 `DEPLOYMENT.md`에 명시.

4. **문서 인덱스 부재**
   - `docs/`에 시점별 리뷰 문서가 쌓이는 구조라면, `docs/README.md` 인덱스를 두어 최신 권고안 추적성을 높이는 것이 좋습니다.

## 4) 우선순위 액션 아이템

### P0 (즉시)
- `docs/README.md` 추가: 문서 목적/최신 리뷰 링크/적용 상태 표기
- 엔트리포인트 정책 명문화: `index.html` vs `src/web/index.html`

### P1 (다음 스프린트)
- `src/web/views`의 상위 1~2개 대형 파일을 시범 분할
- `features/settings` 호출 그래프(간단 다이어그램 or 표) 문서화
- 진행 현황(2026-04-29): `renderHistoryView`를 `views_history_render.js`로 분리 완료

### P2 (중기)
- 모듈 책임 규칙(네이밍/파일 길이 상한/의존 방향) 정의
- 신규 기능 추가 시 `features/*` 템플릿(boilerplate) 도입

## 5) 점검 커맨드 결과
- `npm run check:web`: 통과 (중복 전역 함수 정리 후 확인)

---
필요하면 다음 단계로, 폴더별 "실제 의존 관계 그래프"까지 뽑아 병목 파일 우선순위를 정량화해드리겠습니다.
