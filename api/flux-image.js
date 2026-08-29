// /api/flux-image.js

const FLUX_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const GROQ_MODEL = 'openai/gpt-oss-20b';

function getBody(req) {
  if (!req.body) return {};

  if (typeof req.body === 'object') {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function clean(value, max = 12000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function send(res, status, data) {
  return res.status(status).json(data);
}


/* ---------------------------------------------------------
   GROQ
--------------------------------------------------------- */

async function createVisualPrompt(title, poem) {

  const key = String(
    process.env.GROQ_API_KEY || ''
  ).trim();

  if (!key) {
    return null;
  }

  const systemPrompt = `
You create image-generation prompts from Turkish poems.

Analyze the Turkish poem and create ONE visual scene that
clearly represents what the poem is actually about.

IMPORTANT:

- Follow the poem's meaning.
- Do not invent an unrelated scene.
- Use the emotions, people, places, objects, events,
  nature and metaphors actually suggested by the poem.
- The image must visually represent the poem.
- Use natural or cinematic lighting.
- Do NOT make the image excessively dark.
- Do NOT create a generic "sad poetry" image.

ABSOLUTELY NO TEXT IN THE IMAGE.

Do not include:
letters,
words,
sentences,
captions,
subtitles,
signs,
posters,
books with readable writing,
newspapers,
logos,
watermarks,
typography,
UI,
symbols that resemble writing.

The final image must contain ONLY the visual scene.

Return ONLY an English image-generation prompt.
Do not explain anything.
`;

  const userPrompt = `
Title:
${title || '(no title)'}

Turkish poem:
${poem}
`;

  try {

    const r = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          temperature: 0.2,
          max_completion_tokens: 450
        })
      }
    );

    const raw = await r.text();

    if (!r.ok) {
      console.error(
        'GROQ ERROR:',
        r.status,
        raw
      );

      // Groq başarısızsa FLUX yine çalışabilir.
      return null;
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }

    const prompt =
      data?.choices?.[0]?.message?.content?.trim();

    return prompt || null;

  } catch (err) {

    console.error(
      'GROQ CONNECTION ERROR:',
      err?.message || err
    );

    return null;
  }
}


/* ---------------------------------------------------------
   FALLBACK PROMPT
--------------------------------------------------------- */

function fallbackPrompt(title, poem) {

  return `
Create a realistic cinematic visual scene directly inspired
by the following Turkish poem.

The scene must represent the actual subject and meaning of
the poem, not a generic poetry image.

Title:
${title}

Poem:
${poem}

Use the people, place, objects, events, atmosphere and emotions
suggested by the poem.

Natural cinematic lighting.
Realistic photography.
Beautiful composition.
Natural colors.
Moderate brightness.
Detailed environment.

ABSOLUTELY NO TEXT.

No letters.
No words.
No captions.
No subtitles.
No typography.
No logos.
No watermark.
No signs with writing.
No posters.
No books with writing.
No newspapers.

Only the visual scene.
`.trim();
}


/* ---------------------------------------------------------
   CLOUDFLARE ERROR
--------------------------------------------------------- */

async function readCloudflareError(response) {

  const raw =
    await response.text().catch(() => '');

  let data = null;

  try {
    data = JSON.parse(raw);
  } catch {}

  const internalCode =
    data?.errors?.[0]?.code ??
    data?.error?.code ??
    null;

  const message =
    data?.errors?.[0]?.message ??
    data?.error?.message ??
    data?.message ??
    raw;

  return {
    internalCode,
    message: String(message || '').slice(0, 2000)
  };
}


