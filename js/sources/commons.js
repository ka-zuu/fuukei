// Wikimedia Commons 画像検索。API キー不要・CORS 対応（origin=*）。
// 収録物はすべて CC ライセンスかパブリックドメイン。

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const PAGE_SIZE = 50; // 匿名アクセスの上限
// CirrusSearch の srsearch は 300 文字まで（filetype:/filew: は文字数に含まれない）。
// ラベルや雰囲気を複数選択すると検索語自体が伸びるので、除外語は入るだけ足す方式にする。
const SEARCH_BUDGET = 280;

// 絵画・イラスト・図版など「写真ではない」ものを弾くためのキーワード。
// クライアント側の再チェック（タイトル・説明文・カテゴリ）は全件をフルに使うが、
// 検索クエリへの除外語は文字数上限があるため、効果の大きい語だけ先頭から入るだけ使う。
const ART_TERMS = [
  'painting', 'illustration', 'drawing', 'sketch', 'engraving', 'etching',
  'lithograph', 'woodcut', 'watercolor', 'watercolour', 'gouache', 'fresco',
  'mosaic', 'tapestry', 'mural', 'clipart', 'clip art', 'cartoon', 'caricature',
  'manuscript', 'miniature painting', 'ukiyo-e', 'woodblock print',
  'stained glass', 'screenshot', 'rendering', 'render', 'cgi',
  'digital art', 'vector image', 'ex libris', 'postcard'
];
// 風景写真として不適切なものを弾く（地図・図表・文書スキャン・絵画など）
const REJECT_TEXT = new RegExp(
  '\\b(' +
    ['map', 'karte', 'mapa', 'diagram', 'chart', 'graph', 'logo', 'flag',
      'coat[ _]of[ _]arms', 'heraldry', 'emblem', 'seal', 'poster', 'scan',
      'document', 'blueprint', 'plan', 'stamp', 'banknote', 'coin', 'portrait',
      'selfie', 'panorama[ _]?xxl', 'sculpture', 'carving', 'relief', 'ceramic',
      ...ART_TERMS.map((t) => t.replace(/ /g, '[ _]'))
    ].join('|') +
  ')\\b',
  'i'
);
// Commons のカテゴリ名から同じ観点で弾く（タイトルに現れない絵画作品などを捕まえる）
const REJECT_CATEGORY = new RegExp(
  '\\b(' +
    ['paintings?', 'illustrations?', 'drawings?', 'sketches', 'engravings?',
      'etchings?', 'lithographs?', 'woodcuts?', 'watercolou?rs?', 'gouache',
      'frescos?', 'mosaics?', 'tapestr(?:y|ies)', 'murals?', 'clip ?art',
      'cartoons?', 'caricatures?', 'manuscripts?', 'miniatures?', 'ukiyo-?e',
      'woodblock prints?', 'stained[- ]glass', 'screenshots?', 'renders?',
      'digital art', 'vector images?', 'ex[- ]?libris', 'postcards?',
      'posters?', 'stamps?', 'sculptures?', 'carvings?', 'reliefs?', 'ceramics?',
      'coats? of arms', 'heraldry', 'emblems?'
    ].join('|') +
  ')\\b',
  'i'
);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const id = 'commons';
export const name = 'Wikimedia Commons';
export const note = 'APIキー不要。CC / パブリックドメインの高解像度写真を検索します。';

/**
 * @param {object} opts
 * @param {string[]} opts.terms 検索キーワード（英語）
 * @param {number} opts.width   欲しい表示幅(px)
 * @param {number} opts.minWidth 下限の実解像度
 * @param {boolean} opts.allowPortrait 縦長を許可
 * @param {number} opts.offset  検索オフセット（未指定なら総ヒット数からランダム）
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{items: object[], total: number, nextOffset: number}>}
 */
export async function fetchPage({ terms, width, minWidth, allowPortrait, offset, signal }) {
  const search = buildSearch(terms, minWidth);
  let { titles, total } = await searchTitles(search, offset ?? 0, signal);

  // 指定オフセットが総数を超えていた場合は先頭に戻す
  if (!titles.length && (offset ?? 0) > 0) {
    ({ titles, total } = await searchTitles(search, 0, signal));
  }
  // 解像度条件が厳しすぎて 0 件なら条件を緩める
  if (!titles.length && minWidth) {
    ({ titles, total } = await searchTitles(buildSearch(terms, 0), 0, signal));
  }
  if (!titles.length) return { items: [], total: 0, nextOffset: 0 };

  const items = await loadImageInfo(titles, width, signal);
  const filtered = items.filter((it) => keep(it, minWidth, allowPortrait)).map(strip);

  const nextOffset = total > PAGE_SIZE ? randomOffset(total) : 0;
  return { items: filtered, total, nextOffset };
}

