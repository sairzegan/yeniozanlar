// Vercel Serverless Function — tarayıcıdan gelen isteği Google Gemini'ye iletir.
// Gemini'nin OpenAI-uyumlu endpoint'ini kullanıyoruz, böylece Groq ile aynı
// {model, messages, ...} formatını kullanabiliyoruz.
// Gemini API anahtarı BURADA, yalnızca sunucu tarafında, process.env üzerinden okunur.
// Vercel dashboard → Settings → Environment Variables → GEMINI_API_KEY olarak eklenmelidir.
// Anahtarı almak için: https://aistudio.google.com/apikey

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Sadece POST isteklerine izin verilir.' } });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: {
        message: 'GEMINI_API_KEY tanımlı değil. Vercel projesinde Settings → Environment Variables kısmından ekleyip yeniden deploy edin.'
      }
    });
    return;
  }

  try {
    const geminiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(req.body)
    });

    const data = await geminiRes.json();
    res.status(geminiRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: { message: 'Gemini proxy hatası: ' + e.message } });
  }
}
