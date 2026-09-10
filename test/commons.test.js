import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage } from '../js/sources/commons.js';
import { CATEGORIES, MODIFIERS, buildQueries } from '../js/categories.js';
import { mockFetch, restoreFetch, paramsOf } from './support/fetch-mock.js';

afterEach(() => restoreFetch());

function searchResult(titles, total) {
  return {
    body: {
      query: {
        searchinfo: { totalhits: total ?? titles.length },
        search: titles.map((title, i) => ({ title, pageid: i + 1 }))
      }
    }
  };
}

function imageInfoResult(pages) {
  return { body: { query: { pages } } };
}

/** 実際の Commons API 応答に近い形の「良品」ページを作る。個別フィールドは上書き可能。 */
function makePage({ pageid = 1, title = 'File:Sample.jpg', categories = ['Mountains'], imageinfo = {}, extmetadata = {} } = {}) {
  return {
    pageid,
    title,
    categories: categories.map((name) => ({ title: `Category:${name.replace(/ /g, '_')}` })),
    imageinfo: [{
      url: 'https://upload.wikimedia.org/full.jpg',
      thumburl: 'https://upload.wikimedia.org/thumb.jpg',
      thumbwidth: 1920,
      width: 4000,
      height: 2250,
      mime: 'image/jpeg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sample.jpg',
      ...imageinfo,
      extmetadata: {
        ObjectName: { value: 'Sample landscape' },
        Artist: { value: 'Jane Doe' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
        ...extmetadata
      }
    }]
  };
}

/** 検索・imageinfo の両エンドポイントに対して素直に応答する簡易モック。 */
function mockSimple(pages) {
  return mockFetch((url) => {
    const params = paramsOf(url);
    if (params.get('list') === 'search') return searchResult(pages.map((p) => p.title));
    return imageInfoResult(pages);
  });
}

describe('検索クエリの文字数（回帰: fe4d575 の再発防止）', () => {
  test('全カテゴリ×全ラベル×雰囲気7種すべての組み合わせで、CirrusSearchの上限(300文字)を超えない', async () => {
    const allMods = MODIFIERS.map((m) => m.id);
    for (const cat of CATEGORIES) {
      for (const label of cat.labels) {
        const [query] = buildQueries(cat.id, [label.id], allMods);
        const calls = mockSimple([makePage()]);
        // eslint-disable-next-line no-await-in-loop
        await fetchPage({ terms: query.terms, width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });
        const srsearch = paramsOf(calls[0].url).get('srsearch');
        // filetype:/filew: は Commons 側が文字数に含めないので、比較のため取り除く
        const countable = srsearch.replace(/\bfiletype:bitmap\b/, '').replace(/\bfilew:>\d+\b/, '').trim();
        assert.ok(
          countable.length <= 300,
          `${cat.id}/${label.id}: ${countable.length}文字（上限300） -> "${srsearch}"`
        );
      }
    }
  });
});

describe('buildSearch（fetchPageが送るsrsearch経由で検証）', () => {
  test('検索語・filetype・filew・除外語が含まれる', async () => {
    const calls = mockSimple([makePage()]);
    await fetchPage({ terms: ['mountain', 'landscape'], width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });
    const srsearch = paramsOf(calls[0].url).get('srsearch');
    assert.match(srsearch, /^mountain landscape /);
    assert.match(srsearch, /\bfiletype:bitmap\b/);
    assert.match(srsearch, /\bfilew:>1920\b/);
    assert.match(srsearch, /-painting/);
    assert.match(srsearch, /-illustration/);
  });

  test('複数語の除外語は引用符付きになる', async () => {
    const calls = mockSimple([makePage()]);
    await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    const srsearch = paramsOf(calls[0].url).get('srsearch');
    assert.match(srsearch, /-"clip art"/);
  });

  test('minWidth が 0 なら filew 句を付けない', async () => {
    const calls = mockSimple([makePage()]);
    await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    const srsearch = paramsOf(calls[0].url).get('srsearch');
    assert.doesNotMatch(srsearch, /filew:/);
  });

  test('検索結果0件かつminWidth指定時は、filewを外した2回目の検索を行う', async () => {
    let searchCallCount = 0;
    const calls = mockFetch((url) => {
      const params = paramsOf(url);
      if (params.get('list') === 'search') {
        searchCallCount += 1;
        if (searchCallCount === 1) return searchResult([], 0);
        return searchResult(['File:Retry.jpg']);
      }
      return imageInfoResult([makePage({ title: 'File:Retry.jpg' })]);
    });

    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });

    const searchCalls = calls.filter((c) => paramsOf(c.url).get('list') === 'search');
    assert.equal(searchCalls.length, 2);
    assert.match(paramsOf(searchCalls[0].url).get('srsearch'), /filew:>1920/);
    assert.doesNotMatch(paramsOf(searchCalls[1].url).get('srsearch'), /filew:/);
    assert.equal(result.items.length, 1);
  });

  test('検索結果が0件のままなら空の結果を返す（無限ループしない）', async () => {
    const calls = mockFetch((url) => {
      const params = paramsOf(url);
      if (params.get('list') === 'search') return searchResult([], 0);
      return imageInfoResult([]);
    });
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });
    assert.deepEqual(result, { items: [], total: 0, nextOffset: 0 });
    // search: 初回 + minWidth緩和の1回、imageinfo は呼ばれない
    assert.equal(calls.filter((c) => paramsOf(c.url).get('list') === 'search').length, 2);
  });
});

