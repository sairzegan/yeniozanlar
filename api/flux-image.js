// /api/flux-image.js
//
// Akış:
// index.html
//    ↓
// /api/flux-image
//    ↓
// Groq → şiirin konusunu görsel promptuna çevirir
//    ↓
// Cloudflare FLUX
//    ↓
// image/jpeg → index.html
//
// Vercel Environment Variables:
// GROQ_API_KEY
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

function json(res, status, data) {
  return res.status(status).json(data);
}

function temizle(value, maxLength = 12000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function bodyOku(req) {
  let body = req.body;

  if (!body) return {};

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body;
}

/*
 * Buradaki amaç şiirin tamamını FLUX'a körlemesine
 * vermek değil.
 *
 * Önce Groq şiirin anlamını çıkarıyor.
 * Groq çalışmazsa şiirin kendisini FLUX'a veriyoruz.
 */
async function groqIlePromptOlustur(title, poem) {

  const apiKey = String(
    process.env.GROQ_API_KEY || ''
  ).trim();

  if (!apiKey) {
    console.warn(
      'GROQ_API_KEY yok. Şiirin kendisi FLUX promptu olarak kullanılacak.'
    );

    return null;
  }

  const groqPrompt = `
Aşağıdaki Türkçe şiiri dikkatlice analiz et.

Görevin yalnızca şiirin ANLAMINA ve KONUSUNA uygun
bir görsel üretim promptu yazmak.

ÇOK ÖNEMLİ:

- Şiirin konusu dışına çıkma.
- Şiirde olmayan rastgele nesneler ekleme.
- Şiirin ana duygusunu ve olayını görselleştir.
- Şiirde geçen gerçek kişi, yer, nesne, doğa,
  mevsim, hava, olay veya semboller varsa bunları kullan.
- Görsel şiirin anlattığı sahneyle doğrudan ilişkili olsun.
- Aşırı karanlık bir görüntü oluşturma.
- Gereksiz siyah arka plan kullanma.
- Sinematik ve gerçekçi olsun.
- Estetik bir şiir görseli olsun.

EN ÖNEMLİ KURAL:

GÖRSELDE HİÇBİR YAZI OLMAYACAK.

Harflere benzeyen işaretler,
kelimeler,
kitap yazısı,
gazete,
tabela,
altyazı,
logo,
filigran,
başlık,
tipografi,
poster yazısı
KESİNLİKLE OLMAYACAK.

Yalnızca görüntü oluştur.

Prompt İngilizce olsun.

SADECE promptu döndür.
Açıklama yapma.
`;

  const userText = `
ŞİİR BAŞLIĞI:
${title || '(başlık yok)'}

TÜRKÇE ŞİİR:
${poem}
`;

  try {

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',

          messages: [
            {
              role: 'system',
              content: groqPrompt
            },
            {
              role: 'user',
              content: userText
            }
          ],

          temperature: 0.2,

          max_completion_tokens: 500
        })
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      console.error(
        'GROQ HTTP ERROR:',
        response.status,
        raw
      );

      // Groq hata verse bile resmi durdurma.
      return null;
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.error('Groq JSON okunamadı:', raw);
      return null;
    }

    const prompt =
      data?.choices?.[0]?.message?.content?.trim();

    if (!prompt) {
      console.error(
        'Groq boş prompt döndürdü:',
        raw
      );

      return null;
    }

    return prompt;

  } catch (err) {

    console.error(
      'Groq bağlantı hatası:',
      err?.message || err
    );

    // Groq başarısız olsa bile FLUX çalışmaya devam edecek.
    return null;
  }
}


function fluxFallbackPrompt(title, poem) {

  return `
Create a realistic cinematic scene inspired directly by this Turkish poem.

The poem itself is the primary source of the visual.

Represent the actual subject, events, people, places,
objects, memories, metaphors and emotions described in the poem.

Do not create a generic poetry image.

The visual scene must clearly relate to the poem.

Beautiful natural lighting.
Realistic professional photography.
Cinematic composition.
Poetic atmosphere.
Natural colors.
Detailed environment.
Emotionally expressive.
Believable human figures if appropriate.

IMPORTANT:

NO TEXT IN THE IMAGE.
NO LETTERS.
NO WORDS.
NO TYPOGRAPHY.
NO CAPTIONS.
NO SUBTITLES.
NO LOGOS.
NO WATERMARKS.
NO SIGNS WITH WRITING.
NO POSTERS WITH WRITING.
NO BOOK TEXT.
NO NEWSPAPER TEXT.

Only the visual scene.

Poem title:
${title || ''}

Turkish poem:
${poem}
`.trim();
}


