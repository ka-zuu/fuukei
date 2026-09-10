// 画面の組み立てとイベント配線。

import { CATEGORIES, MODIFIERS, AI_STYLES, getCategory } from './categories.js';
import * as store from './settings.js';
import { AI_DEFAULT_MODELS } from './settings.js';
import { Playlist } from './playlist.js';
import { Viewer } from './viewer.js';
import { WakeGuard } from './wakelock.js';
import * as fullscreen from './fullscreen.js';
import { clearAll, usage } from './cache.js';
import { SOUNDS } from './audio/sounds.js';
import { AudioEngine } from './audio/engine.js';

const $ = (id) => document.getElementById(id);
const IDLE_MS = 3500;

const SOURCE_LIST = [
  { id: 'commons', name: 'Commons', note: 'Wikimedia Commons のCC / パブリックドメイン写真。APIキー不要で、いちばん枚数が多い選択肢です。' },
  { id: 'openverse', name: 'Openverse', note: 'Openverse 横断検索。匿名利用のためレート制限が厳しく、混雑時は失敗することがあります。' },
  { id: 'ai', name: 'AI 生成', note: 'ご自身の API キーで風景を生成します。1枚ごとに各プロバイダの課金が発生します。' }
];

let settings = store.load();
let playing = true;
let advancing = false;
let timer = null;
let idleTimer = null;
let clockTimer = null;
let statusTimer = null;
let installPrompt = null;
let swRegistration = null;
let swRefreshing = false;

const viewer = new Viewer($('stage'));
const playlist = new Playlist(status);
const wake = new WakeGuard(({ active, method }) => {
  if (active && method === 'video') status('スリープ抑制を代替手段で有効にしました');
});
const audio = new AudioEngine({ onStateChange: onAudioState });

boot();

function boot() {
  renderChips();
  renderAiOptions();
  renderSounds();
  syncControls();
  bindEvents();
  registerServiceWorker();
  updateCacheNote();
  armAudioUnlock();

  playlist.configure(settings);
  status('風景を読み込んでいます…');
  advance(1);
  markActivity();
}

/* ---------------- 設定 UI ---------------- */

function renderChips() {
  $('categories').replaceChildren(
    ...CATEGORIES.map((c) => chip(`${c.emoji} ${c.name}`, c.id, () => {
      settings.category = c.id;
      settings.labels = [];
      commit(true);
      renderChips();
    }, settings.category === c.id))
  );

  const cat = getCategory(settings.category);
  $('labels').replaceChildren(
    ...cat.labels.map((l) => chip(l.name, l.id, () => {
      settings.labels = toggleIn(settings.labels, l.id);
      commit(true);
      renderChips();
    }, settings.labels.includes(l.id)))
  );

  $('modifiers').replaceChildren(
    ...MODIFIERS.map((m) => chip(m.name, m.id, () => {
      settings.modifiers = toggleIn(settings.modifiers, m.id);
      commit(true);
      renderChips();
    }, settings.modifiers.includes(m.id)))
  );

  $('sources').replaceChildren(
    ...SOURCE_LIST.map((s) => chip(s.name, s.id, () => {
      settings.source = s.id;
      commit(true);
      renderChips();
      syncControls();
    }, settings.source === s.id))
  );

  $('label-hint').textContent = settings.labels.length ? `（${settings.labels.length}件選択中・複数可）` : '（未選択なら全体から）';
  $('source-note').textContent = SOURCE_LIST.find((s) => s.id === settings.source)?.note || '';
}

function chip(label, value, onClick, pressed) {
  const btn = document.createElement('button');
  btn.className = 'chip';
  btn.type = 'button';
  btn.textContent = label;
  btn.dataset.value = value;
  btn.setAttribute('aria-pressed', String(Boolean(pressed)));
  btn.addEventListener('click', onClick);
  return btn;
}

function renderAiOptions() {
  $('ai-style').replaceChildren(
    ...AI_STYLES.map((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      return opt;
    })
  );
}

function renderSounds() {
  $('sounds').replaceChildren(
    ...SOUNDS.map((s) => chip(`${s.emoji} ${s.name}`, s.id, () => {
      settings.audio.enabled = toggleIn(settings.audio.enabled, s.id);
      commitAudio();
      renderSounds();
    }, settings.audio.enabled.includes(s.id)))
  );
  renderSoundMixer();
}

