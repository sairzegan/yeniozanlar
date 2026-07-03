export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { text } = await req.json();
    if (!text || text.trim().length < 3) {
      return new Response(JSON.stringify({ error: 'Metin çok kısa' }), { status: 400 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Sen deneyimli bir Türk edebiyat eleştirmenisin. Aşağıdaki şiiri derinlemesine analiz et.

Şiir:
"""
${text}
"""

Şiiri şu kriterlere göre değerlendir:
1. Şiirden ne anladın? Doğrudan söylenmese bile ima edilen duygu, durum veya anlatı nedir?
2. Ana tema ve ikincil tema nedir? Şiirdeki hangi dize veya kelimeler bunu taşıyor?
3. İmge ve metaforlar: Özgün mü, klişe mi? Şiirden somut örnek ver.
4. Dil kalitesi: Şiirsel mi, günlük dil mi, didaktik mi? Örnekle açıkla.
5. Ses uyumu: Kafiye, hece ölçüsü, aliterasyon var mı? Gerçekten var mı, yoksa aynı kelime tekrarı mı?
6. Güçlü ve zayıf yönleri neler?
7. Puan: 2.0-9.8 arasında gerçekçi ve eleştirel bir puan ver. Kısa, günlük dilli, tekrarlı şiirlere düşük puan.

SADECE şu JSON formatında yanıt ver:
{
  "score": <sayı>,
  "yorum": "<4-6 cümle, somut dize alıntıları ile>",
  "gucluYonler": "<tek cümle>",
  "gelistirmeOnerisi": "<tek cümle, somut>"
}`
        }]
      })
    });

    const data = await response.json();
    if (!data.content) {
      throw new Error('API yanıt vermedi: ' + JSON.stringify(data));
    }

    const raw = data.content.map(b => b.text || '').join('').trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const jsonStr = clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1);
    const result = JSON.parse(jsonStr);
    result.score = Math.min(9.8, Math.max(2.0, parseFloat(result.score)));
    result.score = Math.round(result.score * 10) / 10;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Hata:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
