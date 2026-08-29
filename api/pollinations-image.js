// Vercel Serverless Function
// Pollinations: OpenAI-compatible POST /v1/images/generations
// Vercel Environment Variable: POLLINATIONS_API_KEY (sk_...)

function buildPrompt(title, text) {
  const t = String(title || '').trim().slice(0, 500);
  const p = String(text || '').trim().slice(0, 14000);

  return [
    'Create one original landscape image directly inspired by the Turkish poem below.',
    'The poem itself is the primary source. The image must specifically reflect its setting, people, objects, actions, metaphors and emotions.',
    'Do not make a generic poetry image. Do not add unrelated subjects.',
    'Style: cinematic photography, poetic, emotional, atmospheric, realistic, elegant composition, natural film lighting, depth of field, subtle film color grading.',
    'If the poem is romantic, melancholic, hopeful, dark, nostalgic or dreamy, reflect that mood naturally.',
    'No GIF, no collage, no watermark, no logo, no readable text, no captions or letters inside the image.',
    'Landscape composition suitable for a poetry post.',
    t ? `Poem title: ${t}` : '',
    'Turkish poem:',
    p
  ].filter(Boolean).join('\n\n');
}

async function readBody(response) {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return await response.json(); } catch (_) { return null; }
  }
  try { return await response.text(); } catch (_) { return ''; }
}

function describeError(status, body) {
  if (body && typeof body === 'object') {
    const msg = body.error?.message || body.error || body.message || body.detail;
    if (msg) return String(msg);
    try { return JSON.stringify(body).slice(0, 1000); } catch (_) {}
  }
  return String(body || `HTTP ${status}`).slice(0, 1000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
  }

  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (!key) {
    return res.status(500).json({
      error: 'POLLINATIONS_API_KEY Vercel Environment Variable bulunamadı.'
    });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni boş.' });
  }

  const prompt = buildPrompt(title, text);

  // Pollinations'ın güncel OpenAI-compatible image endpoint'i.
  // GET yerine POST kullanıyoruz; böylece uzun şiir URL sınırına takılmaz.
  const endpoint = 'https://gen.pollinations.ai/v1/images/generations';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'flux',
        prompt,
        n: 1,
        size: '1024x576',
        response_format: 'b64_json'
      })
    });

    const body = await readBody(response);

    if (!response.ok) {
      return res.status(502).json({
        error: `Pollinations ${response.status}: ${describeError(response.status, body)}`,
        provider: 'pollinations',
        model: 'flux'
      });
    }

    const item = body?.data?.[0];
    const b64 = item?.b64_json;

    if (!b64) {
      return res.status(502).json({
        error: 'Pollinations başarılı yanıt verdi fakat data[0].b64_json bulunamadı.',
        provider: 'pollinations',
        model: 'flux',
        responseKeys: body && typeof body === 'object' ? Object.keys(body) : []
      });
    }

    const mime = 'image/png';
    const buffer = Buffer.from(b64, 'base64');

    if (!buffer.length) {
      return res.status(502).json({
        error: 'Pollinations boş görsel döndürdü.',
        provider: 'pollinations',
        model: 'flux'
      });
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'pollinations');
    res.setHeader('X-AI-Model', 'flux');
    return res.status(200).send(buffer);

  } catch (err) {
    return res.status(502).json({
      error: `Pollinations bağlantı hatası: ${err?.message || String(err)}`,
      provider: 'pollinations',
      model: 'flux'
    });
  }
}