describe('フィルタ（keep）', () => {
  test('mime・restrictions・タイトル・説明文・カテゴリでの除外がすべて効く', async () => {
    const pages = [
      makePage({ pageid: 1, title: 'File:Good.jpg' }),
      makePage({ pageid: 2, title: 'File:Bad-mime.gif', imageinfo: { mime: 'image/gif' } }),
      makePage({ pageid: 3, title: 'File:Bad-restricted.jpg', extmetadata: { Restrictions: { value: 'trademarked' } } }),
      makePage({ pageid: 4, title: 'File:Old map of Japan.jpg', extmetadata: { ObjectName: { value: '' } } }),
      makePage({ pageid: 5, title: 'File:Bad-description.jpg', extmetadata: { ImageDescription: { value: 'An oil painting of mountains' } } }),
      makePage({ pageid: 6, title: 'File:Bad-category.jpg', categories: ['Paintings by unknown artists'] })
    ];
    mockSimple(pages);
    const result = await fetchPage({ terms: ['mountain'], width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });
    assert.deepEqual(result.items.map((i) => i.id), ['commons:1']);
  });

  test('アスペクト比: allowPortrait=false では正方形を除外し、trueなら採用する', async () => {
    const square = makePage({ pageid: 1, imageinfo: { width: 2000, height: 2000 } });

    mockSimple([square]);
    const strict = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(strict.items.length, 0);

    mockSimple([square]);
    const relaxed = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: true, offset: 0 });
    assert.equal(relaxed.items.length, 1);
  });

  test('アスペクト比: 4.5を超える超ワイドは allowPortrait に関わらず除外', async () => {
    const ultraWide = makePage({ pageid: 1, imageinfo: { width: 5000, height: 1000 } });
    mockSimple([ultraWide]);
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: true, offset: 0 });
    assert.equal(result.items.length, 0);
  });

  test('width が minWidth 未満なら除外', async () => {
    const small = makePage({ pageid: 1, imageinfo: { width: 1000, height: 700 } });
    mockSimple([small]);
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 1920, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 0);
  });

  test('imageinfo が無いページ（削除済み等）は無視される', async () => {
    const missing = { pageid: 9, title: 'File:Deleted.jpg', categories: [] };
    mockFetch((url) => {
      const params = paramsOf(url);
      if (params.get('list') === 'search') return searchResult(['File:Deleted.jpg']);
      return imageInfoResult([missing]);
    });
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items.length, 0);
  });
});

describe('メタデータの変換（toItem）', () => {
  test('extmetadataのHTML断片がプレーンテキスト化される', async () => {
    const page = makePage({ extmetadata: { Artist: { value: '<a href="/wiki/User:X">Jane <b>Doe</b></a>' } } });
    mockSimple([page]);
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items[0].author, 'Jane Doe');
  });

  test('licenseUrlはhttp(s)のときだけセットされ、URLでなければ空文字になる', async () => {
    const valid = makePage({ pageid: 1, extmetadata: { LicenseUrl: { value: '<a href="https://example.com/cc">https://example.com/cc</a>' } } });
    const invalid = makePage({ pageid: 2, title: 'File:Other.jpg', extmetadata: { LicenseUrl: { value: 'CC-BY(見出しのみ)' } } });

    mockSimple([valid]);
    const okResult = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(okResult.items[0].licenseUrl, 'https://example.com/cc');

    mockSimple([invalid]);
    const ngResult = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(ngResult.items[0].licenseUrl, '');
  });

  test('thumbwidth < width ならthumburl、そうでなければurlを使う', async () => {
    const thumbCase = makePage({ pageid: 1, imageinfo: { thumbwidth: 1920, width: 4000 } });
    const fullCase = makePage({ pageid: 2, title: 'File:Full.jpg', imageinfo: { thumbwidth: 4000, width: 4000 } });

    mockSimple([thumbCase]);
    const a = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(a.items[0].src, 'https://upload.wikimedia.org/thumb.jpg');

    mockSimple([fullCase]);
    const b = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(b.items[0].src, 'https://upload.wikimedia.org/full.jpg');
  });

  test('ArtistもCreditも無ければ作者は「不明」になる', async () => {
    const page = makePage({ extmetadata: { Artist: undefined, Credit: undefined } });
    delete page.imageinfo[0].extmetadata.Artist;
    mockSimple([page]);
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    assert.equal(result.items[0].author, '不明');
  });

  test('返り値の item に判定専用フィールド(_description/_categories)が残っていない', async () => {
    mockSimple([makePage()]);
    const result = await fetchPage({ terms: ['x'], width: 1920, minWidth: 0, allowPortrait: false, offset: 0 });
    const item = result.items[0];
    assert.ok(!('_description' in item), '_description が strip されていない');
    assert.ok(!('_categories' in item), '_categories が strip されていない');
  });
});
