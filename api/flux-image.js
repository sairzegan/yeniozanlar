// /api/flux-image.js
// Vercel Serverless Function
//
// GÖREV:
// Sadece Cloudflare Workers AI -> FLUX.1-schnell üzerinden
// AI görseli üretir.
//
// ÖNEMLİ:
// Bu dosya GIPHY'ye FALLBACK YAPMAZ.
//
// Frontend'deki gerçek zincir:
// Cloudflare FLUX
//      ↓ başarısızsa
// Pollinations
//      ↓ başarısızsa
// Hugging Face
//      ↓ başarısızsa
// Gemini
//      ↓ hepsi başarısızsa
// GIPHY
//
// Cloudflare burada başarısız olursa HTTP 502 döndürür.
// Böylece index.html bir sonraki AI sağlayıcısına geçebilir.

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CLOUDFLARE_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

const TIMEOUT_MS = 65000;


// ============================================================
// PROMPT
// ============================================================

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);

  // Her istekte farklı prompt oluştur.
  // Aynı şiirde yeniden görsel oluşturulduğunda
  // CDN/cache nedeniyle aynı görsel dönmesini azaltır.
  const varyasyon =
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return [
    'Create one original cinematic image specifically inspired by the Turkish poem below.',

    'Use the actual meaning of the poem as the primary visual source.',

    'Show the setting, people, objects, actions, symbols, metaphors and emotions that are actually present in the poem.',

    'Do not create a generic poetry image.',

    'Do not invent an unrelated scene.',

    'The poem must determine the subject, atmosphere and visual story.',

    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',

    'IMPORTANT: absolutely NO text anywhere in the image.',

    'NO letters, NO words, NO captions, NO typography, NO subtitles, NO signs, NO logos, NO watermark.',

    heading
      ? `Turkish poem title: ${heading}`
      : '',

    `Turkish poem:\n${poem}`,

    `Internal variation tag (ignore, do not depict, do not render as text): ${varyasyon}`
  ]
    .filter(Boolean)
    .join('\n\n');
}


// ============================================================
// TIMEOUT'LU FETCH
// ============================================================

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = TIMEOUT_MS
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// CLOUDFLARE CEVABINI BINARY GÖRSELE ÇEVİR
// ============================================================

async function readCloudflareImage(response) {

  const contentType =
    (
      response.headers.get('content-type') ||
      ''
    )
      .toLowerCase()
      .split(';')[0]
      .trim();


  // ----------------------------------------------------------
  // HTTP hata kodu
  // ----------------------------------------------------------

  if (!response.ok) {

    let raw = '';

    try {
      raw = await response.text();
    } catch (_) {
      raw = '';
    }

    let data = null;

    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }

    const detail =
      data?.errors?.[0]?.message ||
      data?.error ||
      data?.message ||
      raw.slice(0, 800);


    const error = new Error(
      `Cloudflare FLUX HTTP ${response.status}${
        detail
          ? ` — ${detail}`
          : ''
      }`
    );

    error.status = response.status;
    error.isCloudflare = true;

    throw error;
  }


  // ----------------------------------------------------------
  // Cloudflare doğrudan image/* döndürdüyse
  // ----------------------------------------------------------

  if (contentType.startsWith('image/')) {

    const arrayBuffer =
      await response.arrayBuffer();

    const buffer =
      Buffer.from(arrayBuffer);

    if (!buffer.length) {
      throw new Error(
        'Cloudflare FLUX boş görsel döndürdü.'
      );
    }

    return buffer;
  }


  // ----------------------------------------------------------
  // Cloudflare Workers AI genellikle JSON döndürür:
  //
  // {
  //   "result": {
  //      "image": "BASE64..."
  //   },
  //   "success": true
  // }
  // ----------------------------------------------------------

  const raw =
    await response.text();

  let data = null;

  try {
    data = JSON.parse(raw);
  } catch (_) {
    data = null;
  }


  if (!data) {
    throw new Error(
      `Cloudflare FLUX JSON olmayan bir cevap döndürdü: ${raw.slice(0, 500)}`
    );
  }


  const base64 =
    data?.result?.image ||
    data?.image;


  if (
    base64 &&
    typeof base64 === 'string'
  ) {

    let temizBase64 =
      base64.trim();


    // İhtimale karşı data:image/...;base64,... formatını da destekle.
    if (
      temizBase64.startsWith('data:image/')
    ) {
      const virgül =
        temizBase64.indexOf(',');

      if (virgül >= 0) {
        temizBase64 =
          temizBase64.slice(virgül + 1);
      }
    }


    const buffer =
      Buffer.from(
        temizBase64,
        'base64'
      );


    if (!buffer.length) {
      throw new Error(
        'Cloudflare FLUX base64 görsel verisi boş.'
      );
    }


    return buffer;
  }


  // Cloudflare hata mesajını mümkün olduğunca açık göster.
  const detail =
    data?.errors?.[0]?.message ||
    data?.error ||
    data?.message ||
    (
      data?.result
        ? JSON.stringify(data.result).slice(0, 500)
        : ''
    );


  throw new Error(
    `Cloudflare FLUX geçerli bir görsel döndürmedi.${
      detail
        ? ` — ${detail}`
        : ''
    }`
  );
}


