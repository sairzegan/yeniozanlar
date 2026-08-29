// /api/flux-image.js
// Cloudflare Workers AI -> FLUX.1 schnell
//
// Vercel Environment Variables:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function json(res, status, data) {
  return res.status(status).json(data);
}

function temizle(value, maxLength = 1800) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, maxLength);
}

function promptOlustur(title, poem) {
  const baslik = temizle(title, 300);
  const siir = temizle(poem, 1500);

  /*
   * ŞİİR DOĞRUDAN PROMPTUN İÇİNDE.
   *
   * FLUX'a genel "şiirsel bir manzara" istemiyoruz.
   * Görsel doğrudan bu şiirin anlattığı şeyden üretilecek.
   */

  const prompt = `
Create ONE original cinematic image based DIRECTLY on the Turkish poem below.

The poem itself is the primary source for the image.

IMPORTANT:
- Understand the actual meaning of the poem.
- Visually represent the events, people, places, objects, memories,
  emotions and atmosphere described in the poem.
- Do NOT create a generic poetry image.
- Do NOT create an unrelated landscape.
- The final image must clearly feel connected to THIS SPECIFIC POEM.
- If the poem describes a person, make that person visually important.
- If it describes a place, use that place.
- If it describes loneliness, separation, poverty, love, sadness,
  anger, hope, travel, nature, night, village, city or another
  concrete subject, show those elements.
- Use the strongest visual images and metaphors from the poem.
- Cinematic realistic photography.
- Natural dramatic lighting.
- Atmospheric depth.
- Emotional and believable composition.
- Professional fine-art photography.
- High detail.

Do NOT put the poem or any text into the generated image.
Do NOT generate letters, words, captions, subtitles, typography,
logos, watermarks, posters, signs or fake writing.

The image should contain ONLY the visual scene.

${baslik ? `POEM TITLE:\n${baslik}\n\n` : ""}

TURKISH POEM:
${siir}
`.trim();

  return prompt.slice(0, 2048);
}

async function parseBody(req) {
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

async function hataOku(response) {
  const raw = await response.text().catch(() => "");

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(raw);

    if (Array.isArray(data?.errors)) {
      const mesaj = data.errors
        .map(e => e?.message || e?.code)
        .filter(Boolean)
        .join(" | ");

      if (mesaj) {
        return mesaj;
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

    return raw.slice(0, 2000);

  } catch {
    return raw.slice(0, 2000);
  }
}

function base64Temizle(value) {
  if (typeof value !== "string") {
    return null;
  }

  let valueClean = value.trim();

  /*
   * Bazen:
   * data:image/jpeg;base64,AAAA...
   *
   * şeklinde gelebilir.
   */

  if (valueClean.startsWith("data:")) {
    const commaIndex = valueClean.indexOf(",");

    if (commaIndex !== -1) {
      valueClean = valueClean.slice(commaIndex + 1);
    }
  }

  /*
   * Base64 içinde boşluk/newline kalmışsa temizle.
   */
  valueClean = valueClean
    .replace(/\s/g, "")
    .trim();

  return valueClean || null;
}

async function cloudflareGorselAl(response) {
  const contentType =
    String(response.headers.get("content-type") || "")
      .toLowerCase();

  /*
   * -------------------------------------------------------
   * 1. CLOUDFLARE DOĞRUDAN IMAGE DÖNDÜRDÜ
   * -------------------------------------------------------
   */

  if (contentType.startsWith("image/")) {
    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (buffer.length > 1000) {
      return buffer;
    }

    throw new Error(
      "Cloudflare boş veya geçersiz bir görsel döndürdü."
    );
  }

  /*
   * -------------------------------------------------------
   * 2. CLOUDFLARE JSON DÖNDÜRDÜ
   * -------------------------------------------------------
   */

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Cloudflare geçerli JSON veya görsel döndürmedi."
    );
  }

  /*
   * Cloudflare Workers AI standart sonucu:
   *
   * {
   *   success: true,
   *   result: {
   *     image: "BASE64..."
   *   }
   * }
   */

  if (data?.success === false) {
    const mesaj = Array.isArray(data?.errors)
      ? data.errors
          .map(e => e?.message || e?.code)
          .filter(Boolean)
          .join(" | ")
      : "Cloudflare Workers AI isteği başarısız oldu.";

    throw new Error(mesaj);
  }

  /*
   * Farklı olası response biçimlerini destekle.
   */

  let imageValue =
    data?.result?.image ||
    data?.image ||
    data?.result?.output?.image ||
    null;

  /*
   * -------------------------------------------------------
   * 3. IMAGE URL GELDİYSE
   * -------------------------------------------------------
   */

  if (
    typeof imageValue === "string" &&
    /^https?:\/\//i.test(imageValue)
  ) {
    const imageResponse = await fetch(imageValue);

    if (!imageResponse.ok) {
      throw new Error(
        `Cloudflare görsel URL'si alınamadı: HTTP ${imageResponse.status}`
      );
    }

    const buffer = Buffer.from(
      await imageResponse.arrayBuffer()
    );

    if (buffer.length < 1000) {
      throw new Error(
        "Görsel URL'sinden boş/geçersiz veri geldi."
      );
    }

    return buffer;
  }

  /*
   * -------------------------------------------------------
   * 4. BASE64 IMAGE
   * -------------------------------------------------------
   */

  const base64 = base64Temizle(imageValue);

  if (!base64 || base64.length < 1000) {
    console.error(
      "FLUX RESPONSE GÖRSEL İÇERMİYOR:",
      {
        success: data?.success,
        keys: Object.keys(data || {}),
        resultKeys:
          data?.result &&
          typeof data.result === "object"
            ? Object.keys(data.result)
            : []
      }
    );

    throw new Error(
      "Cloudflare başarılı yanıt verdi ancak FLUX görsel verisi bulunamadı."
    );
  }

  const imageBuffer = Buffer.from(
    base64,
    "base64"
  );

  if (imageBuffer.length < 1000) {
    throw new Error(
      "FLUX tarafından dönen Base64 görsel verisi geçersiz."
    );
  }

  return imageBuffer;
}

