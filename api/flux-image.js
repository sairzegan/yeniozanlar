// api/flux-image.js
// Cloudflare Workers AI -> FLUX.1 schnell
//
// Vercel Environment Variables:
// CLOUDFLARE_ACCOUNT_ID
// CLOUDFLARE_API_TOKEN

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function makePrompt(title, poem) {
  const cleanTitle = String(title || "")
    .trim()
    .slice(0, 300);

  const cleanPoem = String(poem || "")
    .trim()
    .slice(0, 1400);

  const prompt = `
Türkçe şiirden ilham alan tek bir özgün yatay görsel oluştur.

ŞİDDETLE UYULACAK KURALLAR:
- Şiirin konusu ve anlamı görselin ana kaynağı olmalıdır.
- Şiirde anlatılan kişi, nesne, mekan, olay, doğa, mevsim, hava durumu ve duygular varsa bunları görsel olarak yansıt.
- Şiirin anlamından uzak, genel veya rastgele bir şiir görseli oluşturma.
- Şiirde olmayan gereksiz nesneler, kişiler veya mekanlar ekleme.
- Görsel sinematik, gerçekçi, sanatsal ve etkileyici olsun.
- Gerçekçi profesyonel fotoğraf estetiği kullan.
- Doğal ve dramatik ışık kullan.
- Güçlü atmosfer, derinlik ve sinematik kompozisyon kullan.
- Görsel şiirin duygusunu açıkça hissettirsin.
- Romantik, hüzünlü, nostaljik, umutlu, gizemli veya düşsel bir duygu varsa bunu görsel olarak ifade et.
- Yatay 16:9 kompozisyon oluştur.
- Görsel yüksek kaliteli ve gerçekçi görünsün.

YAZI KURALI:
- Görselin içine İngilizce hiçbir kelime, cümle veya harf ekleme.
- Görselin içinde yazı bulunması gerekiyorsa yazılar SADECE TÜRKÇE olmalıdır.
- İngilizce tabela, İngilizce kitap kapağı, İngilizce afiş, İngilizce tabela yazısı veya İngilizce herhangi bir metin oluşturma.
- Mümkünse görselin içinde hiç yazı kullanma.
- Logo, filigran, çerçeve, kenarlık, kullanıcı arayüzü veya kolaj oluşturma.

ŞİİR BAŞLIĞI:
${cleanTitle || "Belirtilmemiş"}

ŞİİR:
${cleanPoem}
`.trim();

  // Cloudflare FLUX prompt sınırını aşmamak için güvenli sınır.
  return prompt.slice(0, 2048);
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

async function readCloudflareError(response) {
  const raw = await response.text().catch(() => "");

  if (!raw) {
    return `HTTP ${response.status}`;
  }

  try {
    const data = JSON.parse(raw);

    const errors = Array.isArray(data?.errors)
      ? data.errors
          .map(error => error?.message || error?.code)
          .filter(Boolean)
          .join(" | ")
      : "";

    return (
      errors ||
      data?.error?.message ||
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
    .slice(0, 1400);

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
    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },

      body: JSON.stringify({
        prompt: prompt,

        // FLUX Schnell için hızlı üretim.
        steps: 4,

        // Her tıklamada farklı görsel.
        seed: Math.floor(
          Math.random() * 2147483647
        )
      })
    });

    const raw = await response.text();

    if (!response.ok) {
      const message = await readCloudflareError(
        new Response(raw, {
          status: response.status
        })
      );

      console.error(
        "Cloudflare FLUX hatası:",
        response.status,
        message
      );

      return res.status(502).json({
        error:
          `Cloudflare FLUX HTTP ${response.status}`,
        detail: message
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
        "Cloudflare FLUX görsel döndürmedi:",
        data
      );

      return res.status(502).json({
        error:
          "Cloudflare başarılı yanıt verdi ancak FLUX görseli bulunamadı."
      });
    }

    // data:image/... formatı gelirse başlığı temizle.
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

    return res
      .status(200)
      .send(image);

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