/** 有効な環境音だけ、個別音量スライダーの行を並べる。 */
function renderSoundMixer() {
  $('sound-mixer').replaceChildren(
    ...SOUNDS.filter((s) => settings.audio.enabled.includes(s.id)).map((s) => {
      const row = document.createElement('div');
      row.className = 'mixer-row';

      const label = document.createElement('span');
      label.textContent = `${s.emoji} ${s.name}`;

      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '1';
      range.value = String(Math.round((settings.audio.volumes[s.id] ?? 0.5) * 100));
      range.setAttribute('aria-label', `${s.name}の音量`);
      range.addEventListener('input', (e) => {
        settings.audio.volumes[s.id] = Number(e.target.value) / 100;
        audio.apply(settings.audio);
      });
      range.addEventListener('change', () => store.save(settings));

      row.append(label, range);
      return row;
    })
  );
}

function syncControls() {
  $('interval').value = settings.interval;
  $('interval-value').textContent = formatInterval(settings.interval);
  $('opt-kenburns').checked = settings.kenburns;
  $('opt-clock').checked = settings.clock;
  $('opt-credit').checked = settings.credit;
  $('opt-wake').checked = settings.wakeLock;
  $('opt-portrait').checked = settings.allowPortrait;
  $('opt-quality').value = settings.quality;
  $('opt-hqonly').checked = settings.hqOnly;

  $('ai-section').hidden = settings.source !== 'ai';
  $('ai-provider').value = settings.ai.provider;
  $('ai-model').value = settings.ai.model;
  $('ai-model').placeholder = AI_DEFAULT_MODELS[settings.ai.provider] || '';
  $('ai-key').value = settings.ai.key;
  $('ai-style').value = settings.ai.style;
  $('ai-extra').value = settings.ai.extra;

  $('clock').hidden = !settings.clock;
  $('clock').dataset.pos = settings.clockPosition;
  $('clock-position-field').hidden = !settings.clock;
  $('clock-position').querySelectorAll('.pos-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.pos === settings.clockPosition));
  });
  $('credit').hidden = !settings.credit || !playlist.current;
  $('btn-info').setAttribute('aria-pressed', String(settings.credit));
  $('btn-play').textContent = playing ? '⏸' : '▶';

  const masterPct = Math.round(settings.audio.master * 100);
  $('opt-master-volume').value = String(masterPct);
  $('master-volume-value').textContent = `${masterPct}%`;
  $('btn-mute').textContent = settings.audio.muted ? '🔇' : '🔊';
  $('btn-mute').setAttribute('aria-pressed', String(settings.audio.muted));

  toggleClock();
}

/** 設定を保存し、必要ならキューを組み直して即座に反映する。 */
function commit(restart = false) {
  store.save(settings);
  const changed = playlist.configure(settings);
  if (restart && changed) {
    if (settings.source === 'ai' && !settings.ai.key) {
      status('AI 生成にはご自身の API キーが必要です。設定パネルで登録してください。', 'error');
      return;
    }
    advance(1);
  }
}

/* ---------------- 環境音 ---------------- */

/**
 * 環境音の設定を保存しエンジンに反映する。チップのクリックなど、ユーザー操作の
 * ハンドラから呼ぶこと（AudioContext の生成/resume がユーザー操作起因である必要があるため）。
 */
async function commitAudio() {
  store.save(settings);
  const ok = await audio.apply(settings.audio);
  if (settings.audio.enabled.length && !settings.audio.muted && !ok) {
    status(audio.supported
      ? 'ブラウザが音声をブロックしています。画面を一度操作してください。'
      : 'このブラウザでは環境音を再生できません。', 'error');
  }
}

function toggleMute() {
  settings.audio.muted = !settings.audio.muted;
  store.save(settings);
  if (settings.audio.enabled.length || audio.running || audio.blocked) audio.apply(settings.audio);
  syncControls();
  status(settings.audio.muted ? '環境音をミュートしました' : '環境音のミュートを解除しました');
}

/** 自動再生ポリシー対策: 前回オンだった環境音を、次に開いたときの最初の操作で鳴らし直す。 */
function armAudioUnlock() {
  if (!settings.audio.enabled.length) return;
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    commitAudio();
  };
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
}

function onAudioState({ blocked }) {
  if (blocked && settings.audio.enabled.length && !settings.audio.muted) {
    status('ブラウザが音声をブロックしています。画面を一度操作してください。', 'error');
  }
}

/* ---------------- 再生制御 ---------------- */

async function advance(dir = 1) {
  if (advancing) return;
  advancing = true;
  clearTimeout(timer);
  let shown = false;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      let item = null;
      try {
        item = dir < 0 ? playlist.prev() : await playlist.next();
      } catch (err) {
        status(err.message || '画像を取得できませんでした', 'error');
        break;
      }
      if (!item) {
        if (dir > 0) status('条件に合う画像が見つかりませんでした。ラベルや条件を変えてみてください。', 'error');
        break;
      }
      try {
        await viewer.show(item, { kenburns: settings.kenburns, duration: settings.interval });
        showCredit(item);
        shown = true;
        break;
      } catch {
        playlist.drop(item);
        dir = 1; // 壊れた画像は前方向で置き換える
      }
    }
    if (!shown && !navigator.onLine) {
      status('オフラインです。キャッシュ済みの画像が尽きました。', 'error');
    }
  } finally {
    advancing = false;
    if (playing) scheduleNext();
  }
}

