// Openverse（CC 検索）。匿名でも使えるが利用制限が厳しめなので副ソース扱い。

const ENDPOINT = 'https://api.openverse.org/v1/images/';

// 絵画・イラスト系がまぎれた場合の保険（Openverse 側は category=photograph で
// 大半を除外できるが、由来元の登録ミスに備えてタイトルも見ておく）
const REJECT_TITLE = /\b(painting|illustration|drawing|sketch|engraving|etching|lithograph|woodcut|watercolou?r|clipart|cartoon|postcard|poster|stamp|mural|fresco|mosaic|manuscript|screenshot|render|digital art)\b/i;

export const id = 'openverse';
export const name = 'Openverse';
export const note = '匿名利用のためレート制限が厳しめです。Commons で物足りないときの予備として。';

export async function fetchPage({ terms, minWidth, allowPortrait, offset, signal }) {
  const page = Math.max(1, Math.floor((offset || 0) / 20) + 1);
  const params = new URLSearchParams({
    q: terms.join(' '),
    license_type: 'all-cc',
    category: 'photograph',
    size: 'large',
    aspect_ratio: allowPortrait ? 'wide,square,tall' : 'wide',
    extension: 'jpg,png',
    mature: 'false',
    page: String(page),
    page_size: '20'
  });

  const res = await fetch(`${ENDPOINT}?${params}`, { signal, mode: 'cors', credentials: 'omit' });
  if (res.status === 429) throw new Error('Openverse のレート制限に達しました。しばらく待つか Commons をお使いください。');
  if (!res.ok) throw new Error(`Openverse API エラー (HTTP ${res.status})`);
  const data = await res.json();

  const items = (data.results || [])
    .map((r) => ({
      id: `openverse:${r.id}`,
      provider: r.source || 'Openverse',
      title: r.title || '無題',
      src: r.url,
      width: r.width || 0,
      height: r.height || 0,
      mime: 'image/jpeg',
      author: r.creator || '不明',
      license: `${(r.license || 'cc').toUpperCase()} ${r.license_version || ''}`.trim(),
      licenseUrl: r.license_url || '',
      sourceUrl: r.foreign_landing_url || r.detail_url || ''
    }))
    .filter((it) => {
      if (REJECT_TITLE.test(it.title)) return false;
      if (minWidth && it.width && it.width < minWidth) return false;
      if (!it.width || !it.height) return true;
      const ratio = it.width / it.height;
      return allowPortrait ? ratio < 4.5 : ratio >= 1.15 && ratio <= 4.5;
    });

  const total = data.result_count || items.length;
  const maxPage = Math.max(1, Math.min(data.page_count || 1, 20));
  return { items, total, nextOffset: (Math.floor(Math.random() * maxPage)) * 20 };
}
