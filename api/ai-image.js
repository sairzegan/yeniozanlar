// Vercel Serverless Function — şiirden AI görseli üretir.
// Öncelik: Gemini → Pollinations → istemci tarafındaki mevcut GIPHY fallback.
// Vercel Environment Variables:
//   GEMINI_API_KEY
//   POLLINATIONS_API_KEY

function buildPrompt(title, text) {
  return `Create a cinematic, poetic and emotionally powerful visual inspired DIRECTLY by this Turkish poem.

Title: ${title || '(untitled)'}
Poem:
${text}

Visual direction:
- The poem itself is the main source of the scene. Reflect its actual subject, imagery, place, action and emotion.
- Do not create a generic "poetry" image. The result must clearly feel connected to THIS poem.
- Use cinematic composition, realistic photography or sophisticated cinematic digital art.
- Add romantic, melancholic, dreamy or dramatic atmosphere only when it fits the poem.
- Use natural, film-like lighting, depth, atmosphere and a strong focal subject.
- Avoid random objects, characters or locations that are not supported by the poem.
- No meme, no GIF, no stock-photo look, no collage.
- Do NOT render words, letters, captions, watermarks or typography inside the image; the website can add text separately.
- Wide 16:9 composition suitable for a poetry social-media post.`;
}

function base64FromBuffer(buf) {
  return Buffer.from(buf).toString('base64');
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
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || `Gemini HTTP ${r.status}`;
    throw new Error(msg);
  }

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
  return { imageData: `data:${mime};base64,${b64}`, provider: 'gemini', model: 'gemini-3.1-flash-image' };
}

async function tryPollinations(prompt) {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) throw new Error('POLLINATIONS_API_KEY tanımlı değil.');

  // ÖNEMLİ: Uzun şiir promptunu GET /image/{prompt} ile göndermek URL uzunluğu
  // sınırlarına takılabiliyor. Bu nedenle güncel OpenAI-uyumlu POST endpoint'i
  // kullanıyoruz. Pollinations dokümanı POST /v1/images/generations ve
  // response_format=b64_json desteğini açıkça belirtiyor.
  const r = await fetch('https://gen.pollinations.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'flux',
      prompt,
      n: 1,
      size: '1536x864',
      response_format: 'b64_json'
    })
  });

  const contentType = r.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await r.json().catch(() => null);
  } else {
    const body = await r.text().catch(() => '');
    throw new Error(`Pollinations beklenmeyen yanıt verdi (HTTP ${r.status})${body ? ': ' + body.slice(0, 300) : ''}`);
  }

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `Pollinations HTTP ${r.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const b64 = item?.b64_json || item?.b64Json;
  if (!b64) {
    // Bazı OpenAI-uyumlu yanıtlarda URL dönebilir; onu da destekleyelim.
    const url = item?.url;
    if (url) {
      const img = await fetch(url);
      if (!img.ok) throw new Error(`Pollinations görsel URL'si alınamadı (HTTP ${img.status})`);
      const buf = await img.arrayBuffer();
      const mime = img.headers.get('content-type') || 'image/jpeg';
      if (!buf.byteLength) throw new Error('Pollinations boş görsel döndürdü.');
      return {
        imageData: `data:${mime};base64,${base64FromBuffer(Buffer.from(buf))}`,
        provider: 'pollinations',
        model: 'flux'
      };
    }
    throw new Error('Pollinations görsel verisi döndürmedi.');
  }

  return {
    imageData: `data:image/png;base64,${b64}`,
    provider: 'pollinations',
    model: 'flux'
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });

  const title = String(req.body?.title || '').slice(0, 300);
  const text = String(req.body?.text || '').slice(0, 7000);
  if (!text.trim()) return res.status(400).json({ error: 'Şiir metni boş.' });

  const prompt = buildPrompt(title, text);
  const errors = [];

  // 1) Önce Gemini. Kota doluysa/erişilemiyorsa ikinci sağlayıcıya geç.
  try {
    return res.status(200).json(await tryGemini(prompt));
  } catch (err) {
    errors.push(`Gemini: ${err?.message || 'başarısız'}`);
    console.warn('Gemini görsel başarısız, Pollinations deneniyor:', err);
  }

  // 2) Gemini başarısızsa Pollinations.
  try {
    return res.status(200).json(await tryPollinations(prompt));
  } catch (err) {
    errors.push(`Pollinations: ${err?.message || 'başarısız'}`);
    console.warn('Pollinations görsel başarısız:', err);
  }

  // 3) Burada frontend'in mevcut GIPHY fallback'i devreye girer.
  return res.status(502).json({
    error: 'Gemini ve Pollinations ile AI görsel oluşturulamadı. GIPHY yedeğine geçiliyor.',
    providers: errors
  });
}
