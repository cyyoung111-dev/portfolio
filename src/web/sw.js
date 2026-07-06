// ════════════════════════════════════════════════════════════════
//  sw.js — 서비스워커 (PWA 오프라인 캐싱)
//  캐시 버전을 올리면(예: v2, v3) 브라우저가 자동으로 새 파일을 받습니다.
//  파일을 대량 수정해서 배포할 때는 CACHE_NAME 뒤 숫자만 바꿔주세요.
// ════════════════════════════════════════════════════════════════
const CACHE_NAME = 'portfolio-cache-v1';

// 오프라인에서도 최소한 앱 껍데기는 뜨도록 미리 저장해둘 파일들
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
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
  const url = event.request.url;

  // GAS(구글 앱스크립트) API 요청은 항상 네트워크로만 — 캐싱하면 오래된 가격이 보일 수 있음
  if (url.includes('script.google.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공하면 캐시도 최신화
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // 네트워크 실패(오프라인) 시 캐시에서 꺼내기
        return caches.match(event.request);
      })
  );
});
