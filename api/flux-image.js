// api/flux-image.js
// Vercel Serverless Function
// Cloudflare Workers AI - FLUX.1 schnell
//
// Amaç:
// 1. Şiirin tamamını al.
// 2. Şiirden son 2 gerçek mısrayı seç.
// 3. Şiirin anlamına göre FLUX görseli üret.
// 4. FLUX'ın Türkçe yazı çizmesini isteme.
// 5. Seçilen mısraları response içinde frontend'e geri gönder.
//
// Gerekli Vercel Environment Variables:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN

export default async function handler(req, res) {
  // ---------------------------------------------------------
  // CORS
  // ---------------------------------------------------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Sadece POST isteği kabul edilir."
    });
  }

  try {
    // -------------------------------------------------------
    // ENV
    // -------------------------------------------------------
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      return res.status(500).json({
        ok: false,
        error:
          "Cloudflare ayarları eksik: CLOUDFLARE_ACCOUNT_ID veya CLOUDFLARE_API_TOKEN bulunamadı."
      });
    }

    // -------------------------------------------------------
    // BODY
    // -------------------------------------------------------
    const body = req.body || {};

    /*
      Farklı eski frontend sürümleri için birkaç alanı destekliyoruz.
      Böylece index.html'de alan adı değişmiş olsa bile çalışabilsin.
    */
    const poem =
      body.poem ||
      body.poemText ||
      body.text ||
      body.content ||
      body.poem_content ||
      "";

    const title =
      body.title ||
      body.poemTitle ||
      body.name ||
      "";

    if (!poem || typeof poem !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Şiir metni gönderilmedi."
      });
    }

    // -------------------------------------------------------
    // ŞİİRİ TEMİZLE
    // -------------------------------------------------------
    const cleanPoem = poem
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!cleanPoem) {
      return res.status(400).json({
        ok: false,
        error: "Şiir metni boş."
      });
    }

    // -------------------------------------------------------
    // GERÇEK MISRALARI BUL
    // -------------------------------------------------------
    const lines = cleanPoem
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0);

    /*
      Son 2 gerçek mısra.
      Şiirde yalnızca 1 mısra varsa onu kullan.
    */
    const selectedLines = lines.slice(-2);

    const selectedText = selectedLines.join("\n");

    // -------------------------------------------------------
    // ŞİİRİ FLUX PROMPTUNA KOY
    // -------------------------------------------------------
    /*
      ÖNEMLİ:
      Şiiri modele doğrudan veriyoruz.

      Modelden şiirin kelimelerini görsel olarak yorumlamasını,
      şiirin duygusunu ve olayını temel almasını istiyoruz.

      Fakat modelin Türkçe yazı üretmesini istemiyoruz.
      Yazı gerekiyorsa frontend tarafından gerçek Unicode
      Türkçe metin olarak sonradan eklenebilir.
    */

    const poemForPrompt = cleanPoem.slice(0, 15000);

    const titlePart = title
      ? `Poem title: "${title.slice(0, 300)}".`
      : "";

    const prompt = `
Create a cinematic, artistic image that DIRECTLY represents the meaning, story,
people, places, objects, emotions, atmosphere and imagery described in the
following Turkish poem.

The poem is the SOURCE OF TRUTH for the scene.
Do NOT create a generic landscape.
Do NOT ignore the poem.
Do NOT invent an unrelated subject.
The visual scene must clearly feel inspired by the actual words and meaning
of this specific poem.

${titlePart}

FULL TURKISH POEM:
"""
${poemForPrompt}
"""

IMPORTANT VISUAL INSTRUCTIONS:
- Interpret the poem literally where possible and poetically where necessary.
- Identify the strongest visual elements from the poem.
- Represent its central emotion and situation.
- If the poem describes a person, relationship, journey, loneliness, poverty,
  love, separation, nature, night, city, village, death, hope, anger or another
  subject, make that subject visually important.
- Use composition, lighting, weather, environment and characters that fit the poem.
- The image should look like an artistic interpretation of THIS poem,
  not a random stock photograph.
- No logos.
- No watermark.
- No captions.
- No subtitles.
- No typography.
- Do not generate written words inside the image.
- Do not generate fake Turkish text.

Create a high-quality cinematic photographic/illustrative scene,
emotionally consistent with the poem.
`.trim();

    // Cloudflare FLUX prompt limit is 2048 characters.
    // Keep the beginning + poem content within that limit.
    const finalPrompt =
      prompt.length <= 2048
        ? prompt
        : prompt.slice(0, 2048);

    // -------------------------------------------------------
    // CLOUDFLARE FLUX
    // -------------------------------------------------------
    const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/` +
      `${encodeURIComponent(accountId)}` +
      `/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const cfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: finalPrompt
      })
    });

    // -------------------------------------------------------
    // CLOUDFLARE HATA KONTROLÜ
    // -------------------------------------------------------
    const rawText = await cfResponse.text();

    let cloudflareData;

    try {
      cloudflareData = JSON.parse(rawText);
    } catch {
      cloudflareData = null;
    }

    if (!cfResponse.ok) {
      const cloudflareMessage =
        cloudflareData?.errors?.map(e => e.message).join(" | ") ||
        cloudflareData?.error ||
        rawText ||
        `Cloudflare HTTP ${cfResponse.status}`;

      console.error("Cloudflare FLUX error:", cloudflareMessage);

      return res.status(502).json({
        ok: false,
        error: `Cloudflare FLUX HTTP ${cfResponse.status}`,
        details: cloudflareMessage
      });
    }

    // -------------------------------------------------------
    // IMAGE BASE64
    // -------------------------------------------------------
    const imageBase64 =
      cloudflareData?.result?.image ||
      cloudflareData?.image ||
      null;

    if (!imageBase64) {
      console.error(
        "Cloudflare response içinde image bulunamadı:",
        cloudflareData
      );

      return res.status(502).json({
        ok: false,
        error: "Cloudflare FLUX görsel döndürmedi.",
        details: cloudflareData
      });
    }

    // -------------------------------------------------------
    // DATA URI
    // -------------------------------------------------------
    const dataURI =
      `data:image/jpeg;base64,${imageBase64}`;

    // -------------------------------------------------------
    // RESPONSE
    // -------------------------------------------------------
    /*
      Birden fazla alanı özellikle koruyoruz.
      Böylece mevcut index.html'in image,
      dataURI veya imageUrl alanlarından hangisini
      kullanıyor olursa olsun uyumluluk şansı yüksek olur.
    */

    return res.status(200).json({
      ok: true,

      // Ana görsel
      image: dataURI,
      dataURI: dataURI,
      imageUrl: dataURI,

      // Şiir bilgisi
      title: title || null,
      poem: cleanPoem,

      // Görsele yazı eklemek istenirse kullanılacak
      // gerçek Türkçe metin
      text: selectedText,
      selectedText: selectedText,
      selectedLines: selectedLines,

      // Debug için hangi promptun kullanıldığını
      // tamamen göstermek yerine kısa bilgi
      model: "@cf/black-forest-labs/flux-1-schnell"
    });

  } catch (error) {
    console.error("flux-image.js fatal error:", error);

    return res.status(500).json({
      ok: false,
      error: "FLUX görsel oluşturma sırasında sunucu hatası oluştu.",
      details: error?.message || String(error)
    });
  }
}