export default async function handler(req, res) {

  /*
   * -------------------------------------------------------
   * METHOD
   * -------------------------------------------------------
   */

  if (req.method !== "POST") {
    return json(res, 405, {
      error: "Yalnızca POST destekleniyor."
    });
  }

  /*
   * -------------------------------------------------------
   * ENV
   * -------------------------------------------------------
   */

  const accountId = String(
    process.env.CLOUDFLARE_ACCOUNT_ID || ""
  ).trim();

  const apiToken = String(
    process.env.CLOUDFLARE_API_TOKEN || ""
  ).trim();

  if (!accountId) {
    return json(res, 500, {
      error:
        "CLOUDFLARE_ACCOUNT_ID Vercel'de bulunamadı."
    });
  }

  if (!apiToken) {
    return json(res, 500, {
      error:
        "CLOUDFLARE_API_TOKEN Vercel'de bulunamadı."
    });
  }

  /*
   * -------------------------------------------------------
   * BODY
   * -------------------------------------------------------
   */

  const body = await parseBody(req);

  if (!body) {
    return json(res, 400, {
      error: "Geçersiz JSON isteği."
    });
  }

  const title = temizle(
    body?.title,
    300
  );

  /*
   * Frontend eski/yeni alan adlarından hangisini
   * kullanıyorsa kabul ediyoruz.
   */

  const poem = temizle(
    body?.text ||
    body?.poem ||
    body?.poemText ||
    body?.content ||
    "",
    1500
  );

  if (!poem) {
    return json(res, 400, {
      error: "Şiir metni boş."
    });
  }

  /*
   * -------------------------------------------------------
   * PROMPT
   * -------------------------------------------------------
   */

  const prompt =
    promptOlustur(title, poem);

  console.log(
    "FLUX prompt gönderiliyor:",
    prompt.slice(0, 500)
  );

  /*
   * -------------------------------------------------------
   * CLOUDFLARE ENDPOINT
   * -------------------------------------------------------
   */

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}` +
    `/ai/run/${MODEL}`;

  try {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 90000);

    let response;

    try {

      /*
       * SADECE PROMPT.
       *
       * seed ve diğer tartışmalı parametreleri
       * özellikle göndermiyoruz.
       */

      response = await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${apiToken}`,

            "Content-Type":
              "application/json",

            "Accept":
              "application/json"
          },

          body: JSON.stringify({
            prompt: prompt
          }),

          signal: controller.signal
        }
      );

    } finally {
      clearTimeout(timeout);
    }

    /*
     * -----------------------------------------------------
     * CLOUDFLARE HTTP ERROR
     * -----------------------------------------------------
     */

    if (!response.ok) {

      const detail =
        await hataOku(response);

      console.error(
        "CLOUDFLARE FLUX HTTP HATASI:",
        response.status,
        detail
      );

      return json(res, 502, {
        error:
          `Cloudflare FLUX HTTP ${response.status}`,
        detail
      });
    }

    /*
     * -----------------------------------------------------
     * GÖRSELİ AL
     * -----------------------------------------------------
     */

    let imageBuffer;

    try {

      imageBuffer =
        await cloudflareGorselAl(
          response
        );

    } catch (error) {

      console.error(
        "FLUX GÖRSEL ÇIKARMA HATASI:",
        error
      );

      return json(res, 502, {
        error:
          `Cloudflare FLUX görseli alınamadı: ${
            error?.message ||
            String(error)
          }`
      });
    }

    /*
     * -----------------------------------------------------
     * EN ÖNEMLİ KISIM:
     *
     * Başarılıysa JSON DEĞİL,
     * doğrudan JPEG gönderiyoruz.
     * -----------------------------------------------------
     */

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.setHeader(
      "Content-Length",
      String(imageBuffer.length)
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "Pragma",
      "no-cache"
    );

    return res
      .status(200)
      .send(imageBuffer);

  } catch (error) {

    console.error(
      "FLUX ENDPOINT HATASI:",
      error
    );

    if (
      error?.name === "AbortError"
    ) {
      return json(res, 504, {
        error:
          "FLUX görsel oluşturma 90 saniye içinde tamamlanmadı."
      });
    }

    return json(res, 502, {
      error:
        `FLUX görseli oluşturulamadı: ${
          error?.message ||
          String(error)
        }`
    });
  }
}
