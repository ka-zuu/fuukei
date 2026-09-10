import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, MODIFIERS, AI_STYLES, getCategory, buildQueries, buildAiPrompt } from '../js/categories.js';

describe('getCategory', () => {
  test('存在する id を返す', () => {
    assert.equal(getCategory('sea').id, 'sea');
  });

  test('存在しない id は先頭カテゴリにフォールバック', () => {
    assert.equal(getCategory('存在しないID'), CATEGORIES[0]);
    assert.equal(getCategory(undefined), CATEGORIES[0]);
  });
});

describe('buildQueries', () => {
  test('ラベル未選択ならカテゴリ単体で 1 本、terms はカテゴリの terms のみ', () => {
    const qs = buildQueries('mountain', [], []);
    assert.equal(qs.length, 1);
    assert.equal(qs[0].key, 'mountain:_all:');
    assert.deepEqual(qs[0].terms, ['mountain', 'landscape']);
    assert.equal(qs[0].label, '山岳');
  });

  test('ラベルを 2 つ選ぶとクエリも 2 本、それぞれカテゴリ+ラベルの terms が合成される', () => {
    const qs = buildQueries('mountain', ['alps', 'fuji'], []);
    assert.equal(qs.length, 2);
    const byId = Object.fromEntries(qs.map((q) => [q.key.split(':')[1], q]));
    assert.deepEqual(byId.alps.terms, ['mountain', 'landscape', 'alps', 'mountain range']);
    assert.deepEqual(byId.fuji.terms, ['mountain', 'landscape', 'mount fuji']);
  });

  test('カテゴリ・ラベル・雰囲気の terms が重複除去される', () => {
    // sky: ['sky','landscape'] / sunset ラベル: ['sunset','sky'] → 'sky' が2回現れうる
    const qs = buildQueries('sky', ['sunset'], []);
    const count = qs[0].terms.filter((t) => t === 'sky').length;
    assert.equal(count, 1, `'sky' が重複除去されず複数回含まれている: ${JSON.stringify(qs[0].terms)}`);
  });

  test('雰囲気の選択順が違っても key は同一になる（無駄なキャッシュミスを防ぐ）', () => {
    const a = buildQueries('mountain', ['alps'], ['night', 'mist']);
    const b = buildQueries('mountain', ['alps'], ['mist', 'night']);
    assert.equal(a[0].key, b[0].key);
  });

  test('雰囲気の terms が全クエリに合成される', () => {
    const qs = buildQueries('mountain', ['alps', 'fuji'], ['morning']);
    for (const q of qs) {
      assert.ok(q.terms.includes('sunrise'), `雰囲気の terms が含まれていない: ${JSON.stringify(q.terms)}`);
    }
  });

  test('label には カテゴリ名・ラベル名・雰囲気名が含まれる', () => {
    const qs = buildQueries('mountain', ['alps'], ['morning']);
    assert.equal(qs[0].label, '山岳 / アルプス / 朝');
  });
});

describe('buildAiPrompt', () => {
  test('スタイル・被写体・追加プロンプト・固定句を「. 」で連結する', () => {
    const prompt = buildAiPrompt('mountain', ['fuji'], [], 'STYLE', 'EXTRA');
    assert.match(prompt, /^STYLE\. /);
    assert.match(prompt, /mount fuji/);
    assert.match(prompt, /EXTRA/);
    assert.match(prompt, /16:9 ultra wide composition$/);
  });

  test('extra が空文字なら連結に含めない（連続する ". . " が発生しない）', () => {
    const prompt = buildAiPrompt('mountain', ['fuji'], [], 'STYLE', '');
    assert.doesNotMatch(prompt, /\.\s*\.\s*/);
  });

  test('ラベル未選択でもエラーにならず、被写体はカテゴリの terms のみになる', () => {
    const prompt = buildAiPrompt('mountain', [], [], 'STYLE', '');
    assert.match(prompt, /mountain, landscape/);
  });

  test('複数ラベル選択時はいずれか1つの terms が使われる', () => {
    const prompt = buildAiPrompt('mountain', ['alps', 'fuji'], [], 'STYLE', '');
    const usesAlps = prompt.includes('mountain range');
    const usesFuji = prompt.includes('mount fuji');
    assert.ok(usesAlps || usesFuji, 'いずれのラベルの terms も含まれていない');
    assert.ok(!(usesAlps && usesFuji), '複数ラベルの terms が同時に混ざっている');
  });
});

describe('データ定義の健全性', () => {
  test('カテゴリ id が一意', () => {
    const ids = CATEGORIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `重複した category id: ${JSON.stringify(ids)}`);
  });

  test('カテゴリごとにラベル id が一意', () => {
    for (const cat of CATEGORIES) {
      const ids = cat.labels.map((l) => l.id);
      assert.equal(new Set(ids).size, ids.length, `${cat.id} 内で重複した label id: ${JSON.stringify(ids)}`);
    }
  });

  test('雰囲気(modifier) id が一意', () => {
    const ids = MODIFIERS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('AI画風 id が一意', () => {
    const ids = AI_STYLES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('全カテゴリの terms が非空', () => {
    for (const cat of CATEGORIES) {
      assert.ok(cat.terms.length > 0, `${cat.id} の terms が空`);
    }
  });

  test('全ラベルの terms が非空', () => {
    for (const cat of CATEGORIES) {
      for (const label of cat.labels) {
        assert.ok(label.terms.length > 0, `${cat.id}/${label.id} の terms が空`);
      }
    }
  });

  test('全雰囲気の terms が非空', () => {
    for (const m of MODIFIERS) {
      assert.ok(m.terms.length > 0, `${m.id} の terms が空`);
    }
  });

  test('全AI画風の prompt が非空', () => {
    for (const s of AI_STYLES) {
      assert.ok(s.prompt && s.prompt.length > 0, `${s.id} の prompt が空`);
    }
  });
});
