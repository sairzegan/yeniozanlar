// /api/pollinations-image.js
// Dedicated Pollinations image endpoint for the admin "AI image" button.
//
// DÜZELTME (önemli): Pollinations'ın Flux modeli, İMZASIZ/ANAHTARSIZ (anonim)
// istekte TAMAMEN ÜCRETSİZ ve sınırsızdır (yaklaşık 15 saniyede 1 istek
// hız limitiyle). Bu dosya daha önce HER ZAMAN Bearer/anahtarla istek
// atıyordu — bu da isteği otomatik olarak "pollen bakiyesi" gerektiren
// ücretli yola sokuyordu (HTTP 402 "Insufficient balance" hatasının
// sebebi buydu). Artık önce anonim/ücretsiz isteği deniyoruz; yalnızca o
// başarısız olursa (örn. hız limiti) ve bir anahtar tanımlıysa, öncelikli
// erişim için anahtarla deniyoruz.
//
// Vercel Environment Variable (artık OPSİYONEL — tanımlı değilse sorun değil,
// sistem tamamen ücretsiz anonim moda düşer):
// POLLINATIONS_API_KEY = sk_...
//
// Bu endpoint Pollinations'ın resmi GET /image/{prompt} endpoint'ini kullanır
// ve tarayıcıya JSON { imageData, provider, model } döndürür.

function makePrompt(title, text) {
  const poemTitle = String(title || '').trim().slice(0, 300);
  const poem = String(text || '').trim().slice(0, 5000);
  // Önbellek kırıcı — Pollinations aynı prompt için üretilen görseli önbelleğe
  // alıp anında aynısını döndürüyor ("Repeated image generations for the same
  // prompt are cached and served instantly"). Bu yüzden "Yeniden Resim
  // Oluştur" butonuna tekrar basınca hep AYNI görsel geliyordu. Her istekte
  // benzersiz bir etiket ekleyerek prompt'u (dolayısıyla önbellek anahtarını
  // ve URL'i) her seferinde farklı hale getiriyoruz.
  const varyasyon = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return [
    'Create ONE original landscape image directly inspired by the Turkish poem below.',
    'The poem is the primary source. Visually interpret its actual subject, setting, objects, actions, imagery and emotions.',
    'Do not make a generic poetry image and do not add unrelated objects.',
    'Style: cinematic, poetic, emotional, atmospheric, realistic, elegant composition, natural film lighting, subtle film color grading, depth of field.',
    'Choose romantic, melancholic, dreamy, nostalgic or dramatic atmosphere only when it fits the poem.',
    'No GIF, no collage, no stock-photo look, no logo, no watermark, no readable text, no letters, no captions inside the image.',
    'Landscape 16:9 composition suitable for a poetry post.',
    poemTitle ? `Title: ${poemTitle}` : '',
    `Turkish poem:\n${poem}`,
    `Internal variation tag (ignore, do not depict, do not render as text): ${varyasyon}`
  ].filter(Boolean).join('\n\n');
}

async function getErrorText(r) {
  try {
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await r.json();
      return String(j?.error?.message || j?.error || j?.message || JSON.stringify(j)).slice(0, 1200);
    }
    return (await r.text()).slice(0, 1200);
  } catch (_) {
    return `HTTP ${r.status}`;
  }
}

async function fetchPollinations(url, key) {
  const headers = { Accept: 'image/*' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  return fetch(url, { method: 'GET', headers });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Sadece POST destekleniyor.' });
  }

  // Artık zorunlu DEĞİL: anahtar yoksa tamamen ücretsiz anonim moda geçilir.
  const key = String(process.env.POLLINATIONS_API_KEY || '').trim();

  const title = String(req.body?.title || '');
  const text = String(req.body?.text || '');
  if (!text.trim()) {
    return res.status(400).json({ error: 'Şiir metni boş.' });
  }

  const prompt = makePrompt(title, text);
  const encoded = encodeURIComponent(prompt);
  // seed: Pollinations'ın resmi parametresi — belirtilmezse "rastgele" olması
  // gerekiyor ama URL/prompt aynı kaldığında önbellekten aynı görsel dönebiliyor.
  // Her istekte kendimiz rastgele bir seed vererek bunu kesin olarak engelliyoruz.
  const seed = Math.floor(Math.random() * 1_000_000_000);

  // Official Pollinations image endpoint.
  const base =
    `https://gen.pollinations.ai/image/${encoded}` +
    `?model=flux&width=1024&height=576&nologo=true&seed=${seed}`;

  const errors = [];

  // Attempt 1: ANONİM istek — anahtar GÖNDERMEDEN. Bu, Pollinations'ın
  // "her zaman ücretsiz" Flux tier'ı; bakiye/pollen gerektirmez.
  try {
    const r = await fetchPollinations(base, null);
    if (r.ok) {
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!ct.startsWith('image/')) {
        errors.push(`Anonim: görsel yerine ${ct} döndü`);
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length) {
          return res.status(200).json({
            imageData: `data:${ct};base64,${bytes.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          });
        }
        errors.push('Anonim: boş görsel döndü');
      }
    } else {
      errors.push(`Anonim HTTP ${r.status}: ${await getErrorText(r)}`);
    }
  } catch (e) {
    errors.push(`Anonim bağlantı hatası: ${e?.message || e}`);
  }

  // Anahtar tanımlı değilse burada dur — ücretli denemeye gerek yok.
  if (!key) {
    return res.status(502).json({
      error: `Pollinations (ücretsiz/anonim) görsel üretilemedi. ${errors.join(' | ')}`,
      provider: 'pollinations',
      model: 'flux'
    });
  }

  // Attempt 2: anahtarla (Bearer) öncelikli erişim — anonim mod hız limitine
  // takıldıysa veya geçici olarak başarısız olduysa devreye girer.
  try {
    const r = await fetchPollinations(base, key);
    if (r.ok) {
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!ct.startsWith('image/')) {
        errors.push(`Bearer: görsel yerine ${ct} döndü`);
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length) {
          return res.status(200).json({
            imageData: `data:${ct};base64,${bytes.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          });
        }
        errors.push('Bearer: boş görsel döndü');
      }
    } else {
      errors.push(`Bearer HTTP ${r.status}: ${await getErrorText(r)}`);
    }
  } catch (e) {
    errors.push(`Bearer bağlantı hatası: ${e?.message || e}`);
  }

  // Attempt 3: Pollinations also documents ?key= authentication.
  try {
    const sep = base.includes('?') ? '&' : '?';
    const r = await fetchPollinations(
      `${base}${sep}key=${encodeURIComponent(key)}`,
      null
    );
    if (r.ok) {
      const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      if (!ct.startsWith('image/')) {
        errors.push(`Query-key: görsel yerine ${ct} döndü`);
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length) {
          return res.status(200).json({
            imageData: `data:${ct};base64,${bytes.toString('base64')}`,
            provider: 'pollinations',
            model: 'flux'
          });
        }
        errors.push('Query-key: boş görsel döndü');
      }
    } else {
      errors.push(`Query-key HTTP ${r.status}: ${await getErrorText(r)}`);
    }
  } catch (e) {
    errors.push(`Query-key bağlantı hatası: ${e?.message || e}`);
  }

  return res.status(502).json({
    error: `Pollinations görsel üretilemedi. ${errors.join(' | ')}`,
    provider: 'pollinations',
    model: 'flux'
  });
}
