// /api/huggingface-image.js
// Hugging Face "Inference Providers" üzerinden FLUX.1-schnell ile görsel üretir.
// Cloudflare FLUX (kota/rate-limit) ve Pollinations ikisi de başarısız olursa
// üçüncü AI sağlayıcısı olarak devreye girer (bkz. index.html içinde
// adminYapayZekaGorseliYenile / huggingfaceGorselDene).
//
// ÖNEMLİ (düzeltme notu): Bu dosya daha önce doğrudan
// "https://api-inference.huggingface.co/models/..." adresine POST atıyordu.
// Hugging Face bu eski "serverless Inference API" adresini tamamen KALDIRDI
// (artık 410/bağlantı hatası dönüyor: "no longer supported, use
// router.huggingface.co instead"). Bu yüzden istekler "fetch failed" ile
// başarısız oluyordu — bu bir kota sorunu DEĞİLDİ, kırılan bir endpoint'ti.
//
// Çözüm: resmi "@huggingface/inference" SDK'sı kullanılıyor. Bu SDK, isteği
// otomatik olarak modelin o an hangi sağlayıcı (fal-ai, replicate, nebius vb.)
// üzerinden servis edildiğini bulup doğru "router.huggingface.co" rotasına ve
// doğru istek/cevap şemasına çevirir (provider:"auto" ile).
//
// Vercel Environment Variable:
// HUGGINGFACE_API_TOKEN = hf_...
//
// Vercel Environment (package.json) bağımlılığı:
// "@huggingface/inference" (bkz. package.json)
//
// flux-image.js ile aynı üslupta: ham görsel binary'sini (image/*) doğrudan
// döndürür, JSON sarmalamaz — böylece istemci tarafı tek bir blob-işleme
// koduyla dört sağlayıcıyı da (Cloudflare, Pollinations, Hugging Face, Gemini)
// aynı şekilde işleyebilir.

import { InferenceClient } from '@huggingface/inference';

const MODEL = 'black-forest-labs/FLUX.1-schnell';
const TIMEOUT_MS = 60000;

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 1800);
  const heading = String(title || '').trim().slice(0, 250);
  // Önbellek kırıcı — bkz. flux-image.js'teki aynı isimli değişken.
  const varyasyon = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return [
    'Create one original cinematic image directly inspired by the Turkish poem below.',
    'Use the actual meaning of the poem as the primary visual source: its setting, people, objects, actions, symbols, metaphors and emotions.',
    'Do not create a generic poetry image and do not invent an unrelated scene.',
    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',
    'IMPORTANT: absolutely NO text anywhere in the image. No letters, no words, no captions, no typography, no signs, no logos, no watermark.',
    heading ? `Turkish poem title: ${heading}` : '',
    `Turkish poem:\n${poem}`,
    `Internal variation tag (ignore, do not depict, do not render as text): ${varyasyon}`
  ].filter(Boolean).join('\n\n');
}

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Sadece POST destekleniyor.' });
  }

  const token = String(process.env.HUGGINGFACE_API_TOKEN || '').trim();
  if (!token) {
    return res.status(500).json({
      error: 'HUGGINGFACE_API_TOKEN Vercel Environment Variables içinde bulunamadı.'
    });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni gönderilemedi.' });
  }

  const prompt = buildPrompt(title, text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = new InferenceClient(token);

    // provider:"auto" → HF, modeli o an hangi sağlayıcı (fal-ai, replicate,
    // nebius, vb.) canlı sunuyorsa otomatik olarak onu seçer. Elle sabit bir
    // sağlayıcı (örn. sadece "hf-inference") seçmiyoruz çünkü hf-inference artık
    // ağırlıklı olarak küçük/CPU modelleri servis ediyor, FLUX gibi modelleri değil.
    const blob = await client.textToImage(
      {
        model: MODEL,
        inputs: prompt,
        provider: 'auto',
        parameters: { num_inference_steps: 4 }
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    if (!blob || typeof blob.arrayBuffer !== 'function') {
      return res.status(502).json({ error: 'Hugging Face beklenmeyen bir cevap döndürdü.' });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    if (!buffer.length) {
      return res.status(502).json({ error: 'Hugging Face boş görsel döndürdü.' });
    }

    const contentType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'huggingface');
    res.setHeader('X-AI-Model', MODEL);
    return res.status(200).send(buffer);
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err?.name === 'AbortError'
        ? 'Hugging Face isteği zaman aşımına uğradı.'
        : (err?.message || 'Hugging Face bağlantı hatası.');
    return res.status(502).json({ error: msg });
  }
}
