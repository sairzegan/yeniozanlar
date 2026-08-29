// /api/giphy.js
// Şiirin temasına uygun bir GIF getirir.
// GIPHY API anahtarı yalnızca Vercel Environment Variables'ta tutulur.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: {
        message: 'Sadece POST destekleniyor.'
      }
    });
  }

  const apiKey = process.env.GIPHY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: {
        message:
          'GIPHY_API_KEY tanımlı değil. Vercel → Settings → Environment Variables üzerinden ekleyip yeniden deploy edin.'
      }
    });
  }

  try {
    const { query } = req.body || {};

    const q = (query || 'poetry mood aesthetic')
      .toString()
      .trim()
      .slice(0, 100);

    const url =
      `https://api.giphy.com/v1/gifs/search` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&q=${encodeURIComponent(q)}` +
      `&limit=8` +
      `&rating=pg-13` +
      `&lang=en`;

    const gRes = await fetch(url);

    if (!gRes.ok) {
      const errText = await gRes.text().catch(() => '');

      return res.status(gRes.status).json({
        error: {
          message: `Giphy hatası: ${errText.slice(0, 200)}`
        }
      });
    }

    const data = await gRes.json();
    const results = data?.data || [];

    if (!results.length) {
      return res.status(404).json({
        error: {
          message: 'Uygun GIF bulunamadı.'
        }
      });
    }

    // İlk 3 sonuç genellikle en alakalı sonuçlar.
    // Bunlardan rastgele birini seçiyoruz.
    const havuz = results.slice(
      0,
      Math.min(3, results.length)
    );

    const pick =
      havuz[Math.floor(Math.random() * havuz.length)];

    const gifUrl =
      pick?.images?.downsized_medium?.url ||
      pick?.images?.fixed_height?.url ||
      pick?.images?.original?.url ||
      null;

    if (!gifUrl) {
      return res.status(404).json({
        error: {
          message: 'GIF url bulunamadı.'
        }
      });
    }

    return res.status(200).json({
      gifUrl,
      title: pick?.title || ''
    });

  } catch (e) {
    console.error('GIPHY API error:', e);

    return res.status(500).json({
      error: {
        message:
          e?.message || 'Bilinmeyen hata'
      }
    });
  }
}
