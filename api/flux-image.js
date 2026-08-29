// api/flux-image.js
// Vercel -> Cloudflare Workers AI -> FLUX.1 schnell

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function clean(value, maxLength) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, maxLength);
}

function chooseTurkishLine(poem) {
  const text = clean(poem, 5000);

  if (!text) return "";

  // Önce satırlardan anlamlı ve kısa bir dize seç.
  const lines = text
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(x => x.length >= 8 && x.length <= 180);

  if (lines.length) {
    // İlk anlamlı dizeyi kullan.
    return lines[0];
  }

  // Satır yoksa cümleden kısa bir bölüm al.
  const sentence = text
    .split(/[.!?]+/)
    .map(x => x.trim())
    .find(x => x.length >= 8);

  return sentence ? sentence.slice(0, 180) : text.slice(0, 180);
}

function createPrompt(title, poem) {
  const safeTitle = clean(title, 300);
  const safePoem = clean(poem, 1800);
  const line = chooseTurkishLine(poem);

  return `
Create a beautiful cinematic landscape image inspired specifically by the Turkish poem below.

IMPORTANT:
- The visual must clearly reflect the poem's actual subject, atmosphere, place, objects, emotions and imagery.
- Do NOT create a generic poetry background.
- The image must feel poetic, emotional, realistic and cinematic.
- Use natural lighting, atmospheric depth and a sophisticated composition.
- Landscape composition, suitable for a Turkish poetry website.
- Absolutely no English words.
- Do not invent an English title.
- If any visible text appears in the image, it MUST be in Turkish.
- Prefer NO text in the generated image if accurate Turkish lettering cannot be rendered.
- No logo.
- No watermark.
- No collage.

Poem title:
${safeTitle || "İsimsiz Şiir"}

Turkish poem:
${safePoem}

A meaningful Turkish line from the poem that may inspire the visual:
"${line}"
`.trim();
}

async function getBody(req) {
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

function errorResponse(res, status, message, detail) {
  return res.status(status).json({
    error: message,
    ...(detail ? { detail } : {})
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return errorResponse(
      res,
      405,
      "Yalnızca POST isteği destekleniyor."
    );
  }

  const accountId = clean(
    process.env.CLOUDFLARE_ACCOUNT_ID,
    200
  );

  const apiToken = clean(
    process.env.CLOUDFLARE_API_TOKEN,
    500
  );

  if (!accountId) {
    return errorResponse(
      res,
      500,
      "CLOUDFLARE_ACCOUNT_ID Vercel Environment Variables içinde bulunamadı."
    );
  }

  if (!apiToken) {
    return errorResponse(
      res,
      500,
      "CLOUDFLARE_API_TOKEN Vercel Environment Variables içinde bulunamadı."
    );
  }

  const body = await getBody(req);

  if (!body) {
    return errorResponse(
      res,
      400,
      "Geçersiz JSON isteği."
    );
  }

  const title = clean(body.title, 300);

  const poem = clean(
    body.text || body.poem || body.content,
    5000
  );

  if (!poem) {
    return errorResponse(
      res,
      400,
      "Şiir metni boş."
    );
  }

  const prompt = createPrompt(title, poem);

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  try {
    /*
     * ÖNEMLİ:
     *
     * Cloudflare FLUX'a yalnızca prompt gönderiyoruz.
     *
     * Önceki sürümlerde ek parametrelerden dolayı
     * "Additional or unevaluated properties" hatası oluşuyordu.
     */
    const response = await fetch(endpoint, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },

      body: JSON.stringify({
        prompt
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      let detail = raw;

      try {
        const data = JSON.parse(raw);

        if (Array.isArray(data?.errors)) {
          detail = data.errors
            .map(error => error?.message || error?.code)
            .filter(Boolean)
            .join(" | ");
        } else if (data?.error) {
          detail = data.error;
        }
      } catch (_) {}

      console.error(
        "CLOUDFLARE FLUX ERROR:",
        response.status,
        detail
      );

      return errorResponse(
        res,
        502,
        `Cloudflare FLUX HTTP ${response.status}`,
        String(detail).slice(0, 3000)
      );
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch (_) {
      console.error(
        "Cloudflare JSON olmayan yanıt döndürdü:",
        raw.slice(0, 1000)
      );

      return errorResponse(
        res,
        502,
        "Cloudflare geçerli JSON yanıtı döndürmedi."
      );
    }

    if (data?.success === false) {
      const detail =
        Array.isArray(data.errors)
          ? data.errors
              .map(error => error?.message || error?.code)
              .filter(Boolean)
              .join(" | ")
          : "Cloudflare Workers AI isteği başarısız.";

      return errorResponse(
        res,
        502,
        "Cloudflare FLUX isteği başarısız.",
        detail
      );
    }

    /*
     * Cloudflare FLUX sonucu:
     *
     * {
     *   "result": {
     *     "image": "BASE64..."
     *   }
     * }
     */
    const base64 = data?.result?.image;

    if (
      typeof base64 !== "string" ||
      base64.length < 100
    ) {
      console.error(
        "FLUX IMAGE YOK:",
        JSON.stringify({
          success: data?.success,
          resultKeys: data?.result
            ? Object.keys(data.result)
            : [],
          responseKeys: Object.keys(data || {})
        })
      );

      return errorResponse(
        res,
        502,
        "Cloudflare FLUX görsel döndürmedi.",
        "result.image alanı bulunamadı."
      );
    }

    const cleanBase64 = base64
      .replace(/^data:image\/[^;]+;base64,/i, "")
      .replace(/\s/g, "");

    const imageBuffer = Buffer.from(
      cleanBase64,
      "base64"
    );

    if (
      !imageBuffer ||
      imageBuffer.length < 1000
    ) {
      return errorResponse(
        res,
        502,
        "FLUX geçersiz veya boş görsel döndürdü."
      );
    }

    /*
     * index.html bu endpoint'i blob olarak okuyor.
     * Bu nedenle doğrudan JPEG döndürüyoruz.
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

    return res
      .status(200)
      .send(imageBuffer);

  } catch (error) {
    console.error(
      "FLUX ENDPOINT HATASI:",
      error
    );

    return errorResponse(
      res,
      502,
      "Cloudflare FLUX bağlantı hatası.",
      String(
        error?.message || error
      ).slice(0, 2000)
    );
  }
}
