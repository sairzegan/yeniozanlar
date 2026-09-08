// /api/_lib/storage.js
//
// Cloudinary (KART GEREKTİRMEYEN, kalıcı ücretsiz plan) için
// @vercel/blob'un put()/del() imzasını BİREBİR taklit eden modül.
// api/flux-image.js, api/huggingface-image.js ve api/musicGenerate.js
// bu dosyayı "./_lib/storage.js" olarak import ediyor — içeriği ne olursa
// olsun (B2, R2, Cloudinary...) o üç dosyada değişiklik gerekmez.
//
// NEDEN CLOUDINARY?
// - Cloudflare R2: ücretsiz ama free tier için bile kredi kartı istiyor.
// - Backblaze B2: Private bucket kartsız oluşturuluyor ama Public bucket
//   (yani <img>/<audio> ile doğrudan açılabilen linkler) için de kart
//   isteniyor.
// - Cloudinary: HİÇBİR ZAMAN kart istemiyor, kalıcı ücretsiz planı var,
//   yüklenen her dosya kalıcı/süresiz genel bir URL alıyor, hem görsel
//   hem ses (mp3) dosyalarını destekliyor.
//
// Kurulum:
//   npm install cloudinary
//
// Vercel Environment Variables (Cloudinary Dashboard → Account Details):
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
//
// NOT: Eğer projede zaten (index.html içinde) başka bir amaçla Cloudinary
// kullanılıyorsa AYNI hesabı/AYNI cloud name'i kullanabilirsin — sadece
// API_KEY ve API_SECRET'i (Dashboard → Account Details'ten, "View API Keys")
// sunucu tarafı ortam değişkeni olarak ekle. Client tarafında kullanılan
// "unsigned upload preset" ile bu sunucu taraflı (signed, API secret ile)
// yükleme birbirinden bağımsızdır, çakışmaz.

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function temizKey(pathname) {
  return String(pathname || '').replace(/^\/+/, '');
}

// Cloudinary'de ses dosyaları "video" resource_type'ı ile yönetiliyor
// (mp3/wav/ogg dahil) — Cloudinary'nin kendi terminolojisi böyle, sesin
// kendisi "video" olarak sınıflanmıyor, sadece API'nin adı bu.
function resourceTypeSec(contentTypeVeyaYol) {
  const s = String(contentTypeVeyaYol || '').toLowerCase();
  const sesMi = /^audio\/|\.(mp3|wav|ogg|flac|m4a)(\?|$)/.test(s);
  return sesMi ? 'video' : 'image';
}

/**
 * @vercel/blob'daki put(pathname, buffer, options) ile AYNI imza.
 * options: { contentType, ... } — access/addRandomSuffix yok sayılır
 * (Cloudinary'de yüklenen her dosya zaten herkese açık URL alır).
 * Dönüş: { url, pathname }
 */
export async function put(pathname, buffer, options = {}) {
  const key = temizKey(pathname);
  const resourceType = resourceTypeSec(options.contentType || key);
  // Cloudinary public_id'de dosya uzantısını İSTEMİYOR (kendisi ekliyor);
  // klasör yapısını (örn. "ai-gorseller/xxx", "audio/xxx") korumak için
  // sadece uzantıyı kırpıyoruz.
  const publicId = key.replace(/\.[^/.]+$/, '');

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: resourceType,
        overwrite: true,
        // Rastgele/zaman damgalı dosya adları zaten benzersiz olduğu için
        // Cloudinary'nin kendi versiyonlama/invalidation'ına gerek yok.
      },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(buffer);
  });

  if (!result?.secure_url) {
    throw new Error('Cloudinary yükleme başarılı görünüyor ama url dönmedi.');
  }

  return { url: result.secure_url, pathname: key };
}

/**
 * @vercel/blob'daki del(urlOrPathname) ile AYNI imza. Dosya zaten yoksa
 * sessizce geçer, hata fırlatmaz.
 */
export async function del(urlOrPathname) {
  if (!urlOrPathname) return;
  const raw = String(urlOrPathname);
  const resourceType = resourceTypeSec(raw);

  // Cloudinary URL'i şu şekildedir:
  //   https://res.cloudinary.com/<cloud>/image/upload/v169.../klasor/ad.jpg
  //   https://res.cloudinary.com/<cloud>/video/upload/v169.../klasor/ad.mp3
  // public_id = "klasor/ad" (uzantısız, "vNNNN/" sürüm parçası hariç).
  let publicId;
  const m = raw.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (m) {
    publicId = m[1].replace(/\.[^/.]+$/, '');
  } else {
    // URL değil, doğrudan pathname/key verilmiş olabilir (örn. eski sabit
    // dosya adı temizliği için çağrılan durumlar).
    publicId = temizKey(raw).replace(/\.[^/.]+$/, '');
  }

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (_) {
    // eski dosya zaten yoksa/silinemiyorsa sessiz geç
  }
}
