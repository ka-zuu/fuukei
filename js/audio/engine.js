// AudioContext・マスターゲイン・レイヤー管理。ctx に触れるのはこのファイルだけ。
// playlist.configure(settings) と同じ「設定を渡すと差分を反映する」形にそろえてある。

import { createNoiseBuffer } from './noise.js';
import { createScheduler } from './scheduler.js';
import { getSound } from './sounds.js';

const FADE_SECONDS = 1.2; // レイヤーの開始/停止フェード
const VOLUME_SMOOTH = 0.05; // スライダー操作時のランプ時定数

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function voiceStopSafe(voice, at) {
  try { voice.stop(at); } catch { /* noop */ }
}

export class AudioEngine {
  /** @param {(state: {running: boolean, blocked: boolean}) => void} [onStateChange] */
  constructor({ onStateChange } = {}) {
    this.onStateChange = onStateChange || (() => {});
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.buffers = null;
    this.scheduler = null;
    this.layers = new Map(); // id -> { gain, voice, disposeTimer }
    // ここでは AudioContext を作らない。自動再生ポリシーのため、
    // 生成とレジューム(resume)は必ずユーザー操作の中で ensureContext() を呼んで行う。
  }

  get supported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** ctx が実際に鳴っているか（AudioContext.state === 'running'）。 */
  get running() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  /** 生成済みだが自動再生ポリシー等でまだ鳴らせていない状態。 */
  get blocked() {
    return Boolean(this.ctx) && this.ctx.state !== 'running';
  }

  /**
   * AudioContext を（未生成なら）生成し、resume() を試みる。
   * 必ずユーザー操作イベントハンドラの同期的な流れの中から呼ぶこと
   * （await の前に resume() の呼び出し自体が済んでいれば iOS Safari でも解錠される）。
   */
  async ensureContext() {
    if (!this.supported) return false;

    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'playback' });
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0;

      // 複数レイヤーを重ねた際のクリッピング防止用リミッター。常時オン。
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -6;
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      this.master.connect(this.compressor).connect(ctx.destination);

      this.buffers = {
        white: createNoiseBuffer(ctx, 'white'),
        pink: createNoiseBuffer(ctx, 'pink'),
        brown: createNoiseBuffer(ctx, 'brown')
      };

      this.scheduler = createScheduler(() => ctx.currentTime);
      this.scheduler.start();

      ctx.addEventListener('statechange', () => this.onStateChange({
        running: this.running,
        blocked: this.blocked
      }));
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => { /* 自動再生ブロック。blocked ゲッターで判定できる */ });
    }
    return this.running;
  }

  /**
   * settings.audio（{ master, muted, enabled, volumes }）を反映する。
   * enabled との差分でレイヤーを開始/停止し、音量はランプで滑らかに変える。
   * ctx がまだ無ければ ensureContext() を試みる（呼び出し元はユーザー操作の中で呼ぶこと）。
   */
  async apply(settings) {
    const ok = await this.ensureContext();
    if (!ok || !this.ctx) return false;

    const wanted = new Set((settings.enabled || []).filter((id) => getSound(id)));

    for (const [id, layer] of this.layers) {
      if (!wanted.has(id)) this._stopLayer(id, layer);
    }
    for (const id of wanted) {
      if (!this.layers.has(id)) this._startLayer(id, settings.volumes?.[id]);
    }

    this._applyMaster(settings);
    for (const id of wanted) {
      const layer = this.layers.get(id);
      if (layer) this._setLayerVolume(layer, settings.volumes?.[id]);
    }
    return true;
  }

  _applyMaster(settings) {
    const target = settings.muted ? 0 : clamp01(settings.master);
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(target, now, VOLUME_SMOOTH);
  }

  _startLayer(id, volume) {
    const sound = getSound(id);
    if (!sound) return;
    const ctx = this.ctx;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);

    const voice = sound.create(ctx, { buffers: this.buffers, scheduler: this.scheduler });
    voice.output.connect(gain);

    const at = ctx.currentTime;
    voice.start(at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(clamp01(volume ?? 0.5), at + FADE_SECONDS);

    this.layers.set(id, { gain, voice, disposeTimer: null });
  }

  _setLayerVolume(layer, volume) {
    const now = this.ctx.currentTime;
    layer.gain.gain.setTargetAtTime(clamp01(volume ?? 0.5), now, VOLUME_SMOOTH);
  }

  _stopLayer(id, layer) {
    const ctx = this.ctx;
    const at = ctx.currentTime;

    layer.gain.gain.cancelScheduledValues(at);
    layer.gain.gain.setValueAtTime(layer.gain.gain.value, at);
    layer.gain.gain.linearRampToValueAtTime(0, at + FADE_SECONDS);

    voiceStopSafe(layer.voice, at + FADE_SECONDS);

    clearTimeout(layer.disposeTimer);
    layer.disposeTimer = setTimeout(() => {
      layer.voice.dispose();
      try { layer.gain.disconnect(); } catch { /* noop */ }
    }, (FADE_SECONDS + 0.2) * 1000);

    this.layers.delete(id);
  }
}
