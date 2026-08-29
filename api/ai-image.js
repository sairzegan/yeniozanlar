/**
 * Yeni Ozanlar — Şiirden AI görsel üretimi
 * Vercel Serverless Function
 *
 * Environment Variable:
 *   GEMINI_API_KEY=...
 *
 * Google Gemini 3.1 Flash Image (Nano Banana 2) kullanır.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY Vercel Environment Variables içinde tanımlı değil.'
    });
  }

  const title = String(req.body?.title || '').slice(0, 300).trim();
  const text = String(req.body?.text || '').slice(0, 5000).trim();

  if (!title && !text) {
    return res.status(400).json({ error: 'Şiir başlığı veya metni gerekli.' });
  }

  const prompt = `
Sen Yeni Ozanlar adlı şiir platformu için editoryal görsel üreten profesyonel bir sanat yönetmenisin.
Aşağıdaki şiiri gerçekten oku ve şiirin ana konusu, somut imgeleri, atmosferi, duygusu ve anlatım tonunu belirle.

Başlık:
${title || '(başlıksız)'}

Şiir:
${text || '(metin yok)'}

Görev:
- Şiirin temasına ve özellikle şiirde geçen somut imgelerden birine doğrudan bağlı, özgün ve estetik bir görsel oluştur.
- Alakasız stok fotoğraf, meme, GIF görünümü, çizgi emoji kolajı veya rastgele semboller kullanma.
- Sinematik, şiirsel, edebi ve profesyonel bir kompozisyon tercih et.
- Renk paleti ve ışık şiirin ruh haline uysun.
- İnsan figürü ancak şiirin içeriği bunu gerektiriyorsa kullanılsın.
- Görselin içine şiirden kısa ve anlamlı bir bölüm yerleştir: 4-12 kelimelik, şiirin kendi metninden mümkün olduğunca kelimesi kelimesine alınmış Türkçe bir mısra/ifade seç.
- Bu kısa Türkçe metin görselin üzerine zarif, yüksek kontrastlı, kolay okunabilir tipografiyle yerleştirilsin; metin görselin ana konusunu kapatmasın.
- Uzun şiiri görselin tamamına yazma; yalnızca kısa seçilmiş bölümü yaz.
- Başka açıklama, başlık, logo veya sahte alıntı ekleme.
- Görsel yatay 4:3 sosyal medya/akış kartı kullanımına uygun olsun.
`;

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image',
        input: [{ type: 'text', text: prompt }]
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `Gemini API ${response.status}`;
      return res.status(response.status >= 400 && response.status < 500 ? 400 : 502)
        .json({ error: message });
    }

    const outputImage = data?.output_image;
    if (!outputImage?.data) {
      return res.status(502).json({
        error: 'Gemini yanıtında üretilebilen bir görsel bulunamadı.'
      });
    }

    const mimeType = outputImage.mime_type || 'image/png';

    return res.status(200).json({
      imageData: `data:${mimeType};base64,${outputImage.data}`,
      mimeType,
      model: 'gemini-3.1-flash-image',
      prompt
    });
  } catch (error) {
    console.error('Gemini AI image error:', error);
    return res.status(500).json({
      error: 'AI görsel servisine bağlanırken beklenmeyen bir hata oluştu.'
    });
  }
};
