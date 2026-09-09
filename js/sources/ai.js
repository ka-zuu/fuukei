// AI 生成モード。ユーザー自身の API キーでプロバイダへ直接リクエストする。
// キーはこのモジュールから外部へ送られることはない（各社のエンドポイント宛のみ）。

export const id = 'ai';
export const name = 'AI 生成';
export const note = 'ご自身の API キーを設定してください。生成のたびに各プロバイダへ課金されます。';

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations';

/**
 * 1 枚生成して item 形式で返す。
 * @param {{provider: string, model: string, key: string, prompt: string, signal?: AbortSignal}} opts
 */
export async function generate({ provider, model, key, prompt, signal }) {
  if (!key) throw new Error('API キーが未設定です。設定パネルで登録してください。');

  let base64;
  let mime = 'image/png';
  try {
    if (provider === 'openai') {
      ({ base64, mime } = await openai({ model, key, prompt, signal }));
    } else if (provider === 'google-gemini') {
      ({ base64, mime } = await geminiImage({ model, key, prompt, signal }));
    } else {
      ({ base64, mime } = await imagen({ model, key, prompt, signal }));
    }
  } catch (err) {
    throw translate(err, provider);
  }

  const blob = base64ToBlob(base64, mime);
  return {
    id: `ai:${crypto.randomUUID()}`,
    provider: `${labelOf(provider)} / ${model}`,
    title: prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt,
    src: URL.createObjectURL(blob),
    revoke: true,
    width: 0,
    height: 0,
    mime,
    author: 'AI 生成',
    license: '生成画像（各プロバイダの利用規約に従います）',
    licenseUrl: '',
    sourceUrl: ''
  };
}

async function imagen({ model, key, prompt, signal }) {
  const res = await fetch(`${GOOGLE_BASE}/${encodeURIComponent(model)}:predict`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'dont_allow' }
    })
  });
  const data = await parse(res);
  const pred = data?.predictions?.[0];
  const base64 = pred?.bytesBase64Encoded;
  if (!base64) throw new Error('画像が返りませんでした（プロンプトが弾かれた可能性があります）。');
  return { base64, mime: pred.mimeType || 'image/png' };
}

async function geminiImage({ model, key, prompt, signal }) {
  const res = await fetch(`${GOOGLE_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    })
  });
  const data = await parse(res);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline) throw new Error('画像が返りませんでした（プロンプトが弾かれた可能性があります）。');
  return { base64: inline.data, mime: inline.mimeType || 'image/png' };
}

async function openai({ model, key, prompt, signal }) {
  const res = await fetch(OPENAI_IMAGES, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, prompt, size: '1536x1024', n: 1 })
  });
  const data = await parse(res);
  const first = data?.data?.[0];
  if (first?.b64_json) return { base64: first.b64_json, mime: 'image/png' };
  if (first?.url) {
    const img = await fetch(first.url, { signal });
    const blob = await img.blob();
    return { base64: await blobToBase64(blob), mime: blob.type || 'image/png' };
  }
  throw new Error('画像が返りませんでした。');
}

async function parse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* JSON でない応答 */ }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${msg}`);
  }
  return data;
}

function translate(err, provider) {
  if (err.name === 'AbortError') return err;
  const msg = String(err.message || err);
  if (err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return new Error(`${labelOf(provider)} に接続できませんでした。ネットワーク、またはブラウザからの直接呼び出し（CORS）が拒否された可能性があります。`);
  }
  if (/^401|^403/.test(msg)) return new Error('API キーが無効か、権限がありません。');
  if (/^429/.test(msg)) return new Error('レート制限または残高不足です。時間をおいて再試行してください。');
  return new Error(`生成に失敗しました — ${msg}`);
}

function labelOf(provider) {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'google-gemini') return 'Google Gemini';
  return 'Google Imagen';
}

function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
