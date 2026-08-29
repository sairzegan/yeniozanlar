// /api/flux-image.js

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT_CHARS = 2048;

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
    baslik ? `Şiir başlığı: ${baslik}` : '',
    siir ? `Şiir: ${siir}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `
Create a cinematic, poetic, realistic fine-art photograph inspired directly by the poem below.

The image MUST visually reflect the actual subject, story, imagery, emotions and atmosphere of the poem.

Use:
- cinematic composition
- realistic professional photography
- poetic atmosphere
- dramatic but natural lighting
- beautiful depth
- subtle film grain
- emotionally expressive scene
- tasteful colors
- visually striking but believable details

Do NOT create a generic abstract image.

If the poem contains a concrete object, person, place, animal, season, weather, memory or event, make that element visually important.

The image should feel like a scene from a high-budget poetic movie.

Do not add:
- borders
- frames
- logos
- watermarks
- UI
- random text
- unrelated objects

POEM:
${siirMetni}
`.trim();

  return prompt.slice(0, MAX_PROMPT_CHARS);
}

async function cloudflareHataOku(response) {
  const raw = await response.text().catch(() => '');

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(raw);

    const errors = Array.isArray(data?.errors)
      ? data.errors
          .map(x => x?.message || x?.code)
          .filter(Boolean)
          .join(' | ')
      : '';

    return (
      errors ||
      data?.error?.message ||
      data?.message ||
      raw
    );
  } catch {
    return raw;
  }
}

export default async function handler(req, res) {

  // Sadece POST
  if (req.method !== 'POST') {
    return json(res, 405, {
      error: 'Yalnızca POST isteği destekleniyor.'
    });
  }

  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID;

  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN;

  // Environment kontrolü
  if (!accountId) {
    return json(res, 500, {
      error:
        'CLOUDFLARE_ACCOUNT_ID Vercel Environment Variables içinde bulunamadı.'
    });
  }

  if (!apiToken) {
    return json(res, 500, {
      error:
        'CLOUDFLARE_API_TOKEN Vercel Environment Variables içinde bulunamadı.'
    });
  }

  // Body
  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, {
        error: 'Geçersiz JSON gönderildi.'
      });
    }
  }

  const title = temizle(body.title, 300);
  const text = temizle(body.text, 1500);

  if (!title && !text) {
    return json(res, 400, {
      error:
        'Görsel oluşturmak için şiir başlığı veya şiir metni gerekli.'
    });
  }

  const prompt = promptOlustur(title, text);

  /*
   * Cloudflare Workers AI REST API
   *
   * Güncel endpoint:
   * /accounts/{ACCOUNT_ID}/ai/run/{MODEL}
   */
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${accountId}/ai/run/${MODEL}`;

  try {

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 90000);

    let response;

    try {

      response = await fetch(endpoint, {
        method: 'POST',

        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          prompt: prompt,

          // FLUX schnell için düşük ama kaliteli üretim
          steps: 4,

          // Her istekte farklı görsel
          seed: Math.floor(
            Math.random() * 2147483647
          )
        }),

        signal: controller.signal
      });

    } finally {
      clearTimeout(timeout);
    }

    // Cloudflare HTTP hatası
    if (!response.ok) {

      const hata =
        await cloudflareHataOku(response);

      console.error(
        'CLOUDFLARE FLUX HTTP HATASI:',
        response.status,
        hata
      );

      return json(res, 502, {
        error:
          `Cloudflare FLUX HTTP ${response.status}`,
        detail: hata
      });
    }

    const data =
      await response.json();

    // Cloudflare API success=false
    if (data?.success !== true) {

      const hata =
        Array.isArray(data?.errors)
          ? data.errors
              .map(x => x?.message || x?.code)
              .filter(Boolean)
              .join(' | ')
          : 'Cloudflare Workers AI isteği başarısız oldu.';

      console.error(
        'CLOUDFLARE FLUX API HATASI:',
        data
      );

      return json(res, 502, {
        error:
          `Cloudflare FLUX hatası: ${hata}`
      });
    }

    /*
     * FLUX sonucu:
     *
     * data.result.image
     *
     * Base64 JPEG
     */
    const imageBase64 =
      data?.result?.image;

    if (
      typeof imageBase64 !== 'string' ||
      imageBase64.length < 100
    ) {

      console.error(
        'FLUX GÖRSEL YOK:',
        {
          resultVarMi: !!data?.result,
          resultKeys:
            data?.result
              ? Object.keys(data.result)
              : []
        }
      );

      return json(res, 502, {
        error:
          'Cloudflare FLUX görsel döndürmedi.'
      });
    }

    /*
     * Base64 → Buffer
     *
     * Vercel Node.js ortamında Buffer kullanılabilir.
     */
    const imageBuffer =
      Buffer.from(
        imageBase64,
        'base64'
      );

    if (
      !imageBuffer ||
      imageBuffer.length < 1000
    ) {

      return json(res, 502, {
        error:
          'FLUX tarafından dönen görsel verisi geçersiz veya boş.'
      });
    }

    /*
     * Tarayıcıya DOĞRUDAN JPEG gönderiyoruz.
     *
     * index.html mevcut fetch(...).blob()
     * yapısını kullanıyorsa bu formatla uyumludur.
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

    return res.status(200).send(
      imageBuffer
    );

  } catch (error) {

    console.error(
      'FLUX ENDPOINT HATASI:',
      error
    );

    if (
      error?.name === 'AbortError'
    ) {
      return json(res, 504, {
        error:
          'Cloudflare FLUX isteği 90 saniye içinde tamamlanmadı.'
      });
    }

    return json(res, 502, {
      error:
        `FLUX görseli oluşturulamadı: ${
          error?.message || String(error)
        }`
    });
  }
}
