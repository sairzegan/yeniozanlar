// api/flux-image.js

export const config = {
  maxDuration: 60,
};

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId) {
    return res.status(500).json({
      error: "CLOUDFLARE_ACCOUNT_ID eksik"
    });
  }

  if (!apiToken) {
    return res.status(500).json({
      error: "CLOUDFLARE_API_TOKEN eksik"
    });
  }

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};
  } catch (error) {
    return res.status(400).json({
      error: "Geçersiz JSON"
    });
  }

  const title = String(body.title || "").trim();

  const poem = String(
    body.poem ||
    body.text ||
    body.content ||
    ""
  ).trim();

  if (!poem) {
    return res.status(400).json({
      error: "Şiir metni bulunamadı"
    });
  }

  /*
   * FLUX prompt limiti 2048 karakter.
   * Şiirin mümkün olduğunca büyük kısmını koruyoruz.
   */
  const prompt = `
Create a cinematic, realistic and poetic image inspired directly by this Turkish poem.

The image must visually represent the poem's subject, setting, emotions, people, objects and events.

Style:
cinematic photography, emotional atmosphere, realistic lighting, beautiful composition, subtle film aesthetic, high detail.

Do not add text, letters, captions, logos or watermark.

Title:
${title.slice(0, 150)}

Poem:
${poem.slice(0, 1500)}
`.trim().slice(0, 2048);

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;

  try {
    /*
     * SADECE Cloudflare'ın kabul ettiği temel parametreleri gönderiyoruz.
     *
     * Özellikle önceki koddaki steps gibi ekstra parametreleri
     * burada kullanmıyoruz.
     */
    const cloudflareResponse = await fetch(url, {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        prompt: prompt
      })
    });

    const responseText = await cloudflareResponse.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = null;
    }

    if (!cloudflareResponse.ok) {
      console.error(
        "CLOUDFLARE ERROR:",
        cloudflareResponse.status,
        responseText
      );

      let message = responseText;

      if (data?.errors) {
        message = data.errors
          .map(error => error.message || JSON.stringify(error))
          .join(" | ");
      }

      return res.status(502).json({
        error:
          `Cloudflare Workers AI ${cloudflareResponse.status}: ${message}`
      });
    }

    const imageBase64 =
      data?.result?.image;

    if (!imageBase64) {
      console.error(
        "Cloudflare başarılı cevap verdi fakat image yok:",
        responseText
      );

      return res.status(502).json({
        error:
          "Cloudflare görsel oluşturdu fakat image verisi dönmedi."
      });
    }

    const imageBuffer =
      Buffer.from(imageBase64, "base64");

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).send(imageBuffer);

  } catch (error) {
    console.error(
      "FLUX CONNECTION ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "FLUX bağlantı hatası: " +
        (error?.message || String(error))
    });
  }
}
