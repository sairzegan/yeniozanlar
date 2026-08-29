// Vercel Serverless Function
// Cloudflare Workers AI -> FLUX.1-schnell
// Cloudflare kota/rate-limit durumunda otomatik GIPHY yedeği.
//
// Vercel Environment Variables:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN
// GIPHY_API_KEY

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CLOUDFLARE_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';

const TIMEOUT_MS = 65000;


// ------------------------------------------------------------
// FLUX PROMPT
// ------------------------------------------------------------

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);

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
    heading ? `Turkish poem title: ${heading}` : '',
    `Turkish poem:\n${poem}`
  ]
    .filter(Boolean)
    .join('\n\n');
}


// ------------------------------------------------------------
// GIPHY ARAMA METNİ
// ------------------------------------------------------------

function cleanGiphyQuery(title, text) {
  const source =
    String(title || '').trim() ||
    String(text || '').trim();

  const cleaned = source
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // GIPHY q maksimum 50 karakter.
  return cleaned.slice(0, 50) || 'poetic landscape';
}


// ------------------------------------------------------------
// TIMEOUT'LU FETCH
// ------------------------------------------------------------

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


// ------------------------------------------------------------
// CLOUDFLARE CEVABINI GÖRSELE ÇEVİR
// ------------------------------------------------------------

async function readCloudflareImage(response) {
  const contentType =
    (response.headers.get('content-type') || '').toLowerCase();

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }


  // HTTP hata kodu
  if (!response.ok) {
    const detail =
      data?.errors?.[0]?.message ||
      data?.error ||
      raw.slice(0, 500);

    const error = new Error(
      `Cloudflare FLUX HTTP ${response.status}${
        detail ? ` — ${detail}` : ''
      }`
    );

    error.status = response.status;
    error.isCloudflare = true;

    throw error;
  }


  // Workers AI FLUX cevabı:
  // { result: { image: "BASE64..." } }

  const base64 =
    data?.result?.image ||
    data?.image;

  if (
    base64 &&
    typeof base64 === 'string'
  ) {
    return Buffer.from(base64, 'base64');
  }


  // İhtimale karşı doğrudan binary image cevabı
  if (contentType.startsWith('image/')) {
    return Buffer.from(raw, 'binary');
  }


  throw new Error(
    'Cloudflare FLUX geçerli bir görsel döndürmedi.'
  );
}


// ------------------------------------------------------------
// GIPHY FALLBACK
// ------------------------------------------------------------

async function getGiphyImage(title, text) {

  const key =
    String(process.env.GIPHY_API_KEY || '').trim();

  if (!key) {
    throw new Error(
      'GIPHY_API_KEY Vercel Environment Variable bulunamadı.'
    );
  }


  const q = cleanGiphyQuery(title, text);

  const url = new URL(GIPHY_SEARCH_URL);

  url.searchParams.set(
    'api_key',
    key
  );

  url.searchParams.set(
    'q',
    q
  );

  url.searchParams.set(
    'limit',
    '10'
  );

  url.searchParams.set(
    'rating',
    'g'
  );

  url.searchParams.set(
    'lang',
    'tr'
  );

  url.searchParams.set(
    'fields',
    'id,title,images'
  );


  const response =
    await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: 'application/json'
        }
      },
      15000
    );


  if (!response.ok) {
    throw new Error(
      `GIPHY API HTTP ${response.status}`
    );
  }


  const payload =
    await response.json();


  const items =
    Array.isArray(payload?.data)
      ? payload.data
      : [];


  if (!items.length) {
    throw new Error(
      `GIPHY aramasında sonuç bulunamadı: ${q}`
    );
  }


  // Büyük görselden küçüğe doğru dene.
  const candidates = [];


  for (const item of items) {

    const images =
      item?.images || {};

    const urls = [

      images?.downsized_large?.url,

      images?.downsized?.url,

      images?.original?.url,

      images?.fixed_width?.url,

      images?.fixed_height?.url

    ].filter(Boolean);


    candidates.push(...urls);
  }


  // Bir URL çalışmazsa diğerini dene.
  for (const imageUrl of candidates) {

    try {

      const imageResponse =
        await fetchWithTimeout(
          imageUrl,
          {
            headers: {
              Accept:
                'image/avif,image/webp,image/gif,image/*,*/*;q=0.8'
            }
          },
          15000
        );


      if (!imageResponse.ok) {
        continue;
      }


      const buffer =
        Buffer.from(
          await imageResponse.arrayBuffer()
        );


      if (!buffer.length) {
        continue;
      }


      const contentType =
        imageResponse.headers.get(
          'content-type'
        ) || 'image/gif';


      return {
        buffer,
        contentType,
        query: q
      };

    } catch {
      // Sonraki GIPHY görselini dene.
    }
  }


  throw new Error(
    'GIPHY görsel dosyası alınamadı.'
  );
}