function scheduleNext() {
  clearTimeout(timer);
  timer = setTimeout(() => advance(1), settings.interval * 1000);
}

function setPlaying(value) {
  playing = value;
  $('btn-play').textContent = playing ? '⏸' : '▶';
  $('btn-play').setAttribute('aria-label', playing ? '一時停止' : '再生');
  if (playing) scheduleNext();
  else clearTimeout(timer);
  status(playing ? '再生中' : '一時停止');
}

function showCredit(item) {
  $('credit').hidden = !settings.credit;
  $('credit-title').textContent = item.title || '';
  $('credit-author').textContent = item.author ? `© ${item.author}` : '';
  const license = $('credit-license');
  license.textContent = item.license || '';
  if (item.licenseUrl) { license.href = item.licenseUrl; license.hidden = false; }
  else { license.removeAttribute('href'); license.hidden = !item.license; }
  const source = $('credit-source');
  if (item.sourceUrl) { source.href = item.sourceUrl; source.hidden = false; source.textContent = item.provider || '出典'; }
  else { source.hidden = true; }
}

/* ---------------- イベント ---------------- */

function bindEvents() {
  $('btn-panel').addEventListener('click', () => togglePanel(true));
  $('btn-close-panel').addEventListener('click', () => togglePanel(false));
  $('panel-scrim').addEventListener('click', () => togglePanel(false));
  $('btn-next').addEventListener('click', () => advance(1));
  $('btn-prev').addEventListener('click', () => advance(-1));
  $('btn-play').addEventListener('click', () => setPlaying(!playing));
  $('btn-full').addEventListener('click', toggleFullscreen);
  $('btn-info').addEventListener('click', () => {
    settings.credit = !settings.credit;
    store.save(settings);
    syncControls();
    if (settings.credit && playlist.current) showCredit(playlist.current);
  });

  $('interval').addEventListener('input', (e) => {
    settings.interval = Number(e.target.value);
    $('interval-value').textContent = formatInterval(settings.interval);
  });
  $('interval').addEventListener('change', () => { store.save(settings); if (playing) scheduleNext(); });

  $('opt-master-volume').addEventListener('input', (e) => {
    settings.audio.master = Number(e.target.value) / 100;
    $('master-volume-value').textContent = `${e.target.value}%`;
    audio.apply(settings.audio);
  });
  $('opt-master-volume').addEventListener('change', () => store.save(settings));
  $('btn-mute').addEventListener('click', toggleMute);

  $('clock-position').querySelectorAll('.pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      settings.clockPosition = btn.dataset.pos;
      store.save(settings);
      syncControls();
    });
  });

  bindSwitch('opt-kenburns', 'kenburns');
  bindSwitch('opt-clock', 'clock', () => { syncControls(); });
  bindSwitch('opt-credit', 'credit', () => { syncControls(); });
  bindSwitch('opt-portrait', 'allowPortrait', () => commit(true));
  bindSwitch('opt-hqonly', 'hqOnly', () => commit(true));
  bindSwitch('opt-wake', 'wakeLock', () => applyWakeLock());

  $('opt-quality').addEventListener('change', (e) => {
    settings.quality = e.target.value;
    commit(true);
  });

  $('ai-provider').addEventListener('change', (e) => {
    settings.ai.provider = e.target.value;
    settings.ai.model = '';
    syncControls();
    commit(true);
  });
  ['ai-model', 'ai-extra'].forEach((idAttr) => {
    $(idAttr).addEventListener('change', (e) => {
      settings.ai[idAttr === 'ai-model' ? 'model' : 'extra'] = e.target.value.trim();
      commit(true);
    });
  });
  $('ai-style').addEventListener('change', (e) => { settings.ai.style = e.target.value; commit(true); });
  $('ai-save').addEventListener('click', () => {
    settings.ai.key = $('ai-key').value.trim();
    settings.ai.model = $('ai-model').value.trim();
    settings.ai.extra = $('ai-extra').value.trim();
    store.save(settings);
    playlist.configure(settings);
    status(settings.ai.key ? 'API キーをこの端末に保存しました' : 'API キーを空にしました');
    if (settings.ai.key && settings.source === 'ai') advance(1);
  });
  $('ai-clear').addEventListener('click', () => {
    settings.ai.key = '';
    $('ai-key').value = '';
    store.save(settings);
    status('API キーを削除しました');
  });

  $('btn-clear-cache').addEventListener('click', async () => {
    await clearAll();
    status('キャッシュを削除しました');
    updateCacheNote();
  });
  $('btn-reset').addEventListener('click', () => {
    settings = store.reset();
    renderChips();
    renderSounds();
    syncControls();
    playlist.configure(settings);
    if (audio.running || audio.blocked) audio.apply(settings.audio);
    advance(1);
    status('設定を初期化しました');
  });

  document.addEventListener('keydown', onKeyDown);
  fullscreen.onChange(() => {
    $('btn-full').setAttribute('aria-pressed', String(fullscreen.isFullscreen()));
    applyWakeLock();
    markActivity();
  });

  ['mousemove', 'pointerdown', 'wheel', 'touchstart'].forEach((evt) =>
    window.addEventListener(evt, markActivity, { passive: true })
  );
  window.addEventListener('resize', markActivity, { passive: true });

  bindSwipe();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    showInstallButton();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (playing) scheduleNext();
      // 環境音は意図的に止めない。ブラウザがバックグラウンドで ctx を
      // サスペンドしていた場合のみ、復帰時にレジュームを試みる。
      if (audio.blocked) audio.ensureContext();
      checkForUpdate();
    } else {
      clearTimeout(timer);
    }
  });
}

