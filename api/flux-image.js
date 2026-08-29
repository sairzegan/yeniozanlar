// api/flux-image.js
// Cloudflare Workers AI - FLUX.1-schnell

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function makePrompt(title, poem) {
  // Cloudflare FLUX prompt limiti 2048 karakter.
  // Bu nedenle toplam promptu güvenli şekilde kısa tutuyoruz.
  const fixed =
    "Create a cinematic, realistic, poetic landscape image directly inspired by this Turkish poem. " +
    "Visually represent the poem's actual setting, people, objects, actions, symbols and emotions. " +
    "Do not create a generic poetry image. " +
    "Use atmospheric lighting, elegant composition, emotional depth and subtle film aesthetics. " +
    "Match the poem's mood: romantic, melancholic, nostalgic, dreamy, hopeful or dark when appropriate. " +
    "No text, letters, captions, logos, watermark or typography. " +
    "Landscape composition suitable for a poetry website.\n\n";

  const titleText = String(title || "")
    .trim()
    .slice(0, 150);

  // Sabit prompt yaklaşık 700-800 karakter.
  // Şiiri 1000 karakterle sınırlıyoruz.
  const poemText = String(poem || "")
    .trim()
    .slice(0, 1000);

  return (
    fixed +
    (titleText ? "Title: " + titleText + "\n\n" : "") +
    "Turkish poem:\n" +
    poemText
  ).slice(0, 2040);
}

async function readCloudflareError(response) {
  const raw = await response.text().catch(() => "");

  try {
    const json = JSON.parse(raw);

    if (Array.isArray(json.errors) && json.errors.length) {
      return json.errors
        .map(e => e.message || JSON.stringify(e))
        .join(" | ");
    }

    if (json.error) {
      return typeof json.error === "string"
        ? json.error
        : JSON.stringify(json.error);
    }

    return raw || `HTTP ${response.status}`;
  } catch (_) {
    return raw || `HTTP ${response.status}`;
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
      error: "CLOUDFLARE_ACCOUNT_ID bulunamadı."
    });
  }

  if (!apiToken) {
    return res.status(500).json({
      error: "CLOUDFLARE_API_TOKEN bulunamadı."
    });
  }

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};
  } catch (_) {
    return res.status(400).json({
      error: "Geçersiz JSON."
    });
  }

  const title = String(body.title || "");
  const poem = String(body.text || body.poem || "");

  if (!poem.trim()) {
    return res.status(400).json({
      error: "Şiir metni boş."
    });
  }

  const prompt = makePrompt(title, poem);

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId
    )}/ai/run/${MODEL}`;

  try {
    const response = await fetch(url, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        prompt: prompt,
        steps: 4,
        seed: Math.floor(Math.random() * 2147483647)
      })
    });

    if (!response.ok) {
      const error = await readCloudflareError(response);

      console.error(
        "CLOUDFLARE FLUX ERROR:",
        response.status,
        error
      );

      return res.status(502).json({
        error:
          `Cloudflare FLUX HTTP ${response.status}: ${error}`
      });
    }

    let data;

    try {
      data = await response.json();
    } catch (_) {
      return res.status(502).json({
        error: "Cloudflare JSON yanıtı okunamadı."
      });
    }

    const base64 = data?.result?.image;

    if (!base64) {
      console.error(
        "Cloudflare response:",
        JSON.stringify(data).slice(0, 3000)
      );

      return res.status(502).json({
        error:
          "Cloudflare başarılı yanıt verdi fakat görsel verisi bulunamadı."
      });
    }

    const imageBuffer = Buffer.from(base64, "base64");

    if (!imageBuffer.length) {
      return res.status(502).json({
        error: "Cloudflare boş görsel döndürdü."
      });
    }

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
      "no-store"
    );

    return res.status(200).send(imageBuffer);

  } catch (error) {
    console.error(
      "CLOUDFLARE FLUX CONNECTION ERROR:",
      error
    );

    return res.status(502).json({
      error:
        "Cloudflare bağlantı hatası: " +
        String(error?.message || error)
    });
  }
}
