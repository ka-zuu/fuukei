// Service Worker: アプリシェルのオフライン化と、画像の上限つきキャッシュ。

const VERSION = 'v3';
const APP_CACHE = `fuukei-app-${VERSION}`;
const IMG_CACHE = `fuukei-img-${VERSION}`;
const IMG_MAX_ENTRIES = 120;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/categories.js',
  './js/settings.js',
  './js/cache.js',
  './js/playlist.js',
  './js/viewer.js',
  './js/wakelock.js',
  './js/fullscreen.js',
  './js/audio/engine.js',
  './js/audio/noise.js',
  './js/audio/scheduler.js',
  './js/audio/sounds.js',
  './js/audio/width.js',
  './js/sources/commons.js',
  './js/sources/openverse.js',
  './js/sources/ai.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

// 画像として扱ってキャッシュするホスト
const IMAGE_HOSTS = [
  'upload.wikimedia.org',
  'commons.wikimedia.org' // Special:FilePath 経由のリダイレクト
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('fuukei-') && n !== APP_CACHE && n !== IMG_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API 応答と AI 生成はキャッシュしない（メタデータは IndexedDB 側で管理）
  if (url.pathname.endsWith('/w/api.php') || url.hostname === 'api.openverse.org'
      || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('openai.com')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.destination === 'image' && IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(imageCacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    const cache = await caches.open(APP_CACHE);
    cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request) || await caches.match('./index.html');
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.status === 200) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function imageCacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const res = await fetch(request);
  // 不透明応答(status 0)も表示には使えるので保存対象に含める
  if (res && (res.status === 200 || res.status === 0)) {
    await cache.put(request, res.clone());
    trim(cache);
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys(); // 挿入順
  const excess = keys.length - IMG_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}
