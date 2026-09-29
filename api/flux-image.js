// /api/flux-image.js
// Vercel Serverless Function
//
// GÖREV:
// Sadece Cloudflare Workers AI -> FLUX.1-schnell üzerinden
// AI görseli üretir, ürettiği görseli Vercel Blob'a yükler ve
// istemciye SADECE bir URL (JSON) döner.
//
// ÖNEMLİ:
// Bu dosya GIPHY'ye FALLBACK YAPMAZ.
//
// Frontend'deki gerçek zincir:
// Cloudflare FLUX
//      ↓ başarısızsa
// Pollinations
//      ↓ başarısızsa
// Hugging Face
//      ↓ başarısızsa
// Gemini
//      ↓ hepsi başarısızsa
// GIPHY
//
// Cloudflare burada başarısız olursa HTTP 502 döndürür.
// Böylece index.html bir sonraki AI sağlayıcısına geçebilir.
//
// ────────────────────────────────────────────────────────────────
// DÜZELTME #1 (Cloudflare'in çalışmamasının asıl nedeni):
// Cloudflare'in flux-1-schnell modelinin prompt için ~2048 KARAKTER
// sınırı var (dokümante edilmemiş ama gerçek bir sınır — sınırı aşan
// promptlarda Cloudflare "400 Bad Request" ile hata dönüyor).
// Eski buildPrompt(): sabit İngilizce talimatlar (~650 kr) + başlık
// (250 kr'a kadar) + şiir (1800 kr'a kadar) + varyasyon etiketi
// (~60 kr) = TOPLAMDA 2700+ karaktere kadar çıkabiliyordu — yani
// normal uzunlukta bir şiirde bile sınırı rahatça aşıyordu. Bu yüzden
// Cloudflare çoğu istekte "prompt too long" tarzı bir hata ile
// başarısız oluyor, kod bunu yakalayıp otomatik olarak Hugging Face'e
// (veya GIPHY'ye) düşüyordu — yani "Cloudflare hiç çalışmıyor" hissi
// buradan geliyordu. Şimdi nihai prompt HER ZAMAN güvenli bir sınırın
// (1900 karakter) altında kalacak şekilde kırpılıyor.
//
// DÜZELTME #2 (Firestore günlük kota sorunu):
// Önceden bu fonksiyon ham görsel binary'sini dönüyordu, frontend
// onu küçük bir JPEG'e sıkıştırıp base64 olarak DOĞRUDAN Firestore
// dokümanına (post.image) yazıyordu. Bu, her paylaşımı ~150-200 KB
// büyütüyor ve her okuma/yazmada bu veriyi taşıyor — günlük Firestore
// kotasının (okunan/yazılan bayt) çok hızlı dolmasına yol açıyordu.
// Artık görsel burada (sunucu tarafında) Cloudflare R2'ye yükleniyor ve
// istemciye SADECE küçük bir URL string'i dönülüyor. Firestore'a da
// artık base64 değil, bu URL yazılıyor.
// ────────────────────────────────────────────────────────────────

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// R2 ücretsiz kota güvenlik payı: 10GB'ın altında, aşarsa GitHub'a düş.
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

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CLOUDFLARE_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

const TIMEOUT_MS = 65000;

// Cloudflare'in dokümante etmediği ama gerçekte uyguladığı prompt
// karakter sınırı ~2048. Güvenlik payı bırakmak için 1900 kullanıyoruz.
const MAX_PROMPT_CHARS = 1900;

// ============================================================
// CLOUDFLARE R2 (S3 uyumlu API)
// ============================================================
// Gerekli ortam değişkenleri:
//   R2_ACCOUNT_ID        -> Cloudflare hesap ID
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME
//   R2_PUBLIC_URL        -> bucket'ın public dev URL'i, örn. https://pub-xxxx.r2.dev (sonunda / yok)

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

