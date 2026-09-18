import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fillWhite, fillPink, fillBrown, createNoiseBuffer } from '../js/audio/noise.js';
import { poissonDelay, createScheduler } from '../js/audio/scheduler.js';
import { SOUNDS, getSound } from '../js/audio/sounds.js';
import { createWidthStage, MAX_WIDTH } from '../js/audio/width.js';
import { DEFAULTS } from '../js/settings.js';

/** シード付きの決定論的 rng（テストの再現性のため）。 */
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 隣接サンプルの差の平均絶対値。低域寄り（ブラウン<ピンク<白）なほど小さくなる。 */
function meanAbsDiff(arr) {
  let sum = 0;
  for (let i = 1; i < arr.length; i++) sum += Math.abs(arr[i] - arr[i - 1]);
  return sum / (arr.length - 1);
}

describe('fillWhite / fillPink / fillBrown', () => {
  for (const [name, fill] of [['fillWhite', fillWhite], ['fillPink', fillPink], ['fillBrown', fillBrown]]) {
    test(`${name}: 長さを変えず、全要素が有限で、定数列にならない`, () => {
      const out = new Float32Array(2048);
      fill(out, seededRng(1));
      assert.equal(out.length, 2048);
      assert.ok(Array.from(out).every(Number.isFinite));
      assert.ok(new Set(out).size > 1);
    });

    test(`${name}: 同じ rng を注入すれば決定的`, () => {
      const a = new Float32Array(512);
      const b = new Float32Array(512);
      fill(a, seededRng(42));
      fill(b, seededRng(42));
      assert.deepEqual(Array.from(a), Array.from(b));
    });
  }

  test('スペクトルの色: 隣接差の平均絶対値が brown < pink < white になる', () => {
    const n = 32768;
    const white = new Float32Array(n);
    const pink = new Float32Array(n);
    const brown = new Float32Array(n);
    fillWhite(white, seededRng(7));
    fillPink(pink, seededRng(7));
    fillBrown(brown, seededRng(7));

    const dWhite = meanAbsDiff(white);
    const dPink = meanAbsDiff(pink);
    const dBrown = meanAbsDiff(brown);

    assert.ok(dBrown < dPink, `brown(${dBrown}) < pink(${dPink}) となるはず`);
    assert.ok(dPink < dWhite, `pink(${dPink}) < white(${dWhite}) となるはず`);
  });
});

describe('createNoiseBuffer', () => {
  /**
   * AudioContext.createBuffer 相当の最小モック。
   * チャンネルごとに独立した配列を持つ（実際の AudioBuffer と同様）。
   * これが単一配列の使い回しだと、モノラル実装に戻すバグをテストが見逃してしまう。
   */
  function fakeCtx(sampleRate = 8000) {
    return {
      sampleRate,
      createBuffer(channels, length) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return { length, numberOfChannels: channels, getChannelData: (i) => data[i] };
      }
    };
  }

  test('sampleRate * seconds の長さで AudioBuffer を作る', () => {
    const ctx = fakeCtx(8000);
    const buffer = createNoiseBuffer(ctx, 'pink', 2, seededRng(1));
    assert.equal(buffer.length, 16000);
  });

  test('未知のノイズ種別は例外を投げる', () => {
    const ctx = fakeCtx();
    assert.throws(() => createNoiseBuffer(ctx, 'green'));
  });

  test('2ch で生成される（ステレオの広がりの土台）', () => {
    const ctx = fakeCtx();
    for (const kind of ['white', 'pink', 'brown']) {
      const buffer = createNoiseBuffer(ctx, kind, 1, seededRng(1));
      assert.equal(buffer.numberOfChannels, 2);
    }
  });

  test('左右チャンネルが無相関になる（同一内容ではない）', () => {
    const ctx = fakeCtx();
    for (const kind of ['white', 'pink', 'brown']) {
      const buffer = createNoiseBuffer(ctx, kind, 1, seededRng(9));
      const l = buffer.getChannelData(0);
      const r = buffer.getChannelData(1);
      assert.notDeepEqual(Array.from(l), Array.from(r), `${kind}: 左右が同一になってはいけない`);
    }
  });

  test('各チャンネルが単独でも有限かつ非定数', () => {
    const ctx = fakeCtx();
    const buffer = createNoiseBuffer(ctx, 'pink', 1, seededRng(3));
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      assert.ok(Array.from(data).every(Number.isFinite));
      assert.ok(new Set(data).size > 1);
    }
  });
});

