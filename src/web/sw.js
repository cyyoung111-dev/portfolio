// ════════════════════════════════════════════════════════════════
//  sw.js — 서비스워커 (PWA 오프라인 캐싱)
//  정적 파일 배포 시 CACHE_NAME과 PRECACHE_URLS의 쿼리 버전을 함께 올립니다.
// ════════════════════════════════════════════════════════════════
const CACHE_NAME = 'portfolio-cache-20260904-9';

// 오프라인에서도 최소한 앱 껍데기는 뜨도록 미리 저장해둘 파일들
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './styles/tokens.css?v=20260903-1',
  './styles/base.css?v=20260903-1',
  './styles/components.css?v=20260903-1',
  './styles/layout.css?v=20260904-5',
  './styles/responsive.css?v=20260903-1',
  './styles/pages/plan.css?v=20260903-1',
  './styles/pages/dividend.css?v=20260903-1',
  './styles/pages/asset.css?v=20260903-1',
  './styles/pages/history.css?v=20260904-4',
  './styles/pages/trade.css?v=20260903-1',
  './shared/theme.js?v=20260903-1',
  './domain/portfolio/data.js?v=20260903-1',
  './domain/plan/plan_calculations.js?v=20260903-1',
  './views/views_asset.js?v=20260903-1',
  './views/views_portfolio.js?v=20260903-1',
  './views/views_div_asset.js?v=20260904-1',
  './views/views_plan.js?v=20260903-1',
  './views/views_plan_overview.js?v=20260903-1',
  './views/views_plan_export.js?v=20260903-1',
  './views/views_plan_weights.js?v=20260903-1',
  './views/views_plan_tax.js?v=20260903-1',
  './views/views_plan_retirement.js?v=20260903-1',
  './views/views_plan_simulation.js?v=20260903-1',
  './views/views_asset_schedule_data.js?v=20260903-1',
  './views/views_system.js?v=20260903-1',
  './features/settings/settings.js?v=20260903-1',
  './features/settings/settings_fetch.js?v=20260904-2',
  './features/management/mgmt_editor.js?v=20260903-1',
  './features/dividend/mgmt_div.js?v=20260903-1',
  './views/views_history_benchmark.js?v=20260903-1',
  './views/views_history_utils.js?v=20260904-2',
  './views/views_history_state.js?v=20260904-4',
  './views/views_history_pipeline.js?v=20260904-5',
  './views/views_history_render.js?v=20260904-1',
  './views/views_history.js?v=20260904-6',
  './app/event_delegation.js?v=20260904-1',
];

// 설치 시: 기본 파일 미리 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// 활성화 시: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 요청 가로채기: 네트워크 우선, 실패하면 캐시 사용 (구글시트 API 요청은 캐싱하지 않음)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // GET 요청만 캐싱합니다. POST/PUT 같은 쓰기 요청을 캐시에 넣으면 저장/동기화가 꼬일 수 있습니다.
  if (request.method !== 'GET') {
    return;
  }

  // 같은 출처의 정적 리소스만 캐싱합니다. GAS/외부 API 응답은 항상 네트워크로만 처리합니다.
  if (url.origin !== self.location.origin || url.hostname === 'script.google.com') {
    return;
  }

  event.respondWith(
    // HTTP 캐시도 우회해 재접속 시 배포된 최신 응답을 우선 확인한다.
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        // 실패/리다이렉트/opaque 응답은 캐시하지 않아 오프라인 캐시 오염을 줄입니다.
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패(오프라인) 시 캐시에서 꺼내기
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
  );
});
