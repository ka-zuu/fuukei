// スリープ / スクリーンセーバーの抑制。
// 第一手段は Screen Wake Lock API。非対応ブラウザ向けに、
// 無音のごく小さなループ動画を再生し続けるフォールバックを持つ。

let fallbackBlob = null;

export class WakeGuard {
  /** @param {(state: {active: boolean, method: string}) => void} [onChange] */
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.desired = false;
    this.sentinel = null;
    this.video = null;
    this.method = 'none';
    this._onVisibility = () => {
      if (this.desired && document.visibilityState === 'visible' && !this.sentinel) {
        this._requestLock().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  get active() {
    return Boolean(this.sentinel) || Boolean(this.video && !this.video.paused);
  }

  get supported() {
    return 'wakeLock' in navigator || typeof MediaRecorder !== 'undefined';
  }

  async enable() {
    this.desired = true;
    if ('wakeLock' in navigator) {
      try {
        await this._requestLock();
        return this.method;
      } catch { /* 権限拒否やフォーカス外。フォールバックへ */ }
    }
    await this._startVideo();
    return this.method;
  }

  async disable() {
    this.desired = false;
    if (this.sentinel) {
      try { await this.sentinel.release(); } catch { /* noop */ }
      this.sentinel = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }
    this.method = 'none';
    this.onChange({ active: false, method: 'none' });
  }

  destroy() {
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.disable();
  }

  async _requestLock() {
    const sentinel = await navigator.wakeLock.request('screen');
    this.sentinel = sentinel;
    this.method = 'wakelock';
    sentinel.addEventListener('release', () => {
      if (this.sentinel === sentinel) this.sentinel = null;
      this.onChange({ active: this.active, method: this.method });
    });
    this.onChange({ active: true, method: 'wakelock' });
  }

  async _startVideo() {
    try {
      const blob = await getFallbackVideo();
      if (!blob) throw new Error('生成できません');
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0.01;left:0;bottom:0;pointer-events:none;';
      video.src = URL.createObjectURL(blob);
      document.body.appendChild(video);
      await video.play();
      this.video = video;
      this.method = 'video';
      this.onChange({ active: true, method: 'video' });
    } catch {
      this.method = 'none';
      this.onChange({ active: false, method: 'none' });
    }
  }
}

/** キャンバスから 1 秒ほどの無音動画をその場で作る（外部ファイル不要）。 */
async function getFallbackVideo() {
  if (fallbackBlob) return fallbackBlob;
  if (typeof MediaRecorder === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(10);
  const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(
    (m) => MediaRecorder.isTypeSupported?.(m)
  );
  if (!mime) return null;

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#000' : '#010101';
    ctx.fillRect(0, 0, 2, 2);
    await new Promise((r) => setTimeout(r, 50));
  }
  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());

  fallbackBlob = chunks.length ? new Blob(chunks, { type: mime }) : null;
  return fallbackBlob;
}
