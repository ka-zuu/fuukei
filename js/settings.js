// 設定の永続化。API キーは localStorage のみに置き、外部へは送らない。

import { SOUNDS } from './audio/sounds.js';

const KEY = 'fuukei.settings.v1';
const SOUND_IDS = SOUNDS.map((s) => s.id);

export const DEFAULTS = {
  category: 'mountain',
  labels: [],
  modifiers: [],
  source: 'commons',      // commons | openverse | ai
  interval: 300,          // 秒（既定 5 分。範囲は 1〜60 分）
  kenburns: true,
  clock: false,
  clockPosition: 'center',   // center | top-left | top-right | bottom-left | bottom-right
  credit: true,
  wakeLock: true,
  allowPortrait: false,
  quality: 'auto',        // auto | 1600 | 2560 | 3840
  hqOnly: true,
  audio: {
    master: 0.6,
    muted: false,
    enabled: [],          // 鳴らす環境音の id（例: ['rain', 'fire']）。複数可
    volumes: Object.fromEntries(SOUND_IDS.map((id) => [id, 0.5]))
  },
  ai: {
    provider: 'google-imagen',
    model: '',
    key: '',
    style: 'photo',
    extra: ''
  }
};

export const AI_DEFAULT_MODELS = {
  'google-imagen': 'imagen-4.0-generate-001',
  'google-gemini': 'gemini-2.5-flash-image',
  openai: 'gpt-image-1'
};

const INTERVAL_MIN = 60;
const INTERVAL_MAX = 3600;

/** 0〜1 にクランプする。数値化できなければ fallback を返す。 */
export function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * audio は ai と同様に入れ子オブジェクトなので、load() の `...saved` に任せると
 * 保存済みの部分オブジェクトで丸ごと上書きされ、欠けたキーの既定値が消えてしまう。
 * volumes はさらに一段深いので個別にマージし、未知の音源 id は破棄する
 * （将来 音源を増減・改名しても古い保存値で壊れないように）。
 */
function mergeAudio(saved) {
  const src = (saved && typeof saved === 'object') ? saved : {};
  const enabled = Array.isArray(src.enabled)
    ? [...new Set(src.enabled.filter((id) => SOUND_IDS.includes(id)))]
    : [];
  const volumes = { ...DEFAULTS.audio.volumes };
  if (src.volumes && typeof src.volumes === 'object') {
    for (const id of SOUND_IDS) {
      if (id in src.volumes) volumes[id] = clamp01(src.volumes[id], DEFAULTS.audio.volumes[id]);
    }
  }
  return {
    master: clamp01(src.master, DEFAULTS.audio.master),
    muted: Boolean(src.muted),
    enabled,
    volumes
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    const merged = {
      ...structuredClone(DEFAULTS),
      ...saved,
      ai: { ...DEFAULTS.ai, ...(saved.ai || {}) },
      audio: mergeAudio(saved.audio)
    };
    // 旧バージョン（最短5秒）の保存値を新しい範囲(1〜60分)に収める
    merged.interval = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, merged.interval || DEFAULTS.interval));
    return merged;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* プライベートモード等では保存できないが動作は継続する */
  }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  return structuredClone(DEFAULTS);
}

/** 画面サイズと DPR から実際に要求するピクセル幅を決める。 */
export function resolveWidth(quality) {
  if (quality !== 'auto') return Number(quality);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(Math.max(screen.width, window.innerWidth) * dpr);
  if (w <= 1400) return 1600;
  if (w <= 2200) return 2560;
  return 3840;
}
