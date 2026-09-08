// カテゴリ / ラベル定義。
// terms は画像検索に使う英語キーワード、aiTerms は AI 生成プロンプト用の描写。
// ラベルを選ぶと「カテゴリの terms + ラベルの terms」で 1 本のクエリを組み立て、
// 複数ラベル選択時はラベルごとのクエリをラウンドロビンで交互に取得する。

export const CATEGORIES = [
  {
    id: 'mountain', name: '山岳', emoji: '⛰️',
    terms: ['mountain', 'landscape'],
    labels: [
      { id: 'alps', name: 'アルプス', terms: ['alps', 'mountain range'] },
      { id: 'fuji', name: '富士山', terms: ['mount fuji'] },
      { id: 'snowpeak', name: '雪山', terms: ['snow', 'summit', 'peak'] },
      { id: 'cliff', name: '岩壁', terms: ['rock face', 'cliff', 'mountain'] },
      { id: 'plateau', name: '高原', terms: ['plateau', 'highland'] },
      { id: 'volcano', name: '火山', terms: ['volcano', 'crater'] }
    ]
  },
  {
    id: 'sea', name: '海・海岸', emoji: '🌊',
    terms: ['sea', 'coast', 'landscape'],
    labels: [
      { id: 'beach', name: 'ビーチ', terms: ['tropical beach', 'turquoise'] },
      { id: 'seacliff', name: '断崖', terms: ['sea cliff', 'coastline'] },
      { id: 'reef', name: '珊瑚礁', terms: ['coral reef', 'lagoon'] },
      { id: 'lighthouse', name: '灯台', terms: ['lighthouse', 'coast'] },
      { id: 'wave', name: '波', terms: ['ocean wave', 'surf'] },
      { id: 'island', name: '島', terms: ['island', 'aerial'] }
    ]
  },
  {
    id: 'forest', name: '森・樹木', emoji: '🌲',
    terms: ['forest'],
    labels: [
      { id: 'moss', name: '苔むす森', terms: ['mossy', 'temperate rainforest'] },
      { id: 'bamboo', name: '竹林', terms: ['bamboo forest'] },
      { id: 'conifer', name: '針葉樹林', terms: ['coniferous forest', 'spruce'] },
      { id: 'bigtree', name: '巨木', terms: ['giant tree', 'ancient tree'] },
      { id: 'trail', name: '林道', terms: ['forest path', 'trail'] },
      { id: 'foggy', name: '霧の森', terms: ['fog', 'mist', 'forest'] }
    ]
  },
  {
    id: 'water', name: '湖・川・滝', emoji: '💧',
    terms: ['lake', 'landscape'],
    labels: [
      { id: 'lake', name: '湖', terms: ['lake', 'reflection'] },
      { id: 'waterfall', name: '滝', terms: ['waterfall'] },
      { id: 'canyon', name: '渓谷', terms: ['canyon', 'gorge', 'river'] },
      { id: 'river', name: '川', terms: ['river valley'] },
      { id: 'wetland', name: '湿原', terms: ['wetland', 'marsh'] },
      { id: 'glacial', name: '氷河湖', terms: ['glacial lake', 'turquoise'] }
    ]
  },
  {
    id: 'sky', name: '空・天体', emoji: '🌌',
    terms: ['sky', 'landscape'],
    labels: [
      { id: 'stars', name: '星空', terms: ['starry sky', 'night sky'] },
      { id: 'milkyway', name: '天の川', terms: ['milky way'] },
      { id: 'aurora', name: 'オーロラ', terms: ['aurora borealis'] },
      { id: 'sunset', name: '夕焼け', terms: ['sunset', 'sky'] },
      { id: 'cloudsea', name: '雲海', terms: ['sea of clouds', 'above the clouds'] },
      { id: 'rainbow', name: '虹', terms: ['rainbow', 'landscape'] }
    ]
  },
  {
    id: 'season', name: '四季', emoji: '🍁',
    terms: ['landscape'],
    labels: [
      { id: 'sakura', name: '桜', terms: ['cherry blossom'] },
      { id: 'green', name: '新緑', terms: ['spring', 'fresh green', 'meadow'] },
      { id: 'autumn', name: '紅葉', terms: ['autumn foliage', 'fall colors'] },
      { id: 'snow', name: '雪景色', terms: ['winter', 'snow landscape'] },
      { id: 'flowers', name: '花畑', terms: ['flower field', 'wildflowers'] },
      { id: 'rice', name: '田園', terms: ['rice paddy', 'countryside'] }
    ]
  },
  {
    id: 'desert', name: '砂漠・荒野', emoji: '🏜️',
    terms: ['desert', 'landscape'],
    labels: [
      { id: 'dunes', name: '砂丘', terms: ['sand dunes'] },
      { id: 'rockdesert', name: '岩石砂漠', terms: ['rock formation', 'desert canyon'] },
      { id: 'salt', name: '塩湖', terms: ['salt flat', 'salt lake'] },
      { id: 'steppe', name: '草原', terms: ['steppe', 'grassland'] },
      { id: 'badlands', name: '荒野', terms: ['badlands'] },
      { id: 'cactus', name: 'サボテン', terms: ['cactus', 'saguaro desert'] }
    ]
  },
  {
    id: 'polar', name: '極地・氷雪', emoji: '❄️',
    terms: ['glacier', 'ice', 'landscape'],
    labels: [
      { id: 'glacier', name: '氷河', terms: ['glacier'] },
      { id: 'iceberg', name: '氷山', terms: ['iceberg'] },
      { id: 'antarctic', name: '南極', terms: ['antarctica'] },
      { id: 'tundra', name: 'ツンドラ', terms: ['arctic tundra'] },
      { id: 'icecave', name: '氷の洞窟', terms: ['ice cave'] },
      { id: 'rime', name: '樹氷', terms: ['snow covered trees', 'hoarfrost'] }
    ]
  },
  {
    id: 'city', name: '街・夜景', emoji: '🌃',
    terms: ['cityscape'],
    labels: [
      { id: 'skyline', name: '夜景', terms: ['skyline', 'night', 'city lights'] },
      { id: 'oldtown', name: '古都', terms: ['historic old town', 'aerial'] },
      { id: 'harbour', name: '港町', terms: ['harbour', 'waterfront'] },
      { id: 'terrace', name: '棚田の村', terms: ['terraced fields', 'village'] },
      { id: 'castle', name: '城', terms: ['castle', 'landscape'] },
      { id: 'bridge', name: '橋', terms: ['bridge', 'landscape'] }
    ]
  },
  {
    id: 'japan', name: '日本の風景', emoji: '🎌',
    terms: ['Japan', 'landscape'],
    labels: [
      { id: 'shrine', name: '神社', terms: ['shrine', 'torii', 'Japan'] },
      { id: 'temple', name: '寺', terms: ['temple', 'Japan'] },
      { id: 'satoyama', name: '里山', terms: ['countryside', 'Japan', 'village'] },
      { id: 'jgorge', name: '渓谷', terms: ['gorge', 'Japan', 'river'] },
      { id: 'jcoast', name: '海岸', terms: ['coast', 'Japan', 'sea'] },
      { id: 'garden', name: '庭園', terms: ['Japanese garden'] }
    ]
  }
];

