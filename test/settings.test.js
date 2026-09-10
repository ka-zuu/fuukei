import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, load, save, reset, resolveWidth, clamp01 } from '../js/settings.js';
import { SOUNDS } from '../js/audio/sounds.js';

const KEY = 'fuukei.settings.v1';
const [SOUND_A, SOUND_B] = SOUNDS.map((s) => s.id);

beforeEach(() => {
  localStorage.clear();
});

describe('load', () => {
  test('保存が無ければ DEFAULTS と一致する（別オブジェクトとして）', () => {
    const loaded = load();
    assert.deepEqual(loaded, DEFAULTS);
    assert.notEqual(loaded, DEFAULTS);
  });

  test('部分的な保存値を DEFAULTS にマージし、ai の欠けたキーは既定値で埋まる', () => {
    localStorage.setItem(KEY, JSON.stringify({ category: 'sea', ai: { key: 'sk-xxx' } }));
    const loaded = load();
    assert.equal(loaded.category, 'sea');
    assert.equal(loaded.ai.key, 'sk-xxx');
    assert.equal(loaded.ai.provider, DEFAULTS.ai.provider);
    assert.equal(loaded.ai.style, DEFAULTS.ai.style);
  });

  test('壊れた JSON でも例外を投げず DEFAULTS を返す', () => {
    localStorage.setItem(KEY, '{ this is not json');
    assert.deepEqual(load(), DEFAULTS);
  });

  test('旧バージョンの短すぎる interval は 60 秒にクランプされる', () => {
    localStorage.setItem(KEY, JSON.stringify({ interval: 5 }));
    assert.equal(load().interval, 60);
  });

  test('異常に長い interval は 3600 秒にクランプされる', () => {
    localStorage.setItem(KEY, JSON.stringify({ interval: 99999 }));
    assert.equal(load().interval, 3600);
  });

  test('interval が範囲内ならそのまま', () => {
    localStorage.setItem(KEY, JSON.stringify({ interval: 600 }));
    assert.equal(load().interval, 600);
  });

  test('audio が無い旧設定でも DEFAULTS.audio と一致する', () => {
    localStorage.setItem(KEY, JSON.stringify({ category: 'sea' }));
    assert.deepEqual(load().audio, DEFAULTS.audio);
  });

  test('audio.master だけ保存しても他のキーは既定値のまま（丸ごと上書きされない）', () => {
    localStorage.setItem(KEY, JSON.stringify({ audio: { master: 0.3 } }));
    const loaded = load();
    assert.equal(loaded.audio.master, 0.3);
    assert.equal(loaded.audio.muted, DEFAULTS.audio.muted);
    assert.deepEqual(loaded.audio.enabled, DEFAULTS.audio.enabled);
    assert.deepEqual(loaded.audio.volumes, DEFAULTS.audio.volumes);
  });

  test('audio.volumes を1つだけ保存しても、他の音の既定音量は消えない', () => {
    localStorage.setItem(KEY, JSON.stringify({ audio: { volumes: { [SOUND_A]: 0.9 } } }));
    const loaded = load();
    assert.equal(loaded.audio.volumes[SOUND_A], 0.9);
    assert.equal(loaded.audio.volumes[SOUND_B], DEFAULTS.audio.volumes[SOUND_B]);
  });

  test('audio.enabled の未知の id は除去される', () => {
    localStorage.setItem(KEY, JSON.stringify({ audio: { enabled: [SOUND_A, '廃止済みの音'] } }));
    assert.deepEqual(load().audio.enabled, [SOUND_A]);
  });

  test('audio.enabled の重複は除去される', () => {
    localStorage.setItem(KEY, JSON.stringify({ audio: { enabled: [SOUND_A, SOUND_A] } }));
    assert.deepEqual(load().audio.enabled, [SOUND_A]);
  });

  test('audio.master / volumes の範囲外や不正な値は 0〜1 にクランプされる', () => {
    localStorage.setItem(KEY, JSON.stringify({
      audio: { master: 2.5, muted: 1, volumes: { [SOUND_A]: -1, [SOUND_B]: 'うるさい' } }
    }));
    const loaded = load();
    assert.equal(loaded.audio.master, 1);
    assert.equal(loaded.audio.muted, true);
    assert.equal(loaded.audio.volumes[SOUND_A], 0);
    assert.equal(loaded.audio.volumes[SOUND_B], DEFAULTS.audio.volumes[SOUND_B]);
  });
});