async function cloudflareHataOku(response) {

  const raw =
    await response.text().catch(() => '');

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {

    const data = JSON.parse(raw);

    if (Array.isArray(data?.errors)) {

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


  /*
   * ---------------------------------------------------------
   * ENV
   * ---------------------------------------------------------
   */

  const accountId =
    String(
      process.env.CLOUDFLARE_ACCOUNT_ID || ''
    ).trim();

  const apiToken =
    String(
      process.env.CLOUDFLARE_API_TOKEN || ''
    ).trim();


  if (!accountId) {

    return json(res, 500, {
      error:
        'CLOUDFLARE_ACCOUNT_ID Vercel Environment Variable bulunamadı.'
    });
  }


  if (!apiToken) {

    return json(res, 500, {
      error:
        'CLOUDFLARE_API_TOKEN Vercel Environment Variable bulunamadı.'
    });
  }


  /*
   * ---------------------------------------------------------
   * REQUEST BODY
   * ---------------------------------------------------------
   *
   * Mevcut index.html:
   *
   * {
   *   title: post.title,
   *   text: post.text
   * }
   *
   * Bunu doğrudan destekliyoruz.
   *
   * Ek olarak eski/yeni sürümlerde kullanılabilecek
   * poem/content/body alanlarını da kabul ediyoruz.
   */

  const body = bodyOku(req);

  const title = temizle(
    body?.title ??
    body?.post?.title ??
    body?.poemTitle ??
    '',
    500
  );


  const poem = temizle(
    body?.text ??
    body?.poem ??
    body?.content ??
    body?.poemText ??
    body?.postText ??
    body?.post?.text ??
    body?.post?.poem ??
    body?.data?.text ??
    '',
    12000
  );


  /*
   * BURASI ÖNEMLİ:
   *
   * Önceki kod burada yalnızca poem arıyordu.
   *
   * Artık index.html'den gelen "text" doğrudan kabul ediliyor.
   */

  if (!poem) {

    console.error(
      'FLUX: Şiir bulunamadı. Gelen body:',
      JSON.stringify(body).slice(0, 3000)
    );

    return json(res, 400, {
      error: 'Şiir metni gönderilemedi.',
      acceptedFields: [
        'text',
        'poem',
        'content',
        'poemText',
        'postText'
      ]
    });
  }


  /*
   * ---------------------------------------------------------
   * GROQ
   * ---------------------------------------------------------
   */

  let imagePrompt =
    await groqIlePromptOlustur(
      title,
      poem
    );


  /*
   * Groq çalışmazsa resmi yine üret.
   */

  if (!imagePrompt) {

    console.warn(
      'Groq prompt üretmedi. FLUX fallback prompt kullanılacak.'
    );

    imagePrompt =
      fluxFallbackPrompt(
        title,
        poem
      );
  }


  /*
   * FLUX'a gönderilecek promptu son kez
   * yazısız görsel kurallarıyla güçlendiriyoruz.
   */

  imagePrompt = `
${imagePrompt}

ABSOLUTE IMAGE RULE:
The final generated image must contain ZERO visible text.

No letters.
No words.
No typography.
No captions.
No subtitles.
No logos.
No watermark.
No signs.
No posters.
No newspaper.
No book pages with writing.
No UI.
No readable symbols.

ONLY THE VISUAL SCENE.
`.trim();


  // Cloudflare FLUX prompt limiti 2048 karakter.
  imagePrompt =
    imagePrompt.slice(0, 2048);


  /*
   * ---------------------------------------------------------
   * CLOUDFLARE FLUX
   * ---------------------------------------------------------
   */

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}` +
    `/ai/run/${MODEL}`;


  try {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        90000
      );


    let response;

    try {

      response = await fetch(
        endpoint,
        {
          method: 'POST',

          headers: {
            'Authorization':
              `Bearer ${apiToken}`,

            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body: JSON.stringify({
            prompt: imagePrompt,
            steps: 4
          }),

          signal: controller.signal
        }
      );

    } finally {

      clearTimeout(timeout);
    }


    /*
     * -------------------------------------------------------
     * CLOUDFLARE HATA
     * -------------------------------------------------------
     */

    if (!response.ok) {

      const hata =
        await cloudflareHataOku(response);

      console.error(
        'CLOUDFLARE FLUX HTTP:',
        response.status,
        hata
      );

      return json(res, 502, {

        error:
          `Cloudflare FLUX HTTP ${response.status}`,

        detail: hata
      });
    }


    /*
     * -------------------------------------------------------
     * RESPONSE
     * -------------------------------------------------------
     */

    const contentType =
      (
        response.headers.get(
          'content-type'
        ) || ''
      ).toLowerCase();


    /*
     * Bazı Cloudflare cevapları doğrudan
     * image/jpeg olabilir.
     */

    if (
      contentType.startsWith('image/')
    ) {

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );


      if (!buffer.length) {

        return json(res, 502, {
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
     * Normal Cloudflare Workers AI REST cevabı:
     *
     * {
     *   success: true,
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
        'FLUX JSON parse hatası:',
        raw.slice(0, 2000)
      );

      return json(res, 502, {
        error:
          'FLUX görsel yerine geçersiz veri döndürdü.'
      });
    }


    const base64Image =
      data?.result?.image ||
      data?.image;


    if (!base64Image) {

      console.error(
        'FLUX result.image bulunamadı:',
        JSON.stringify(data).slice(0, 3000)
      );

      return json(res, 502, {
        error:
          'FLUX görsel üretmedi.',
        detail:
          data?.errors ||
          data?.messages ||
          null
      });
    }


    const buffer =
      Buffer.from(
        String(base64Image),
        'base64'
      );


    if (
      !buffer.length ||
      buffer.length < 1000
    ) {

      return json(res, 502, {
        error:
          'FLUX geçerli bir görsel döndürmedi.'
      });
    }


    /*
     * -------------------------------------------------------
     * INDEX.HTML'E DOĞRUDAN JPEG DÖNDÜR
     * -------------------------------------------------------
     */

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


  } catch (err) {

    console.error(
      'FLUX FATAL ERROR:',
      err
    );

    if (
      err?.name === 'AbortError'
    ) {

      return json(res, 504, {
        error:
          'FLUX görsel oluşturma zaman aşımına uğradı.'
      });
    }


    return json(res, 500, {
      error:
        'Görsel oluşturma sırasında hata oluştu.',
      detail:
        err?.message ||
        String(err)
    });
  }
}
