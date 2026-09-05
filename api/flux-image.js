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
// Artık görsel burada (sunucu tarafında) Vercel Blob'a yükleniyor ve
// istemciye SADECE küçük bir URL string'i dönülüyor. Firestore'a da
// artık base64 değil, bu URL yazılıyor.
// ────────────────────────────────────────────────────────────────

import { put } from '@vercel/blob';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const CLOUDFLARE_URL = (accountId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

const TIMEOUT_MS = 65000;

// Cloudflare'in dokümante etmediği ama gerçekte uyguladığı prompt
// karakter sınırı ~2048. Güvenlik payı bırakmak için 1900 kullanıyoruz.
const MAX_PROMPT_CHARS = 1900;

// ============================================================
// VERCEL BLOB
// ============================================================
// Vercel projesine bir "Blob" store bağlandığında Vercel otomatik
// olarak BLOB_READ_WRITE_TOKEN ortam değişkenini ekler; put() bunu
// kendisi okur, elle geçmeye gerek yok.

async function uploadToVercelBlob(buffer, title = '') {
  const safeTitle =
    String(title || 'siir')
      .trim()
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'siir';

  const pathname = `ai-gorseller/${safeTitle}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.jpg`;

  const result = await put(pathname, buffer, {
    access: 'public',
    contentType: 'image/jpeg',
    addRandomSuffix: false
  });

  if (!result?.url) {
    throw new Error('Vercel Blob yükleme başarılı görünüyor ama url dönmedi.');
  }

  return result;
}

// ============================================================
// PROMPT
// ============================================================

function buildPrompt(title, text) {
  const heading = String(title || '').trim().slice(0, 200);

  const instructions = [
    'Create one original cinematic image specifically inspired by the Turkish poem below.',
    'Use the actual meaning of the poem as the primary visual source.',
    'Show the setting, people, objects, actions, symbols, metaphors and emotions that are actually present in the poem.',
    'Do not create a generic poetry image. Do not invent an unrelated scene.',
    'The poem must determine the subject, atmosphere and visual story.',
    'Style: cinematic photography, realistic, artistic, atmospheric, detailed, natural lighting, elegant composition, 16:9 landscape.',
    'IMPORTANT: absolutely NO text anywhere in the image. NO letters, NO words, NO captions, NO typography, NO subtitles, NO signs, NO logos, NO watermark.',
    heading ? `Turkish poem title: ${heading}` : ''
  ].filter(Boolean).join(' ');

  // Önbellek kırıcı — her istekte farklı bir prompt üretir (aynı şiir
  // yeniden görselleştirilse bile CDN/model önbelleği aynı sonucu
  // dönmesin diye). Kısa tutuluyor ki toplam bütçeden fazla yer kaplamasın.
  const varyasyon = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const suffix = `\n\nInternal variation tag (ignore, do not depict, do not render as text): ${varyasyon}`;

  // Sabit kısımlar ayrıldıktan sonra şiire ayrılabilecek gerçek bütçeyi
  // hesapla, böylece TOPLAM prompt her zaman MAX_PROMPT_CHARS altında kalır.
  const fixedLen = instructions.length + suffix.length + '\n\nTurkish poem:\n'.length;
  const poemBudget = Math.max(200, MAX_PROMPT_CHARS - fixedLen);
  const poem = String(text || '').trim().slice(0, poemBudget);

  const finalPrompt = `${instructions}\n\nTurkish poem:\n${poem}${suffix}`;

  // Son bir güvenlik kesmesi (teorik olarak buraya hiç gelmemeli).
  return finalPrompt.length > MAX_PROMPT_CHARS
    ? finalPrompt.slice(0, MAX_PROMPT_CHARS)
    : finalPrompt;
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
// VERCEL
// ============================================================

export const maxDuration = 75;

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
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
          steps: 4
        })
      },
      TIMEOUT_MS
    );

    const buffer = await readCloudflareImage(response);

    // --------------------------------------------------------
    // VERCEL BLOB'A YÜKLE — artık Firestore'a base64 yazılmıyor,
    // sadece bu adımda üretilen küçük URL yazılacak.
    // --------------------------------------------------------
    let blobResult;
    try {
      blobResult = await uploadToVercelBlob(buffer, title);
    } catch (blobErr) {
      console.error('Vercel Blob upload başarısız:', blobErr?.message || blobErr);
      return res.status(502).json({
        error: `Görsel üretildi ama depolamaya (Vercel Blob) yüklenemedi: ${blobErr?.message || blobErr}`,
        provider: 'cloudflare'
      });
    }

    return res.status(200).json({
      imageUrl: blobResult.url,
      provider: 'cloudflare',
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