describe('createWidthStage', () => {
  /**
   * ノード生成を記録する軽量な AudioContext モック。
   * createGain は実装順に midL, midR, sideL, sideR, sideW, sideWInv の 6 個生成される。
   */
  function fakeCtx() {
    const created = [];
    const ctx = {
      createChannelSplitter: () => ({ connect() { return this; } }),
      createChannelMerger: () => ({ connect() { return this; } }),
      createGain: () => {
        const g = { gain: { value: 0, setTargetAtTime(v) { this.value = v; } }, connect() { return this; } };
        created.push(g);
        return g;
      }
    };
    return { ctx, created };
  }

  function sideGains(created) {
    const [, , , , sideW, sideWInv] = created;
    return { sideW, sideWInv };
  }

  test('w=0 でモノラル（side成分が完全に消える）', () => {
    const { ctx, created } = fakeCtx();
    createWidthStage(ctx).setWidth(0);
    const { sideW, sideWInv } = sideGains(created);
    assert.equal(sideW.gain.value, 0);
    assert.equal(sideWInv.gain.value, -0);
  });

  test('w=0.7 で side ゲインが +0.7 / -0.7 になる', () => {
    const { ctx, created } = fakeCtx();
    createWidthStage(ctx).setWidth(0.7);
    const { sideW, sideWInv } = sideGains(created);
    assert.equal(sideW.gain.value, 0.7);
    assert.equal(sideWInv.gain.value, -0.7);
  });

  test('w=1 を超えると side を持ち上げて元より広げる', () => {
    const { ctx, created } = fakeCtx();
    createWidthStage(ctx).setWidth(1.5);
    const { sideW, sideWInv } = sideGains(created);
    assert.equal(sideW.gain.value, 1.5);
    assert.equal(sideWInv.gain.value, -1.5);
  });

  test('範囲外の値は 0〜MAX_WIDTH にクランプされる', () => {
    const over = fakeCtx();
    createWidthStage(over.ctx).setWidth(99);
    assert.equal(sideGains(over.created).sideW.gain.value, MAX_WIDTH);

    const under = fakeCtx();
    createWidthStage(under.ctx).setWidth(-1);
    assert.equal(sideGains(under.created).sideW.gain.value, 0);
  });

  test('at/smooth を渡すと setTargetAtTime 経由でランプされる', () => {
    const { ctx, created } = fakeCtx();
    createWidthStage(ctx).setWidth(0.5, 1.0, 0.05);
    const { sideW, sideWInv } = sideGains(created);
    assert.equal(sideW.gain.value, 0.5);
    assert.equal(sideWInv.gain.value, -0.5);
  });
});

