// テスト用の fetch モック。setup.js が用意する「未スタブなら throw する」
// 既定の fetch を退避しておき、各テストはこれで一時的に差し替える。

const ORIGINAL_FETCH = globalThis.fetch;

/**
 * @param {(url: string, init: object, callIndex: number) => {status?: number, body?: any}} handler
 * @returns {{url: string, init: object}[]} 呼び出しの記録（呼ぶたびに追記される）
 */
export function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    const index = calls.length;
    calls.push({ url: urlStr, init });
    const result = await handler(urlStr, init, index);
    const { status = 200, body = {} } = result || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    };
  };
  return calls;
}

/** 各テストの afterEach で必ず呼び、未スタブ検出用の既定 fetch に戻す。 */
export function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

export function paramsOf(url) {
  return new URL(url).searchParams;
}
