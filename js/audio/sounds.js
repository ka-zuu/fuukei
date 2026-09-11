// 音源レジストリ。各エントリは { id, name, emoji, kind, create(ctx, shared) } の形。
//
// create(ctx, shared) は { output, start(at), stop(at), dispose() } を返す:
//   output    … 接続済みの AudioNode（呼び出し側がレイヤー用 GainNode に繋ぐ）
//   start(at) … ctx.currentTime 基準の時刻 at にノードを開始する
//   stop(at)  … 時刻 at 以降にノードの停止を予約する。呼び出し自体はフェードアウト
//               開始と同時（即座）に行い、at にフェード完了時刻を渡す想定。
//               パチパチ・泡などのスケジューラ登録はここで即座に解除する
//   dispose() … 内部ノードを全て disconnect する（stop の完了後、GC 前に一度だけ）
//
// shared = { buffers: { white, pink, brown } (AudioBuffer), scheduler (scheduler.js の createScheduler) }
//
// kind は v1 では 'synth' のみ。将来ファイル/Openverse 音声など 'sample' 音源を
// 追加する場合も同じ create(ctx, shared) 契約で差し込める想定（サンプル音源は
// 追加で credit: { author, license, licenseUrl, sourceUrl } を持たせる）。

const DUAL_RATES = [1, 0.7862915]; // 無理数的な比。2本の比率が単純比にならないようにする

function safeStop(node, at) {
  try { node.stop(at); } catch { /* 既に停止済みなど */ }
}

function disconnectSafe(node) {
  try { node.disconnect(); } catch { /* noop */ }
}

/**
 * 同じノイズバッファを playbackRate 違いで2本ループ再生し、加算する。
 * 単独ループだとバッファ長（数秒）ごとの反復に気づかれるが、無理数的な比の
 * 2本を重ねることでほぼ反復しない合成波形になる（生成コストは追加ゼロ）。
 */
function dualLoop(ctx, buffer) {
  const output = ctx.createGain();
  output.gain.value = 1;
  const sources = DUAL_RATES.map((rate) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    src.connect(g).connect(output);
    return src;
  });
  return { output, sources };
}

/** gain/frequency など AudioParam を、時刻 at から山型に変化させて戻す。 */
function rampSwell(param, base, peak, at, attack, decay) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.linearRampToValueAtTime(base, at + attack + decay);
}

/**
 * 緩やかに変化するパラメータ自動化を、ランダムな周期（数秒〜十数秒）で繰り返す
 * ための軽量スケジューラ。scheduler.js の先読み方式は焚き火のパチパチ等の
 * 短い離散イベント用で、ここでの周期はそれよりずっと遅いため setTimeout の
 * 分解能（数msのジッタ）で十分間に合う。
 */
function createSwellLoop(ctx, apply, { periodMin, periodMax }, rng = Math.random) {
  let timerId = null;
  let stopped = true;

  function tick() {
    if (stopped) return;
    const at = ctx.currentTime + 0.05;
    apply(at, rng);
    const period = periodMin + rng() * (periodMax - periodMin);
    timerId = setTimeout(tick, period * 1000);
  }

  return {
    start() { stopped = false; tick(); },
    stop() { stopped = true; clearTimeout(timerId); }
  };
}

/** 焚き火のパチパチ: ノイズを短く切り出し、帯域を絞って指数減衰させ、毎回ランダムな位置に定位させる。 */
function scheduleCrackle(ctx, buffer, destination, at, rng = Math.random) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const dur = 0.02 + rng() * 0.06; // 20〜80ms
  const offset = rng() * Math.max(buffer.duration - dur - 0.05, 0.1);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800 + rng() * 3200; // 800〜4000Hz
  bp.Q.value = 3 + rng() * 4;

  const g = ctx.createGain();
  const peak = 0.5 + rng() * 0.5;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  const pan = ctx.createStereoPanner();
  pan.pan.value = (rng() * 2 - 1) * 0.8; // 焚き火の周囲でランダムに弾ける

  src.connect(bp).connect(g).connect(pan).connect(destination);
  src.start(at, offset, dur + 0.02);
  src.onended = () => { disconnectSafe(src); disconnectSafe(bp); disconnectSafe(g); disconnectSafe(pan); };
}

/** 川の泡: 短く急上昇して消える減衰サイン。毎回ランダムな位置に定位させる。 */
function scheduleBubble(ctx, destination, at, rng = Math.random) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const startFreq = 400 + rng() * 300;
  const endFreq = startFreq + 600 + rng() * 800;
  const dur = 0.01 + rng() * 0.03; // 10〜40ms
  osc.frequency.setValueAtTime(startFreq, at);
  osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);

  const g = ctx.createGain();
  const peak = 0.15 + rng() * 0.15;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  const pan = ctx.createStereoPanner();
  pan.pan.value = (rng() * 2 - 1) * 0.7; // 川幅のどこかで弾ける

  osc.connect(g).connect(pan).connect(destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  osc.onended = () => { disconnectSafe(osc); disconnectSafe(g); disconnectSafe(pan); };
}

