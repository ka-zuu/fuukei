// 2 枚のレイヤーを交互に使ったクロスフェード表示と Ken Burns 効果。

export class Viewer {
  constructor(stage) {
    this.layers = [...stage.querySelectorAll('.layer')];
    this.active = -1;
    this.token = 0;
  }

  /**
   * @param {object} item
   * @param {{kenburns: boolean, duration: number}} opts duration は秒
   * @returns {Promise<void>} 読み込み完了時に解決、失敗時に reject
   */
  show(item, { kenburns, duration }) {
    const token = ++this.token;
    const nextIndex = this.active === 0 ? 1 : 0;
    const next = this.layers[nextIndex];
    const prev = this.layers[this.active] || null;

    return new Promise((resolve, reject) => {
      const cleanup = () => { next.onload = null; next.onerror = null; };

      next.onload = () => {
        cleanup();
        if (token !== this.token) return resolve(); // 追い越された
        this.#applyKenBurns(next, kenburns, duration);
        next.classList.add('visible');
        if (prev) prev.classList.remove('visible');
        this.active = nextIndex;
        resolve();
      };
      next.onerror = () => {
        cleanup();
        reject(new Error('画像を読み込めませんでした'));
      };

      next.classList.remove('kenburns');
      next.alt = item.title || '';
      next.src = item.src;
      if (next.complete && next.naturalWidth) next.onload();
    });
  }

  #applyKenBurns(layer, enabled, duration) {
    layer.classList.remove('kenburns');
    if (!enabled) {
      layer.style.removeProperty('--kb-duration');
      return;
    }
    const drift = () => `${(Math.random() * 4 - 2).toFixed(2)}%`;
    layer.style.setProperty('--kb-duration', `${Math.max(8, duration + 4)}s`);
    layer.style.setProperty('--kb-x0', drift());
    layer.style.setProperty('--kb-y0', drift());
    layer.style.setProperty('--kb-x1', drift());
    layer.style.setProperty('--kb-y1', drift());
    void layer.offsetWidth; // アニメーションを再開させるためのリフロー
    layer.classList.add('kenburns');
  }
}
