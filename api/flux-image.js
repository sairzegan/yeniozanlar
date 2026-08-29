// api/flux-image.js

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function clean(value, max = 1800) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.json(data);
}

function createPrompt(title, poem) {
  const safeTitle = clean(title, 250);
  const safePoem = clean(poem, 1400);

  return `
Create one beautiful cinematic realistic image inspired by this Turkish poem.

The image must visually express the emotion, atmosphere, people, places and meaning of the poem.

IMPORTANT:
- The poem is in Turkish.
- Do NOT translate the poem.
- Do NOT invent text.
- Do NOT write random letters.
- Do NOT write English.
- Do NOT put paragraphs or multiple lines of text into the image.
- Prefer NO TEXT AT ALL.
- No typography.
- No captions.
- No subtitles.
- No watermark.
- No logo.
- No signs containing writing.
- No books or pages containing writing.
- No UI.

Create a clean artistic composition with one strong visual subject.
Photorealistic cinematic photography.
Natural lighting.
Atmospheric depth.
Detailed environment.
Professional fine-art photography.

POEM TITLE:
${safeTitle}

TURKISH POEM:
${safePoem}
`.trim().slice(0, 2048);
}

async function readError(response) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(text);

    if (Array.isArray(data.errors)) {
      return data.errors
        .map(x => x?.message || x?.code)
        .filter(Boolean)
        .join(" | ");
    }

    if (data.error?.message) {
      return data.error.message;
    }

    if (typeof data.error === "string") {
      return data.error;
    }

    if (data.message) {
      return data.message;
    }

    return text.slice(0, 1500);
  } catch {
    return text.slice(0, 1500);
  }
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      error: "Sadece POST isteği kabul edilir."
    });
  }

  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN?.trim();

  if (!accountId) {
    return sendJson(res, 500, {
      error: "CLOUDFLARE_ACCOUNT_ID bulunamadı."
    });
  }

  if (!apiToken) {
    return sendJson(res, 500, {
      error: "CLOUDFLARE_API_TOKEN bulunamadı."
    });
  }

  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, {
        error: "Geçersiz JSON."
      });
    }
  }

  body = body || {};

  const poem = clean(
    body.poem ||
    body.text ||
    body.content ||
    "",
    1400
  );

  const title = clean(
    body.title ||
    body.baslik ||
    "",
    250
  );

  if (!poem) {
    return sendJson(res, 400, {
      error: "Şiir metni gönderilmedi."
    });
  }

  const prompt = createPrompt(
    title,
    poem
  );

  const url =
    "https://api.cloudflare.com/client/v4/accounts/" +
    encodeURIComponent(accountId) +
    "/ai/run/" +
    MODEL;

  try {

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 90000);

    let response;

    try {

      response = await fetch(url, {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },

        /*
         * DİKKAT:
         * seed YOK.
         *
         * Daha önce aldığın:
         * Additional or unevaluated properties '/seed'
         * hatasının tekrar oluşmasını engelliyoruz.
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

    if (!response.ok) {

      const detail =
        await readError(response);

      console.error(
        "FLUX HTTP ERROR:",
        response.status,
        detail
      );

      return sendJson(res, 502, {
        error:
          `Cloudflare FLUX HTTP ${response.status}`,
        detail
      });
    }

    const contentType =
      (
        response.headers.get("content-type") ||
        ""
      ).toLowerCase();

    /*
     * Eğer Cloudflare doğrudan image döndürürse
     * onu da destekle.
     */

    if (contentType.startsWith("image/")) {

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      if (!buffer.length) {
        return sendJson(res, 502, {
          error: "FLUX boş görsel döndürdü."
        });
      }

      res.setHeader(
        "Content-Type",
        contentType.split(";")[0]
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
     * Cloudflare FLUX REST API normalde:
     *
     * {
     *   "success": true,
     *   "result": {
     *      "image": "BASE64..."
     *   }
     * }
     */

    const text =
      await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return sendJson(res, 502, {
        error:
          "Cloudflare geçerli JSON döndürmedi.",
        detail: text.slice(0, 1000)
      });
    }

    if (data.success === false) {

      const detail =
        Array.isArray(data.errors)
          ? data.errors
              .map(
                e =>
                  e?.message ||
                  e?.code
              )
              .filter(Boolean)
              .join(" | ")
          : "Bilinmeyen Cloudflare hatası.";

      return sendJson(res, 502, {
        error:
          `Cloudflare FLUX hatası: ${detail}`
      });
    }

    const base64 =
      data?.result?.image;

    if (
      typeof base64 !== "string" ||
      base64.length < 100
    ) {

      console.error(
        "FLUX IMAGE YOK:",
        JSON.stringify(data).slice(0, 3000)
      );

      return sendJson(res, 502, {
        error:
          "FLUX görsel oluşturduğunu bildirmedi."
      });
    }

    /*
     * Base64 -> JPEG
     */

    const image =
      Buffer.from(
        base64,
        "base64"
      );

    if (!image.length) {
      return sendJson(res, 502, {
        error:
          "FLUX görsel verisi boş."
      });
    }

    /*
     * Firebase yok.
     * Storage yok.
     * Görsel doğrudan frontend'e gönderiliyor.
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
      "no-store, no-cache, must-revalidate"
    );

    return res
      .status(200)
      .send(image);

  } catch (error) {

    console.error(
      "FLUX ERROR:",
      error
    );

    if (error?.name === "AbortError") {
      return sendJson(res, 504, {
        error:
          "FLUX görsel oluşturma zaman aşımına uğradı."
      });
    }

    return sendJson(res, 500, {
      error:
        `FLUX bağlantı hatası: ${
          error?.message || error
        }`
    });
  }
}