function buildSearch(terms, minWidth) {
  const subject = terms.join(' ');
  // 文字数上限（filetype:/filew: を除いて300）に収まる分だけ除外語を足す。
  // 効果の大きい語から並べているので、削れるのは末尾の優先度が低いものから。
  const negatives = [];
  let used = subject.length;
  for (const t of ART_TERMS) {
    const clause = t.includes(' ') ? `-"${t}"` : `-${t}`;
    if (used + 1 + clause.length > SEARCH_BUDGET) break;
    negatives.push(clause);
    used += 1 + clause.length;
  }
  const parts = [subject, 'filetype:bitmap'];
  if (minWidth) parts.push(`filew:>${minWidth}`);
  parts.push(...negatives);
  return parts.join(' ');
}

function randomOffset(total) {
  // CirrusSearch は 10000 件目以降を返さないため上限を設ける
  const span = Math.max(0, Math.min(total, 3000) - PAGE_SIZE);
  return span > 0 ? Math.floor(Math.random() * span) : 0;
}

async function searchTitles(srsearch, sroffset, signal) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    list: 'search',
    srsearch,
    srnamespace: '6',
    srlimit: String(PAGE_SIZE),
    sroffset: String(sroffset),
    srinfo: 'totalhits',
    srprop: ''
  });
  const data = await getJson(`${ENDPOINT}?${params}`, signal);
  const results = data?.query?.search || [];
  return {
    titles: results.map((r) => r.title),
    total: data?.query?.searchinfo?.totalhits || results.length
  };
}

async function loadImageInfo(titles, width, signal) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    titles: titles.join('|'),
    prop: 'imageinfo|categories',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: String(width),
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|ObjectName|ImageDescription|Attribution|Restrictions',
    clshow: '!hidden',
    cllimit: 'max'
  });
  const data = await getJson(`${ENDPOINT}?${params}`, signal);
  const pages = data?.query?.pages || [];
  return pages.map(toItem).filter(Boolean);
}

function toItem(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const value = (k) => plain(meta[k]?.value || '');
  const title = (value('ObjectName') || page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')).trim();
  // 原寸が要求幅より小さければ原寸をそのまま使う（無駄な拡大を避ける）
  const src = info.thumbwidth && info.thumbwidth < info.width ? info.thumburl : info.url;
  const categories = (page.categories || []).map((c) => c.title.replace(/^Category:/, '').replace(/_/g, ' '));

  return {
    id: `commons:${page.pageid}`,
    provider: 'Wikimedia Commons',
    title,
    src,
    width: info.width,
    height: info.height,
    mime: info.mime,
    author: value('Artist') || value('Credit') || '不明',
    license: value('LicenseShortName') || value('UsageTerms') || 'Wikimedia Commons',
    licenseUrl: plainUrl(meta.LicenseUrl?.value),
    sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    restrictions: value('Restrictions'),
    // 判定専用。表示には使わない
    _description: value('ImageDescription'),
    _categories: categories
  };
}

function keep(item, minWidth, allowPortrait) {
  if (!ALLOWED_MIME.has(item.mime)) return false;
  if (item.restrictions) return false;
  if (REJECT_TEXT.test(item.title) || REJECT_TEXT.test(item._description)) return false;
  if (item._categories.some((c) => REJECT_CATEGORY.test(c))) return false;
  if (minWidth && item.width < minWidth) return false;
  const ratio = item.width / item.height;
  if (!allowPortrait && ratio < 1.15) return false;
  if (ratio > 4.5) return false; // 超パノラマは全画面で破綻する
  return true;
}

/** 判定専用フィールドを外して、保存・表示用の item だけにする。 */
function strip({ _description, _categories, ...item }) {
  return item;
}

/** extmetadata の値は HTML 断片なのでプレーンテキスト化する。 */
function plain(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function plainUrl(url) {
  const s = plain(url);
  return /^https?:\/\//i.test(s) ? s : '';
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`Commons API エラー (HTTP ${res.status})`);
  const data = await res.json();
  if (data.error) throw new Error(`Commons API エラー: ${data.error.info || data.error.code}`);
  return data;
}
