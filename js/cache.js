// 検索結果メタデータの IndexedDB キャッシュ。
// 画像そのものは Service Worker の Cache Storage 側で持つ（sw.js を参照）。

// sw.js の IMG_CACHE と同じ名前を使う（バージョンを上げるときは両方直す）
export const IMG_CACHE_NAME = 'fuukei-img-v3';

const DB_NAME = 'fuukei';
const DB_VERSION = 1;
const STORE = 'queries';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 時間

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB 非対応'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function tx(mode) {
  return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getQuery(key) {
  try {
    const store = await tx('readonly');
    const row = await wrap(store.get(key));
    if (!row) return null;
    if (Date.now() - row.ts > TTL_MS) return null;
    return row.items;
  } catch {
    return null;
  }
}

export async function putQuery(key, items) {
  try {
    const store = await tx('readwrite');
    await wrap(store.put({ key, items, ts: Date.now() }));
  } catch {
    /* 保存に失敗しても致命的ではない */
  }
}

export async function clearAll() {
  try {
    const store = await tx('readwrite');
    await wrap(store.clear());
  } catch { /* noop */ }
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('fuukei-')).map((n) => caches.delete(n)));
  }
}

/** Service Worker のキャッシュに実体がある画像を先頭に寄せる（オフライン再生用）。 */
export async function preferCached(items) {
  if (!('caches' in window) || !items.length) return items;
  try {
    const cache = await caches.open(IMG_CACHE_NAME);
    const flags = await Promise.all(
      items.map((it) => cache.match(it.src, { ignoreVary: true }).then(Boolean).catch(() => false))
    );
    const hit = items.filter((_, i) => flags[i]);
    const miss = items.filter((_, i) => !flags[i]);
    return [...hit, ...miss];
  } catch {
    return items;
  }
}

export async function usage() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage: used } = await navigator.storage.estimate();
    return used || 0;
  } catch {
    return null;
  }
}
