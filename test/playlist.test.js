import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Playlist } from '../js/playlist.js';
import { DEFAULTS } from '../js/settings.js';

// quality を固定値にして resolveWidth の window 依存を避ける。
function baseSettings(overrides = {}) {
  return structuredClone({ ...DEFAULTS, quality: '1600', ...overrides });
}

function seedItem(id) {
  return { id: `seed:${id}`, src: `https://example.com/${id}.jpg`, title: `item ${id}` };
}

/** buffer に十分な件数を積み、テスト中に fill()（＝実fetch）が発火しないようにする。 */
function seedBuffer(playlist, count = 20) {
  playlist.buffer.push(...Array.from({ length: count }, (_, i) => seedItem(i)));
}

describe('configure', () => {
  test('初回呼び出しは true を返す', () => {
    const p = new Playlist();
    assert.equal(p.configure(baseSettings()), true);
  });

  test('同一設定の再呼び出しは false を返す', () => {
    const p = new Playlist();
    p.configure(baseSettings());
    assert.equal(p.configure(baseSettings()), false);
  });

  test('カテゴリを変えると true を返す', () => {
    const p = new Playlist();
    p.configure(baseSettings({ category: 'mountain' }));
    assert.equal(p.configure(baseSettings({ category: 'sea' })), true);
  });

  test('ラベルの指定順だけが違う場合は false（無駄な作り直しをしない）', () => {
    const p = new Playlist();
    p.configure(baseSettings({ labels: ['alps', 'fuji'] }));
    assert.equal(p.configure(baseSettings({ labels: ['fuji', 'alps'] })), false);
  });

  test('雰囲気の指定順だけが違う場合も false', () => {
    const p = new Playlist();
    p.configure(baseSettings({ modifiers: ['night', 'mist'] }));
    assert.equal(p.configure(baseSettings({ modifiers: ['mist', 'night'] })), false);
  });

  test('signature 変更時に buffer/history/seen/offsets がリセットされる', () => {
    const p = new Playlist();
    p.configure(baseSettings({ category: 'mountain' }));
    seedBuffer(p, 5);
    p.history.push(seedItem('history-1'));
    p.pos = 0;
    p.seen.add('some-id');
    p.offsets.set('some-key', 42);

    p.configure(baseSettings({ category: 'sea' }));

    assert.deepEqual(p.buffer, []);
    assert.deepEqual(p.history, []);
    assert.equal(p.pos, -1);
    assert.equal(p.seen.size, 0);
    assert.equal(p.offsets.size, 0);
  });

  test('hqOnly=true なら minWidth は1920、falseなら0', () => {
    const p = new Playlist();
    p.configure(baseSettings({ hqOnly: true }));
    assert.equal(p.minWidth, 1920);
    p.configure(baseSettings({ hqOnly: false }));
    assert.equal(p.minWidth, 0);
  });
});

describe('next / prev / current / canGoBack（シード済みbufferに対して）', () => {
  test('初期状態では current は null、canGoBack は false', () => {
    const p = new Playlist();
    p.configure(baseSettings());
    assert.equal(p.current, null);
    assert.equal(p.canGoBack, false);
  });

  test('next() は buffer から取り出して history に積み、current を更新する', async () => {
    const p = new Playlist();
    p.configure(baseSettings());
    seedBuffer(p, 20);

    const first = await p.next();
    assert.equal(first.id, 'seed:0');
    assert.equal(p.current, first);
    assert.equal(p.canGoBack, false); // history が1件だけなので戻れない

    const second = await p.next();
    assert.equal(second.id, 'seed:1');
    assert.equal(p.canGoBack, true);
  });

  test('prev() で1つ前の item に戻り、その後の next() は再取得せず履歴を前進する', async () => {
    const p = new Playlist();
    p.configure(baseSettings());
    seedBuffer(p, 20);

    const first = await p.next();
    const second = await p.next();
    const back = p.prev();
    assert.equal(back, first);
    assert.equal(p.current, first);

    const forwardAgain = await p.next();
    assert.equal(forwardAgain, second, '履歴を前進しているので同じ item に戻るはず');
  });

  test('prev() は先頭で false 相当（null）を返し、それ以上戻らない', async () => {
    const p = new Playlist();
    p.configure(baseSettings());
    seedBuffer(p, 20);
    await p.next();
    assert.equal(p.canGoBack, false);
    assert.equal(p.prev(), null);
  });
});

describe('drop', () => {
  test('該当 item を履歴から取り除き、posをクランプする', async () => {
    const p = new Playlist();
    p.configure(baseSettings());
    seedBuffer(p, 20);

    const first = await p.next();
    const second = await p.next();
    const third = await p.next();
    assert.equal(p.pos, 2);

    p.drop(third);

    assert.equal(p.history.includes(third), false);
    assert.deepEqual(p.history, [first, second]);
    assert.equal(p.pos, 1);
  });
});
