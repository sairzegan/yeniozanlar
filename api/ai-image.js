// Vercel Serverless Function — şiirden gerçek AI görseli üretir.
// Vercel Environment Variables: GEMINI_API_KEY
// Google Gemini Interactions API / gemini-3.1-flash-image kullanır.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY Vercel Environment Variables içinde tanımlı değil.' });

  const title = String(req.body?.title || '').slice(0, 300);
  const text = String(req.body?.text || '').slice(0, 7000);
  if (!text.trim()) return res.status(400).json({ error: 'Şiir metni boş.' });

  const prompt = `Türkçe bir şiir için sinematik, estetik ve özgün bir kapak görseli oluştur.

Başlık: ${title || '(başlıksız)'}
Şiir:
${text}

Kurallar:
- Görsel şiirin gerçek temasını, imgelerini, mekânını ve duygusunu doğrudan yansıtsın.
- Stok fotoğraf, meme, GIF, çizgi film veya rastgele soyut bir görsel olmasın.
- Fotoğrafik/sinematik veya kaliteli dijital sanat estetiği kullan; şiirin atmosferine göre ışık, renk ve kompozisyon seç.
- Görselin üzerine şiirden KISA VE BİREBİR bir bölüm yaz. Mümkünse 3-10 kelimelik güçlü bir mısrayı şiirden aynen seç; şiirden uygun kısa bir bölüm yoksa kısa ve şiire sadık bir ifade oluştur.
- Yazı Türkçe olsun, okunaklı ve zarif tipografiyle görselin kompozisyonuna doğal biçimde yerleşsin.
- Görselde şiirde olmayan belirgin nesneler veya kişiler ekleme.
- 16:9 yatay kompozisyon, sosyal medya şiir paylaşım kapağı.`;

  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image',
        input: prompt,
        response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' }
      })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || `Gemini HTTP ${r.status}`;
      return res.status(r.status >= 400 && r.status < 500 ? 502 : 500).json({ error: msg });
    }

    // Güncel Interactions API: output_image.data.
    let b64 = data?.output_image?.data;
    let mime = data?.output_image?.mime_type || 'image/png';

    // İleri/geri uyumluluk: bazı cevaplarda image step içinde gelebilir.
    if (!b64 && Array.isArray(data?.steps)) {
      for (const step of data.steps) {
        for (const block of (step?.content || [])) {
          if (block?.type === 'image' && block?.data) {
            b64 = block.data;
            mime = block.mime_type || mime;
            break;
          }
        }
        if (b64) break;
      }
    }

    if (!b64) return res.status(502).json({ error: 'Gemini başarılı yanıt verdi ancak görsel verisi bulunamadı.' });
    return res.status(200).json({ imageData: `data:${mime};base64,${b64}`, model: 'gemini-3.1-flash-image' });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Görsel oluşturulamadı.' });
  }
}
