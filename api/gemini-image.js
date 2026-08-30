// /api/gemini-image.js
// Google Gemini ("Nano Banana" / gemini-3.1-flash-image) ile görsel üretir.
// Cloudflare FLUX, Pollinations ve Hugging Face üçü de başarısız olursa
// dördüncü AI sağlayıcısı olarak devreye girer (bkz. index.html içinde
// adminYapayZekaGorseliYenile / geminiGorselDene).
//
// Vercel Environment Variable:
// GEMINI_API_KEY = ...
// (Şiir puanlama özelliği için zaten tanımlıysa aynı anahtar burada da kullanılır,
// ayrı bir anahtar eklemeniz gerekmez.)
//
// flux-image.js / huggingface-image.js ile aynı sözleşme: ham görsel binary'sini
// (image/*) doğrudan döndürür, JSON sarmalamaz — istemci tarafı tüm sağlayıcıları
// tek bir blob-işleme koduyla aynı şekilde işleyebilsin diye.

const MODEL = 'gemini-3.1-flash-image';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 60000;

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);
  // Önbellek kırıcı — flux-image.js / huggingface-image.js'teki aynı fikir.
  const varyasyon = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return [
    'Create one original cinematic image directly inspired by the Turkish poem below.',
    'Use the actual meaning of the poem as the primary visual source: its setting, people, objects, actions, symbols, metaphors and emotions.',
    'Do not create a generic poetry image and do not invent an unrelated scene.',
    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',
    'IMPORTANT: absolutely NO text anywhere in the image. No letters, no words, no captions, no typography, no signs, no logos, no watermark.',
    heading ? `Turkish poem title: ${heading}` : '',
    `Turkish poem:\n${poem}`,
    `Internal variation tag (ignore, do not depict, do not render as text): ${varyasyon}`
  ].filter(Boolean).join('\n\n');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Sadece POST destekleniyor.' });
  }

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY Vercel Environment Variables içinde bulunamadı.'
    });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni gönderilemedi.' });
  }

  const prompt = buildPrompt(title, text);

  try {
    const r = await fetchWithTimeout(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });

    const raw = await r.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    if (!r.ok) {
      const detail = data?.error?.message || raw.slice(0, 400);
      return res.status(r.status).json({ error: `Gemini HTTP ${r.status}${detail ? ` — ${detail}` : ''}` });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p?.inlineData?.data);

    if (!imgPart) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      const textPart = parts.find(p => p?.text)?.text;
      const detail = [finishReason ? `finishReason: ${finishReason}` : '', textPart ? textPart.slice(0, 200) : '']
        .filter(Boolean).join(' — ');
      return res.status(502).json({ error: `Gemini görsel döndürmedi.${detail ? ` (${detail})` : ''}` });
    }

    const mime = imgPart.inlineData.mimeType || 'image/png';
    const buffer = Buffer.from(imgPart.inlineData.data, 'base64');
    if (!buffer.length) {
      return res.status(502).json({ error: 'Gemini boş görsel döndürdü.' });
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'gemini');
    res.setHeader('X-AI-Model', MODEL);
    return res.status(200).send(buffer);
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? 'Gemini isteği zaman aşımına uğradı.'
      : (err?.message || 'Gemini bağlantı hatası.');
    return res.status(502).json({ error: msg });
  }
}
