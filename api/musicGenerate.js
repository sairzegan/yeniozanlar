import { put } from "@vercel/blob";

// /api/musicGenerate.js
// v6 — ACE-Step (acemusic.ai, ÜCRETSİZ API — bkz. https://acemusic.ai/playground/api-key)
// ile GERÇEK yapay zeka enstrümantal fon müziği üretir.
//
// Önceki sürüm (v5) sabit, önceden Colab'da üretilmiş 8 parçalık bir
// kütüphaneden şiirin ruh haline en yakın hazır parçayı seçiyordu. Artık HER
// şiir için GERÇEKTEN benzersiz, o şiire özel bir parça üretiliyor.
//
// Şiirin türüne/duygusuna uygun İngilizce prompt'u Groq (kota dolarsa Gemini)
// hazırlıyor (bkz. index.html → aiMuzikPromptuGroqlaOlustur); burada SADECE
// ACE-Step'e üretim isteği + Blob'a yükleme var.
//
// `lyrics` alanı bilerek sabit "[inst]" (enstrümantal) olarak gönderilir —
// bu buton/uç nokta SÖZLÜ bir şey ÜRETMEZ, sadece arka plan müziği üretir.
// Şiirin GERÇEKTEN seslendirildiği (sözlü okuma + otomatik fon müziği) akış
// için bkz. ttsGenerate.js / post.audioUrl.

const ACE_ENDPOINT = "https://api.acemusic.ai/v1/chat/completions";
const ACE_MODEL = "acestep/ACE-Step-v1.5";
const ACE_TIMEOUT_MS = 90000;
const VARSAYILAN_PROMPT =
  "calm ambient ballad, soft piano and warm strings, reflective and gentle atmosphere";
const MUZIK_SURESI_SN = 75;

function base64SesVerisiniCoz(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return null;
  }
  const virgulIdx = dataUrl.indexOf(",");
  if (virgulIdx < 0) return null;
  const buffer = Buffer.from(dataUrl.slice(virgulIdx + 1), "base64");
  return buffer.length ? buffer : null;
}

async function aceStepIleMuzikUret(musicPrompt) {
  if (!process.env.ACE_MUSIC_API_KEY) {
    throw new Error(
      "ACE_MUSIC_API_KEY tanımlı değil (acemusic.ai/playground/api-key üzerinden ücretsiz alınabilir)."
    );
  }
  const caption = String(musicPrompt || "").trim() || VARSAYILAN_PROMPT;
  const govde = {
    model: ACE_MODEL,
    messages: [
      { role: "user", content: `<prompt>${caption}</prompt><lyrics>[inst]</lyrics>` },
    ],
    stream: false,
    thinking: true,
    use_format: false,
    audio_config: { duration: MUZIK_SURESI_SN, format: "mp3" },
  };

  const res = await fetch(ACE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ACE_MUSIC_API_KEY}`,
    },
    body: JSON.stringify(govde),
    signal: AbortSignal.timeout(ACE_TIMEOUT_MS),
  });

  if (!res.ok) {
    let detay = "";
    try {
      const j = await res.json();
      detay = j?.error?.message || j?.detail || "";
    } catch (_) {}
    throw new Error(`ACE-Step HTTP ${res.status}${detay ? ": " + detay : ""}`);
  }

  const data = await res.json();
  const audioDataUrl = data?.choices?.[0]?.message?.audio?.[0]?.audio_url?.url;
  const buffer = base64SesVerisiniCoz(audioDataUrl);
  if (!buffer) throw new Error("ACE-Step geçerli bir ses verisi döndürmedi.");
  return buffer;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }
  if (!process.env.BLOB_STORE_ID) {
    return res.status(500).json({ error: "BLOB_STORE_ID tanımlı değil (Blob deposu projeye bağlı mı?)." });
  }

  const { postId, musicPrompt } = req.body || {};
  const cleanPostId = String(postId || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
    return res.status(400).json({ error: "Geçersiz şiir ID." });
  }

  try {
    const buffer = await aceStepIleMuzikUret(musicPrompt);

    // NOT: dosya adı ttsGenerate.js'nin ürettiği `audio/${postId}.mp3` (seslendirme)
    // ile ÇAKIŞMASIN diye "-music" son eki kullanılıyor.
    const blob = await put(`audio/${cleanPostId}-music.mp3`, buffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    return res.status(200).json({ musicUrl: blob.url, prompt: musicPrompt || "" });
  } catch (e) {
    console.error("musicGenerate HATASI:", e);
    return res.status(502).json({ error: `Müzik oluşturulamadı: ${String(e?.message || e).slice(0, 300)}` });
  }
}
