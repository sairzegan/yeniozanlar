// /api/_lib/r2.js
//
// @vercel/blob'un put()/del() imzasını BİREBİR taklit eden, Cloudflare R2'ye
// yazan yerine geçen (drop-in replacement) modül. Bu sayede flux-image.js,
// huggingface-image.js ve musicGenerate.js içinde SADECE import satırı
// değişiyor, geri kalan kod (uploadToVercelBlob, del(...) çağrıları vb.)
// AYNEN kalıyor.
//
// Kurulum:
//   npm install @aws-sdk/client-s3
//
// Vercel Environment Variables (Settings → Environment Variables):
//   R2_ACCOUNT_ID         Cloudflare hesap ID'n
//   R2_ACCESS_KEY_ID      R2 API token'ının Access Key ID'si
//   R2_SECRET_ACCESS_KEY  R2 API token'ının Secret Access Key'i
//   R2_BUCKET_NAME        Bucket adın (örn. "yeniozanlar-media")
//   R2_PUBLIC_URL         Bucket'ın herkese açık adresi, SONUNDA / OLMADAN
//                         (örn. "https://pub-xxxxxxxx.r2.dev" ya da kendi
//                          bağladığın domain "https://medya.siten.com")

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

function temizKey(pathname) {
  return String(pathname || '').replace(/^\/+/, '');
}

/**
 * @vercel/blob'daki put(pathname, buffer, options) ile AYNI imza.
 * options: { access, contentType, addRandomSuffix, cacheControlMaxAge }
 * (access ve addRandomSuffix R2'de anlamsız, sessizce yok sayılıyor —
 * çağıran kodda değişiklik yapmamak için imza aynı bırakıldı.)
 * Dönüş: { url, pathname } — @vercel/blob'daki blob.url ile aynı şekilde kullanılır.
 */
export async function put(pathname, buffer, options = {}) {
  const key = temizKey(pathname);
  const maxAge = options.cacheControlMaxAge || 31536000;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: options.contentType || 'application/octet-stream',
    CacheControl: `public, max-age=${maxAge}, immutable`,
  }));

  const publicBase = String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
  return { url: `${publicBase}/${key}`, pathname: key };
}

/**
 * @vercel/blob'daki del(urlOrPathname) ile AYNI imza. Tam URL veya sadece
 * key/pathname kabul eder. Dosya zaten yoksa (eski davranışla tutarlı
 * olması için) sessizce geçer, hata fırlatmaz.
 */
export async function del(urlOrPathname) {
  if (!urlOrPathname) return;
  const publicBase = String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '') + '/';
  const raw = String(urlOrPathname);
  const key = temizKey(raw.startsWith('http') ? raw.replace(publicBase, '') : raw);

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }));
  } catch (_) {
    // eski dosya zaten yoksa/silinemiyorsa sessiz geç
  }
}
