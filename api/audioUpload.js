// /api/audioUpload.js
// Kullanıcının kendi bilgisayarından seçtiği bir ses dosyasını (mp3, wav, m4a...)
// VEYA tarayıcıda mikrofonla kaydettiği sesi (webm/ogg) alıp Vercel Blob'a
// yükler ve herkese açık bir URL döner. ttsGenerate.js / musicGenerate.js ile
// AYNI sözleşmeyi izler: { audioUrl } döner.
//
// Frontend, dosyayı/kaydı base64'e çevirip JSON içinde bu endpoint'e POST eder
// (multipart/form-data yerine — diğer /api dosyalarıyla tutarlı olsun diye).
//
// Vercel Environment: BLOB_STORE_ID zaten diğer ses/müzik endpoint'leriyle
// PAYLAŞILIYOR, ek bir kurulum gerekmez.

import { put } from "@vercel/blob";

// JSON gövdesi base64 ses verisi taşıdığı için varsayılan body limiti (1mb)
// yetersiz kalabilir; birkaç dakikalık bir kayıt/mp3 için yükseltiyoruz.
export const config = {
  api: {
    bodyParser: { sizeLimit: "15mb" }
  }
};

const UZANTI_HARITASI = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac"
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }
  if (!process.env.BLOB_STORE_ID) {
    return res.status(500).json({ error: "BLOB_STORE_ID tanımlı değil (Blob deposu projeye bağlı mı?)." });
  }

  const { base64Data, mimeType, ownerId } = req.body || {};
  if (!base64Data || typeof base64Data !== "string") {
    return res.status(400).json({ error: "Ses verisi (base64Data) eksik." });
  }

  const temizMime = String(mimeType || "audio/mpeg").split(";")[0].trim().toLowerCase();
  const ext = UZANTI_HARITASI[temizMime] || "mp3";

  // base64Data "data:audio/mpeg;base64,...." önekiyle gelebilir, temizle.
  const virgulIndex = base64Data.indexOf(",");
  const saf = base64Data.startsWith("data:") && virgulIndex !== -1
    ? base64Data.slice(virgulIndex + 1)
    : base64Data;

  let buffer;
  try {
    buffer = Buffer.from(saf, "base64");
  } catch {
    return res.status(400).json({ error: "Ses verisi çözümlenemedi (geçersiz base64)." });
  }
  if (!buffer.length) {
    return res.status(400).json({ error: "Ses dosyası boş." });
  }
  // Kaba bir üst sınır (~12MB) — ör. 3-4 dakikalık orta kaliteli bir kayıt/mp3.
  const MAX_BYTES = 12 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: "Ses dosyası çok büyük (12MB üstü). Daha kısa/küçük bir dosya deneyin." });
  }

  const guvenliOwnerId = /^[A-Za-z0-9_-]+$/.test(String(ownerId || "")) ? String(ownerId) : "kullanici";
  const dosyaAdi = `ses/kullanici-yuklemeleri/${guvenliOwnerId}-${Date.now()}.${ext}`;

  try {
    const uploaded = await put(dosyaAdi, buffer, {
      access: "public",
      contentType: temizMime.startsWith("audio/") ? temizMime : "audio/mpeg",
      addRandomSuffix: false,
      cacheControlMaxAge: 31536000
    });
    return res.status(200).json({ audioUrl: uploaded.url });
  } catch (e) {
    console.error("audioUpload HATASI:", e);
    return res.status(502).json({ error: `Yükleme başarısız: ${String(e?.message || e).slice(0, 250)}` });
  }
}
