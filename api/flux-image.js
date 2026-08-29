export const maxDuration = 60;

// api/flux-image.js
// Cloudflare Workers AI -> FLUX.1 schnell
//
// Vercel Environment Variables:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN
//
// Bu endpoint doğrudan Cloudflare'ın resmi Workers AI REST API'sini kullanır.
// index.html'in /api/flux-image çağrısı ile çalışacak şekilde tasarlanmıştır.

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
    "No text, letters, captions, typography, logo, watermark or collage inside the generated image.",
    "Landscape 16:9 composition suitable for a poetry post.",
    cleanTitle ? `Poem title: ${cleanTitle}` : "",
    "Turkish poem:",
    cleanPoem
  ].filter(Boolean).join("\n\n");
}

async function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return null;
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

  const title = body.title || "";
  const poem = body.text || body.poem || "";

  if (!String(poem).trim()) {
    return res.status(400).json({
      error: "Şiir metni boş."
    });
  }

  const prompt = makePrompt(title, poem);

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        prompt,
        steps: 4,
        seed: Math.floor(Math.random() * 2147483647)
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      let message = raw;

      try {
        const json = JSON.parse(raw);
        message =
          json?.errors?.map?.(e => e.message).filter(Boolean).join(" | ") ||
          json?.error ||
          raw;
      } catch {}

      console.error("Cloudflare Workers AI error:", response.status, message);

      return res.status(502).json({
        error: `Cloudflare FLUX HTTP ${response.status}: ${String(message).slice(0, 2000)}`
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "Cloudflare geçerli JSON yanıtı döndürmedi."
      });
    }

    const base64 = data?.result?.image;

    if (!base64) {
      return res.status(502).json({
        error: "Cloudflare başarılı yanıt verdi ancak result.image bulunamadı."
      });
    }

    const image = Buffer.from(base64, "base64");

    if (!image.length) {
      return res.status(502).json({
        error: "Cloudflare boş görsel döndürdü."
      });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(image.length));
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(image);

  } catch (error) {
    console.error("Cloudflare FLUX request error:", error);

    return res.status(502).json({
      error: `Cloudflare bağlantı hatası: ${String(error?.message || error).slice(0, 1500)}`
    });
  }
}