/* ---------------- 雨 ---------------- */

function createRain(ctx, shared) {
  const output = ctx.createGain();
  output.gain.value = 1;

  // 本体: ピンクノイズ→ハイパス（低域の籠もりを削り雨粒の帯域を残す）
  const body = dualLoop(ctx, shared.buffers.pink);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 450;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.9;
  body.output.connect(hp).connect(bodyGain).connect(output);

  // 降りの強弱: ハイパスのカットオフをゆっくり揺らす
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06 + Math.random() * 0.09; // 0.06〜0.15Hz
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 180;
  lfo.connect(lfoDepth).connect(hp.frequency);

  // 細かい飛沫感: 白ノイズを高めのハイパスで薄く重ねる
  const sparkle = dualLoop(ctx, shared.buffers.white);
  const sparkleHp = ctx.createBiquadFilter();
  sparkleHp.type = 'highpass';
  sparkleHp.frequency.value = 2600;
  const sparkleGain = ctx.createGain();
  sparkleGain.gain.value = 0.18;
  sparkle.output.connect(sparkleHp).connect(sparkleGain).connect(output);

  const sources = [...body.sources, ...sparkle.sources];

  return {
    output,
    start(at) {
      sources.forEach((s) => s.start(at));
      lfo.start(at);
    },
    stop(at) {
      sources.forEach((s) => safeStop(s, at));
      safeStop(lfo, at);
    },
    dispose() {
      [body.output, sparkle.output, hp, sparkleHp, bodyGain, sparkleGain, lfo, lfoDepth, output]
        .forEach(disconnectSafe);
    }
  };
}

/* ---------------- 焚き火 ---------------- */

function createFire(ctx, shared) {
  const output = ctx.createGain();
  output.gain.value = 1;

  // 胴鳴り: ブラウンノイズ→ローパス
  const body = dualLoop(ctx, shared.buffers.brown);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 1.1;
  body.output.connect(lp).connect(bodyGain).connect(output);

  // パチパチ: 白ノイズの短い切り出しをランダムな間隔（毎秒3〜8回）で発生
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0.8;
  crackleGain.connect(output);
  const jobId = 'fire:crackle';

  const sources = [...body.sources];

  return {
    output,
    start(at) {
      sources.forEach((s) => s.start(at));
      shared.scheduler.addJob(jobId, {
        rate: 3 + Math.random() * 5,
        onEvent: (t) => scheduleCrackle(ctx, shared.buffers.white, crackleGain, t)
      });
    },
    stop(at) {
      sources.forEach((s) => safeStop(s, at));
      shared.scheduler.removeJob(jobId);
    },
    dispose() {
      [body.output, lp, bodyGain, crackleGain, output].forEach(disconnectSafe);
    }
  };
}

/* ---------------- 川 ---------------- */

function createRiver(ctx, shared) {
  const output = ctx.createGain();
  output.gain.value = 1;

  // 川床のノイズ床。帯域分割フィルタの元信号としてのみ使う（直結はしない）
  const bedBrown = dualLoop(ctx, shared.buffers.brown);
  const bedPink = dualLoop(ctx, shared.buffers.pink);
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.5;
  bedBrown.output.connect(bedGain);
  bedPink.output.connect(bedGain);

  // 中心周波数が個別にゆっくり動くバンドパスを3本並列にすることで、
  // 「ただのシャー音」ではなく共振ピークが動く「流れる水」に聞こえる。
  // 各バンドを左中右に固定配置し、川幅のある流れに聞こえるようにする
  const bandCenters = [650, 1150, 2000];
  const bandPans = [-0.55, 0.05, 0.6];
  const bands = bandCenters.map((freq, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    const pan = ctx.createStereoPanner();
    pan.pan.value = bandPans[i];
    bedGain.connect(bp).connect(g).connect(pan).connect(output);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.03 + Math.random() * 0.05;
    const depth = ctx.createGain();
    depth.gain.value = freq * 0.35;
    lfo.connect(depth).connect(bp.frequency);
    return { bp, g, pan, lfo, depth };
  });

  // 泡: 疎らに混ぜることで自然さが増す
  const bubbleGain = ctx.createGain();
  bubbleGain.gain.value = 0.5;
  bubbleGain.connect(output);
  const jobId = 'river:bubble';

  const sources = [...bedBrown.sources, ...bedPink.sources];
  const lfos = bands.map((b) => b.lfo);

  return {
    output,
    start(at) {
      sources.forEach((s) => s.start(at));
      lfos.forEach((l) => l.start(at));
      shared.scheduler.addJob(jobId, {
        rate: 6 + Math.random() * 6,
        onEvent: (t) => scheduleBubble(ctx, bubbleGain, t)
      });
    },
    stop(at) {
      sources.forEach((s) => safeStop(s, at));
      lfos.forEach((l) => safeStop(l, at));
      shared.scheduler.removeJob(jobId);
    },
    dispose() {
      [bedBrown.output, bedPink.output, bedGain, bubbleGain, output,
        ...bands.flatMap((b) => [b.bp, b.g, b.pan, b.lfo, b.depth])].forEach(disconnectSafe);
    }
  };
}

