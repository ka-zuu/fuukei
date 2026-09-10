import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fillWhite, fillPink, fillBrown, createNoiseBuffer } from '../js/audio/noise.js';
import { poissonDelay, createScheduler } from '../js/audio/scheduler.js';
import { SOUNDS, getSound } from '../js/audio/sounds.js';
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
  /** AudioContext.createBuffer 相当の最小モック。 */
  function fakeCtx(sampleRate = 8000) {
    return {
      sampleRate,
      createBuffer(channels, length) {
        const data = new Float32Array(length);
        return { length, getChannelData: () => data };
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
