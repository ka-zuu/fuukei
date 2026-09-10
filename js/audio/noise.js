// ノイズ生成。AudioContext に触れるのは createNoiseBuffer だけで、
// それ以外は純関数にしてある（jsdom でもテストできるように）。

/** Float32Array をホワイトノイズ（-1〜1、全帯域均等）で埋める。 */
export function fillWhite(out, rng = Math.random) {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
}

/**
 * Paul Kellet の近似フィルタでピンクノイズを生成する（-1〜1 目安に正規化）。
 * バッファ充填時に一度だけ計算するので、再生時のコストはゼロ。
 * 雨・風・波のように「耳に柔らかい」ノイズが欲しい場面の基本形。
 */
export function fillPink(out, rng = Math.random) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

/**
 * ブラウンノイズ（積分＋リーク）。低域主体で、川の底鳴りや焚き火の胴鳴りに使う。
 * 単純積分だと直流に発散するので、わずかなリーク係数で 0 付近に留める。
 */
export function fillBrown(out, rng = Math.random) {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rng() * 2 - 1;
    last = (last + w * 0.02) * 0.998;
    out[i] = last * 3.5; // 積分で小さくなる分を持ち上げて他のノイズと音量を揃える
  }
}

const FILLERS = { white: fillWhite, pink: fillPink, brown: fillBrown };

/**
 * ctx 上にループ再生用の AudioBuffer を作る。
 * seconds は長めに取るほど反復が気づかれにくくなるが、生成コストとメモリも増える。
 * 6 秒あれば十分で、engine 側で playbackRate をずらした多重再生と組み合わせて
 * 体感的な反復周期をさらに伸ばす想定。
 */
export function createNoiseBuffer(ctx, kind, seconds = 6, rng = Math.random) {
  const fill = FILLERS[kind];
  if (!fill) throw new Error(`未知のノイズ種別: ${kind}`);
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  fill(data, rng);
  return buffer;
}
