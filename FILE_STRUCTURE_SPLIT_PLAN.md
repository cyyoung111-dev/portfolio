# 파일 구성 분석 및 기능 분할 제안

## 1) 현재 구조 진단 (요약)

현재 저장소는 기능 접두사(`core_`, `data_`, `views_`, `mgmt_`, `settings_`)로 책임을 어느 정도 구분하고 있지만, 모든 파일이 루트에 평면적으로 배치되어 있어 의존성과 변경 범위 추적이 어렵다.

특히 다음 3가지가 유지보수 비용을 키운다.

1. **뷰/도메인/인프라 코드가 같은 레벨에 혼재**
2. **초기화 엔트리(`views_misc.js`)가 광범위 이벤트 위임을 담당**
3. **Google Apps Script 백엔드(`apps_script.gs`)와 프론트엔드가 물리적으로 분리되지 않음**

---

## 2) 현재 파일 기능 분류표

| 구분 | 파일 | 현재 책임 | 분할 후 권장 위치 |
|---|---|---|---|
| HTML Shell | `index.html` | 단일 페이지 마크업 + 대량 스타일 + 스크립트 로딩 | `src/web/index.html`, 스타일은 `src/web/styles/`로 분리 |
| Core | `core_storage.js` | DOM 헬퍼, localStorage 접근, 원격 전용 키 제어 | `src/web/core/storage.js` |
| Core | `core_ui.js` | 토스트, 날짜 포맷, UI 공통 유틸 | `src/web/core/ui.js` |
| Core | `core_color.js` | 색상 변환(특히 canvas 대응) | `src/web/core/color.js` |
| Data | `data_state.js` | 전역 상태/상수/공용 저장 함수 | `src/web/domain/state/portfolioState.js` |
| Data | `data.js` | 거래 마이그레이션/동기화/집계 핵심 로직 | `src/web/domain/portfolio/portfolioService.js` |
| Settings | `settings.js` | 설정 UI/설정 상태 반영 | `src/web/features/settings/settingsView.js` |
| Settings | `settings_fetch.js` | 원격 fetch/동기화 관련 설정 처리 | `src/web/features/settings/settingsSyncService.js` |
| Settings | `settings_sync.js` | 동기화 실행/보조 유틸 | `src/web/features/settings/settingsSyncController.js` |
| Mgmt | `mgmt_acct.js` | 계좌 마스터 관리 | `src/web/features/master/account/` |
| Mgmt | `mgmt_stock.js` | 종목 마스터 관리 | `src/web/features/master/stock/` |
| Mgmt | `mgmt_sector.js` | 섹터 마스터 관리 | `src/web/features/master/sector/` |
| Mgmt | `mgmt_trade.js` | 거래 입력/수정/삭제 로직 | `src/web/features/trade/editor/tradeCrud.js` |
| Mgmt | `mgmt_div.js` | 배당 설정 관리 | `src/web/features/dividend/` |
| Mgmt | `mgmt_bulk.js` | 대량 입력/업로드 처리 | `src/web/features/import/` |
| Mgmt | `mgmt_editor.js` | 편집기 오버레이/폼 바인딩 | `src/web/features/editor/overlay/` |
| Mgmt | `mgmt_migration.js` | 데이터 마이그레이션 실행 | `src/web/domain/migration/` |
| Views | `views_system.js` | 탭/라우팅/요약/입출력 제어 | `src/web/app/router.js`, `src/web/app/summary.js`로 분리 |
| Views | `views_misc.js` | DOMContentLoaded 초기화 + 전역 이벤트 위임 | `src/web/app/bootstrap.js`, `src/web/app/eventDelegation.js` |
| Views | `views_portfolio.js` | 계좌/섹터/종목 뷰 렌더링 | `src/web/features/portfolio/views/` |
| Views | `views_table.js` | 표 렌더링 본체 | `src/web/shared/table/tableRenderer.js` |
| Views | `views_table_state.js` | 표 상태/정렬/필터 상태 저장 | `src/web/shared/table/tableState.js` |
| Views | `views_table_filters.js` | 표 필터 드롭다운/정렬 제어 | `src/web/shared/table/tableFilterController.js` |
| Views | `views_trades.js` | 거래 이력 테이블/요약 렌더링 | `src/web/features/trade/views/tradeHistoryView.js` |
| Views | `views_tradegroup.js` | 종목별 거래 그룹 뷰 | `src/web/features/trade/views/tradeGroupView.js` |
| Views | `views_history.js` | 히스토리 차트/테이블 | `src/web/features/history/` |
| Views | `views_asset.js` | 자산 관련 뷰 | `src/web/features/asset/views/` |
| Views | `views_asset_loan.js` | 대출 자산 뷰 | `src/web/features/asset/views/loanAssetView.js` |
| Views | `views_div_asset.js` | 배당 자산 뷰 | `src/web/features/dividend/views/dividendAssetView.js` |
| Infra | `theme.js` | 테마 관련 처리 | `src/web/shared/theme/themeController.js` |
| Backend Script | `apps_script.gs` | GSheet API/배치/백필/설정 저장 | `src/gas/apps_script.gs` |