describe('音源の定位（StereoPanner にはモノラルを入れる）', () => {
  /**
   * 接続を記録する AudioContext モック。
   *
   * 「StereoPannerNode に無相関ステレオをそのまま入れていないか」を検査するためのもの。
   * ノイズ源は左右が無相関なので、畳まずにパンすると左右で別々の波形が鳴るだけになり、
   * 定位が滲んで「ステレオに聞こえない」という不具合になる（実測で相関 1.0→0.69、
   * L/R 差 16dB→12.9dB まで劣化する）。これはグラフの形だけで検出できる。
   */
  function recordingCtx() {
    const nodes = [];
    const edges = []; // { from, to }

    function param(value = 0) {
      return {
        value,
        setValueAtTime() { return this; },
        setTargetAtTime() { return this; },
        linearRampToValueAtTime() { return this; },
        exponentialRampToValueAtTime() { return this; },
        cancelScheduledValues() { return this; }
      };
    }

    // ノード種別は kind に持たせる。type は BiquadFilterNode.type / OscillatorNode.type
    // として音源側が書き換えるプロパティなので、種別の判定には使えない。
    function node(kind, extra = {}) {
      const n = {
        kind,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        connect(dest) {
          // AudioParam への接続（変調）はノード間の信号経路ではないので記録しない
          if (dest && dest.kind) edges.push({ from: n, to: dest });
          return dest;
        },
        disconnect() { },
        ...extra
      };
      nodes.push(n);
      return n;
    }

    const ctx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => node('gain', { gain: param(1) }),
      createBiquadFilter: () => node('biquad', { type: 'lowpass', frequency: param(1000), Q: param(1) }),
      createStereoPanner: () => node('stereo-panner', { pan: param(0) }),
      createOscillator: () => node('oscillator', {
        type: 'sine', frequency: param(440), start() { }, stop() { }
      }),
      createBufferSource: () => node('buffer-source', {
        buffer: null, loop: false, playbackRate: param(1), start() { }, stop() { }, onended: null
      }),
      createChannelSplitter: () => node('splitter'),
      createChannelMerger: () => node('merger'),
      createBuffer(channels, length, sampleRate) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
          length,
          numberOfChannels: channels,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (i) => data[i]
        };
      }
    };
    return { ctx, nodes, edges };
  }

  /** ワンショット（パチパチ・泡）も必ず生成されるよう、登録即発火するスケジューラ。 */
  function eagerScheduler() {
    return {
      addJob(id, { onEvent }) { onEvent(0); },
      removeJob() { },
      updateRate() { },
      tickOnce() { },
      start() { },
      stop() { }
    };
  }

  function buildAll(sound) {
    const { ctx, nodes, edges } = recordingCtx();
    const buffers = {
      white: createNoiseBuffer(ctx, 'white', 1, seededRng(1)),
      pink: createNoiseBuffer(ctx, 'pink', 1, seededRng(2)),
      brown: createNoiseBuffer(ctx, 'brown', 1, seededRng(3))
    };
    const voice = sound.create(ctx, { buffers, scheduler: eagerScheduler() });
    voice.start(0); // パチパチ・泡はここで初めて生成される
    // 波・風は start() で setTimeout のループを回し始めるので、必ず止めてから返す
    // （止めないとテストプロセスが終了しない）。stop() は接続を壊さないので記録は残る。
    voice.stop(0);
    return { ctx, nodes, edges, voice };
  }

  /**
   * そのノードから出てくる信号が 1ch かどうかを、上流をたどって判定する。
   * GainNode 等は channelCountMode='max' なので、自身の ch 数ではなく
   * 「何が入っているか」で決まる（泡の OscillatorNode → GainNode → Panner のように、
   * 見かけは 2ch/max でも中身はモノラル、というケースがある）。
   */
  function makeIsMono(edges) {
    const cache = new Map();
    return function isMono(n, seen = new Set()) {
      if (cache.has(n)) return cache.get(n);
      if (seen.has(n)) return true; // 循環（ここでは起きない）は判定に影響させない
      seen.add(n);

      let result;
      if (n.channelCount === 1 && n.channelCountMode === 'explicit') {
        result = true; // toMono() で明示的に畳んである
      } else if (n.kind === 'oscillator') {
        result = true; // 単一の発振器は常にモノラル
      } else if (n.kind === 'buffer-source') {
        result = (n.buffer?.numberOfChannels ?? 1) === 1;
      } else {
        const inputs = edges.filter((e) => e.to === n).map((e) => e.from);
        result = inputs.length > 0 && inputs.every((src) => isMono(src, seen));
      }

      cache.set(n, result);
      return result;
    };
  }

  for (const sound of SOUNDS) {
    test(`${sound.id}: StereoPanner の入力はすべてモノラルに畳まれている`, () => {
      const { nodes, edges } = buildAll(sound);
      const isMono = makeIsMono(edges);
      const panners = nodes.filter((n) => n.kind === 'stereo-panner');
      assert.ok(panners.length > 0 || sound.id === 'rain', `${sound.id}: 定位させる要素が無い`);

      for (const panner of panners) {
        const inputs = edges.filter((e) => e.to === panner).map((e) => e.from);
        assert.ok(inputs.length > 0, `${sound.id}: StereoPanner に入力が無い`);
        for (const src of inputs) {
          assert.ok(
            isMono(src),
            `${sound.id}: StereoPanner に ${src.kind}（${src.channelCount}ch/${src.channelCountMode}）が` +
            '直接入っている。無相関ステレオのままパンすると定位が滲むので、' +
            'toMono() で畳んでから入れること'
          );
        }
      }
    });

    test(`${sound.id}: 左右どちらかに寄った定位を持つ（または左右を揺らす）`, () => {
      const { nodes } = buildAll(sound);
      const panned = nodes.some((n) => n.kind === 'stereo-panner');
      const swayed = nodes.some((n) => n.kind === 'splitter') && nodes.some((n) => n.kind === 'merger');
      assert.ok(panned || swayed, `${sound.id}: 定位も左右の揺れも無く、モノラルにしか聞こえない`);
    });
  }
});

