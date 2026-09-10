import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage } from '../js/sources/openverse.js';
import { mockFetch, restoreFetch, paramsOf } from './support/fetch-mock.js';

afterEach(() => restoreFetch());

function ok(body) {
  return { status: 200, body };
}

function sampleResult(overrides = {}) {
  return {
    id: 'abc123',
    title: 'Mountain at sunrise',
    url: 'https://example.com/img.jpg',
    width: 4000,
    height: 2250,
    creator: 'Jane Doe',
    license: 'by',
    license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    foreign_landing_url: 'https://example.com/photo/abc123',
    source: 'flickr',
    ...overrides
  };
}

describe('リクエストパラメータ', () => {
  test('offset を 20 件区切りの page に変換する', async () => {
    const cases = [[0, '1'], [19, '1'], [20, '2'], [40, '3']];
    for (const [offset, expectedPage] of cases) {
      const calls = mockFetch(() => ok({ results: [] }));
      // eslint-disable-next-line no-await-in-loop
      await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset });
      assert.equal(paramsOf(calls[0].url).get('page'), expectedPage, `offset=${offset}`);
    }
  });

  test('allowPortrait で aspect_ratio が切り替わる', async () => {
    const wide = mockFetch(() => ok({ results: [] }));
    await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(paramsOf(wide[0].url).get('aspect_ratio'), 'wide');

    const relaxed = mockFetch(() => ok({ results: [] }));
    await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: true, offset: 0 });
    assert.equal(paramsOf(relaxed[0].url).get('aspect_ratio'), 'wide,square,tall');
  });

  test('category=photograph と license_type=all-cc を常に指定する', async () => {
    const calls = mockFetch(() => ok({ results: [] }));
    await fetchPage({ terms: ['mountain'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(paramsOf(calls[0].url).get('category'), 'photograph');
    assert.equal(paramsOf(calls[0].url).get('license_type'), 'all-cc');
    assert.equal(paramsOf(calls[0].url).get('q'), 'mountain');
  });
});

describe('エラー処理', () => {
  test('429はレート制限用の日本語メッセージで reject する', async () => {
    mockFetch(() => ({ status: 429, body: {} }));
    await assert.rejects(
      fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 }),
      /レート制限/
    );
  });

  test('その他の非OKステータスは汎用エラーになる', async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    await assert.rejects(
      fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 }),
      /HTTP 500/
    );
  });
});

describe('item への変換とフィルタ', () => {
  test('レスポンスの各フィールドが item にマップされる', async () => {
    mockFetch(() => ok({ results: [sampleResult()], result_count: 1, page_count: 1 }));
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.deepEqual(result.items[0], {
      id: 'openverse:abc123',
      provider: 'flickr',
      title: 'Mountain at sunrise',
      src: 'https://example.com/img.jpg',
      width: 4000,
      height: 2250,
      mime: 'image/jpeg',
      author: 'Jane Doe',
      license: 'BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://example.com/photo/abc123'
    });
  });

  test('license_version が無ければ余分な空白なしで大文字化される', async () => {
    mockFetch(() => ok({ results: [sampleResult({ license: 'cc0', license_version: undefined })] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items[0].license, 'CC0');
  });

  test('title・creator・source が欠けていれば既定値を使う', async () => {
    mockFetch(() => ok({ results: [sampleResult({ title: undefined, creator: undefined, source: undefined })] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items[0].title, '無題');
    assert.equal(result.items[0].author, '不明');
    assert.equal(result.items[0].provider, 'Openverse');
  });

  test('タイトルに絵画系ワードを含む場合は除外する', async () => {
    mockFetch(() => ok({ results: [sampleResult({ title: 'A watercolor of the mountains' })] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 0);
  });

  test('minWidth 未満の item は除外する', async () => {
    mockFetch(() => ok({ results: [sampleResult({ width: 800, height: 450 })] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 1920, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 0);
  });

  test('アスペクト比が範囲外なら除外する（allowPortrait=false）', async () => {
    mockFetch(() => ok({ results: [sampleResult({ width: 2000, height: 2000 })] })); // ratio 1.0
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 0);
  });

  test('幅・高さが両方0の item はアスペクト比判定をスキップして採用する', async () => {
    mockFetch(() => ok({ results: [sampleResult({ width: 0, height: 0 })] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 1920, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 1);
  });

  test('result_count が無ければ items.length を total として使う', async () => {
    mockFetch(() => ok({ results: [sampleResult()] }));
    const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.total, 1);
  });

  test('nextOffset は 20 の倍数で、page_count の範囲内に収まる', async () => {
    mockFetch(() => ok({ results: [], page_count: 3 }));
    const original = Math.random;
    try {
      Math.random = () => 0.999;
      const result = await fetchPage({ terms: ['x'], minWidth: 0, allowPortrait: false, offset: 0 });
      // floor(0.999 * 3) * 20 = 2 * 20 = 40
      assert.equal(result.nextOffset, 40);
    } finally {
      Math.random = original;
    }
  });
});
