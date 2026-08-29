// /api/flux-image.js
//
// AKIŞ:
//
// 1. Kullanıcıdan şiiri alır.
// 2. Groq şiiri analiz eder.
// 3. Groq, şiire özel İNGİLİZCE görsel üretim promptu oluşturur.
// 4. Prompt FLUX.1 schnell'e gönderilir.
// 5. FLUX görselini Base64 olarak döndürür.
// 6. Vercel doğrudan image/jpeg döndürür.
//
// ENV:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN
// GROQ_API_KEY

const FLUX_MODEL =
  "@cf/black-forest-labs/flux-1-schnell";

const GROQ_MODEL =
  "llama-3.3-70b-versatile";

const CLOUDFLARE_URL =
  "https://api.cloudflare.com/client/v4/accounts";

const GROQ_URL =
  "https://api.groq.com/openai/v1/chat/completions";


// ---------------------------------------------------------
// JSON RESPONSE
// ---------------------------------------------------------

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  return res.json(data);
}


// ---------------------------------------------------------
// TEXT CLEAN
// ---------------------------------------------------------

function cleanText(value, maxLength = 12000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, maxLength);
}


// ---------------------------------------------------------
// REQUEST BODY
// ---------------------------------------------------------

async function readBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}


// ---------------------------------------------------------
// GROQ
//
// Groq'dan SADECE görsel promptu istiyoruz.
// Şiirin kendisini görsele yazdırmıyoruz.
//
// ---------------------------------------------------------

