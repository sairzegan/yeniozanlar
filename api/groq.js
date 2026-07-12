// Vercel Serverless Function — tarayıcıdan gelen isteği Groq'a iletir.
// Groq API anahtarı BURADA, yalnızca sunucu tarafında, process.env üzerinden okunur.
// Vercel dashboard → Settings → Environment Variables → GROQ_API_KEY olarak eklenmelidir.
// Bu sayede anahtar hiçbir zaman tarayıcıya / GitHub'a / kod dosyasına yazılmaz.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Sadece POST isteklerine izin verilir.' } });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Teşhis bilgisi: bu deployment'ın hangi ortamda çalıştığını ve GROQ_API_KEY'e
    // benzer isimde başka hangi değişkenlerin (varsa) göründüğünü gösterir.
    // Değerleri değil, sadece isimleri döner — güvenlik sorunu yaratmaz.
    const benzerAnahtarlar = Object.keys(process.env).filter(k => k.toUpperCase().includes('GROQ'));
    res.status(500).json({
      error: {
        message: 'GROQ_API_KEY tanımlı değil. Vercel projesinde Settings → Environment Variables kısmından ekleyip yeniden deploy edin.',
        teshis: {
          calisan_ortam: process.env.VERCEL_ENV || 'bilinmiyor',
          groq_ile_ilgili_bulunan_degisken_isimleri: benzerAnahtarlar,
          not: 'calisan_ortam "production" değilse ve Vercel\'de key sadece Preview için tanımlıysa bu normaldir. groq_ile_ilgili_bulunan_degisken_isimleri boşsa, GROQ_API_KEY hiç bu deployment\'a dahil edilmemiş demektir.'
        }
      }
    });
    return;
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(req.body)
    });

    // Groq'un durum kodunu (200, 429, 401 vb.) ve gövdesini olduğu gibi tarayıcıya geri veriyoruz,
    // böylece index.html'deki mevcut hata/kota mantığı (429 kontrolü vb.) değişmeden çalışmaya devam eder.
    const data = await groqRes.json();
    res.status(groqRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: { message: 'Groq proxy hatası: ' + e.message } });
  }
}
