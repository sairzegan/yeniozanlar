// api/flux-image.js
// FLUX görsel üretimi + Türkçe şiir metnini sonradan SVG olarak ekleme
//
// Vercel Environment Variables:
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
      success: false,
      error: "Sadece POST kullanılabilir."
    });
  }

  try {
    // -------------------------------------------------------
    // ENV
    // -------------------------------------------------------
    const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

    if (!ACCOUNT_ID) {
      return res.status(500).json({
        success: false,
        error: "CLOUDFLARE_ACCOUNT_ID eksik."
      });
    }

    if (!API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: "CLOUDFLARE_API_TOKEN eksik."
      });
    }

    // -------------------------------------------------------
    // REQUEST
    // Birçok farklı frontend formatını kabul ediyoruz.
    // -------------------------------------------------------
    const body = req.body || {};

    const poem =
      body.poem ||
      body.poetry ||
      body.content ||
      body.text ||
      body.description ||
      "";

    const title =
      body.title ||
      body.poemTitle ||
      "";

    const requestedPrompt =
      body.prompt ||
      body.imagePrompt ||
      "";

    // -------------------------------------------------------
    // ŞİİR METNİNİ TEMİZLE
    // -------------------------------------------------------
    function cleanText(value) {
      if (value === null || value === undefined) return "";

      return String(value)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();
    }

    const cleanPoem = cleanText(poem);
    const cleanTitle = cleanText(title);

    // -------------------------------------------------------
    // ŞİİRDEN SADECE SON 2 MISRA
    //
    // Başlık + uzun şiir + bütün şiir gönderilmiyor.
    // Böylece görselin üstünde karmaşık yazı oluşmaz.
    // -------------------------------------------------------
    function getLastTwoLines(text) {
      if (!text) return [];

      const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      // Çok uzun satırlardaki boşlukları düzelt.
      const normalized = lines.map(line =>
        line
          .replace(/\s+/g, " ")
          .trim()
      );

      return normalized.slice(-2);
    }

    let poemLines = getLastTwoLines(cleanPoem);

    // -------------------------------------------------------
    // Eğer şiir tek satır geldiyse, tek satır kullan.
    // Asla yapay zekaya metni yeniden yazdırmıyoruz.
    // -------------------------------------------------------
    if (poemLines.length > 2) {
      poemLines = poemLines.slice(-2);
    }

    // -------------------------------------------------------
    // SVG ESCAPE
    // Türkçe karakterler değiştirilmez.
    // -------------------------------------------------------
    function escapeXml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }

    // -------------------------------------------------------
    // FLUX PROMPT
    //
    // ÖNEMLİ:
    // Şiir burada kesinlikle gönderilmiyor.
    // FLUX'a yazı üretmesini istemiyoruz.
    // -------------------------------------------------------
    let visualPrompt = requestedPrompt
      ? cleanText(requestedPrompt)
      : "";

    // Prompt çok uzunsa sınırla.
    visualPrompt = visualPrompt.slice(0, 1600);

    const basePrompt = `
Create a beautiful cinematic artistic image inspired by the mood and atmosphere
of a Turkish poem.

IMPORTANT:
- Do NOT generate any text.
- Do NOT generate letters.
- Do NOT generate words.
- Do NOT generate captions.
- Do NOT generate typography.
- Do NOT generate signs with readable writing.
- The final image must contain NO WRITTEN LANGUAGE.
- Leave some calm darker/cleaner space suitable for adding a short poem later.
- Focus entirely on the visual atmosphere, emotion, lighting, scenery and composition.
- Photorealistic cinematic artistic style.
`.trim();

    if (visualPrompt) {
      visualPrompt += "\n\n" + basePrompt;
    } else {
      visualPrompt = basePrompt;
    }

    // -------------------------------------------------------
    // CLOUDFLARE FLUX
    //
    // SADECE desteklenen alanları gönderiyoruz.
    // /seed YOK.
    // -------------------------------------------------------
    const fluxUrl =
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const fluxResponse = await fetch(fluxUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: visualPrompt,
        steps: 4
      })
    });

    const fluxText = await fluxResponse.text();

    let fluxData;

    try {
      fluxData = JSON.parse(fluxText);
    } catch {
      return res.status(502).json({
        success: false,
        error: "Cloudflare geçerli JSON döndürmedi.",
        details: fluxText.slice(0, 1000)
      });
    }

    if (!fluxResponse.ok || !fluxData?.success) {
      const errorMessage =
        fluxData?.errors?.map(e => e.message).join(" | ") ||
        fluxData?.error ||
        `Cloudflare FLUX HTTP ${fluxResponse.status}`;

      return res.status(502).json({
        success: false,
        error: `Cloudflare FLUX hatası: ${errorMessage}`
      });
    }

    const imageBase64 =
      fluxData?.result?.image ||
      fluxData?.image ||
      null;

    if (!imageBase64) {
      return res.status(502).json({
        success: false,
        error: "FLUX görsel döndürmedi."
      });
    }

    // -------------------------------------------------------
    // SVG'YE TÜRKÇE METİN EKLE
    //
    // Burada FLUX'un metni yok.
    // Türkçe karakterler olduğu gibi korunuyor.
    // -------------------------------------------------------

    // SVG genişliği.
    // FLUX çıktısını bozmadan 1024x1024 bir çalışma alanı.
    const WIDTH = 1024;
    const HEIGHT = 1024;

    // -------------------------------------------------------
    // Satırı kelimelerden bölerek genişliğe sığdır.
    // Kelimenin ortasından ASLA bölmez.
    // -------------------------------------------------------
    function wrapText(text, maxChars) {
      const words = text.split(/\s+/).filter(Boolean);

      if (!words.length) return [];

      const result = [];
      let current = "";

      for (const word of words) {
        const candidate = current
          ? current + " " + word
          : word;

        if (candidate.length <= maxChars) {
          current = candidate;
        } else {
          if (current) {
            result.push(current);
          }

          // Tek kelime aşırı uzunsa bile kelimeyi parçalamıyoruz.
          current = word;
        }
      }

      if (current) {
        result.push(current);
      }

      return result;
    }

    // -------------------------------------------------------
    // Maksimum 2 şiir mısrası.
    // Her mısra kendi içinde kelime sınırlarından sarılabilir.
    // -------------------------------------------------------
    let displayLines = [];

    for (const line of poemLines) {
      const wrapped = wrapText(line, 48);

      // Bir mısra çok uzunsa en fazla 2 görsel satırı.
      displayLines.push(...wrapped.slice(0, 2));
    }

    // Güvenlik: toplamda en fazla 4 görsel satırı.
    displayLines = displayLines.slice(0, 4);

    // -------------------------------------------------------
    // FONT BOYUTU
    // -------------------------------------------------------
    let fontSize = 58;

    if (displayLines.length >= 4) {
      fontSize = 45;
    } else if (displayLines.length === 3) {
      fontSize = 50;
    }

    // Çok uzun satırları daha küçük yap.
    const longestLine = displayLines.reduce(
      (max, line) => Math.max(max, line.length),
      0
    );

    if (longestLine > 42) {
      fontSize = Math.min(fontSize, 44);
    }

    if (longestLine > 48) {
      fontSize = Math.min(fontSize, 38);
    }

    // -------------------------------------------------------
    // METİN BLOĞUNUN YERİ
    //
    // Görselin tam genişliğini kullanıyoruz.
    // X = 512 merkez.
    // Böylece kelimeler sağ/sol kenardan kesilmez.
    // -------------------------------------------------------
    const lineHeight = Math.round(fontSize * 1.35);

    let textBlock = "";

    if (displayLines.length > 0) {
      const blockHeight = displayLines.length * lineHeight;

      // Metni görüntünün alt-orta bölümüne koy.
      const startY =
        HEIGHT - blockHeight - 90;

      // Hafif koyu şeffaf panel.
      // Metnin okunmasını sağlar ama görseli kapatmaz.
      const panelX = 35;
      const panelY = Math.max(40, startY - 55);
      const panelWidth = WIDTH - 70;
      const panelHeight = blockHeight + 90;

      textBlock += `
        <rect
          x="${panelX}"
          y="${panelY}"
          width="${panelWidth}"
          height="${panelHeight}"
          rx="28"
          fill="rgba(0,0,0,0.45)"
        />
      `;

      displayLines.forEach((line, index) => {
        const y =
          startY +
          fontSize +
          index * lineHeight;

        textBlock += `
          <text
            x="512"
            y="${y}"
            text-anchor="middle"
            dominant-baseline="alphabetic"
            font-family="Georgia, 'Times New Roman', serif"
            font-size="${fontSize}px"
            font-weight="600"
            fill="#ffffff"
            stroke="#000000"
            stroke-width="1.5"
            paint-order="stroke"
          >${escapeXml(line)}</text>
        `;
      });
    }

    // -------------------------------------------------------
    // SVG
    //
    // FLUX JPEG'i base64 olarak SVG içine koyuyoruz.
    // Metin SVG tarafından birebir çiziliyor.
    // -------------------------------------------------------
    const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${WIDTH}"
  height="${HEIGHT}"
  viewBox="0 0 ${WIDTH} ${HEIGHT}"
