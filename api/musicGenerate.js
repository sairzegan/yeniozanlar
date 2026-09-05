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
//
// NOT (v7): api.acemusic.ai SADECE senkron "OpenRouter uyumlu" modu destekler
// (POST /v1/chat/completions) — /release_task gibi asenkron uç noktalar YOKTUR
// (bunlar sadece kendi sunucunuzu barındırdığınızda kullanılabilir, HTTP 404
// döner). Resmi doküman: ace-step/ACE-Step-1.5 docs/en/Openrouter_API_DOC.md.
// Önceki 504 hatası, GEÇERSİZ bir "model" ID'si göndermekten kaynaklanıyordu;
// bu alan opsiyonel olduğu için artık hiç gönderilmiyor. Enstrümantal (sözsüz)
// üretim için resmi olarak belgelenen `audio_config.instrumental: true`
// kullanılıyor (önceki `lyrics:"[inst]"` yöntemi yerine).

const ACE_ENDPOINT = "https://api.acemusic.ai/v1/chat/completions";
const ACE_TIMEOUT_MS = 260000; // Vercel fonksiyon süresiyle (config.maxDuration) uyumlu
const VARSAYILAN_PROMPT =
  "calm ambient ballad, soft piano and warm strings, reflective and gentle atmosphere";
const MUZIK_SURESI_SN = 45;

// 100sn'lik önceki denemede HÂLÂ "aborted due to timeout" alındığı için süre
// iyice yükseltildi (bkz. ttsGenerate.js'teki aynı notun ayrıntısı).
export const config = { maxDuration: 280 };

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
      "ACE_MUSIC_API_KEY tanımlı değil (acemusic.ai/api-key üzerinden ücretsiz alınabilir)."
    );
  }
  const caption = String(musicPrompt || "").trim() || VARSAYILAN_PROMPT;
  const govde = {
    // "model" alanı BİLEREK gönderilmiyor — bkz. yukarıdaki not.
    messages: [
      { role: "user", content: `<prompt>${caption}</prompt>` },
    ],
    stream: false,
    thinking: true,
    audio_config: {
      duration: MUZIK_SURESI_SN,
      format: "mp3",
      instrumental: true,
    },
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
      detay = j?.error?.message || j?.detail || JSON.stringify(j).slice(0, 200);
    } catch (_) {}
    throw new Error(`ACE-Step HTTP ${res.status}${detay ? ": " + detay : ""}`);
  }

  const data = await res.json();
  const audioDataUrl = data?.choices?.[0]?.message?.audio?.[0]?.audio_url?.url;
  const buffer = base64SesVerisiniCoz(audioDataUrl);
  if (!buffer) throw new Error("ACE-Step geçerli bir ses verisi döndürmedi.");
  return buffer;
}

// ACE-Step geçici olarak çökmüş/aşırı yavaşsa (timeout, 502/503/504, ağ
// hatası vb.) kullanıcıya ham teknik hata yerine daha anlaşılır, ne yapması
// gerektiğini söyleyen bir mesaj gösteriyoruz. Teknik detay yine de
// console.error ile sunucu loglarına yazılıyor (bkz. handler içindeki catch).
function kullaniciDostuHataMesaji(e) {
  const mesaj = String(e?.message || e || "");
  const gecici = /aborted|timeout|zaman a[şs][iı]m[iı]|50[234]|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(
    mesaj
  );
  if (gecici) {
    return (
      'AI müzik servisi (acemusic.ai) şu anda geçici olarak yanıt vermiyor ya da çok yoğun. ' +
      'Bu genelde kısa süreli bir durumdur — birkaç dakika sonra "Yapay Zeka ile Müzik Oluştur" ' +
      "butonuna tekrar basmayı deneyin."
    );
  }
  return `Müzik oluşturulamadı: ${mesaj.slice(0, 250)}`;
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
    return res.status(502).json({ error: kullaniciDostuHataMesaji(e) });
  }
}
