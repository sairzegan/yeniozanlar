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

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        temperature: 0.7,
        messages: [{
          role: 'system',
          content: 'Sen deneyimli bir Türk edebiyat eleştirmenisin. Şiirleri derinlemesine analiz eder, doğrudan söylenmese bile ima edilen duygu ve anlatıyı kavrayabilirsin. Yanıtlarını SADECE geçerli JSON formatında verirsin.'
        },{
          role: 'user',
          content: `Aşağıdaki şiiri analiz et:

"""
${text}
"""

Dikkat et:
- Aynı kelimenin tekrarını kafiye sayma
- Kısa ve tekrarlı şiirlere düşük puan ver
- Doğrudan söylenmese bile ima edilen duyguyu, temayı, anlatıyı kavra (örnek: "narin bir nergis" bir kadını anlatıyor olabilir)
- Şiirden gerçek dize alıntısı yap
- Hece ölçüsünü doğru tespit et; çok kısa dizeler hece ölçülü sayılmaz
- Günlük konuşma dili ve klişelere eksi puan ver

SADECE şu JSON ile yanıtla, başka hiçbir şey yazma:
{
  "score": <2.0-9.8 arası gerçekçi puan>,
  "yorum": "<5-7 cümle: şiirden ne anlaşıldığı, tema, imge, dil kalitesi, ses uyumu — hepsi şiirden somut alıntıyla>",
  "gucluYonler": "<tek cümle, şiirden somut örnek>",
  "gelistirmeOnerisi": "<tek cümle, somut ve uygulanabilir>"
}`
        }]
      })
    });

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Groq yanıt vermedi: ' + JSON.stringify(data));
    }

    const raw = data.choices[0].message.content.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const jsonStr = clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1);
    const result = JSON.parse(jsonStr);
    result.score = Math.min(9.8, Math.max(2.0, parseFloat(result.score)));
    result.score = Math.round(result.score * 10) / 10;

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    console.error('Hata:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
