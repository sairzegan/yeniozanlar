// /api/huggingface-image.js
// Hugging Face Inference API üzerinden FLUX.1-schnell ile görsel üretir.
// Cloudflare FLUX (kota/rate-limit) ve Pollinations ikisi de başarısız olursa
// üçüncü AI sağlayıcısı olarak devreye girer (bkz. index.html içinde
// adminYapayZekaGorseliYenile / huggingfaceGorselDene).
//
// Vercel Environment Variable:
// HUGGINGFACE_API_TOKEN = hf_...
//
// flux-image.js ile aynı üslupta: ham görsel binary'sini (image/*) doğrudan
// döndürür, JSON sarmalamaz — böylece istemci tarafı tek bir blob-işleme
// koduyla üç sağlayıcıyı da aynı şekilde işleyebilir.

const MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}`;
const TIMEOUT_MS = 60000;

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);

  return [
    'Create one original cinematic image directly inspired by the Turkish poem below.',
    'Use the actual meaning of the poem as the primary visual source: its setting, people, objects, actions, symbols, metaphors and emotions.',
    'Do not create a generic poetry image and do not invent an unrelated scene.',
    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',
    'IMPORTANT: absolutely NO text anywhere in the image. No letters, no words, no captions, no typography, no signs, no logos, no watermark.',
    heading ? `Turkish poem title: ${heading}` : '',
    `Turkish poem:\n${poem}`
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

  const token = String(process.env.HUGGINGFACE_API_TOKEN || '').trim();
  if (!token) {
    return res.status(500).json({
      error: 'HUGGINGFACE_API_TOKEN Vercel Environment Variables içinde bulunamadı.'
    });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni gönderilemedi.' });
  }

  const prompt = buildPrompt(title, text);

  try {
    const response = await fetchWithTimeout(HF_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'image/png',
        // Model "cold" ise (henüz belleğe yüklenmemişse) 503 yerine, model hazır
        // olana kadar isteği bekletir — tek denemede başarı ihtimalini artırır.
        'x-wait-for-model': 'true'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { num_inference_steps: 4 }
      })
    });

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (!response.ok) {
      let detail = '';
      try {
        if (contentType.includes('application/json')) {
          const data = await response.json();
          detail = data?.error || JSON.stringify(data).slice(0, 300);
        } else {
          detail = (await response.text()).slice(0, 300);
        }
      } catch (_) {}
      return res.status(response.status).json({
        error: `Hugging Face HTTP ${response.status}${detail ? ` — ${detail}` : ''}`
      });
    }

    if (!contentType.startsWith('image/')) {
      // HF nadiren 200 ile birlikte JSON hata da dönebiliyor.
      let detail = '';
      try {
        const data = await response.json();
        detail = data?.error || JSON.stringify(data).slice(0, 300);
      } catch (_) {}
      return res.status(502).json({
        error: `Hugging Face görsel yerine ${contentType || 'bilinmeyen veri'} döndürdü.${detail ? ` — ${detail}` : ''}`
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      return res.status(502).json({ error: 'Hugging Face boş görsel döndürdü.' });
    }

    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'huggingface');
    res.setHeader('X-AI-Model', MODEL);
    return res.status(200).send(buffer);
  } catch (err) {
    const msg =
      err?.name === 'AbortError'
        ? 'Hugging Face isteği zaman aşımına uğradı.'
        : (err?.message || 'Hugging Face bağlantı hatası.');
    return res.status(502).json({ error: msg });
  }
}
