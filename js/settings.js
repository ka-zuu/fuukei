// 設定の永続化。API キーは localStorage のみに置き、外部へは送らない。

const KEY = 'fuukei.settings.v1';

export const DEFAULTS = {
  category: 'mountain',
  labels: [],
  modifiers: [],
  source: 'commons',      // commons | openverse | ai
  interval: 300,          // 秒（既定 5 分。範囲は 1〜60 分）
  kenburns: true,
  clock: false,
  credit: true,
  wakeLock: true,
  allowPortrait: false,
  quality: 'auto',        // auto | 1600 | 2560 | 3840
  hqOnly: true,
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

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    const merged = { ...structuredClone(DEFAULTS), ...saved, ai: { ...DEFAULTS.ai, ...(saved.ai || {}) } };
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