// ------------------------------------------------------------
// VERCEL
// ------------------------------------------------------------

export const maxDuration = 75;


// ------------------------------------------------------------
// MAIN HANDLER
// ------------------------------------------------------------

export default async function handler(
  req,
  res
) {

  // Sadece POST
  if (req.method !== 'POST') {

    return res
      .status(405)
      .json({
        error:
          'Yalnızca POST destekleniyor.'
      });
  }


  const title =
    req.body?.title || '';

  const text =
    req.body?.text || '';


  // Şiir yoksa FLUX'a boş prompt gönderme.
  if (!String(text).trim()) {

    return res
      .status(400)
      .json({
        error:
          'Şiir metni gönderilemedi.'
      });
  }


  const accountId =
    String(
      process.env.CLOUDFLARE_ACCOUNT_ID || ''
    ).trim();


  const token =
    String(
      process.env.CLOUDFLARE_API_TOKEN || ''
    ).trim();


  if (!accountId || !token) {

    return res
      .status(500)
      .json({
        error:
          'Cloudflare değişkenleri eksik: CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN gerekli.'
      });
  }


  let cloudflareError = null;


  // ==========================================================
  // 1. ÖNCE CLOUDFLARE FLUX
  // ==========================================================

  try {

    const prompt =
      buildPrompt(
        title,
        text
      );


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

              // Seed YOK.
              // Önceki "/seed not allowed"
              // problemini engeller.
              steps: 4
            })
        }
      );


    const buffer =
      await readCloudflareImage(
        response
      );


    // FLUX başarılı
    res.setHeader(
      'Content-Type',
      'image/jpeg'
    );

    res.setHeader(
      'Content-Length',
      String(buffer.length)
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
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

    cloudflareError = err;

    console.error(
      'Cloudflare FLUX error:',
      err?.message || err
    );
  }


  // ==========================================================
  // 2. FLUX BAŞARISIZSA GIPHY
  // ==========================================================

  try {

    const fallback =
      await getGiphyImage(
        title,
        text
      );


    res.setHeader(
      'Content-Type',
      fallback.contentType
    );

    res.setHeader(
      'Content-Length',
      String(
        fallback.buffer.length
      )
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    res.setHeader(
      'X-AI-Provider',
      'giphy-fallback'
    );

    res.setHeader(
      // HTTP header değerleri yalnızca Latin-1 (ISO-8859-1) karakter kümesini kabul eder.
      // fallback.query Türkçe karakterler (ş, ğ, ı, İ vb.) içerebiliyor ve bunlar bu
      // aralığın dışında kalıyor; Node bu yüzden "Invalid character in header content"
      // hatasıyla çöküyordu. encodeURIComponent ile her zaman ASCII-güvenli hale getiriyoruz.
      'X-GIPHY-Query',
      encodeURIComponent(fallback.query)
    );


    // ÖNEMLİ:
    // JSON değil, gerçek görsel binary'si dönüyor.
    return res
      .status(200)
      .send(fallback.buffer);


  } catch (giphyError) {

    console.error(
      'GIPHY fallback error:',
      giphyError?.message ||
      giphyError
    );


    const cfMessage =
      cloudflareError?.name === 'AbortError'
        ? 'Cloudflare FLUX isteği zaman aşımına uğradı.'
        : (
            cloudflareError?.message ||
            'Cloudflare FLUX başarısız oldu.'
          );


    const gifMessage =
      giphyError?.message ||
      'GIPHY yedeği başarısız oldu.';


    return res
      .status(502)
      .json({

        error:
          `Görsel üretilemedi. FLUX: ${cfMessage} | GIPHY yedeği: ${gifMessage}`,

        provider:
          'cloudflare+giphy-fallback'
      });
  }
}
