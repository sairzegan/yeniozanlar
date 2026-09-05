// /api/huggingface-image.js
// Hugging Face "Inference Providers" üzerinden FLUX.1-schnell ile görsel üretir.
// Cloudflare FLUX başarısız olursa ikinci AI sağlayıcısı olarak devreye girer.
//
// DÜZELTME (bkz. flux-image.js'teki aynı not): FLUX.1-schnell'in prompt için
// dokümante edilmemiş ama gerçek bir ~2048 karakter sınırı var. Aynı güvenlik
// payını (1900 kr) burada da uyguluyoruz, çünkü bu model HF üzerinde de aynı
// (fal-ai / replicate) altyapıyı kullanabiliyor.
//
// DÜZELTME (Firestore kotası): Artık ham binary döndürmek yerine görsel
// burada Vercel Blob'a yükleniyor ve istemciye sadece küçük bir URL
// (JSON: {imageUrl}) dönülüyor — böylece Firestore'a base64 yazılmıyor.
//
// Vercel Environment Variables:
// HUGGINGFACE_API_TOKEN = hf_...
// (Vercel Blob store bağlıysa BLOB_READ_WRITE_TOKEN otomatik eklenir)
//
// Vercel Environment (package.json) bağımlılıkları:
// "@huggingface/inference", "@vercel/blob"

import { InferenceClient } from '@huggingface/inference';
import { put } from '@vercel/blob';

const MODEL = 'black-forest-labs/FLUX.1-schnell';
const TIMEOUT_MS = 60000;
const MAX_PROMPT_CHARS = 1900;

function buildPrompt(title, text) {
  const heading = String(title || '').trim().slice(0, 200);

  const noText = 'No text, no letters, no words, no writing, no typography, no captions, no signs, no logos, no watermark, no books, no handwritten pages anywhere in the image.';

  const instructions = [
    noText,
    'Create one original cinematic image inspired by the scene described below.',
    'Show the setting, people, objects, actions and atmosphere described — nothing else.',
    'Do not create a generic abstract image. Do not invent unrelated elements.',
    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',
    heading ? `Theme: ${heading}` : ''
  ].filter(Boolean).join(' ');

  const varyasyon = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const suffix = ` ${noText} (Internal variation tag, ignore: ${varyasyon})`;

  const fixedLen = instructions.length + suffix.length + '\n\nScene:\n'.length;
  const poemBudget = Math.max(200, MAX_PROMPT_CHARS - fixedLen);
  const scene = String(text || '').trim().slice(0, poemBudget);

  const finalPrompt = `${instructions}\n\nScene:\n${scene}${suffix}`;
  return finalPrompt.length > MAX_PROMPT_CHARS ? finalPrompt.slice(0, MAX_PROMPT_CHARS) : finalPrompt;
}

async function uploadToVercelBlob(buffer, title = '', contentType = 'image/jpeg') {
  const safeTitle =
    String(title || 'siir')
      .trim()
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'siir';

  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const pathname = `ai-gorseller/${safeTitle}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const result = await put(pathname, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false
  });

  if (!result?.url) {
    throw new Error('Vercel Blob yükleme başarılı görünüyor ama url dönmedi.');
  }

  return result;
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

    let blobResult;
    try {
      blobResult = await uploadToVercelBlob(buffer, title, contentType);
    } catch (blobErr) {
      console.error('Vercel Blob upload başarısız:', blobErr?.message || blobErr);
      return res.status(502).json({
        error: `Görsel üretildi ama depolamaya (Vercel Blob) yüklenemedi: ${blobErr?.message || blobErr}`,
        provider: 'huggingface'
      });
    }

    return res.status(200).json({
      imageUrl: blobResult.url,
      provider: 'huggingface',
      model: MODEL
    });
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err?.name === 'AbortError'
        ? 'Hugging Face isteği zaman aşımına uğradı.'
        : (err?.message || 'Hugging Face bağlantı hatası.');
    return res.status(502).json({ error: msg });
  }
}
