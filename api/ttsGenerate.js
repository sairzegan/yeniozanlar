import { put } from "@vercel/blob";

// Sabit ses eşlemesi: istemci (Groq) sadece bu 5 anahtardan birini seçer,
// gerçek ElevenLabs ses ID'leri HER ZAMAN burada, sunucu tarafında sabit
// kalır — Groq'un uydurabileceği geçersiz/yanlış bir ID asla kullanılmaz.
// ÖNEMLİ: Bu 5 ses ElevenLabs hesabınızda "Voice Library" üzerinden
// "Add to my voices" ile eklenmiş olmalı, yoksa ücretsiz hesaplarda 402
// (payment_required) hatası alırsınız.
const VOICE_MAP = {
  huzunlu:  "MF3mGyEYCl7XYWbV9V6O", // Elli — duygusal, hüzünlü kadın sesi
  romantik: "EXAVITQu4vr4xnSDxMaL", // Bella — yumuşak, sıcak kadın sesi
  dramatik: "ErXwobaYiN019PkySvjV", // Antoni — güçlü, dramatik erkek sesi
  sakin:    "21m00Tcm4TlvDq8ikWAM", // Rachel — sakin, dingin kadın sesi
  tutkulu:  "pNInz6obpgDQGcFmaJgB", // Adam — derin, tutkulu erkek sesi
};
const VARSAYILAN_SES = "sakin";

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
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN tanımlı değil (Vercel Storage -> Blob bağlı mı?)." });
    }

    const secilenAnahtar = Object.prototype.hasOwnProperty.call(VOICE_MAP, voiceKey) ? voiceKey : VARSAYILAN_SES;
    const voiceId = VOICE_MAP[secilenAnahtar];
    const clamp01 = (v, def) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);
    const finalStability = clamp01(Number(stability), 0.5);
    const finalStyle = clamp01(Number(style), 0.35);

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

    // Vercel Blob'a yükle — Firebase/Blaze'e hiç gerek yok, Hobby planda
    // ücretsiz (1GB/ay). access:'public' ile link doğrudan çalınabilir olur.
    const blob = await put(`audio/${cleanPostId}.mp3`, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    return res.status(200).json({ audioUrl: blob.url, voiceKey: secilenAnahtar });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası.", detail: String(e?.message || e).slice(0, 300) });
  }
}
