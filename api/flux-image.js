// api/flux-image.js
// Cloudflare Workers AI -> FLUX.1 schnell

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function makePrompt(title, poem) {
  const cleanTitle = String(title || "").trim().slice(0, 300);
  const cleanPoem = String(poem || "").trim().slice(0, 1800);

  return [
    "Create a single original landscape image directly inspired by the Turkish poem below.",
    "The poem is the main source of the visual idea.",
    "Show the actual subject, setting, objects, actions, symbols and emotions found in the poem.",
    "Do not make a generic poetry image.",
    "Do not add unrelated people, objects or scenery.",
    "Use a cinematic, poetic, realistic and emotionally powerful visual style.",
    "Use natural dramatic lighting, atmospheric depth, elegant composition and subtle film aesthetics.",
    "If the poem is romantic, melancholic, nostalgic, hopeful, mysterious or dreamy, express that mood visually.",
    "Landscape 16:9 composition suitable for a poetry post.",
    "No logo, watermark or collage.",
    "",
    "IMPORTANT LANGUAGE RULE:",
    "The poem is Turkish.",
    "If any visible text appears inside the image, it MUST be in Turkish.",
    "Do NOT generate English words, English signs, English letters, English book covers or English captions.",
    "Prefer having NO visible text in the image at all.",
    "",
    cleanTitle ? `Turkish poem title: ${cleanTitle}` : "",
    "Turkish poem:",
    cleanPoem
  ].filter(Boolean).join("\n\n");
}

async function parseRequestBody(req) {
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

async function getErrorMessage(response) {
  const raw = await response.text().catch(() => "");

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(raw);

    if (Array.isArray(data.errors)) {
      const errors = data.errors
        .map(x => x?.message || x?.code)
        .filter(Boolean)
        .join(" | ");

      if (errors) return errors;
    }

    return (
      data?.error?.message ||
      data?.error ||
      data?.message ||
      raw.slice(0, 2000)
    );
  } catch {
    return raw.slice(0, 2000);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
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
    return res.status(500).json({
      error: "CLOUDFLARE_ACCOUNT_ID Vercel'de bulunamadı."
    });
  }

  if (!apiToken) {
    return res.status(500).json({
      error: "CLOUDFLARE_API_TOKEN Vercel'de bulunamadı."
    });
  }

  const body = await parseRequestBody(req);

  if (!body) {
    return res.status(400).json({
      error: "Geçersiz JSON isteği."
    });
  }

  const title = String(body.title || "")
    .trim()
    .slice(0, 300);

  const poem = String(
    body.text || body.poem || ""
  )
    .trim()
    .slice(0, 1800);

  if (!poem) {
    return res.status(400).json({
      error: "Şiir metni boş."
    });
  }

  const prompt = makePrompt(title, poem);

  const url =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  try {
    /*
     * ÖNEMLİ:
     * Cloudflare FLUX endpoint'i burada yalnızca prompt
     * gönderilecek şekilde kullanılıyor.
     *
     * seed YOK
     * steps YOK
     *
     * Çünkü endpoint bunları kabul etmiyor.
     */
    const response = await fetch(url, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },

      body: JSON.stringify({
        prompt: prompt
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      let message = raw;

      try {
        const data = JSON.parse(raw);

        if (Array.isArray(data?.errors)) {
          message = data.errors
            .map(x => x?.message || x?.code)
            .filter(Boolean)
            .join(" | ");
        } else {
          message =
            data?.error?.message ||
            data?.error ||
            data?.message ||
            raw;
        }
      } catch {}

      console.error(
        "Cloudflare FLUX hatası:",
        response.status,
        message
      );

      return res.status(502).json({
        error:
          `Cloudflare FLUX HTTP ${response.status}`,
        detail: String(message).slice(0, 2000)
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error:
          "Cloudflare geçerli JSON yanıtı döndürmedi."
      });
    }

    const base64 = data?.result?.image;

    if (
      typeof base64 !== "string" ||
      base64.length < 100
    ) {
      console.error(
        "FLUX görseli bulunamadı:",
        data
      );

      return res.status(502).json({
        error:
          "Cloudflare başarılı yanıt verdi ancak FLUX görseli bulunamadı."
      });
    }

    const cleanBase64 = base64
      .replace(
        /^data:image\/[^;]+;base64,/i,
        ""
      )
      .replace(/\s/g, "");

    const image = Buffer.from(
      cleanBase64,
      "base64"
    );

    if (!image.length) {
      return res.status(502).json({
        error:
          "Cloudflare boş görsel döndürdü."
      });
    }

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

    return res.status(200).send(image);

  } catch (error) {
    console.error(
      "Cloudflare FLUX bağlantı hatası:",
      error
    );

    return res.status(502).json({
      error:
        `FLUX görseli oluşturulamadı: ${
          String(
            error?.message || error
          ).slice(0, 1500)
        }`
    });
  }
}