>
  <image
    x="0"
    y="0"
    width="${WIDTH}"
    height="${HEIGHT}"
    preserveAspectRatio="xMidYMid slice"
    href="data:image/jpeg;base64,${imageBase64}"
    xlink:href="data:image/jpeg;base64,${imageBase64}"
  />

  ${textBlock}
</svg>
`.trim();

    // -------------------------------------------------------
    // SVG DATA URI
    // -------------------------------------------------------
    const svgBase64 = Buffer
      .from(svg, "utf8")
      .toString("base64");

    const dataURI =
      `data:image/svg+xml;base64,${svgBase64}`;

    // -------------------------------------------------------
    // RESPONSE
    //
    // Birden fazla isim dönüyoruz ki mevcut index.html
    // hangi alanı kullanıyorsa uyumlu olsun.
    // -------------------------------------------------------
    return res.status(200).json({
      success: true,

      // En yaygın isimler
      image: dataURI,
      imageUrl: dataURI,
      dataURI: dataURI,

      // Debug bilgileri
      textAdded: displayLines.length > 0,
      textLines: displayLines,

      // Orijinal FLUX çıktısı da isteyen frontend için.
      fluxImage:
        `data:image/jpeg;base64,${imageBase64}`
    });

  } catch (error) {
    console.error("FLUX IMAGE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Görsel oluşturulurken bilinmeyen hata oluştu."
    });
  }
}