/* ---------------- 波 ---------------- */

function createWaves(ctx, shared) {
  const output = ctx.createGain();
  output.gain.value = 0;

  const body = dualLoop(ctx, shared.buffers.pink);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const pan = ctx.createStereoPanner();
  pan.pan.value = 0;
  body.output.connect(lp).connect(pan).connect(output);

  // 1波ごとのエンベロープ（打ち寄せて引く）。砕けるピークでローパスを開き泡の明るさを出す。
  // 波ごとに砕ける位置を左右にずらし、寄せては返す幅を感じさせる
  const swell = createSwellLoop(ctx, (at, rng) => {
    const peakGain = 0.55 + rng() * 0.35;
    const peakFreq = 1300 + rng() * 900;
    const attack = 1.2 + rng() * 0.6;
    const decay = 2.4 + rng() * 1.6;
    rampSwell(output.gain, 0, peakGain, at, attack, decay);
    rampSwell(lp.frequency, 700, peakFreq, at, attack, decay);
    pan.pan.cancelScheduledValues(at);
    pan.pan.setValueAtTime(pan.pan.value, at);
    pan.pan.linearRampToValueAtTime((rng() * 2 - 1) * 0.35, at + attack);
  }, { periodMin: 7, periodMax: 12 });

  return {
    output,
    start(at) {
      body.sources.forEach((s) => s.start(at));
      swell.start();
    },
    stop(at) {
      body.sources.forEach((s) => safeStop(s, at));
      swell.stop();
    },
    dispose() {
      [body.output, lp, pan, output].forEach(disconnectSafe);
    }
  };
}

/* ---------------- 風 ---------------- */

function createWind(ctx, shared) {
  const output = ctx.createGain();
  output.gain.value = 0;

  const body = dualLoop(ctx, shared.buffers.pink);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 1.4;
  const pan = ctx.createStereoPanner();
  pan.pan.value = 0;
  body.output.connect(bp).connect(pan).connect(output);

  // 中心周波数をゆっくりしたランダムウォークで動かす（吹き抜ける感じ）。
  // 定位も同じ周期でランダムウォークさせ、左右を吹き抜けていく感じを足す
  const wander = createSwellLoop(ctx, (at, rng) => {
    const target = 220 + rng() * 900;
    const dur = 2.5 + rng() * 2;
    bp.frequency.cancelScheduledValues(at);
    bp.frequency.setValueAtTime(bp.frequency.value, at);
    bp.frequency.linearRampToValueAtTime(target, at + dur);
    pan.pan.cancelScheduledValues(at);
    pan.pan.setValueAtTime(pan.pan.value, at);
    pan.pan.linearRampToValueAtTime((rng() * 2 - 1) * 0.7, at + dur);
  }, { periodMin: 2.5, periodMax: 5 });

  // 突風のエンベロープ
  const gust = createSwellLoop(ctx, (at, rng) => {
    const peak = 0.3 + rng() * 0.5;
    rampSwell(output.gain, 0, peak, at, 0.8 + rng() * 0.6, 1.6 + rng() * 1.2);
  }, { periodMin: 4, periodMax: 9 });

  return {
    output,
    start(at) {
      body.sources.forEach((s) => s.start(at));
      wander.start();
      gust.start();
    },
    stop(at) {
      body.sources.forEach((s) => safeStop(s, at));
      wander.stop();
      gust.stop();
    },
    dispose() {
      [body.output, bp, pan, output].forEach(disconnectSafe);
    }
  };
}

export const SOUNDS = [
  { id: 'rain', name: '雨', emoji: '🌧', kind: 'synth', create: createRain },
  { id: 'fire', name: '焚き火', emoji: '🔥', kind: 'synth', create: createFire },
  { id: 'river', name: '川', emoji: '🏞', kind: 'synth', create: createRiver },
  { id: 'waves', name: '波', emoji: '🌊', kind: 'synth', create: createWaves },
  { id: 'wind', name: '風', emoji: '🍃', kind: 'synth', create: createWind }
];

export function getSound(id) {
  return SOUNDS.find((s) => s.id === id) || null;
}