// ============================================================
// VERCEL
// ============================================================

export const maxDuration = 75;


// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {

  // ----------------------------------------------------------
  // Sadece POST
  // ----------------------------------------------------------

  if (req.method !== 'POST') {

    res.setHeader(
      'Allow',
      'POST'
    );

    return res
      .status(405)
      .json({
        error:
          'Yalnızca POST destekleniyor.'
      });
  }


  // ----------------------------------------------------------
  // Gelen veriler
  // ----------------------------------------------------------

  const title =
    req.body?.title || '';

  const text =
    req.body?.text || '';


  // ----------------------------------------------------------
  // Şiir kontrolü
  // ----------------------------------------------------------

  if (
    !String(text).trim()
  ) {

    return res
      .status(400)
      .json({
        error:
          'Şiir metni gönderilemedi.'
      });
  }


  // ----------------------------------------------------------
  // Cloudflare Environment Variables
  // ----------------------------------------------------------

  const accountId =
    String(
      process.env.CLOUDFLARE_ACCOUNT_ID || ''
    ).trim();


  const token =
    String(
      process.env.CLOUDFLARE_API_TOKEN || ''
    ).trim();


  if (
    !accountId ||
    !token
  ) {

    return res
      .status(500)
      .json({
        error:
          'Cloudflare değişkenleri eksik: CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN gerekli.'
      });
  }


  // ----------------------------------------------------------
  // PROMPT
  // ----------------------------------------------------------

  const prompt =
    buildPrompt(
      title,
      text
    );


  // ----------------------------------------------------------
  // CLOUDFLARE FLUX
  // ----------------------------------------------------------

  try {

    const response =
      await fetchWithTimeout(

        CLOUDFLARE_URL(
          accountId
        ),

        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${token}`,

            'Content-Type':
              'application/json',

            Accept:
              'application/json'
          },

          body:
            JSON.stringify({
              prompt,

              // Seed göndermiyoruz.
              // Cloudflare FLUX endpointinde
              // geçersiz / desteklenmeyen seed parametresi
              // nedeniyle hata oluşmasını engeller.
              steps: 4
            })
        },

        TIMEOUT_MS
      );


    const buffer =
      await readCloudflareImage(
        response
      );


    // --------------------------------------------------------
    // BAŞARILI
    // --------------------------------------------------------

    res.setHeader(
      'Content-Type',
      'image/jpeg'
    );

    res.setHeader(
      'Content-Length',
      String(buffer.length)
    );

    // AI görseli her istekte yeniden oluşturulabilsin.
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate'
    );

    res.setHeader(
      'X-AI-Provider',
      'cloudflare'
    );

    res.setHeader(
      'X-AI-Model',
      MODEL
    );


    return res
      .status(200)
      .send(buffer);


  } catch (err) {

    // --------------------------------------------------------
    // ÇOK ÖNEMLİ:
    //
    // BURADA GIPHY ÇAĞRILMIYOR.
    //
    // HTTP 502 dönüyoruz.
    //
    // index.html bunu yakalayıp:
    //
    // Cloudflare ❌
    //       ↓
    // Pollinations
    //       ↓
    // Hugging Face
    //       ↓
    // Gemini
    //       ↓
    // GIPHY
    //
    // şeklinde devam edecek.
    // --------------------------------------------------------

    const mesaj =
      err?.name === 'AbortError'
        ? 'Cloudflare FLUX isteği zaman aşımına uğradı.'
        : (
            err?.message ||
            'Cloudflare FLUX başarısız oldu.'
          );


    console.error(
      'Cloudflare FLUX error:',
      mesaj
    );


    return res
      .status(502)
      .json({
        error: mesaj,
        provider: 'cloudflare',
        fallback: false
      });
  }
}
