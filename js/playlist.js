// 表示キューの管理。
//
// 「都度取得」の設計：
//   1. メタデータ（検索結果）は取得のたびに IndexedDB へ 24 時間キャッシュする
//   2. 画像バイナリは Service Worker が上限付き LRU でキャッシュする（sw.js）
//   3. 常に数枚先まで先読み・デコードしておき、切り替えを瞬時にする
//   4. 通信できないときは蓄積した「プール」から再生を続ける（オフライン動作）
// これで毎回新鮮な画像を取りつつ、通信量と待ち時間を抑えられる。

import * as commons from './sources/commons.js';
import * as openverse from './sources/openverse.js';
import * as ai from './sources/ai.js';
import { getQuery, putQuery, preferCached } from './cache.js';
import { buildQueries, buildAiPrompt, AI_STYLES } from './categories.js';
import { resolveWidth, AI_DEFAULT_MODELS } from './settings.js';

const SOURCES = { commons, openverse };
const BUFFER_MIN = 4;      // これを下回ったら補充
const HISTORY_MAX = 60;
const SEEN_MAX = 600;
const POOL_MAX = 150;

export class Playlist {
  /** @param {(msg: string, kind?: string) => void} onStatus */
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.settings = null;
    this.signature = '';
    this.queries = [];
    this.buffer = [];
    this.history = [];
    this.pos = -1;
    this.seen = new Set();
    this.offsets = new Map();
    this.rr = 0;
    this.filling = null;
    this.exhausted = false;
  }

  /** 設定変更を反映する。検索条件が変わったらキューを捨てて組み直す。 */
  configure(settings) {
    this.settings = settings;
    const width = resolveWidth(settings.quality);
    const sig = [
      settings.source,
      settings.category,
      settings.labels.slice().sort().join(','),
      settings.modifiers.slice().sort().join(','),
      width,
      settings.hqOnly,
      settings.allowPortrait,
      settings.source === 'ai' ? [settings.ai.provider, settings.ai.model, settings.ai.style, settings.ai.extra].join('|') : ''
    ].join('/');

    this.width = width;
    this.minWidth = settings.hqOnly ? 1920 : 0;
    this.queries = buildQueries(settings.category, settings.labels, settings.modifiers);

    if (sig !== this.signature) {
      this.signature = sig;
      this.releaseAll();
      this.buffer = [];
      this.history = [];
      this.pos = -1;
      this.seen.clear();
      this.offsets.clear();
      this.rr = 0;
      this.exhausted = false;
      return true;
    }
    return false;
  }

  get current() {
    return this.history[this.pos] || null;
  }

  get canGoBack() {
    return this.pos > 0;
  }

  /** 次の画像を返す。履歴を戻っている最中は履歴を前進する。 */
  async next() {
    if (this.pos < this.history.length - 1) {
      this.pos += 1;
      this.prefetch();
      return this.current;
    }
    if (!this.buffer.length) await this.fill();
    const item = this.buffer.shift();
    if (!item) return null;

    this.history.push(item);
    if (this.history.length > HISTORY_MAX) this.release(this.history.shift());
    this.pos = this.history.length - 1;

    if (this.buffer.length < BUFFER_MIN) this.fill().catch(() => {});
    this.prefetch();
    return item;
  }

  prev() {
    if (!this.canGoBack) return null;
    this.pos -= 1;
    return this.current;
  }

  /** 読み込みに失敗した画像を捨てる。 */
  drop(item) {
    this.history = this.history.filter((h) => h !== item);
    this.pos = Math.min(this.pos, this.history.length - 1);
    this.release(item);
  }

  async fill() {
    if (this.filling) return this.filling;
    this.filling = this._fill().finally(() => { this.filling = null; });
    return this.filling;
  }

  async _fill() {
    if (this.settings.source === 'ai') return this._fillAi();

    const src = SOURCES[this.settings.source] || commons;
    const query = this.queries[this.rr++ % this.queries.length];
    const offset = this.offsets.get(query.key) ?? 0;
    const base = `${this.settings.source}|${query.key}|w${this.width}|m${this.minWidth}|p${this.settings.allowPortrait ? 1 : 0}`;
    const cacheKey = `${base}|o${offset}`;

    let page = await getQuery(cacheKey);
    if (!page) {
      try {
        page = await src.fetchPage({
          terms: query.terms,
          width: this.width,
          minWidth: this.minWidth,
          allowPortrait: this.settings.allowPortrait,
          offset
        });
        putQuery(cacheKey, page);
        this.mergePool(base, page.items);
      } catch (err) {
        const pool = await getQuery(`pool|${base}`);
        if (pool?.length) {
          this.onStatus('オフラインのためキャッシュから表示しています', 'warn');
          page = { items: shuffle(pool.slice()), nextOffset: 0 };
        } else {
          throw err;
        }
      }
    }

    this.offsets.set(query.key, page.nextOffset || 0);

    let fresh = shuffle(page.items.filter((it) => !this.seen.has(it.id)));
    // オフラインでは実体がキャッシュにある画像から先に出す
    if (!navigator.onLine) fresh = await preferCached(fresh);
    for (const it of fresh) {
      this.seen.add(it.id);
      it.queryLabel = query.label;
    }
    if (this.seen.size > SEEN_MAX) this.seen.clear();

    if (!fresh.length) {
      // 同じ検索を掘り尽くした場合はオフセットを飛ばして再挑戦する余地を残す
      this.exhausted = this.queries.length === 1;
      if (this.exhausted) this.seen.clear();
    }
    this.buffer.push(...fresh);
  }

  async _fillAi() {
    const { ai: cfg } = this.settings;
    const style = AI_STYLES.find((s) => s.id === cfg.style) || AI_STYLES[0];
    const prompt = buildAiPrompt(this.settings.category, this.settings.labels, this.settings.modifiers, style.prompt, cfg.extra);
    this.onStatus('AI が風景を生成しています…');
    const item = await ai.generate({
      provider: cfg.provider,
      model: cfg.model || AI_DEFAULT_MODELS[cfg.provider],
      key: cfg.key,
      prompt
    });
    item.queryLabel = 'AI 生成';
    this.buffer.push(item);
  }

  async mergePool(base, items) {
    if (!items.length) return;
    const key = `pool|${base}`;
    const existing = (await getQuery(key)) || [];
    const map = new Map(existing.map((it) => [it.id, it]));
    for (const it of items) map.set(it.id, it);
    putQuery(key, [...map.values()].slice(-POOL_MAX));
  }

  /** 先読み。デコードまで済ませておくと切り替えが引っかからない。 */
  prefetch() {
    for (const item of this.buffer.slice(0, 2)) {
      if (item.preloaded) continue;
      item.preloaded = true;
      const img = new Image();
      img.decoding = 'async';
      img.src = item.src;
      img.decode?.().catch(() => {});
    }
  }

  release(item) {
    if (item?.revoke && item.src.startsWith('blob:')) URL.revokeObjectURL(item.src);
  }

  releaseAll() {
    [...this.history, ...this.buffer].forEach((it) => this.release(it));
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