---

## 3) 목표 디렉터리 구조(안)

```text
src/
  web/
    app/
      bootstrap.js
      router.js
      eventDelegation.js
      summary.js
    core/
      storage.js
      ui.js
      color.js
    domain/
      state/
        portfolioState.js
      portfolio/
        portfolioService.js
      migration/
        migrationService.js
    shared/
      table/
        tableRenderer.js
        tableState.js
        tableFilterController.js
      theme/
        themeController.js
    features/
      portfolio/
        views/
      trade/
        views/
        editor/
      master/
        account/
        stock/
        sector/
      settings/
      history/
      asset/
      dividend/
      import/
      editor/
    styles/
      base.css
      components.css
      views.css
    index.html
  gas/
    apps_script.gs
```

---

## 4) 기능 분할 우선순위 (실행 순서)

| 단계 | 목표 | 작업 | 기대 효과 |
|---|---|---|---|
| 1 | 안전한 분리 기반 확보 | 파일 이동 전 `bootstrap/router/table` 경계 정의 | 리팩터링 중 회귀 최소화 |
| 2 | 공통 테이블 모듈 고정 | `views_table*` 3종을 `shared/table`로 이동 | 뷰별 중복 감소 |
| 3 | 도메인 로직 분리 | `data.js`를 `portfolioService`, `state`와 분리 | 테스트 용이성 향상 |
| 4 | 기능 단위 슬라이싱 | `mgmt_*`, `views_*`를 feature 폴더별 재배치 | 변경 영향 범위 축소 |
| 5 | 인프라 경계 분리 | `apps_script.gs`를 `src/gas`로 분리 | 프론트/백엔드 책임 명확화 |
| 6 | 스타일 분리 | `index.html` 인라인 스타일 파일화 | 가독성/협업성 향상 |

---

## 5) 권장 모듈 경계 원칙

| 원칙 | 설명 |
|---|---|
| 단방향 의존 | `app -> features -> domain -> core` 방향으로만 참조 |
| 상태 단일 소스 | 전역 상태는 `domain/state`에서만 변경 |
| 렌더와 계산 분리 | View 함수는 렌더링만, 계산은 domain/service로 이동 |
| 원격 I/O 집중 | GSheet/네트워크 호출은 `settingsSyncService` 등 인프라 계층으로 집중 |
| 이벤트 위임 최소화 | 전역 이벤트는 bootstrap에서 등록하고 기능별 핸들러로 라우팅 |

---

## 6) 즉시 적용 가능한 최소 분할(MVP)

1. `views_misc.js`를 `bootstrap.js`와 `eventDelegation.js`로 1차 분리
2. `views_table.js`, `views_table_state.js`, `views_table_filters.js`를 `shared/table`로 이동
3. `data.js`의 계산 함수(`calc*`, `sync*`)부터 `portfolioService.js`로 이동
4. `index.html`의 CSS를 `styles/base.css`로 우선 추출

이 4단계만 완료해도 코드 탐색성과 충돌 해소 속도가 크게 개선된다.

---

## 7) 변경 전/후 수량 비교 (질문 대응)

질문하신 "기존 파일 구성에서 어떻게 바뀌는지"를 **수량 기준**으로 요약하면 아래와 같다.

### A. 루트(root) 기준

| 항목 | 변경 전(현재) | 변경 후(목표) | 증감 |
|---|---:|---:|---:|
| 루트의 실행 코드 파일(`.js/.gs/.html`) | 31개 (JS 29 + GS 1 + HTML 1) | 0개 (모두 `src/` 하위로 이동) | **-31** |
| 루트 문서 파일(`.md`) | 1개 | 1개+ (문서 정책에 따라 유지) | 유지/소폭 증가 |

