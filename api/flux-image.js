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
   * ÖNEMLİ:
   * FLUX'a şiirin yazısını görselin içine çizdirmiyoruz.
   *
   * FLUX metinleri özellikle Türkçe şiirlerde bozabiliyor.
   * Görsel sadece şiirin anlamından oluşturuluyor.
   *
   * Şiirden seçilecek 1-2 mısra gerekiyorsa bunu
   * index.html tarafındaki canvas/metin katmanı yapmalı.
   */

  const prompt = `
Create ONE original cinematic landscape image inspired by the Turkish poem below.

IMPORTANT:
- The image must be based on the actual meaning, story, objects, places,
  people, memories and emotions in the poem.
- Create a realistic poetic scene, not a generic "poetry" image.
- Keep the composition elegant, simple and uncluttered.
- Make the main subject visually clear.
- Use cinematic realistic photography.
- Natural dramatic lighting.
- Atmospheric depth.
- Emotional but tasteful composition.
- High detail.
- Professional fine-art photography.

ABSOLUTELY NO TEXT IN THE IMAGE.
Do not generate:
letters,
words,
sentences,
poem lines,
captions,
titles,
signs,
posters,
book pages,
typography,
logos,
watermarks,
UI,
subtitles,
random writing.

The final image must contain ONLY the visual scene.
There must be no readable or fake writing anywhere.

Use the Turkish poem only as the visual inspiration.

${baslik ? `ŞİİR BAŞLIĞI:\n${baslik}\n` : ""}

TÜRKÇE ŞİİR:
${siir}
`.trim();

  // Cloudflare FLUX prompt limiti
  return prompt.slice(0, 2048);
}

async function parseBody(req) {
  if (!req.body) return {};

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

      if (mesaj) return mesaj;
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      error: "Yalnızca POST destekleniyor."
    });
  }

  const accountId = String(
    process.env.CLOUDFLARE_ACCOUNT_ID || ""
  ).trim();

  const apiToken = String(
    process.env.CLOUDFLARE_API_TOKEN || ""
  ).trim();

  if (!accountId) {
    return json(res, 500, {
      error: "CLOUDFLARE_ACCOUNT_ID Vercel'de bulunamadı."
    });
  }

  if (!apiToken) {
    return json(res, 500, {
      error: "CLOUDFLARE_API_TOKEN Vercel'de bulunamadı."
    });
  }

  const body = await parseBody(req);

  if (!body) {
    return json(res, 400, {
      error: "Geçersiz JSON isteği."
    });
  }

  const title = temizle(body.title, 300);
  const poem = temizle(
    body.text || body.poem || "",
    1500
  );

  if (!poem) {
    return json(res, 400, {
      error: "Şiir metni boş."
    });
  }

  const prompt = promptOlustur(title, poem);

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 90000);

    let response;

    try {
      response = await fetch(endpoint, {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },

        /*
         * ÖNEMLİ:
         * seed YOK.
         *
         * Daha önce:
         * seed: Math.floor(...)
         *
         * gönderiliyordu ve Cloudflare:
         * "Additional or unevaluated properties '/seed'
         * at '/' not allowed"
         *
         * hatası veriyordu.
         */

        body: JSON.stringify({
          prompt: prompt,
          steps: 4
        }),

        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    /*
     * Cloudflare hata verdi
     */
    if (!response.ok) {
      const hata = await hataOku(response);

      console.error(
        "CLOUDFLARE FLUX HTTP HATASI:",
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
     * Cloudflare normalde JSON içinde:
     *
     * {
     *   "success": true,
     *   "result": {
     *      "image": "BASE64..."
     *   }
     * }
     *
     * döndürüyor.
     *
     * Ama olası binary cevabı da destekliyoruz.
     */

    const contentType =
      (response.headers.get("content-type") || "")
        .toLowerCase();

    /*
     * Doğrudan image/jpeg geldiyse
     */
    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(
        await response.arrayBuffer()
      );

      if (!buffer.length) {
        return json(res, 502, {
          error: "Cloudflare boş görsel döndürdü."
        });
      }

      res.setHeader(
        "Content-Type",
        contentType.split(";")[0]
      );

      res.setHeader(
        "Content-Length",
        String(buffer.length)
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.status(200).send(buffer);
    }

    /*
     * JSON cevap
     */
    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return json(res, 502, {
        error:
          "Cloudflare geçerli JSON veya görsel döndürmedi."
      });
    }

    if (data?.success === false) {
      const hata = Array.isArray(data?.errors)
        ? data.errors
            .map(e => e?.message || e?.code)
            .filter(Boolean)
            .join(" | ")
        : "Cloudflare Workers AI isteği başarısız oldu.";

      return json(res, 502, {
        error: `Cloudflare FLUX hatası: ${hata}`
      });
    }

    const base64 =
      data?.result?.image;

    if (
      typeof base64 !== "string" ||
      base64.length < 100
    ) {
      console.error(
        "FLUX GÖRSEL YOK:",
        data
      );

      return json(res, 502, {
        error:
          "Cloudflare başarılı yanıt verdi ancak görsel bulunamadı."
      });
    }

    const image = Buffer.from(
      base64,
      "base64"
    );

    if (!image.length) {
      return json(res, 502, {
        error:
          "Cloudflare boş görsel döndürdü."
      });
    }

    /*
     * index.html şu anda /api/flux-image
     * sonucunu doğrudan image/blob olarak bekliyor.
     *
     * Bu yüzden JSON değil JPEG döndürüyoruz.
     */

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.setHeader(
      "Content-Length",
      String(image.length)
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).send(image);

  } catch (error) {
    console.error(
      "CLOUDFLARE FLUX BAĞLANTI HATASI:",
      error
    );

    if (error?.name === "AbortError") {
      return json(res, 504, {
        error:
          "FLUX görsel oluşturma zaman aşımına uğradı."
      });
    }

    return json(res, 502, {
      error:
        `Cloudflare bağlantı hatası: ${String(
          error?.message || error
        ).slice(0, 1500)}`
    });
  }
}