export const MODIFIERS = [
  { id: 'morning', name: '朝', terms: ['sunrise', 'morning'] },
  { id: 'goldenhour', name: '夕暮れ', terms: ['golden hour', 'dusk'] },
  { id: 'night', name: '夜', terms: ['night'] },
  { id: 'mist', name: '霧', terms: ['mist', 'fog'] },
  { id: 'aerial', name: '空撮', terms: ['aerial view', 'drone'] },
  { id: 'panorama', name: 'パノラマ', terms: ['panorama'] },
  { id: 'longexp', name: '長時間露光', terms: ['long exposure'] }
];

export const AI_STYLES = [
  { id: 'photo', name: '写実的な写真', prompt: 'ultra realistic landscape photograph, natural light, shot on a full-frame camera, fine detail' },
  { id: 'cinematic', name: 'シネマティック', prompt: 'cinematic landscape, dramatic lighting, anamorphic, film still, wide vista' },
  { id: 'watercolor', name: '水彩画', prompt: 'delicate watercolor painting of a landscape, soft washes, paper texture' },
  { id: 'oil', name: '油彩画', prompt: 'romantic oil painting of a landscape, visible brush strokes, luminous atmosphere' },
  { id: 'ukiyoe', name: '浮世絵風', prompt: 'ukiyo-e woodblock print landscape, flat color planes, bold outlines' },
  { id: 'anime', name: 'アニメ背景', prompt: 'anime background art of a landscape, crisp clouds, vivid saturated color, hand painted' },
  { id: 'fantasy', name: '幻想的', prompt: 'ethereal fantasy landscape, otherworldly atmosphere, volumetric light' }
];

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}

/**
 * 選択状態から検索クエリの束を作る。ラベル未選択ならカテゴリ単体で 1 本。
 * @returns {{key: string, terms: string[], label: string}[]}
 */
export function buildQueries(categoryId, labelIds, modifierIds) {
  const cat = getCategory(categoryId);
  const mods = MODIFIERS.filter((m) => modifierIds.includes(m.id));
  const modTerms = mods.flatMap((m) => m.terms);
  const modName = mods.map((m) => m.name).join('・');
  const chosen = cat.labels.filter((l) => labelIds.includes(l.id));
  const sets = chosen.length ? chosen : [{ id: '_all', name: cat.name, terms: [] }];

  return sets.map((l) => {
    const terms = dedupe([...cat.terms, ...l.terms, ...modTerms]);
    const label = [cat.name, l.id === '_all' ? '' : l.name, modName].filter(Boolean).join(' / ');
    return { key: `${cat.id}:${l.id}:${modifierIds.slice().sort().join(',')}`, terms, label };
  });
}

/** AI 生成用の日本語→英語プロンプト。 */
export function buildAiPrompt(categoryId, labelIds, modifierIds, stylePrompt, extra) {
  const cat = getCategory(categoryId);
  const label = cat.labels.filter((l) => labelIds.includes(l.id));
  const pick = label.length ? label[Math.floor(Math.random() * label.length)] : null;
  const mods = MODIFIERS.filter((m) => modifierIds.includes(m.id));
  const subject = dedupe([...cat.terms, ...(pick ? pick.terms : []), ...mods.flatMap((m) => m.terms)]).join(', ');
  return [
    stylePrompt,
    subject,
    extra,
    'expansive scenery, no people, no text, no watermark, no border, 16:9 ultra wide composition'
  ].filter(Boolean).join('. ');
}

function dedupe(arr) {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}
