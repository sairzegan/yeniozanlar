// /api/flux-image.js
// Cloudflare Workers AI -> FLUX.1 schnell

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
   * FLUX'a şiir metnini görselin içine çizdirmiyoruz.
   * Türkçe yazı üretiminde hata oluşmaması için
   * görsel yalnızca şiirin anlamından oluşturuluyor.
   */

  const prompt = `
Create ONE original cinematic landscape image inspired by the Turkish poem below.

IMPORTANT:
- Understand the meaning, emotion, story, people, places and imagery of the poem.
- Create a specific visual scene based on the poem.
- Do NOT create a generic poetry image.
- Cinematic realistic photography.
- Natural dramatic lighting.
- Atmospheric depth.
- Elegant and uncluttered composition.
- One clear main subject.
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
typography,
logos,
watermarks,
subtitles,
signs,
posters,
book pages,
screens,
UI,
random writing,
fake writing.

The final image must contain ONLY the visual scene.

Use the Turkish poem ONLY as visual inspiration.

${baslik ? `POEM TITLE:\n${baslik}\n` : ""}

TURKISH POEM:
${siir}
`.trim();

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

  const prompt = promptOlustur(
    title,
    poem
  );

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  try {
    const controller =
      new AbortController();

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
         * seed GÖNDERMİYORUZ.
         *
         * Cloudflare FLUX bu endpoint'te
         * /seed parametresini kabul etmiyor.
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
     * Cloudflare HTTP hatası
     */

    if (!response.ok) {
      const hata =
        await hataOku(response);

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
     * Bazı cevaplarda doğrudan image/*
     * dönebilir.
     */

    const contentType =
      (
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    if (
      contentType.startsWith("image/")
    ) {
      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      if (!buffer.length) {
        return json(res, 502, {
          error:
            "Cloudflare boş görsel döndürdü."
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

      return res
        .status(200)
        .send(buffer);
    }

    /*
     * Normal Cloudflare JSON cevabı
     */

    const raw =
      await response.text();

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
      const hata =
        Array.isArray(data?.errors)
          ? data.errors
              .map(
                e =>
                  e?.message ||
                  e?.code
              )
              .filter(Boolean)
              .join(" | ")
          : "Cloudflare Workers AI isteği başarısız oldu.";

      return json(res, 502, {
        error:
          `Cloudflare FLUX hatası: ${hata}`
      });
    }

    /*
     * FLUX sonucu:
     *
     * result.image = BASE64
     */

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

    const image =
      Buffer.from(
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
     * Frontend /api/flux-image sonucunu
     * doğrudan görsel olarak kullanıyor.
     *
     * Bu nedenle JSON yerine JPEG gönderiyoruz.
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

    return res
      .status(200)
      .send(image);

  } catch (error) {
    console.error(
      "CLOUDFLARE FLUX BAĞLANTI HATASI:",
      error
    );

    if (
      error?.name === "AbortError"
    ) {
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
