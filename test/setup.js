// node --test の起動時に一度だけ読み込まれるグローバルセットアップ。
// アプリ側のモジュールはブラウザ環境を前提にしているので、jsdom で
// 最小限のグローバル（DOM・localStorage・screen・Image）を用意する。

import { JSDOM } from 'jsdom';

// about:blank（既定）は opaque origin になり localStorage が SecurityError で
// 落ちるため、実オリジンを明示する。
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://fuukei.test/',
  pretendToBeVisual: true
});

// Node 22 は navigator 等をすでに getter-only なグローバルとして持っているため、
// 単純代入では TypeError になる。defineProperty で上書き可能にする。
function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

define('window', dom.window);
define('document', dom.window.document);
define('DOMParser', dom.window.DOMParser);
define('localStorage', dom.window.localStorage);
define('navigator', dom.window.navigator);
define('screen', dom.window.screen);
define('Image', dom.window.Image);

// 各テストは globalThis.fetch を自前でスタブする前提。取りこぼした呼び出しが
// あれば、静かに実ネットワークへ出て行く代わりにテストを失敗させる安全網。
globalThis.fetch = async (url) => {
  throw new Error(`テストがスタブしていない fetch が呼ばれました: ${url}`);
};