async function createVisualPrompt(poem, title) {

  const systemPrompt = `
You are an expert visual director and cinematic image-prompt writer.

Your task is to read a Turkish poem and convert its meaning into ONE
strong visual scene for an AI image generation model.

IMPORTANT RULES:

1. The poem itself is the ONLY source of inspiration.
2. Understand the actual subject, story, people, place, objects,
   emotions and events in the poem.
3. Do NOT create a generic "sad person looking at sunset" image
   unless the poem actually describes that.
4. Do NOT invent an unrelated landscape.
5. Prefer concrete details from the poem.
6. If the poem describes a person, show that person.
7. If it describes a village, road, house, city, sea, mountain,
   family, lover, separation, journey, poverty, childhood,
   loneliness, hope or another concrete subject, visually represent it.
8. Preserve the emotional atmosphere of the poem.
9. The result must be ONE coherent cinematic scene.
10. Use realistic visual storytelling.
11. Use natural, balanced lighting.
12. Avoid unnecessarily dark or black images.
13. If the poem happens at night, use visible moonlight,
    practical lights or atmospheric lighting so the scene remains
    clearly visible.
14. Do NOT add text to the image.
15. Absolutely NO letters, words, captions, subtitles,
    poems, typography, signs, logos, watermarks,
    book pages, newspapers, screens or readable writing.
16. Do not show the poem as text.
17. Do not quote any line from the poem inside the image.
18. Do not create a poster or book cover.
19. Create a cinematic photographic scene, not an illustration
    of written words.
20. The final image should look like a professional cinematic
    photograph inspired specifically by this poem.

Return ONLY valid JSON:

{
  "image_prompt": "..."
}

The image_prompt must be written in English because the image model
understands English visual instructions more reliably.

The image_prompt must be detailed enough to describe:
- subject
- environment
- important objects
- human presence if relevant
- action
- emotional atmosphere
- composition
- camera perspective
- lighting
- color mood

But it must NEVER contain instructions to put text into the image.
`.trim();


  const userPrompt = `
Analyze this Turkish poem and create the visual scene.

TITLE:
${title || "(no title)"}

POEM:
${poem}

Remember:

The generated image must visually represent THIS poem.

Do not make a generic poetry image.

Do not put any text, words, letters or writing in the image.

Return JSON only.
`.trim();


  const response = await fetch(
    GROQ_URL,
    {
      method: "POST",

      headers: {
        "Authorization":
          `Bearer ${process.env.GROQ_API_KEY}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        model: GROQ_MODEL,

        temperature: 0.35,

        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ],

        response_format: {
          type: "json_object"
        },

        max_tokens: 900
      })
    }
  );


  const raw = await response.text();


  if (!response.ok) {

    console.error(
      "GROQ HTTP ERROR:",
      response.status,
      raw
    );

    throw new Error(
      `Groq HTTP ${response.status}`
    );
  }


  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Groq geçerli JSON döndürmedi."
    );
  }


  const content =
    data?.choices?.[0]?.message?.content;


  if (!content) {
    throw new Error(
      "Groq yanıtında message.content bulunamadı."
    );
  }


  let result;

  try {
    result = JSON.parse(content);
  } catch {

    /*
     * Model JSON'u markdown içine koyduysa
     * yine kurtarmaya çalış.
     */

    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      result = JSON.parse(cleaned);
    } catch {
      throw new Error(
        "Groq görsel promptunu geçerli JSON olarak döndürmedi."
      );
    }
  }


  let imagePrompt =
    cleanText(
      result?.image_prompt,
      1900
    );


  if (!imagePrompt) {
    throw new Error(
      "Groq boş görsel promptu döndürdü."
    );
  }


  /*
   * FLUX'a son güvenlik katmanı.
   *
   * Groq yanlışlıkla text/typography yazsa bile
   * FLUX promptunun sonuna kesin yasak ekleniyor.
   */

  imagePrompt += `

ABSOLUTELY NO TEXT IN THE IMAGE.
NO LETTERS.
NO WORDS.
NO TYPOGRAPHY.
NO CAPTIONS.
NO SUBTITLES.
NO POEM TEXT.
NO QUOTES.
NO LOGOS.
NO WATERMARKS.
NO SIGNS WITH WRITING.
NO BOOK TEXT.
NO NEWSPAPER TEXT.
NO SCREEN TEXT.
NO POSTER.
NO ALPHABETIC CHARACTERS.

Create only the visual scene.

Use clear, natural, balanced lighting.
Do not make the entire image black or excessively dark.
The subject must remain clearly visible.
`.trim();


  return imagePrompt.slice(0, 2048);
}


// ---------------------------------------------------------
// CLOUDFLARE ERROR
// ---------------------------------------------------------

async function readCloudflareError(response) {

  const raw =
    await response.text().catch(
      () => ""
    );


  if (!raw) {
    return `HTTP ${response.status}`;
  }


  try {

    const data =
      JSON.parse(raw);


    if (Array.isArray(data?.errors)) {

      const messages =
        data.errors
          .map(
            e =>
              e?.message ||
              e?.code ||
              ""
          )
          .filter(Boolean);


      if (messages.length) {
        return messages.join(" | ");
      }
    }


    if (data?.error?.message) {
      return data.error.message;
    }


    if (typeof data?.error === "string") {
      return data.error;
    }


    if (data?.message) {
      return data.message;
    }


  } catch {
    // JSON değilse aşağıdaki raw kullanılır.
  }


  return raw.slice(0, 2000);
}


// ---------------------------------------------------------
// BASE64 TEMİZLE
// ---------------------------------------------------------

function cleanBase64(value) {

  if (
    typeof value !== "string"
  ) {
    return null;
  }


  let base64 =
    value.trim();


  /*
   * data:image/jpeg;base64,...
   * şeklinde gelirse prefix'i kaldır.
   */

  if (
    base64.startsWith("data:")
  ) {

    const comma =
      base64.indexOf(",");

    if (comma !== -1) {
      base64 =
        base64.slice(
          comma + 1
        );
    }
  }


  return base64
    .replace(/\s/g, "")
    .trim() || null;
}


// ---------------------------------------------------------
// CLOUDFLARE FLUX
// ---------------------------------------------------------

async function generateWithFlux(
  accountId,
  token,
  prompt
) {

  const endpoint =
    `${CLOUDFLARE_URL}/` +
    `${encodeURIComponent(accountId)}` +
    `/ai/run/${FLUX_MODEL}`;


  /*
   * SADECE PROMPT GÖNDERİYORUZ.
   *
   * seed yok
   * steps yok
   * width yok
   * height yok
   *
   * Böylece önceki "Additional or unevaluated
   * properties '/seed'..." hatasının tekrar
   * etmesini engelliyoruz.
   */

  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${token}`,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json"
        },

        body: JSON.stringify({
          prompt
        })
      }
    );


  /*
   * HTTP HATASI
   */

  if (!response.ok) {

    const detail =
      await readCloudflareError(
        response
      );


    throw new Error(
      `Cloudflare FLUX HTTP ${response.status} — ${detail}`
    );
  }


  /*
   * FLUX genellikle JSON içinde:
   *
   * {
   *   success: true,
   *   result: {
   *      image: "BASE64..."
   *   }
   * }
   *
   * döndürüyor.
   */

  const contentType =
    String(
      response.headers.get(
        "content-type"
      ) || ""
    ).toLowerCase();


  /*
   * Nadiren doğrudan image dönerse
   * onu da destekle.
   */

  if (
    contentType.startsWith(
      "image/"
    )
  ) {

    const buffer =
      Buffer.from(
        await response.arrayBuffer()
      );


    if (buffer.length < 1000) {
      throw new Error(
        "Cloudflare boş görsel döndürdü."
      );
    }


    return buffer;
  }


  const raw =
    await response.text();


  let data;


  try {
    data =
      JSON.parse(raw);
  } catch {

    throw new Error(
      "Cloudflare FLUX geçerli JSON veya görsel döndürmedi."
    );
  }


  if (
    data?.success === false
  ) {

    const message =
      Array.isArray(data?.errors)
        ? data.errors
            .map(
              e =>
                e?.message ||
                e?.code ||
                ""
            )
            .filter(Boolean)
            .join(" | ")
        : "Cloudflare FLUX başarısız oldu.";


    throw new Error(
      message
    );
  }


  /*
   * FLUX IMAGE
   */

  const imageValue =
    data?.result?.image ||
    data?.image ||
    data?.result?.output?.image ||
    null;


  /*
   * IMAGE URL GELİRSE
   */

  if (
    typeof imageValue === "string" &&
    /^https?:\/\//i.test(
      imageValue
    )
  ) {

    const imageResponse =
      await fetch(
        imageValue
      );


    if (
      !imageResponse.ok
    ) {

      throw new Error(
        `FLUX görsel URL'si alınamadı: HTTP ${imageResponse.status}`
      );
    }


    const buffer =
      Buffer.from(
        await imageResponse.arrayBuffer()
      );


    if (
      buffer.length < 1000
    ) {

      throw new Error(
        "FLUX görsel URL'si boş döndü."
      );
    }


    return buffer;
  }


  /*
   * BASE64
   */

  const base64 =
    cleanBase64(
      imageValue
    );


  if (
    !base64 ||
    base64.length < 1000
  ) {

    console.error(
      "FLUX RESPONSE:",
      JSON.stringify(
        data
      ).slice(
        0,
        4000
      )
    );


    throw new Error(
      "FLUX görsel yerine geçerli bir image verisi döndürmedi."
    );
  }


  const buffer =
    Buffer.from(
      base64,
      "base64"
    );


  if (
    buffer.length < 1000
  ) {

    throw new Error(
      "FLUX Base64 görsel verisi geçersiz."
    );
  }


  return buffer;
}


