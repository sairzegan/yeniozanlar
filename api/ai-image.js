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

  // Pollinations'ın resmi görsel endpoint'i /image/{prompt} olarak çalışır.
  // POST /v1/images/generations bazı hesap/model kombinasyonlarında farklı
  // OpenAI uyumluluk davranışı gösterebildiği için önce POST'u, sonra resmi
  // GET endpoint'ini yedek olarak deniyoruz.
  const cleanPrompt = String(prompt || '').trim();
  const errors = [];

  // 1) OpenAI uyumlu POST endpoint.
  try {
    const r = await fetch('https://gen.pollinations.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model: 'flux',
        prompt: cleanPrompt,
        n: 1,
        size: '1536x864'
      })
    });

    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data?.error?.message || data?.error || data?.message || `HTTP ${r.status}`;
        errors.push(`POST ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      } else {
        const item = Array.isArray(data?.data) ? data.data[0] : null;
        const b64 = item?.b64_json || item?.b64Json;
        if (b64) {
          return {
            imageData: `data:image/png;base64,${b64}`,
            provider: 'pollinations',
            model: 'flux'
          };
        }
        if (item?.url) {
          const image = await fetch(item.url);
          if (!image.ok) throw new Error(`POST ile dönen görsel URL'si alınamadı (HTTP ${image.status})`);
          const buf = Buffer.from(await image.arrayBuffer());
          if (!buf.length) throw new Error('POST ile dönen görsel boş.');
          const mime = image.headers.get('content-type') || 'image/jpeg';
          return {
            imageData: `data:${mime};base64,${buf.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          };
        }
        errors.push('POST başarılı görünüyor fakat görsel verisi dönmedi.');
      }
    } else {
      const body = await r.text().catch(() => '');
      errors.push(`POST ${r.status}: JSON olmayan yanıt${body ? ` (${body.slice(0, 180)})` : ''}`);
    }
  } catch (err) {
    errors.push(`POST bağlantı hatası: ${err?.message || err}`);
  }

  // 2) Pollinations'ın resmi ve çok daha basit GET image endpoint'i.
  // Secret key URL'ye yazılmaz; Authorization header ile gönderilir.
  // URL sınırlarına takılmamak için promptu makul bir uzunlukta tutuyoruz.
  try {
    const maxPromptChars = 2600;
    const shortPrompt = cleanPrompt.length > maxPromptChars
      ? cleanPrompt.slice(0, maxPromptChars) + '\n\nIMPORTANT: Use the poem excerpt above as the primary visual source.'
      : cleanPrompt;
    const url = `https://gen.pollinations.ai/image/${encodeURIComponent(shortPrompt)}?model=flux&width=1536&height=864&nologo=true`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'image/*'
      }
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`GET ${r.status}${body ? `: ${body.slice(0, 220)}` : ''}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('GET boş görsel döndürdü.');
    const mime = r.headers.get('content-type') || 'image/jpeg';
    if (!mime.startsWith('image/')) throw new Error(`GET görsel yerine ${mime} döndürdü.`);
    return {
      imageData: `data:${mime};base64,${buf.toString('base64')}`,
      provider: 'pollinations',
      model: 'flux'
    };
  } catch (err) {
    errors.push(`GET bağlantı hatası: ${err?.message || err}`);
  }

  throw new Error(`Pollinations kullanılamadı. ${errors.join(' | ')}`);
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