> 즉, 코드 파일은 "루트 평면 구조"에서 "src 하위 계층 구조"로 완전히 이동하는 것이 핵심이다.

### B. 기능군 기준(현재 → 목표)

| 기능군 | 현재 파일 수 | 목표 구조 | 비고 |
|---|---:|---|---|
| Core (`core_*`) | 3 | `src/web/core/` | 수량 유지, 위치만 이동 |
| Data (`data*`) | 2 | `src/web/domain/state`, `src/web/domain/portfolio` | 책임 분리로 파일 소폭 증가 가능 |
| Settings (`settings*`) | 3 | `src/web/features/settings/` | 수량 유지 또는 서비스 분리 시 +1~2 |
| Mgmt (`mgmt_*`) | 8 | `src/web/features/master|trade|import|editor|dividend` | 기능별 폴더 분산 |
| Views (`views_*`) | 12 | `src/web/features/*/views`, 일부는 `src/web/app`, `src/web/shared/table` | 공통/기능뷰로 재분배 |
| Theme | 1 | `src/web/shared/theme/` | 이동 |
| GAS | 1 | `src/gas/` | 이동 |
| HTML | 1 | `src/web/index.html` | 이동 |

### C. 디렉터리 수(대략)

| 항목 | 변경 전 | 변경 후(안) |
|---|---:|---:|
| 코드 디렉터리(실질) | 0~1개 수준(루트 집중) | 약 20개 내외(`app/core/domain/shared/features/...`) |

- 파일 개수 자체를 크게 줄이는 리팩터링이 아니라,
- **동일/유사 수량의 파일을 책임별 디렉터리로 재배치**하여 탐색성과 충돌 범위를 줄이는 전략이다.

---

## 8) 현재 진행 상태 (끝났는지 여부)

결론부터 말하면 **전체 분할은 아직 미완료**다.

현재는 MVP 4단계 중 아래 상태다.

| 항목 | 상태 | 근거 |
|---|---|---|
| `views_misc.js` 역할 분리 (`bootstrap` / `eventDelegation`) | ✅ 완료 | `app_bootstrap.js`, `app_event_delegation.js`로 분리 완료 |
| `views_table*`를 `shared/table` 성격으로 분리 | ✅ 완료 | `shared/table/views_table*.js`로 물리 이동 완료 |
| `data.js` 계산/도메인 서비스 분리 | ✅ 완료(1차) | `calcRealizedPnl`, `_getFilteredTrades`, `syncHoldingsFromTrades`, `computeRows`, `recomputeRows`를 `domain/portfolio/portfolio_service.js`로 이동 |
| `index.html` CSS 외부 파일화 | ✅ 완료(1차) | 인라인 CSS를 `styles/base.css`로 추출 완료 |

### 실무 판단 가이드

- **\"지금 운영 가능한가?\"** → 네. 초기화/이벤트 분리까지는 적용됨.
- **\"분할 작업 다 끝났나?\"** → MVP 기준으로는 대부분 완료. 전체 구조 개편 기준으로는 약 **85~90% 진행**으로 보는 게 정확함.
- **\"다음 우선순위\"** → 배포 환경별 document root를 `src/web`로 반영하고, 검증 완료 후 루트 `index.html` 리다이렉트 제거 여부 최종 결정.

---

## 9) 최종 판단 (분할 작업 끝났는가?)

### 현재 결론
- **코드/폴더 분할 작업은 사실상 완료(구조 리팩터링 완료 단계)**  
- **운영 전환 작업은 일부 남음(배포 설정 확정 단계)**

| 구분 | 상태 | 비고 |
|---|---|---|
| 파일 물리 이동 (`src/web`, `src/gas`) | ✅ 완료 | 주요 소스 이동 완료 |
| 기능 경계 분리 (`app/core/domain/shared/features/views`) | ✅ 완료(1차) | 서비스/초기화 분리 적용 |
| 스타일 외부화 (`styles/base.css`) | ✅ 완료 | 인라인 대량 스타일 분리 |
| 루트 리다이렉트 제거 | ⚠️ 보류 | 배포 루트 전환 검증 후 결정 |
| 배포 환경 document root 확정 | ⚠️ 진행 필요 | `src/web` 직접 서빙 최종 반영 필요 |