// ============================================================
// GITHUB + jsDelivr YEDEK DEPOLAMA
// ============================================================
// R2 herhangi bir sebeple (kota, kimlik doğrulama, ağ hatası vb.)
// başarısız olursa aynı dosya bu public GitHub reposuna commit'lenir
// ve jsDelivr CDN üzerinden servis edilir. Gerekli ortam değişkenleri:
//   GITHUB_TOKEN  -> sadece bu repoya "Contents: Read and write" izinli,
//                    fine-grained bir Personal Access Token
//   GITHUB_OWNER  -> GitHub kullanıcı adı
//   GITHUB_REPO   -> public repo adı
//   GITHUB_BRANCH -> varsayılan: main

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

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(title, text) {
  const heading = String(title || '').trim().slice(0, 200);

  // DÜZELTME (görselde yazı/harf çıkması sorunu): FLUX.1-schnell "guidance
  // distilled" bir modeldir, yani "no text" gibi olumsuz talimatları normal
  // modeller kadar güvenilir uygulayamaz. Elimizden gelen: (1) yasak
  // talimatını hem PROMPTUN EN BAŞINA hem EN SONUNA koymak (distilled
  // modellerde başta/sonda olan talimatlar ortadakilerden daha çok dikkate
  // alınıyor), (2) "poem/title" gibi metni çağrıştıran kelimeleri en aza
  // indirmek — bu yüzden gerçek şiir metni artık normalde hiç buraya
  // gelmiyor (bkz. index.html: gorselIcinMetin artık sadece Groq'un ürettiği
  // sahne tarifini kullanıyor, ham şiiri değil).
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
// TIMEOUT'LU FETCH
// ============================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// CLOUDFLARE CEVABINI BINARY GÖRSELE ÇEVİR
// ============================================================

async function readCloudflareImage(response) {
  const contentType = (response.headers.get('content-type') || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (!response.ok) {
    let raw = '';
    try { raw = await response.text(); } catch (_) { raw = ''; }

    let data = null;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    const detail =
      data?.errors?.[0]?.message ||
      data?.error ||
      data?.message ||
      raw.slice(0, 800);

    const error = new Error(`Cloudflare FLUX HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    error.status = response.status;
    error.isCloudflare = true;
    throw error;
  }

  // Cloudflare doğrudan image/* döndürdüyse (bazı hesap/model varyasyonlarında olur)
  if (contentType.startsWith('image/')) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) throw new Error('Cloudflare FLUX boş görsel döndürdü.');
    return buffer;
  }

  // Normalde Cloudflare Workers AI REST API'si JSON döner:
  // { "result": { "image": "BASE64..." }, "success": true }
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { data = null; }

  if (!data) {
    throw new Error(`Cloudflare FLUX JSON olmayan bir cevap döndürdü: ${raw.slice(0, 500)}`);
  }

  const base64 = data?.result?.image || data?.image;

  if (base64 && typeof base64 === 'string') {
    let temizBase64 = base64.trim();
    if (temizBase64.startsWith('data:image/')) {
      const virgul = temizBase64.indexOf(',');
      if (virgul >= 0) temizBase64 = temizBase64.slice(virgul + 1);
    }
    const buffer = Buffer.from(temizBase64, 'base64');
    if (!buffer.length) throw new Error('Cloudflare FLUX base64 görsel verisi boş.');
    return buffer;
  }

  const detail =
    data?.errors?.[0]?.message ||
    data?.error ||
    data?.message ||
    (data?.result ? JSON.stringify(data.result).slice(0, 500) : '');

  throw new Error(`Cloudflare FLUX geçerli bir görsel döndürmedi.${detail ? ` — ${detail}` : ''}`);
}

// ============================================================
// MEDYA SİLME (R2 + GitHub yedeği)
// ============================================================
// /api/flux-image: POST → görsel üretir, DELETE → medya siler (ayrı
// fonksiyon Vercel Hobby'nin 12 fonksiyon sınırına takılmasın diye).
// Frontend elindeki herhangi bir URL'yi gönderebilir; sadece kendi R2/GitHub
// desenimize uyanları silip gerisini sessizce yok sayıyoruz (skipped:true).

function matchR2Key(url) {
  const publicBase = String(process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!publicBase || typeof url !== 'string') return null;

  const prefix = `${publicBase}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length).split('?')[0]);
}

function matchGithubKey(url) {
  const owner = String(process.env.GITHUB_OWNER || '').trim();
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const branch = String(process.env.GITHUB_BRANCH || 'main').trim();
  if (!owner || !repo || typeof url !== 'string') return null;

  const prefix = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/`;
  if (!url.startsWith(prefix)) return null;
  return { key: decodeURIComponent(url.slice(prefix.length).split('?')[0]), branch };
}

async function deleteFromR2(key) {
  const client = getR2Client();
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim();
  if (!client || !bucket) throw new Error('R2 yapılandırması eksik.');
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// GitHub'ın Contents API'sinden dosya silmek için önce mevcut dosyanın
// "sha" değerini bilmek gerekiyor (API böyle çalışıyor: hangi sürümü
// sildiğinizi teyit etmeniz isteniyor).
async function deleteFromGithub(key, branch) {
  const owner = String(process.env.GITHUB_OWNER || '').trim();
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!owner || !repo || !token) throw new Error('GitHub yapılandırması eksik.');

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${key}`;

  const getRes = await fetchWithTimeout(
    `${apiUrl}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    },
    15000
  );

  if (getRes.status === 404) return; // Dosya zaten yok, silinecek bir şey kalmamış.
  if (!getRes.ok) {
    const raw = await getRes.text().catch(() => '');
    throw new Error(`GitHub dosya bilgisi alınamadı: HTTP ${getRes.status} — ${raw.slice(0, 200)}`);
  }

  const fileData = await getRes.json();
  const sha = fileData?.sha;
  if (!sha) throw new Error('GitHub dosyasının sha bilgisi bulunamadı.');

  const delRes = await fetchWithTimeout(
    apiUrl,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ message: `Otomatik temizlik: ${key}`, sha, branch })
    },
    15000
  );

  if (!delRes.ok) {
    const raw = await delRes.text().catch(() => '');
    throw new Error(`GitHub silme başarısız: HTTP ${delRes.status} — ${raw.slice(0, 200)}`);
  }
}

async function medyaSilmeIsteginiIsle(req, res) {
  const gelenUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const temizUrls = [...new Set(gelenUrls.filter(u => typeof u === 'string' && u.trim()))];

  if (!temizUrls.length) {
    return res.status(200).json({ results: [] });
  }

  // Kötüye kullanımı önlemek için tek istekte makul bir üst sınır.
  const islenecekUrls = temizUrls.slice(0, 20);
  const results = [];

  for (const url of islenecekUrls) {
    const r2Key = matchR2Key(url);
    const ghMatch = !r2Key ? matchGithubKey(url) : null;

    if (r2Key) {
      try {
        await deleteFromR2(r2Key);
        results.push({ url, provider: 'r2', deleted: true });
      } catch (err) {
        console.error('R2 silme hatası:', url, err?.message || err);
        results.push({ url, provider: 'r2', deleted: false, error: err?.message || String(err) });
      }
    } else if (ghMatch) {
      try {
        await deleteFromGithub(ghMatch.key, ghMatch.branch);
        results.push({ url, provider: 'github', deleted: true });
      } catch (err) {
        console.error('GitHub silme hatası:', url, err?.message || err);
        results.push({ url, provider: 'github', deleted: false, error: err?.message || String(err) });
      }
    } else {
      // Bize ait değil (GIPHY, Cloudinary, Spotify/YouTube linki, statik
      // müzik kütüphanesi vb.) — dokunmuyoruz.
      results.push({ url, provider: 'none', deleted: false, skipped: true });
    }
  }

  return res.status(200).json({ results });
}

// ============================================================
// VERCEL
// ============================================================

export const maxDuration = 75;

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    return medyaSilmeIsteginiIsle(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'Yalnızca POST veya DELETE destekleniyor.' });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';

  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni gönderilemedi.' });
  }

  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();

  if (!accountId || !token) {
    return res.status(500).json({
      error: 'Cloudflare değişkenleri eksik: CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN gerekli.'
    });
  }

  const prompt = buildPrompt(title, text);

  try {
    const response = await fetchWithTimeout(
      CLOUDFLARE_URL(accountId),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          prompt,
          // Seed göndermiyoruz: geçersiz/desteklenmeyen seed nedeniyle
          // hata oluşmasını engeller.
          // Cloudflare flux-1-schnell şeması SADECE prompt, steps (ve seed) kabul eder.
          // width/height gönderilirse 400 "Additional properties not allowed" hatası verir.
          steps: 4
        })
      },
      TIMEOUT_MS
    );

    const buffer = await readCloudflareImage(response);

    // R2'YE YÜKLE, BAŞARISIZ OLURSA GITHUB+jsDelivr'E DÜŞ
    const mediaKey = makeMediaKey(title, 'jpg');
    let uploadResult;
    try {
      uploadResult = await uploadWithFallback(buffer, mediaKey, 'image/jpeg', `Görsel: ${title || mediaKey}`);
    } catch (blobErr) {
      console.error('R2 ve GitHub yedeği ikisi de başarısız:', blobErr?.message || blobErr);
      return res.status(502).json({
        error: `Görsel üretildi ama hem Cloudflare R2 hem GitHub yedeğine yüklenemedi: ${blobErr?.message || blobErr}`,
        provider: 'cloudflare'
      });
    }

    return res.status(200).json({
      imageUrl: uploadResult.url,
      provider: 'cloudflare',
      storage: uploadResult.provider,
      r2Error: uploadResult.r2Error || null,
      model: MODEL
    });
  } catch (err) {
    // BURADA GIPHY ÇAĞRILMIYOR — HTTP 502 dönüyoruz, index.html bir
    // sonraki sağlayıcıya (Hugging Face) geçecek.
    const mesaj = err?.name === 'AbortError'
      ? 'Cloudflare FLUX isteği zaman aşımına uğradı.'
      : (err?.message || 'Cloudflare FLUX başarısız oldu.');

    console.error('Cloudflare FLUX error:', mesaj);

    return res.status(502).json({
      error: mesaj,
      provider: 'cloudflare',
      fallback: false
    });
  }
}