function bindSwitch(elementId, key, after) {
  $(elementId).addEventListener('change', (e) => {
    settings[key] = e.target.checked;
    store.save(settings);
    if (after) after();
  });
}

function onKeyDown(e) {
  if (e.target.matches('input, select, textarea')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === ' ' || key === 'spacebar') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowRight') advance(1);
  else if (e.key === 'ArrowLeft') advance(-1);
  else if (key === 'f') toggleFullscreen();
  else if (key === 's') togglePanel($('panel').hidden);
  else if (key === 'i') $('btn-info').click();
  else if (key === 'm') toggleMute();
  else if (e.key === 'Escape') togglePanel(false);
}

function bindSwipe() {
  const stage = $('stage');
  let x0 = null;
  let y0 = null;
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) advance(dx < 0 ? 1 : -1);
  });
}

function togglePanel(open) {
  $('panel').hidden = !open;
  $('panel-scrim').hidden = !open;
  if (open) { markActivity(); updateCacheNote(); }
}

async function toggleFullscreen() {
  try {
    await fullscreen.toggle(document.documentElement);
  } catch {
    status('このブラウザでは全画面表示を開始できませんでした', 'error');
  }
}

async function applyWakeLock() {
  const shouldHold = settings.wakeLock && fullscreen.isFullscreen();
  if (shouldHold) {
    const method = await wake.enable();
    if (method === 'none') status('この環境ではスリープ抑制を利用できません', 'error');
  } else {
    await wake.disable();
  }
}

/* ---------------- 表示補助 ---------------- */

function markActivity() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!$('panel').hidden) return;
  idleTimer = setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
}

function status(message, kind = '') {
  const el = $('status');
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 6000 : 2600);
}

function toggleClock() {
  clearInterval(clockTimer);
  if (!settings.clock) return;
  const tick = () => {
    const now = new Date();
    $('clock-time').textContent = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    $('clock-date').textContent = now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' });
  };
  tick();
  clockTimer = setInterval(tick, 10000);
}

async function updateCacheNote() {
  const used = await usage();
  const base = '画像は Service Worker が上限つきでキャッシュします。';
  $('cache-note').textContent = used === null
    ? base
    : `${base}現在の使用量: 約 ${(used / 1024 / 1024).toFixed(1)} MB`;
}

function showInstallButton() {
  if ($('btn-install')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-install';
  btn.className = 'btn';
  btn.textContent = 'アプリとしてインストール';
  btn.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    btn.remove();
  });
  $('btn-clear-cache').parentElement.prepend(btn);
}

/**
 * Service Worker を登録し、起動時と再開時にサーバー側の最新版と照合する。
 * 新しいバージョンが見つかって制御が切り替わったら、ページを再読み込みして反映する。
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
      checkForUpdate();
      swRegistration.addEventListener('updatefound', () => {
        const worker = swRegistration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // controller が既にあるなら初回インストールではなく更新
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            status('新しいバージョンに更新します…');
          }
        });
      });
    } catch {
      /* file:// で開いた場合など。オフライン対応が無効になるだけ */
    }
  });
}

/** サーバー側の sw.js を取得し直し、更新があれば適用する（起動時・再開時に呼ぶ）。 */
function checkForUpdate() {
  swRegistration?.update().catch(() => {});
}

/** 秒単位の間隔を「5分」「90分」のような表示用ラベルにする。 */
function formatInterval(seconds) {
  const minutes = Math.round(seconds / 60);
  return `${minutes}分`;
}

function toggleIn(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
