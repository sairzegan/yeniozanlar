// Vercel Serverless Function: Pollinations'tan doğrudan AI görseli alır.
// Environment Variable: POLLINATIONS_API_KEY (sk_...)
// Resmi endpoint: GET https://gen.pollinations.ai/image/{prompt}?model=flux

function buildPrompt(title, text) {
  const safeTitle = String(title || '').trim().slice(0, 300);
  // GET endpoint URL'si çok büyümesin diye şiirin tamamını makul bir sınırda tutuyoruz.
  const safeText = String(text || '').trim().slice(0, 9000);

  return [
    'Create ONE original cinematic visual inspired directly by the Turkish poem below.',
    'The poem is the PRIMARY source for the scene. Visually represent its actual subject, imagery, setting, actions and emotions.',
    'Do not make a generic poetry image and do not add unrelated objects or locations.',
    'Style: cinematic photography, poetic, emotional, atmospheric, realistic, elegant composition, natural film lighting, depth, subtle color grading.',
    'Use romantic, melancholic, dreamy or dramatic atmosphere only if it fits the poem.',
    'No GIF, no collage, no stock-photo look, no watermark, no logo, no readable text, no letters, no captions inside the image.',
    'Wide landscape 16:9 composition suitable for a poetry social-media post.',
    safeTitle ? `Title: ${safeTitle}` : '',
    'Turkish poem:',
    safeText
  ].filter(Boolean).join('\n\n');
}

function errorText(status, body) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim();
  return `Pollinations HTTP ${status}${clean ? `: ${clean.slice(0, 500)}` : ''}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
  }

  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();
  if (!key) {
    return res.status(500).json({ error: 'POLLINATIONS_API_KEY Vercel Environment Variable olarak tanımlı değil.' });
  }

  const title = String(req.body?.title || '');
  const text = String(req.body?.text || '');
  if (!text.trim()) {
    return res.status(400).json({ error: 'Şiir metni boş.' });
  }

  const prompt = buildPrompt(title, text);
  const base = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`;
  const url = `${base}?model=flux&width=1024&height=576&nologo=true`;

  // Önce resmi dokümantasyondaki Bearer authentication yöntemini kullan.
  // Bazı gateway sürümlerinde query-key kabul edildiği için ikinci deneme de var.
  const attempts = [
    { url, headers: { Authorization: `Bearer ${key}`, Accept: 'image/*' } },
    { url: `${url}&key=${encodeURIComponent(key)}`, headers: { Accept: 'image/*' } }
  ];

  let lastError = '';

  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, {
        method: 'GET',
        headers: attempt.headers,
        redirect: 'follow'
      });

      const contentType = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

      if (!r.ok) {
        const body = await r.text().catch(() => '');
        lastError = errorText(r.status, body);
        continue;
      }

      if (!contentType.startsWith('image/')) {
        const body = await r.text().catch(() => '');
        lastError = `Pollinations image yerine ${contentType || 'bilinmeyen'} yanıt döndürdü${body ? `: ${body.slice(0, 500)}` : ''}`;
        continue;
      }

      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length) {
        lastError = 'Pollinations boş görsel döndürdü.';
        continue;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-AI-Provider', 'pollinations');
      res.setHeader('X-AI-Model', 'flux');
      return res.status(200).send(buffer);
    } catch (err) {
      lastError = err?.message || String(err);
    }
  }

  return res.status(502).json({
    error: `Pollinations görseli oluşturamadı. ${lastError}`,
    provider: 'pollinations',
    model: 'flux'
  });
}
