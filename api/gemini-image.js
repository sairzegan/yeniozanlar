// /api/gemini-image.js
// Google Gemini ("Nano Banana" — gemini-2.5-flash-image) üzerinden görsel üretir.
// Dördüncü ve son AI görsel sağlayıcısı olarak devreye girer (bkz. index.html
// içinde adminYapayZekaGorseliYenile / geminiGorselDene). Aynı GEMINI_API_KEY,
// mevcut /api/gemini.js (şiir yorumlama) tarafından da kullanılıyor.
//
// Vercel Environment Variable (muhtemelen zaten tanımlı):
// GEMINI_API_KEY = AIza...
// Anahtar buradan alınır: https://aistudio.google.com/apikey
//
// flux-image.js ve huggingface-image.js ile aynı üslupta: ham görsel
// binary'sini (image/*) doğrudan döndürür, JSON sarmalamaz.

// Not: "gemini-2.5-flash-image" (Nano Banana), Google'ın en geniş ücretsiz
// kotaya sahip görsel modelidir. Daha yüksek kalite/daha yeni dünya bilgisi
// isterse admin bunu 'gemini-3.1-flash-image' (Nano Banana 2) ile
// değiştirebilir — aşağıdaki MODEL sabitini güncellemek yeterli.
const MODEL = 'gemini-2.5-flash-image';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 60000;

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);
  // Önbellek kırıcı — bkz. flux-image.js'teki aynı isimli değişken.
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
    const response = await fetchWithTimeout(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] }
      })
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    if (!response.ok) {
      const detail = data?.error?.message || raw.slice(0, 500);
      return res.status(response.status).json({
        error: `Gemini HTTP ${response.status}${detail ? ` — ${detail}` : ''}`
      });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p?.inlineData?.data);

    if (!imagePart) {
      // Güvenlik filtresi görseli engellemiş olabilir (finishReason: SAFETY) ya da
      // model yalnızca metin döndürmüş olabilir.
      const finishReason = data?.candidates?.[0]?.finishReason;
      const textPart = parts.find(p => p?.text)?.text;
      const detail = finishReason ? `finishReason: ${finishReason}` : (textPart ? textPart.slice(0, 300) : 'görsel verisi yok');
      return res.status(502).json({ error: `Gemini görsel döndürmedi (${detail}).` });
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    if (!buffer.length) {
      return res.status(502).json({ error: 'Gemini boş görsel döndürdü.' });
    }

    const contentType = imagePart.inlineData.mimeType || 'image/png';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'gemini');
    res.setHeader('X-AI-Model', MODEL);
    return res.status(200).send(buffer);
  } catch (err) {
    const msg =
      err?.name === 'AbortError'
        ? 'Gemini isteği zaman aşımına uğradı.'
        : (err?.message || 'Gemini bağlantı hatası.');
    return res.status(502).json({ error: msg });
  }
}
