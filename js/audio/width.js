// マスター段のステレオ幅ステージ（Mid/Side）。
//
// input(2ch) → splitter → mid = (L+R)/2, side = (L-R)/2
//   mid  はそのまま両chへ
//   side は +w / -w で左右へ戻す（w=0 で side が消えて完全モノラル、w=1 で入力そのまま）
// → merger → output(2ch)
//
// ノード数・接続は生成時に固定。可変なのは side 側 2 本の GainNode の値だけなので、
// スライダー操作のたびにグラフを組み替える必要はない。

export function createWidthStage(ctx) {
  const input = ctx.createChannelSplitter(2);
  const output = ctx.createChannelMerger(2);

  const midL = ctx.createGain();
  midL.gain.value = 0.5;
  const midR = ctx.createGain();
  midR.gain.value = 0.5;

  const sideL = ctx.createGain();
  sideL.gain.value = 0.5;
  const sideR = ctx.createGain();
  sideR.gain.value = -0.5;

  const sideW = ctx.createGain(); // 左出力へ +w
  sideW.gain.value = 0;
  const sideWInv = ctx.createGain(); // 右出力へ -w
  sideWInv.gain.value = 0;

  // mid = 0.5*L + 0.5*R。両chの出力に均等に足す
  input.connect(midL, 0);
  input.connect(midR, 1);
  midL.connect(output, 0, 0);
  midL.connect(output, 0, 1);
  midR.connect(output, 0, 0);
  midR.connect(output, 0, 1);

  // side = 0.5*L - 0.5*R。w倍して左に、-w倍して右に足す
  input.connect(sideL, 0);
  input.connect(sideR, 1);
  sideL.connect(sideW);
  sideR.connect(sideW);
  sideL.connect(sideWInv);
  sideR.connect(sideWInv);
  sideW.connect(output, 0, 0);
  sideWInv.connect(output, 0, 1);

  return {
    input,
    output,
    /** w: 0(モノラル)〜1(元のステレオ幅)。at/smooth 省略時は即値変更。 */
    setWidth(w, at, smooth) {
      const clamped = Math.min(1, Math.max(0, w));
      if (at == null || !smooth) {
        sideW.gain.value = clamped;
        sideWInv.gain.value = -clamped;
        return;
      }
      sideW.gain.setTargetAtTime(clamped, at, smooth);
      sideWInv.gain.setTargetAtTime(-clamped, at, smooth);
    }
  };
}
