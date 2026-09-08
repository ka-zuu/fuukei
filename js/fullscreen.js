// 全画面表示（ベンダー接頭辞つきの古い実装にも配慮）。

export function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function enter(el = document.documentElement) {
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) throw new Error('このブラウザは全画面表示に対応していません');
  await request.call(el, { navigationUI: 'hide' });
}

export async function exit() {
  const leave = document.exitFullscreen || document.webkitExitFullscreen;
  if (leave) await leave.call(document);
}

export async function toggle(el) {
  if (isFullscreen()) await exit();
  else await enter(el);
}

export function onChange(handler) {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}

/** 全画面 API が無い環境（iPhone の Safari など）向けの案内が必要か。 */
export function isSupported() {
  return Boolean(
    document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
  );
}
