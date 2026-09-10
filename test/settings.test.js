import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, load, save, reset, resolveWidth } from '../js/settings.js';

const KEY = 'fuukei.settings.v1';

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
});

describe('save / load のラウンドトリップ', () => {
  test('save したものが load で戻ってくる', () => {
    const custom = { ...DEFAULTS, category: 'polar', interval: 120 };
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
