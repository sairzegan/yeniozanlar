// /api/flux-image.js

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

function json(res, status, data) {
  return res.status(status).json(data);
}

function temizle(value, maxLength = 1800) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function promptOlustur(title, text) {
  const baslik = temizle(title, 300);
  const siir = temizle(text, 1500);

  const siirMetni = [
    baslik ? `Poem title: ${baslik}` : '',
    siir ? `Poem: ${siir}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `
Create a cinematic, realistic fine-art photograph inspired directly by this poem.

The image must clearly represent the actual subject, story, objects,
people, places, emotions, memories, weather and atmosphere described in the poem.

Style:
cinematic movie still,
realistic professional photography,
poetic atmosphere,
dramatic natural lighting,
beautiful depth,
subtle film grain,
emotionally expressive,
tasteful colors,
highly detailed,
believable realistic scene.

Do NOT create a generic abstract image.

If the poem contains a specific person, object, animal, place,
season, weather, event or memory, make it visually important.

Do not add:
logos,
watermarks,
borders,
frames,
UI,
random text,
unrelated objects.

POEM:
${siirMetni}
`.trim();

  return prompt.slice(0, 2048);
}

async function hataOku(response) {
  const raw = await response.text().catch(() => '');

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(raw);

    if (Array.isArray(data.errors)) {
      const errors = data.errors
        .map(x => x?.message || x?.code)
        .filter(Boolean)
        .join(' | ');

      if (errors) return errors;
    }

    return (
      data?.error?.message ||
      data?.message ||
      raw.slice(0, 2000)
    );
  } catch {
    return raw.slice(0, 2000);
  }
}

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Yalnızca POST destekleniyor.'
    });
  }

  const accountId = String(
    process.env.CLOUDFLARE_ACCOUNT_ID || ''
  ).trim();

  const apiToken = String(
    process.env.CLOUDFLARE_API_TOKEN || ''
  ).trim();

  if (!accountId) {
    return json(res, 500, {
      error: 'CLOUDFLARE_ACCOUNT_ID bulunamadı.'
    });
  }

  if (!apiToken) {
    return json(res, 500, {
      error: 'CLOUDFLARE_API_TOKEN bulunamadı.'
    });
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, {
        error: 'Geçersiz JSON.'
      });
    }
  }

  const title = temizle(body?.title, 300);
  const text = temizle(body?.text, 1500);

  if (!title && !text) {
    return json(res, 400, {
      error: 'Şiir başlığı veya şiir metni gerekli.'
    });
  }

  const prompt = promptOlustur(title, text);

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${accountId}/ai/run/${MODEL}`;

  try {

    /*
     * ÖNEMLİ:
     * Cloudflare'a yalnızca zorunlu "prompt" gönderiyoruz.
     *
     * Böylece FLUX isteği minimum resmi API formatında kalıyor.
     */
    const response = await fetch(endpoint, {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },

      body: JSON.stringify({
        prompt: prompt
      })
    });

    if (!response.ok) {

      const detail = await hataOku(response);

      console.error(
        'CLOUDFLARE FLUX HATASI:',
        response.status,
        detail
      );

      return json(res, 502, {
        error: `Cloudflare FLUX HTTP ${response.status}`,
        detail: detail
      });
    }

    /*
     * Cloudflare Workers AI REST cevabı:
     *
     * {
     *   "result": {
     *     "image": "BASE64..."
     *   }
     * }
     */

    const data = await response.json();

    if (data?.success === false) {

      let detail = 'Cloudflare AI isteği başarısız.';

      if (Array.isArray(data.errors)) {
        detail = data.errors
          .map(x => x?.message || x?.code)
          .filter(Boolean)
          .join(' | ');
      }

      return json(res, 502, {
        error: 'Cloudflare FLUX isteği başarısız.',
        detail: detail
      });
    }

    const imageBase64 =
      data?.result?.image;

    if (
      typeof imageBase64 !== 'string' ||
      imageBase64.length < 100
    ) {

      console.error(
        'FLUX IMAGE BULUNAMADI:',
        JSON.stringify({
          success: data?.success,
          resultKeys: data?.result
            ? Object.keys(data.result)
            : [],
          responseKeys: Object.keys(data || {})
        })
      );

      return json(res, 502, {
        error: 'Cloudflare FLUX görsel döndürmedi.',
        detail: 'result.image alanı bulunamadı.'
      });
    }

    /*
     * Base64 → JPEG
     */

    const temizBase64 = imageBase64
      .replace(/^data:image\/[^;]+;base64,/i, '')
      .replace(/\s/g, '');

    const imageBuffer = Buffer.from(
      temizBase64,
      'base64'
    );

    if (
      !imageBuffer ||
      imageBuffer.length < 1000
    ) {
      return json(res, 502, {
        error: 'FLUX görsel verisi boş veya geçersiz.'
      });
    }

    /*
     * Frontend fetch(...).blob()
     * ile doğrudan resmi alabilir.
     */

    res.setHeader(
      'Content-Type',
      'image/jpeg'
    );

    res.setHeader(
      'Content-Length',
      String(imageBuffer.length)
    );

    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate'
    );

    return res
      .status(200)
      .send(imageBuffer);

  } catch (error) {

    console.error(
      'FLUX ENDPOINT HATASI:',
      error
    );

    return json(res, 502, {
      error: 'FLUX görseli oluşturulamadı.',
      detail:
        error?.message ||
        String(error)
    });
  }
}
