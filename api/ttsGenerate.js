import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

const PROJECT_ID = "yeniozanlar-68b49";
// Firebase projeniz için doğru bucket adını Firebase Console -> Storage
// sayfasının üstünde görebilirsiniz (gs://... kısmının hemen sonrası).
// Farklıysa Vercel'de FIREBASE_STORAGE_BUCKET ortam değişkeni ile geçersiz kılın.
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;

// Sabit ses eşlemesi: istemci (Groq) sadece bu 5 anahtardan birini seçer,
// gerçek ElevenLabs ses ID'leri HER ZAMAN burada, sunucu tarafında sabit
// kalır — Groq'un uydurabileceği geçersiz/yanlış bir ID asla kullanılmaz.
// Farklı bir ses istersen ilgili ID'yi ElevenLabs sitesindeki
// (VoiceLab -> ilgili ses -> ... -> Copy Voice ID) ile değiştirebilirsin.
const VOICE_MAP = {
  huzunlu:  "MF3mGyEYCl7XYWbV9V6O", // Elli — duygusal, hüzünlü kadın sesi
  romantik: "EXAVITQu4vr4xnSDxMaL", // Bella — yumuşak, sıcak kadın sesi
  dramatik: "ErXwobaYiN019PkySvjV", // Antoni — güçlü, dramatik erkek sesi
  sakin:    "21m00Tcm4TlvDq8ikWAM", // Rachel — sakin, dingin kadın sesi
  tutkulu:  "pNInz6obpgDQGcFmaJgB", // Adam — derin, tutkulu erkek sesi
};
const VARSAYILAN_SES = "sakin";

function getBucket() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      initializeApp({ credential: cert(JSON.parse(raw)), projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
    } else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!clientEmail || !privateKey) throw new Error("Firebase Admin ortam değişkenleri eksik.");
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
        storageBucket: STORAGE_BUCKET,
      });
    }
  }
  return getStorage().bucket();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }

  try {
    const { text, title, postId, voiceKey, stability, style } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanPostId = String(postId || "").trim();

    if (!cleanText || cleanText.length < 5) {
      return res.status(400).json({ error: "Geçersiz metin." });
    }
    if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
      return res.status(400).json({ error: "Geçersiz şiir ID." });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "ELEVENLABS_API_KEY tanımlı değil." });
    }

    // Groq'un önerdiği ses/duygu — geçersizse (veya hiç gelmezse) güvenli
    // varsayılana düşülür, ASLA client'tan gelen bir ID doğrudan kullanılmaz.
    const secilenAnahtar = Object.prototype.hasOwnProperty.call(VOICE_MAP, voiceKey) ? voiceKey : VARSAYILAN_SES;
    const voiceId = VOICE_MAP[secilenAnahtar];
    const clamp01 = (v, def) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);
    const finalStability = clamp01(Number(stability), 0.5);
    const finalStyle = clamp01(Number(style), 0.35);

    // ElevenLabs karakter sınırlarını aşmamak için makul bir üst sınır.
    const spoken = (title ? `${title}. ` : "") + cleanText;
    const trimmed = spoken.length > 4500 ? spoken.slice(0, 4500) : spoken;

    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: trimmed,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: finalStability, similarity_boost: 0.75, style: finalStyle, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!elevenRes.ok) {
      let detay = "";
      try { detay = await elevenRes.text(); } catch {}
      console.error("ElevenLabs HATASI:", elevenRes.status, detay);
      return res.status(502).json({ error: "Ses oluşturulamadı.", detail: detay.slice(0, 300) });
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());
    if (!audioBuffer.length) {
      return res.status(502).json({ error: "Boş ses verisi döndü." });
    }

    const bucket = getBucket();
    const filePath = `audio/${cleanPostId}.mp3`;
    const file = bucket.file(filePath);
    const downloadToken = randomUUID();
    // makePublic() yerine Firebase'in kendi indirme-token yöntemi kullanılıyor:
    // bucket'ın "Uniform Bucket-Level Access" ayarından TAMAMEN bağımsız
    // çalışır (o ayar açıksa makePublic() sessizce başarısız oluyordu).
    await file.save(audioBuffer, {
      metadata: {
        contentType: "audio/mpeg",
        cacheControl: "public, max-age=31536000",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
    return res.status(200).json({ audioUrl, voiceKey: secilenAnahtar });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası." });
  }
}
