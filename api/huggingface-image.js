// /api/huggingface-image.js
// Hugging Face "Inference Providers" üzerinden FLUX.1-schnell ile görsel üretir.
// Cloudflare FLUX başarısız olursa ikinci AI sağlayıcısı olarak devreye girer.
//
// DÜZELTME (bkz. flux-image.js'teki aynı not): FLUX.1-schnell'in prompt için
// dokümante edilmemiş ama gerçek bir ~2048 karakter sınırı var. Aynı güvenlik
// payını (1900 kr) burada da uyguluyoruz.
//
// Görsel burada üretilip Cloudflare R2'ye yükleniyor, istemciye sadece küçük
// bir URL (JSON: {imageUrl}) dönülüyor.
//
// Vercel Environment Variables:
// HUGGINGFACE_API_TOKEN = hf_...
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
//
// package.json bağımlılıkları:
// "@huggingface/inference", "@aws-sdk/client-s3"

import { InferenceClient } from '@huggingface/inference';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const R2_GUVENLIK_LIMITI = 9 * 1024 * 1024 * 1024;
function r2AyAnahtari() {
  const d = new Date();
  return `_meta/r2-kullanim-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}.json`;
}
async function r2KullanimOku(client, bucket) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: r2AyAnahtari() }));
    const text = await res.Body.transformToString();
    return Number(JSON.parse(text)?.bytes) || 0;
  } catch (_) { return 0; }
}
function r2KullanimYaz(client, bucket, bytes) {
  client.send(new PutObjectCommand({ Bucket: bucket, Key: r2AyAnahtari(), Body: JSON.stringify({ bytes }), ContentType: 'application/json' })).catch(() => {});
}

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
// CLOUDFLARE R2 (S3 uyumlu API)
// ============================================================
// Gerekli ortam değişkenleri:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

function getR2Client() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 ortam değişkenleri eksik: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY gerekli.');
  }

  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    requestChecksumValidation: 'WHEN_REQUIRED',
    responseChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
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

async function uploadToR2(buffer, key, contentType = 'image/jpeg') {
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim();
  const publicBase = String(process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!bucket) throw new Error('R2_BUCKET_NAME ortam değişkeni eksik.');
  if (!publicBase) throw new Error('R2_PUBLIC_URL ortam değişkeni eksik.');

  const client = getR2Client();
  const mevcutBayt = await r2KullanimOku(client, bucket);
  if (mevcutBayt + buffer.length > R2_GUVENLIK_LIMITI) {
    throw new Error('R2 aylık güvenlik limiti (9GB) aşılıyor.');
  }

  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );
  r2KullanimYaz(client, bucket, mevcutBayt + buffer.length);

  return `${publicBase}/${key}`;
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

// TEŞHİS: gerçek anahtarları loglamıyoruz, sadece uzunluk + ilk birkaç karakter.
function r2TeshisBilgisi() {
  const maskele = (v) => {
    const s = String(v || '');
    return s ? `uzunluk=${s.length}, başlangıç="${s.slice(0, 4)}…"` : '(tanımsız)';
  };
  return `[R2_ACCESS_KEY_ID: ${maskele(process.env.R2_ACCESS_KEY_ID)} | R2_SECRET_ACCESS_KEY: ${maskele(process.env.R2_SECRET_ACCESS_KEY)} | R2_ACCOUNT_ID="${process.env.R2_ACCOUNT_ID || '(tanımsız)'}" | R2_BUCKET_NAME="${process.env.R2_BUCKET_NAME || '(tanımsız)'}" | R2_PUBLIC_URL="${process.env.R2_PUBLIC_URL || '(tanımsız)'}"]`;
}

async function uploadWithFallback(buffer, key, contentType, commitMessage) {
  try {
    const url = await uploadToR2(buffer, key, contentType);
    return { url, provider: 'r2' };
  } catch (r2Err) {
    const teshis = r2TeshisBilgisi();
    console.error('R2 upload başarısız, GitHub yedeğine geçiliyor:', r2Err?.message || r2Err, teshis);
    const url = await uploadToGithubFallback(buffer, key, commitMessage);
    return { url, provider: 'github', r2Error: `${r2Err?.message || String(r2Err)} ${teshis}` };
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
        parameters: { num_inference_steps: 4, width: 768, height: 432 }
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
      console.error('R2 ve GitHub yedeği ikisi de başarısız:', blobErr?.message || blobErr);
      return res.status(502).json({
        error: `Görsel üretildi ama hem Cloudflare R2 hem GitHub yedeğine yüklenemedi: ${blobErr?.message || blobErr}`,
        provider: 'huggingface'
      });
    }

    return res.status(200).json({
      imageUrl: uploadResult.url,
      provider: 'huggingface',
      storage: uploadResult.provider,
      r2Error: uploadResult.r2Error || null,
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
