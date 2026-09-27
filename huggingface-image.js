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
// burada Backblaze B2'ye yükleniyor ve istemciye sadece küçük bir URL
// (JSON: {imageUrl}) dönülüyor — böylece Firestore'a base64 yazılmıyor.
//
// Vercel Environment Variables:
// HUGGINGFACE_API_TOKEN = hf_...
// B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION
//
// package.json bağımlılıkları:
// "@huggingface/inference", "@aws-sdk/client-s3"

import { InferenceClient } from '@huggingface/inference';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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

// ============================================================
// BACKBLAZE B2 (S3 uyumlu API)
// ============================================================
// Gerekli ortam değişkenleri:
//   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION
// Bucket, B2 panelinde "Public" olarak ayarlanmalı.

function getB2Client() {
  const endpoint = String(process.env.B2_ENDPOINT || '').trim();
  const region = String(process.env.B2_REGION || '').trim();
  const keyId = String(process.env.B2_KEY_ID || '').trim();
  const appKey = String(process.env.B2_APPLICATION_KEY || '').trim();

  if (!endpoint || !region || !keyId || !appKey) {
    throw new Error(
      'B2 ortam değişkenleri eksik: B2_ENDPOINT, B2_REGION, B2_KEY_ID, B2_APPLICATION_KEY gerekli.'
    );
  }

  return new S3Client({
    endpoint: `https://${endpoint}`,
    region,
    credentials: { accessKeyId: keyId, secretAccessKey: appKey },
    forcePathStyle: true
  });
}

function makeMediaKey(title, ext) {
  const safeTitle =
    String(title || 'siir')
      .trim()
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'siir';

  return `ai-gorseller/${safeTitle}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

async function uploadToB2(buffer, key, contentType = 'image/jpeg') {
  const bucket = String(process.env.B2_BUCKET_NAME || '').trim();
  if (!bucket) {
    throw new Error('B2_BUCKET_NAME ortam değişkeni eksik.');
  }

  const client = getB2Client();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );

  return `https://${process.env.B2_ENDPOINT}/${bucket}/${key}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// GITHUB + jsDelivr YEDEK DEPOLAMA (bkz. flux-image.js'teki aynı not)
// ============================================================

async function uploadToGithubFallback(buffer, key, commitMessage) {
  const owner = String(process.env.GITHUB_OWNER || '').trim();
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  const branch = String(process.env.GITHUB_BRANCH || 'main').trim();

  if (!owner || !repo || !token) {
    throw new Error('GitHub yedek depolama için GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN gerekli.');
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${key}`;
  const response = await fetchWithTimeout(
    apiUrl,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        message: commitMessage || `Yedek yükleme: ${key}`,
        content: buffer.toString('base64'),
        branch
      })
    },
    30000
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new Error(`GitHub yedek yükleme başarısız: HTTP ${response.status} — ${raw.slice(0, 300)}`);
  }

  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${key}`;
}

async function uploadWithFallback(buffer, key, contentType, commitMessage) {
  try {
    const url = await uploadToB2(buffer, key, contentType);
    return { url, provider: 'b2' };
  } catch (b2Err) {
    console.error('B2 upload başarısız, GitHub yedeğine geçiliyor:', b2Err?.message || b2Err);
    const url = await uploadToGithubFallback(buffer, key, commitMessage);
    return { url, provider: 'github', b2Error: b2Err?.message || String(b2Err) };
  }
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
    const mediaKey = makeMediaKey(title, contentType.includes('png') ? 'png' : 'jpg');

    let uploadResult;
    try {
      uploadResult = await uploadWithFallback(buffer, mediaKey, contentType, `Görsel: ${title || mediaKey}`);
    } catch (blobErr) {
      console.error('B2 ve GitHub yedeği ikisi de başarısız:', blobErr?.message || blobErr);
      return res.status(502).json({
        error: `Görsel üretildi ama hem Backblaze B2 hem GitHub yedeğine yüklenemedi: ${blobErr?.message || blobErr}`,
        provider: 'huggingface'
      });
    }

    return res.status(200).json({
      imageUrl: uploadResult.url,
      provider: 'huggingface',
      storage: uploadResult.provider,
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