// ---------------------------------------------------------
// MAIN HANDLER
// ---------------------------------------------------------

export default async function handler(
  req,
  res
) {

  /*
   * POST
   */

  if (
    req.method !== "POST"
  ) {

    return sendJson(
      res,
      405,
      {
        error:
          "Yalnızca POST destekleniyor."
      }
    );
  }


  /*
   * ENV
   */

  const accountId =
    cleanText(
      process.env.CLOUDFLARE_ACCOUNT_ID,
      200
    );


  const cloudflareToken =
    cleanText(
      process.env.CLOUDFLARE_API_TOKEN,
      500
    );


  const groqKey =
    cleanText(
      process.env.GROQ_API_KEY,
      500
    );


  if (!accountId) {

    return sendJson(
      res,
      500,
      {
        error:
          "CLOUDFLARE_ACCOUNT_ID bulunamadı."
      }
    );
  }


  if (!cloudflareToken) {

    return sendJson(
      res,
      500,
      {
        error:
          "CLOUDFLARE_API_TOKEN bulunamadı."
      }
    );
  }


  if (!groqKey) {

    return sendJson(
      res,
      500,
      {
        error:
          "GROQ_API_KEY bulunamadı."
      }
    );
  }


  /*
   * BODY
   */

  const body =
    await readBody(req);


  if (!body) {

    return sendJson(
      res,
      400,
      {
        error:
          "Geçersiz JSON isteği."
      }
    );
  }


  /*
   * Şiir alanı.
   *
   * Frontend'in eski/yeni alan adlarını
   * destekliyoruz.
   */

  const poem =
    cleanText(
      body?.poem ||
      body?.text ||
      body?.poemText ||
      body?.content ||
      "",
      12000
    );


  const title =
    cleanText(
      body?.title ||
      body?.name ||
      "",
      500
    );


  if (!poem) {

    return sendJson(
      res,
      400,
      {
        error:
          "Şiir metni boş."
      }
    );
  }


  try {

    /*
     * -----------------------------------------------------
     * 1. GROQ ŞİİRİ ANALİZ EDİYOR
     * -----------------------------------------------------
     */

    console.log(
      "1/2 Groq şiiri analiz ediyor..."
    );


    const imagePrompt =
      await createVisualPrompt(
        poem,
        title
      );


    console.log(
      "Groq tarafından oluşturulan FLUX prompt:",
      imagePrompt
    );


    /*
     * -----------------------------------------------------
     * 2. FLUX GÖRSELİ ÜRETİYOR
     * -----------------------------------------------------
     */

    console.log(
      "2/2 FLUX görsel oluşturuyor..."
    );


    const imageBuffer =
      await generateWithFlux(
        accountId,
        cloudflareToken,
        imagePrompt
      );


    /*
     * -----------------------------------------------------
     * DOĞRUDAN JPEG
     * -----------------------------------------------------
     */

    res.status(200);

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.setHeader(
      "Content-Length",
      String(
        imageBuffer.length
      )
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );


    return res.send(
      imageBuffer
    );


  } catch (error) {

    console.error(
      "FLUX IMAGE ERROR:",
      error
    );


    return sendJson(
      res,
      502,
      {
        error:
          error?.message ||
          "Görsel oluşturulamadı."
      }
    );
  }
}
