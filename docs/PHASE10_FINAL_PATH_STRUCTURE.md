# 10차 진행: 최종 경로 구조 고정

이 문서는 `src/web/index.html` 기준으로 실제 로딩되는 스크립트 경로를 기준선으로 정리한다.

## 1) 최종 로딩 기준 (defer scripts)

### Core / Shared
1. `core/core_storage.js`
2. `core/core_log.js`
3. `shared/theme.js`
4. `core/core_ui.js`
5. `core/core_color.js`
6. `domain/state/data_state.js`
7. `domain/portfolio/portfolio_service.js`
8. `domain/portfolio/data.js`
9. `shared/table/views_table_state.js`
10. `shared/table/views_table_filters.js`
11. `shared/table/views_table.js`

### Views
12. `views/views_portfolio.js`
13. `views/views_trades.js`
14. `views/views_tradegroup.js`
15. `views/views_div_asset.js`
16. `views/views_asset_loan.js`
17. `views/views_asset.js`
18. `views/views_history_legacy_guard.js`
19. `views/views_history_utils.js`
20. `views/views_history.js`
21. `views/views_system.js`

### Features
22. `features/settings/settings_net.js`
23. `features/settings/settings_persistence_utils.js`
24. `features/settings/settings.js`
25. `features/settings/settings_sync.js`
26. `features/settings/settings_tabsync.js`
27. `features/settings/settings_fetch.js`
28. `features/management/mgmt_editor.js`
29. `features/master/account/mgmt_acct.js`
30. `features/dividend/mgmt_div.js`
31. `features/master/stock/mgmt_stock.js`
32. `features/master/sector/mgmt_sector.js`
33. `features/trade/editor/mgmt_trade.js`
34. `features/import/mgmt_bulk.js`

### App
35. `domain/migration/mgmt_migration.js`
36. `app/event_delegation.js`
37. `app/bootstrap.js`

> 참고: 위 순서는 `src/web/script-manifest.json` 및 `scripts/check-web-manifest.mjs`로 CI 고정된다.

## 2) 중복 경로 정리 결과
- history 관련 레거시 중복 경로(`src/web/features/history/views_history*.js`)는 제거 완료.
- history 렌더링 경로는 `src/web/views/views_history*.js` 계열로 단일화.
- editor는 현재 `src/web/features/management/mgmt_editor.js`를 `index.html`이 직접 include하므로 유지.

## 3) 변경 시 운영 규칙
- `index.html`의 로컬 defer script 경로/순서를 변경하면 반드시 아래를 함께 갱신:
  1. `src/web/script-manifest.json`
  2. 필요한 경우 관련 문서(본 문서 포함)
- PR에는 include 변경 이유와 영향 범위를 명시.
- 머지 전 `npm run check:web:ci` 통과를 필수로 유지.
