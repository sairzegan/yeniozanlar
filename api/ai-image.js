// Vercel Serverless Function — şiirden AI görseli üretir.
// Akış: Gemini -> Pollinations. Pollinations görseli JSON/base64 yerine
// doğrudan image/* response olarak döndürür; böylece Vercel JSON response
// boyutu sınırına takılmaz.
// Environment Variables:
//   GEMINI_API_KEY
//   POLLINATIONS_API_KEY

function buildPrompt(title, text) {
  return `Create a cinematic, poetic and emotionally powerful visual inspired DIRECTLY by this Turkish poem.

Title: ${title || '(untitled)'}
Poem:
${text}

Visual direction:
- The poem itself is the main source of the scene. Reflect its actual subject, imagery, place, action and emotion.
- Do not create a generic poetry image. The result must clearly feel connected to THIS poem.
- Cinematic composition, realistic photography or sophisticated cinematic digital art.
- Romantic, melancholic, dreamy or dramatic atmosphere only when it fits the poem.
- Natural film lighting, depth, atmosphere and a strong focal subject.
- Avoid random objects, characters or locations not supported by the poem.
- No meme, GIF, stock-photo look or collage.
- Do not render words, letters, captions, watermarks or typography inside the image.
- Wide landscape composition suitable for a poetry social-media post.`;
}

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function tryGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil.');

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.1-flash-image',
      input: prompt,
      response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' }
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || data?.message || `Gemini HTTP ${r.status}`);

  let b64 = data?.output_image?.data;
  let mime = data?.output_image?.mime_type || 'image/png';
  if (!b64 && Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      for (const block of (step?.content || [])) {
        if (block?.type === 'image' && block?.data) {
          b64 = block.data;
          mime = block.mime_type || mime;
          break;
        }
      }
      if (b64) break;
    }
  }
  if (!b64) throw new Error('Gemini görsel verisi döndürmedi.');
  return { type: 'json', data: { imageData: `data:${mime};base64,${b64}`, provider: 'gemini', model: 'gemini-3.1-flash-image' } };
}

async function tryPollinations(prompt) {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) throw new Error('POLLINATIONS_API_KEY tanımlı değil.');

  // Pollinations'ın resmi image endpoint'i. Secret key server tarafında Bearer
  // header ile gönderilir; istemciye asla anahtar verilmez.
  // Daha küçük bir çıktı kullanıyoruz; böylece Vercel response limitine takılma riski azalır.
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux&width=1024&height=576&nologo=true`;

  let r;
  let lastError = '';
  for (const authMode of ['header', 'query']) {
    const requestUrl = authMode === 'query'
      ? `${url}&key=${encodeURIComponent(key)}`
      : url;
    try {
      r = await fetch(requestUrl, {
        method: 'GET',
        headers: authMode === 'header'
          ? { Authorization: `Bearer ${key}`, Accept: 'image/*' }
          : { Accept: 'image/*' }
      });
      if (r.ok) break;
      const body = await r.text().catch(() => '');
      lastError = `HTTP ${r.status}${body ? `: ${body.slice(0, 350)}` : ''}`;
    } catch (e) {
      lastError = e?.message || String(e);
    }
  }

  if (!r || !r.ok) throw new Error(`Pollinations görsel üretmedi. ${lastError}`);

  const contentType = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) {
    const body = await r.text().catch(() => '');
    throw new Error(`Pollinations image yerine ${contentType || 'bilinmeyen'} yanıt döndürdü${body ? `: ${body.slice(0, 300)}` : ''}`);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('Pollinations boş görsel döndürdü.');

  // ÖNEMLİ: JSON/base64 yapmıyoruz. Görseli doğrudan HTTP response olarak gönderiyoruz.
  return { type: 'image', mime: contentType, buffer: buf, provider: 'pollinations', model: 'flux' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Yalnızca POST destekleniyor.' });

  const title = String(req.body?.title || '').slice(0, 300);
  const text = String(req.body?.text || '').slice(0, 7000);
  if (!text.trim()) return sendJson(res, 400, { error: 'Şiir metni boş.' });

  const prompt = buildPrompt(title, text);
  const errors = [];

  try {
    const result = await tryGemini(prompt);
    return sendJson(res, 200, result.data);
  } catch (err) {
    errors.push(`Gemini: ${err?.message || 'başarısız'}`);
    console.warn('Gemini başarısız, Pollinations deneniyor:', err);
  }

  try {
    const result = await tryPollinations(prompt);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', result.provider);
    res.setHeader('X-AI-Model', result.model);
    return res.status(200).send(result.buffer);
  } catch (err) {
    errors.push(`Pollinations: ${err?.message || 'başarısız'}`);
    console.warn('Pollinations başarısız:', err);
  }

  return sendJson(res, 502, {
    error: 'Gemini ve Pollinations ile AI görsel oluşturulamadı. GIPHY yedeğine geçiliyor.',
    providers: errors
  });
}