/* ---------------------------------------------------------
   MAIN
--------------------------------------------------------- */

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return send(res, 405, {
      error: 'Yalnızca POST destekleniyor.'
    });
  }


  const body = getBody(req);


  /*
   * index.html şu anda:
   *
   * {
   *   title: post.title,
   *   text: post.text
   * }
   *
   * gönderiyor.
   */

  const title = clean(
    body.title ??
    body.poemTitle ??
    body.post?.title ??
    '',
    500
  );


  const poem = clean(
    body.text ??
    body.poem ??
    body.content ??
    body.poemText ??
    body.postText ??
    body.post?.text ??
    body.post?.poem ??
    '',
    12000
  );


  if (!poem) {

    console.error(
      'FLUX: şiir metni yok.',
      JSON.stringify(body).slice(0, 3000)
    );

    return send(res, 400, {
      error: 'Şiir metni gönderilemedi.'
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


  if (!accountId) {
    return send(res, 500, {
      error: 'CLOUDFLARE_ACCOUNT_ID eksik.'
    });
  }

  if (!token) {
    return send(res, 500, {
      error: 'CLOUDFLARE_API_TOKEN eksik.'
    });
  }


  /* -------------------------------------------------------
     GROQ → ŞİİR ANALİZİ
  ------------------------------------------------------- */

  let prompt =
    await createVisualPrompt(
      title,
      poem
    );


  if (!prompt) {
    prompt =
      fallbackPrompt(
        title,
        poem
      );
  }


  /*
   * FLUX prompt maksimum 2048 karakter.
   */

  prompt =
    prompt
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2048);


  /* -------------------------------------------------------
     FLUX
  ------------------------------------------------------- */

  const url =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}` +
    `/ai/run/${FLUX_MODEL}`;


  let response;

  try {

    response = await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },

        body: JSON.stringify({
          prompt,
          steps: 4
        })
      }
    );

  } catch (err) {

    console.error(
      'CLOUDFLARE CONNECTION ERROR:',
      err
    );

    return send(res, 502, {
      error:
        'Cloudflare FLUX bağlantısı kurulamadı.'
    });
  }


  /* -------------------------------------------------------
     429 — ÖZEL OLARAK ELE AL
  ------------------------------------------------------- */

  if (response.status === 429) {

    const cf =
      await readCloudflareError(
        response
      );

    console.error(
      'CLOUDFLARE FLUX 429:',
      cf
    );


    /*
     * 3036 = günlük ücretsiz neuron kotası.
     */

    if (cf.internalCode === 3036) {

      return send(res, 429, {
        error:
          'Cloudflare FLUX günlük ücretsiz kullanım kotası doldu.',
        code: 'CLOUDFLARE_DAILY_QUOTA',
        detail:
          'Yeni görsel oluşturmak için Cloudflare Workers AI kotasının yenilenmesi veya ücretli plana geçilmesi gerekiyor.'
      });
    }


    /*
     * 3040 = Cloudflare kapasitesi.
     */

    if (cf.internalCode === 3040) {

      return send(res, 503, {
        error:
          'Cloudflare FLUX şu anda kapasite sınırında.',
        code: 'CLOUDFLARE_CAPACITY',
        detail:
          'Bir süre sonra tekrar deneyin.'
      });
    }


    /*
     * Diğer 429.
     */

    return send(res, 429, {
      error:
        'Cloudflare FLUX istek sınırı nedeniyle isteği reddetti.',
      code: 'CLOUDFLARE_RATE_LIMIT',
      detail:
        cf.message
    });
  }


  /* -------------------------------------------------------
     DİĞER CLOUDFLARE HATALARI
  ------------------------------------------------------- */

  if (!response.ok) {

    const cf =
      await readCloudflareError(
        response
      );

    console.error(
      'CLOUDFLARE FLUX ERROR:',
      response.status,
      cf
    );

    return send(res, 502, {
      error:
        `Cloudflare FLUX HTTP ${response.status}`,
      detail:
        cf.message,
      code:
        cf.internalCode
    });
  }


  /* -------------------------------------------------------
     BAŞARILI CEVAP
  ------------------------------------------------------- */

  const contentType =
    (
      response.headers.get(
        'content-type'
      ) || ''
    ).toLowerCase();


  /*
   * Cloudflare bazı durumlarda doğrudan JPEG döndürebilir.
   */

  if (
    contentType.startsWith('image/')
  ) {

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (!buffer.length) {

      return send(res, 502, {
        error:
          'Cloudflare boş görsel döndürdü.'
      });
    }

    res.setHeader(
      'Content-Type',
      contentType.split(';')[0]
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(200)
      .send(buffer);
  }


  /*
   * Normal Workers AI JSON:
   *
   * {
   *   result: {
   *      image: "BASE64..."
   *   }
   * }
   */

  const raw =
    await response.text();


  let data;

  try {

    data =
      JSON.parse(raw);

  } catch {

    console.error(
      'FLUX JSON parse error:',
      raw.slice(0, 2000)
    );

    return send(res, 502, {
      error:
        'FLUX geçerli JSON/görsel döndürmedi.'
    });
  }


  const base64 =
    data?.result?.image;


  if (!base64) {

    console.error(
      'FLUX result.image yok:',
      JSON.stringify(data).slice(0, 3000)
    );

    return send(res, 502, {
      error:
        'FLUX görsel üretmedi.',
      detail:
        data?.errors ||
        data?.messages ||
        null
    });
  }


  let buffer;

  try {

    buffer =
      Buffer.from(
        String(base64),
        'base64'
      );

  } catch {

    return send(res, 502, {
      error:
        'FLUX görsel verisi okunamadı.'
    });
  }


  if (
    !buffer ||
    buffer.length < 1000
  ) {

    return send(res, 502, {
      error:
        'FLUX geçerli bir görsel döndürmedi.'
    });
  }


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


  return res
    .status(200)
    .send(buffer);
}