describe('save / load のラウンドトリップ', () => {
  test('save したものが load で戻ってくる', () => {
    const custom = { ...DEFAULTS, category: 'polar', interval: 120 };
    save(custom);
    assert.deepEqual(load(), custom);
  });

  test('audio をカスタマイズしたものも往復する', () => {
    const custom = {
      ...DEFAULTS,
      audio: {
        master: 0.2,
        muted: true,
        enabled: [SOUND_A],
        volumes: { ...DEFAULTS.audio.volumes, [SOUND_A]: 0.9 }
      }
    };
    save(custom);
    assert.deepEqual(load(), custom);
  });
});

describe('reset', () => {
  test('ストレージを消して DEFAULTS を返す', () => {
    save({ ...DEFAULTS, category: 'city' });
    const result = reset();
    assert.deepEqual(result, DEFAULTS);
    assert.equal(localStorage.getItem(KEY), null);
    assert.deepEqual(load(), DEFAULTS);
  });

  test('audio は毎回独立した新しいオブジェクトを返す（DEFAULTS と共有しない）', () => {
    const a = reset();
    a.audio.enabled.push(SOUND_A);
    const b = reset();
    assert.deepEqual(b.audio.enabled, []);
    assert.deepEqual(DEFAULTS.audio.enabled, []);
  });
});

describe('clamp01', () => {
  test('範囲内はそのまま', () => {
    assert.equal(clamp01(0.4), 0.4);
  });

  test('範囲外は 0〜1 にクランプされる', () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
  });

  test('数値化できない値は fallback を返す', () => {
    assert.equal(clamp01('うるさい', 0.5), 0.5);
    assert.equal(clamp01(undefined, 0.7), 0.7);
    assert.equal(clamp01(NaN), 0);
  });
});

describe('resolveWidth', () => {
  const original = {
    innerWidth: window.innerWidth,
    dpr: window.devicePixelRatio
  };

  afterEach(() => {
    window.innerWidth = original.innerWidth;
    window.devicePixelRatio = original.dpr;
  });

  test('quality が auto 以外なら数値化してそのまま返す', () => {
    assert.equal(resolveWidth('1600'), 1600);
    assert.equal(resolveWidth('2560'), 2560);
    assert.equal(resolveWidth('3840'), 3840);
  });

  test('auto: 実効幅が1400以下なら1600', () => {
    window.innerWidth = 1024;
    window.devicePixelRatio = 1;
    assert.equal(resolveWidth('auto'), 1600);
  });

  test('auto: 実効幅がちょうど1400なら境界として1600（1600の側に含む）', () => {
    window.innerWidth = 1400;
    window.devicePixelRatio = 1;
    assert.equal(resolveWidth('auto'), 1600);
  });

  test('auto: 実効幅が1401〜2200なら2560', () => {
    window.innerWidth = 1401;
    window.devicePixelRatio = 1;
    assert.equal(resolveWidth('auto'), 2560);
  });

  test('auto: 実効幅がちょうど2200なら境界として2560', () => {
    window.innerWidth = 2200;
    window.devicePixelRatio = 1;
    assert.equal(resolveWidth('auto'), 2560);
  });

  test('auto: 実効幅が2200超なら3840', () => {
    window.innerWidth = 2201;
    window.devicePixelRatio = 1;
    assert.equal(resolveWidth('auto'), 3840);
  });

  test('auto: devicePixelRatio は 2 で頭打ちになる', () => {
    window.innerWidth = 1000;
    window.devicePixelRatio = 3; // 2 に clamp されるはず → 実効幅 2000 → 2560
    assert.equal(resolveWidth('auto'), 2560);
  });
});
