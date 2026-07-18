// Vercel Serverless Function — tarayıcıdan gelen isteği Anthropic Claude'a iletir.
// Claude API anahtarı BURADA, yalnızca sunucu tarafında, process.env üzerinden okunur.
// Vercel dashboard → Settings → Environment Variables → ANTHROPIC_API_KEY olarak eklenmelidir.
// Anahtarı almak için: https://console.anthropic.com/settings/keys
//
// NOT: Claude'un Messages API'si Groq/Gemini'den farklı bir format kullanır:
// system prompt ayrı bir alandır (messages içinde 'system' rolü yoktur).
// Ön yüz kodu isteği zaten bu formatta gönderiyor: {model, max_tokens, system, messages}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Sadece POST isteklerine izin verilir.' } });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: {
        message: 'ANTHROPIC_API_KEY tanımlı değil. Vercel projesinde Settings → Environment Variables kısmından ekleyip yeniden deploy edin.'
      }
    });
    return;
  }

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await claudeRes.json();
    res.status(claudeRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: { message: 'Claude proxy hatası: ' + e.message } });
  }
}
