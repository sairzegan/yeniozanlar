// api/flux-image.js
// Groq -> şiiri analiz eder ve görsel promptu oluşturur
// Cloudflare Workers AI -> FLUX ile görsel üretir
// Görselde YAZI / HARF / TYPOGRAPHY kesinlikle istenmez.
//
// Vercel Environment Variables:
// GROQ_API_KEY
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      poem,
      title = "",
      prompt: incomingPrompt = ""
    } = req.body || {};

    const poemText = String(poem || "").trim();
    const poemTitle = String(title || "").trim();

    if (!poemText) {
      return res.status(400).json({
        error: "Şiir metni gönderilmedi."
      });
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const CLOUDFLARE_ACCOUNT_ID =
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.CLOUDFLARE_ACCOUNT_ID;

    const CLOUDFLARE_API_TOKEN =
      process.env.CLOUDFLARE_API_TOKEN;

    if (!GROQ_API_KEY) {
      return res.status(500).json({
        error: "GROQ_API_KEY eksik."
      });
    }

    if (!CLOUDFLARE_ACCOUNT_ID) {
      return res.status(500).json({
        error: "CLOUDFLARE_ACCOUNT_ID eksik."
      });
    }

    if (!CLOUDFLARE_API_TOKEN) {
      return res.status(500).json({
        error: "CLOUDFLARE_API_TOKEN eksik."
      });
    }

    // ---------------------------------------------------------
    // 1. GROQ
    // Şiiri analiz edip SADECE görsel tarifini oluşturuyor.
    // Görselde kesinlikle yazı olmayacak.
    // ---------------------------------------------------------

    const groqSystemPrompt = `
Sen profesyonel bir sinematik görsel yönetmenisin.

Görevin Türkçe bir şiiri analiz ederek bu şiirin DUYGUSUNU,
ANA TEMASINI, MEKANINI, ZAMANINI, İNSANLARINI ve SEMBOLLERİNİ
anlatan bir yapay zeka görsel üretim promptu hazırlamaktır.

ÇOK ÖNEMLİ:

- Şiirin kendisini görsele YAZMA.
- Görselde hiçbir harf, kelime, cümle, başlık, tabela,
  kitap yazısı, gazete yazısı, logo veya tipografi OLMASIN.
- Görselde okunabilir hiçbir metin bulunmasın.
- Şiirin konusu ile doğrudan bağlantılı bir sahne oluştur.
- Şiirde anlatılmayan rastgele konular ekleme.
- Şiirin duygusunu görsel atmosferle anlat.
- Çok karanlık korku filmi görünümü kullanma.
- Gereksiz siyah arka plan kullanma.
- Doğal, estetik, şiirsel ve sinematik bir kompozisyon oluştur.
- İnsan varsa doğal ve gerçekçi olsun.
- Soyut ama şiirin anlamıyla bağlantılı semboller kullanılabilir.
- Görsel bir şiir kitabının kapağı gibi estetik olabilir fakat
  üzerinde kesinlikle yazı olmamalıdır.
- Türkçe şiiri anlam olarak analiz et fakat çıktı İngilizce olsun.
  Çünkü FLUX görsel üretim promptlarında İngilizce daha başarılıdır.

SADECE görsel promptunu döndür.
Açıklama yapma.
Madde işareti kullanma.
Tırnak kullanma.
`;

    const poemForGroq = `
ŞİİR BAŞLIĞI:
${poemTitle || "(başlık yok)"}

ŞİİR:
${poemText}
`;

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: groqSystemPrompt
            },
            {
              role: "user",
              content: poemForGroq
            }
          ],
          temperature: 0.35,
          max_tokens: 350
        })
      }
    );

    const groqRaw = await groqResponse.text();

    if (!groqResponse.ok) {
      console.error("GROQ ERROR:", groqRaw);

      return res.status(502).json({
        error: `Groq HTTP ${groqResponse.status}`,
        details: groqRaw.slice(0, 1000)
      });
    }

    let groqData;

    try {
      groqData = JSON.parse(groqRaw);
    } catch {
      return res.status(502).json({
        error: "Groq geçerli JSON döndürmedi."
      });
    }

    let imagePrompt =
      groqData?.choices?.[0]?.message?.content?.trim();

    if (!imagePrompt) {
      return res.status(502).json({
        error: "Groq görsel promptu oluşturamadı."
      });
    }

    // Gelen promptu FLUX için güvenli şekilde güçlendir.
    imagePrompt = `
${imagePrompt}

Absolutely no text in the image.
No letters.
No words.
No sentences.
No typography.
No captions.
No subtitles.
No signs.
No logos.
No watermark.
No readable writing.
Create only the visual scene inspired by the poem.
Cinematic poetic photography, natural lighting, detailed composition, emotionally expressive, visually beautiful.
`.trim();

    // ---------------------------------------------------------
    // 2. CLOUDFLARE FLUX
    // ---------------------------------------------------------

    const fluxUrl =
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const fluxResponse = await fetch(fluxUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: imagePrompt
      })
    });

    const contentType =
      fluxResponse.headers.get("content-type") || "";

    // ---------------------------------------------------------
    // FLUX hata kontrolü
    // ---------------------------------------------------------

    if (!fluxResponse.ok) {
      const errorText = await fluxResponse.text();

      console.error(
        "CLOUDFLARE FLUX ERROR:",
        fluxResponse.status,
        errorText
      );

      return res.status(502).json({
        error: `Cloudflare FLUX HTTP ${fluxResponse.status}`,
        details: errorText.slice(0, 1500)
      });
    }

    // ---------------------------------------------------------
    // FLUX doğrudan image/* döndürürse
    // ---------------------------------------------------------

    if (contentType.startsWith("image/")) {
      const imageBuffer = Buffer.from(
        await fluxResponse.arrayBuffer()
      );

      res.setHeader(
        "Content-Type",
        contentType.split(";")[0]
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.status(200).send(imageBuffer);
    }

    // ---------------------------------------------------------
    // FLUX JSON döndürürse
    // ---------------------------------------------------------

    const fluxRaw = await fluxResponse.text();

    let fluxData;

    try {
      fluxData = JSON.parse(fluxRaw);
    } catch {
      console.error(
        "FLUX bilinmeyen response:",
        fluxRaw.slice(0, 1000)
      );

      return res.status(502).json({
        error: "FLUX görsel yerine geçersiz cevap döndürdü."
      });
    }

    // Cloudflare başarılı response:
    // { success: true, result: { image: "base64..." } }

    const base64Image =
      fluxData?.result?.image ||
      fluxData?.image ||
      fluxData?.result?.data?.image;

    if (!base64Image) {
      console.error(
        "FLUX IMAGE YOK:",
        JSON.stringify(fluxData).slice(0, 2000)
      );

      return res.status(502).json({
        error: "FLUX görsel üretmedi.",
        details: fluxData?.errors || fluxData?.messages || null
      });
    }

    let cleanBase64 = String(base64Image);

    // Eğer data:image/...;base64,... şeklinde geldiyse
    if (cleanBase64.includes(",")) {
      cleanBase64 = cleanBase64.split(",").pop();
    }

    const imageBuffer = Buffer.from(
      cleanBase64,
      "base64"
    );

    if (!imageBuffer || imageBuffer.length < 1000) {
      return res.status(502).json({
        error: "FLUX geçerli bir görsel verisi döndürmedi."
      });
    }

    // ---------------------------------------------------------
    // 3. TARAYICIYA DOĞRUDAN GÖRSEL DÖNDÜR
    // Firebase yok.
    // GIPHY yok.
    // /api/groq yok.
    // ---------------------------------------------------------

    res.setHeader(
      "Content-Type",
      "image/jpeg"
    );

    res.setHeader(
      "Content-Length",
      imageBuffer.length
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).send(imageBuffer);

  } catch (error) {
    console.error(
      "FLUX IMAGE FATAL ERROR:",
      error
    );

    return res.status(500).json({
      error: "Görsel oluşturma sırasında hata oluştu.",
      details: error?.message || String(error)
    });
  }
}