describe('poissonDelay', () => {
  test('常に正の値を返す', () => {
    for (let i = 1; i <= 20; i++) {
      assert.ok(poissonDelay(3, () => i / 21) > 0);
    }
  });

  test('rng() が 0 を返しても Infinity にならない', () => {
    const d = poissonDelay(5, () => 0);
    assert.ok(Number.isFinite(d));
    assert.ok(d > 0);
  });

  test('注入した rng で期待どおりの値になる', () => {
    // -ln(0.5) / rate
    const d = poissonDelay(2, () => 0.5);
    assert.ok(Math.abs(d - (-Math.log(0.5) / 2)) < 1e-9);
  });
});

describe('createScheduler', () => {
  test('先読み窓に入ったイベントだけが発火する', () => {
    let now = 0;
    const fired = [];
    // rng をほぼ 1 に固定し、poissonDelay(-ln(u)/rate) が確実に先読み窓（0.25秒）に
    // 収まる短い間隔になるようにする（毎回異なる乱数だと窓を外れる確率があり不安定になる）。
    const s = createScheduler(() => now, { lookahead: 0.25, tick: 80 });
    s.addJob('a', { rate: 4, onEvent: (t) => fired.push(t), rng: () => 0.99 });
    s.tickOnce();
    assert.ok(fired.length > 0, '少なくとも1件は先読み窓の中で発火するはず');
    assert.ok(fired.every((t) => t >= 0 && t < 0.25));
  });

  test('時刻を進めながら呼んでも、過去や重複した時刻では発火しない', () => {
    let now = 0;
    const fired = [];
    const s = createScheduler(() => now, { lookahead: 0.25, tick: 80 });
    s.addJob('a', { rate: 4, onEvent: (t) => fired.push(t), rng: () => 0.9 });
    for (let i = 0; i < 10; i++) {
      s.tickOnce();
      now += 0.08;
    }
    assert.ok(fired.length > 5, `十分な回数発火するはず: ${fired.length}`);
    for (let i = 1; i < fired.length; i++) {
      assert.ok(fired[i] > fired[i - 1], `発火時刻は単調増加のはず: ${fired}`);
    }
  });

  test('removeJob 後は発火しない', () => {
    let now = 0;
    const fired = [];
    const s = createScheduler(() => now, { lookahead: 0.25, tick: 80 });
    s.addJob('a', { rate: 4, onEvent: (t) => fired.push(t), rng: seededRng(3) });
    s.removeJob('a');
    s.tickOnce();
    assert.equal(fired.length, 0);
  });

  test('long-idle 後に呼んでも暴走しない（1000回のガードで打ち切られる）', () => {
    let now = 0;
    let count = 0;
    const s = createScheduler(() => now, { lookahead: 0.25, tick: 80 });
    s.addJob('a', { rate: 1000, onEvent: () => count++, rng: seededRng(4) });
    now = 100; // 長時間放置されたのと同じ状況
    s.tickOnce();
    assert.ok(count <= 1000);
  });
});

describe('SOUNDS レジストリ', () => {
  test('id が一意', () => {
    const ids = SOUNDS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('各エントリが name / emoji / create を持つ', () => {
    for (const s of SOUNDS) {
      assert.ok(s.id, 'id が空');
      assert.ok(s.name, `${s.id} に name が無い`);
      assert.ok(s.emoji, `${s.id} に emoji が無い`);
      assert.equal(typeof s.create, 'function', `${s.id} の create が関数でない`);
    }
  });

  test('全ての音源 id が DEFAULTS.audio.volumes に存在する', () => {
    for (const s of SOUNDS) {
      assert.ok(s.id in DEFAULTS.audio.volumes, `${s.id} が DEFAULTS.audio.volumes に無い`);
    }
  });

  test('getSound: 存在する id を返す', () => {
    assert.equal(getSound(SOUNDS[0].id), SOUNDS[0]);
  });

  test('getSound: 存在しない id は null', () => {
    assert.equal(getSound('存在しないID'), null);
  });
});
