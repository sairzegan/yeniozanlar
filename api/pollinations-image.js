// /api/pollinations-image.js
// Dedicated Pollinations image endpoint for the admin "AI image" button.
// Vercel Environment Variable required:
// POLLINATIONS_API_KEY = sk_...
//
// This endpoint intentionally uses Pollinations' documented GET /image/{prompt}
// endpoint and returns JSON { imageData, provider, model } to the browser.
// The API key never leaves the server.

function makePrompt(title, text) {
  const poemTitle = String(title || '').trim().slice(0, 300);
  const poem = String(text || '').trim().slice(0, 5000);

  return [
    'Create ONE original landscape image directly inspired by the Turkish poem below.',
    'The poem is the primary source. Visually interpret its actual subject, setting, objects, actions, imagery and emotions.',
    'Do not make a generic poetry image and do not add unrelated objects.',
    'Style: cinematic, poetic, emotional, atmospheric, realistic, elegant composition, natural film lighting, subtle film color grading, depth of field.',
    'Choose romantic, melancholic, dreamy, nostalgic or dramatic atmosphere only when it fits the poem.',
    'No GIF, no collage, no stock-photo look, no logo, no watermark, no readable text, no letters, no captions inside the image.',
    'Landscape 16:9 composition suitable for a poetry post.',
    poemTitle ? `Title: ${poemTitle}` : '',
    `Turkish poem:\n${poem}`
  ].filter(Boolean).join('\n\n');
}

async function getErrorText(r) {
  try {
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await r.json();
      return String(j?.error?.message || j?.error || j?.message || JSON.stringify(j)).slice(0, 1200);
    }
    return (await r.text()).slice(0, 1200);
  } catch (_) {
    return `HTTP ${r.status}`;
  }
}

async function fetchPollinations(url, key) {
  return fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'image/*'
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Sadece POST destekleniyor.' });
  }

  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (!key) {
    return res.status(500).json({
      error: 'POLLINATIONS_API_KEY Vercel Production Environment Variables içinde bulunamadı.'
    });
  }

  const title = String(req.body?.title || '');
  const text = String(req.body?.text || '');
  if (!text.trim()) {
    return res.status(400).json({ error: 'Şiir metni boş.' });
  }

  const prompt = makePrompt(title, text);
  const encoded = encodeURIComponent(prompt);

  // Official Pollinations image endpoint.
  const base =
    `https://gen.pollinations.ai/image/${encoded}` +
    `?model=flux&width=1024&height=576&nologo=true`;

  const errors = [];

  // Attempt 1: documented Bearer authentication.
  try {
    const r = await fetchPollinations(base, key);
    if (r.ok) {
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!ct.startsWith('image/')) {
        errors.push(`Bearer: görsel yerine ${ct} döndü`);
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length) {
          return res.status(200).json({
            imageData: `data:${ct};base64,${bytes.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          });
        }
        errors.push('Bearer: boş görsel döndü');
      }
    } else {
      errors.push(`Bearer HTTP ${r.status}: ${await getErrorText(r)}`);
    }
  } catch (e) {
    errors.push(`Bearer bağlantı hatası: ${e?.message || e}`);
  }

  // Attempt 2: Pollinations also documents ?key= authentication.
  // The key is used only in this server-to-server request and is never returned.
  try {
    const sep = base.includes('?') ? '&' : '?';
    const r = await fetchPollinations(
      `${base}${sep}key=${encodeURIComponent(key)}`,
      key
    );
    if (r.ok) {
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!ct.startsWith('image/')) {
        errors.push(`Query-key: görsel yerine ${ct} döndü`);
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length) {
          return res.status(200).json({
            imageData: `data:${ct};base64,${bytes.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          });
        }
        errors.push('Query-key: boş görsel döndü');
      }
    } else {
      errors.push(`Query-key HTTP ${r.status}: ${await getErrorText(r)}`);
    }
  } catch (e) {
    errors.push(`Query-key bağlantı hatası: ${e?.message || e}`);
  }

  return res.status(502).json({
    error: `Pollinations görsel üretilemedi. ${errors.join(' | ')}`,
    provider: 'pollinations',
    model: 'flux'
  });
}
