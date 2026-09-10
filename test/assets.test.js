// sw.js はトップレベルで self.addEventListener を呼ぶため import できない。
// テキストとして読み、APP_SHELL 配列やキャッシュ名の宣言を正規表現で取り出して検証する。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function extractAppShell(swSource) {
  const m = swSource.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'sw.js に APP_SHELL 配列が見つからない');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function extractConst(source, name) {
  const m = source.match(new RegExp(`const ${name} = ['"\`]([^'"\`]+)['"\`]`));
  assert.ok(m, `${name} の宣言が見つからない`);
  return m[1];
}

/** 拡張子で始まり "文字通り" 展開できるテンプレートリテラル(${VERSION}等)を含む定数も拾う。 */
function extractTemplateConst(source, name) {
  const m = source.match(new RegExp(`const ${name} = \`([^\`]+)\``));
  assert.ok(m, `${name} の宣言が見つからない`);
  return m[1];
}

function listFiles(dir, filterExt) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { recursive: true })
    .filter((f) => filterExt.some((ext) => f.endsWith(ext)))
    .map((f) => `./${dir}/${f.split(path.sep).join('/')}`);
}

const swSource = read('sw.js');
const cacheSource = read('js/cache.js');
const appShell = extractAppShell(swSource);

describe('sw.js の APP_SHELL', () => {
  test('js/**/*.js・css/*.css・icons/* の実ファイルがすべて含まれる（追加時の書き忘れ検出）', () => {
    const onDisk = [
      ...listFiles('js', ['.js']),
      ...listFiles('css', ['.css']),
      ...listFiles('icons', ['.svg', '.png', '.ico'])
    ];
    const missing = onDisk.filter((f) => !appShell.includes(f));
    assert.deepEqual(missing, [], `APP_SHELL に含まれていないファイル: ${missing.join(', ')}`);
  });

  test('APP_SHELL の各エントリが実在する（"./" を除く）', () => {
    const missing = appShell.filter((entry) => entry !== './' && !fs.existsSync(path.join(ROOT, entry)));
    assert.deepEqual(missing, [], `実在しない APP_SHELL エントリ: ${missing.join(', ')}`);
  });
});

describe('画像キャッシュ名の同期', () => {
  test('cache.js の IMG_CACHE_NAME と sw.js の IMG_CACHE が一致する', () => {
    const version = extractConst(swSource, 'VERSION');
    const swImgCache = extractTemplateConst(swSource, 'IMG_CACHE').replace('${VERSION}', version);
    const clientImgCache = extractConst(cacheSource, 'IMG_CACHE_NAME');
    assert.equal(
      clientImgCache,
      swImgCache,
      'js/cache.js の IMG_CACHE_NAME を sw.js の VERSION 変更に合わせて更新し忘れています'
    );
  });
});

describe('index.html のローカル参照', () => {
  test('"./" で始まる href / src がすべて実在する', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, 'index.html からローカル参照を1件も抽出できなかった（正規表現が壊れている可能性）');
    const missing = refs.filter((ref) => !fs.existsSync(path.join(ROOT, ref)));
    assert.deepEqual(missing, [], `実在しない参照: ${missing.join(', ')}`);
  });
});

describe('manifest.webmanifest', () => {
  test('妥当なJSONで、全アイコンファイルが実在する', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
    const missing = manifest.icons
      .map((icon) => icon.src)
      .filter((src) => !fs.existsSync(path.join(ROOT, src)));
    assert.deepEqual(missing, [], `実在しないアイコン: ${missing.join(', ')}`);
  });
});
