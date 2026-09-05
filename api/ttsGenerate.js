import { put } from "@vercel/blob";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs/promises";
import os from "os";
import path from "path";

// v2 — ACE-Step (acemusic.ai, ÜCRETSİZ API — bkz. https://acemusic.ai/playground/api-key)
// ile GERÇEK yapay zeka seslendirmesi.
//
// ACE-Step şiiri "söyleyerek/okuyarak" seslendiren VE arkasına kendisinin
// ürettiği enstrümantal fon müziğini otomatik ekleyen bir müzik/şarkı üretim
// modelidir — yani TEK bir istekte hem "seslendirme" hem "fon müziği" birlikte
// üretilir (post.audioUrl). Bu, eski Microsoft Edge TTS (sentetik, müziksiz
// okuma) akışının yerini alır.
//
// Groq (kota dolarsa Gemini) sadece HANGİ ses tonu / cinsiyet / enstrüman
// kullanılacağına karar verir (bkz. index.html → aiSesYonlendirmesiGroqlaOlustur);
// bu fonksiyon o kararın sonucunda gelen { caption, vocalLanguage } alanlarını
// kullanarak ACE-Step'e tek bir üretim isteği gönderir.
//
// ÖNEMLİ NOTLAR:
// - ACE-Step Türkçe vokali destekler (50+ dil), ancak en iyi performansı
//   İngilizce/Çince/Japonca/Korece gibi "üst düzey destekli" dillerde verir;
//   Türkçe'de sonuç kalitesi şiirden şiire değişebilir.
// - ACE-Step SABİT bir süre için müzik üretir (adaptif bir TTS motoru gibi
//   şiirin uzunluğuna göre otomatik uzayıp kısalmaz); bu yüzden şiir
//   uzunluğundan kaba bir süre tahmini yapıyoruz (saniyeTahminEt). Çok uzun
//   şiirlerde okuma metni süreye sığdırılamayabilir — bu ACE-Step'in kendi
//   sınırıdır.
// - ACE_MUSIC_API_KEY tanımlı değilse VEYA ACE-Step geçici olarak başarısız
//   olursa (kota/timeout/ağ hatası), eskisi gibi Microsoft Edge TTS'e YEDEK
//   olarak düşülür — böylece bir paylaşım hiçbir zaman sessiz kalmaz. Bu
//   durumda üretilen ses sadece okuma içerir, fon müziği İÇERMEZ.
//
// NOT (v3): api.acemusic.ai SADECE senkron "OpenRouter uyumlu" modu destekler
// (POST /v1/chat/completions) — /release_task gibi asenkron uç noktalar YOKTUR
// (bunlar sadece kendi sunucunuzu barındırdığınızda kullanılabilir, HTTP 404
// döner). Resmi doküman: ace-step/ACE-Step-1.5 docs/en/Openrouter_API_DOC.md.
// Önceki 504 hatası, GEÇERSİZ bir "model" ID'si göndermekten kaynaklanıyordu;
// bu alan opsiyonel olduğu ve varsayılanı zaten doğru modele işaret ettiği
// için artık hiç gönderilmiyor. Gerçek üretim genelde 5-15 saniye sürer.

const ACE_ENDPOINT = "https://api.acemusic.ai/v1/chat/completions";
const ACE_TIMEOUT_MS = 55000; // Vercel fonksiyon süresiyle (config.maxDuration) uyumlu

// Vercel'de fonksiyon süresi varsayılan olarak kısadır (Hobby planında ~10sn).
// ACE-Step'e istek + Blob'a yükleme için bunu artırıyoruz.
export const config = { maxDuration: 60 };

const EDGE_VOICE_MAP = {
  female: { voice: "tr-TR-EmelNeural", pitch: "-3%", rate: "-8%" },
  male: { voice: "tr-TR-AhmetNeural", pitch: "+0%", rate: "-5%" },
};

const VARSAYILAN_CAPTION =
  "melancholic and tender spoken-word poetry reading, female vocal, soft solo piano, gentle expressive delivery, intimate and clear diction";

// Türkçe okuma hızı için kaba bir tahmin (~13 karakter/sn). ACE-Step sabit
// süreli müzik ürettiği için (gerçek adaptif TTS'in aksine) buradan makul
// bir başlangıç noktası üretiyoruz; 25-240 sn aralığında sınırlandırıyoruz.
function saniyeTahminEt(metin) {
  const sn = Math.round((metin?.length || 0) / 13);
  // Üst sınır 180'e çekildi: daha uzun ses hedefleri genelde daha uzun
  // üretim süresi gerektirir, bu da ACE_MAX_WAIT_MS penceresini zorlayabilir.
  return Math.min(180, Math.max(25, sn || 25));
}

function base64SesVerisiniCoz(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return null;
  }
  const virgulIdx = dataUrl.indexOf(",");
  if (virgulIdx < 0) return null;
  const buffer = Buffer.from(dataUrl.slice(virgulIdx + 1), "base64");
  return buffer.length ? buffer : null;
}

async function aceStepIleUret({ caption, lyrics, vocalLanguage, duration }) {
  if (!process.env.ACE_MUSIC_API_KEY) {
    throw new Error(
      "ACE_MUSIC_API_KEY tanımlı değil (acemusic.ai/api-key üzerinden ücretsiz alınabilir)."
    );
  }
  const govde = {
    // "model" alanı BİLEREK gönderilmiyor — varsayılanı zaten doğru modele
    // (ACE-Step XL Turbo) işaret ediyor; yanlış/geçersiz bir ID göndermek
    // sunucu tarafında beklenmedik hatalara (504 dahil) yol açabiliyor.
    messages: [
      {
        role: "user",
        content: `<prompt>${caption}</prompt>\n<lyrics>${lyrics}</lyrics>`,
      },
    ],
    stream: false,
    thinking: true,
    audio_config: {
      duration,
      format: "mp3",
      vocal_language: vocalLanguage || "tr",
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

// Yalnızca ACE-Step tamamen başarısız olursa (key yok, kota, timeout vb.)
// devreye giren, MÜZİKSİZ, saf okuma yedeği.
async function edgeTtsIleUret({ text, title, voiceKey }) {
  const secim = EDGE_VOICE_MAP[voiceKey] || EDGE_VOICE_MAP.female;
  const spoken = (title ? `${title}. ` : "") + text;
  const trimmed = spoken.length > 4500 ? spoken.slice(0, 4500) : spoken;

  const tts = new EdgeTTS({
    voice: secim.voice,
    lang: "tr-TR",
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    pitch: secim.pitch,
    rate: secim.rate,
    volume: "default",
    timeout: 20000,
  });

  const tmpPath = path.join(os.tmpdir(), `edge-yedek-${Date.now()}.mp3`);
  try {
    await tts.ttsPromise(trimmed, tmpPath);
    const buffer = await fs.readFile(tmpPath);
    if (!buffer.length) throw new Error("Edge TTS boş ses verisi döndürdü.");
    return buffer;
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }

  try {
    const { text, title, postId, caption, vocalLanguage, gender } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanPostId = String(postId || "").trim();

    if (!cleanText || cleanText.length < 5) {
      return res.status(400).json({ error: "Geçersiz metin." });
    }
    if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
      return res.status(400).json({ error: "Geçersiz şiir ID." });
    }
    if (!process.env.BLOB_STORE_ID) {
      return res.status(500).json({ error: "BLOB_STORE_ID tanımlı değil (Blob deposu projeye bağlı mı?)." });
    }

    const finalCaption = String(caption || "").trim() || VARSAYILAN_CAPTION;
    // ACE-Step'e gönderilecek metin: başlık + şiir (aşırı uzun şiirlerde
    // model zaman aşımına uğramasın / süreye sığmasın diye üst sınır).
    const lyricsMetin = ((title ? `${title}\n` : "") + cleanText).slice(0, 2600);
    const duration = saniyeTahminEt(lyricsMetin);

    let buffer;
    let kaynak = "ace-step";
    try {
      buffer = await aceStepIleUret({
        caption: finalCaption,
        lyrics: `[Verse]\n${lyricsMetin}`,
        vocalLanguage,
        duration,
      });
    } catch (aceErr) {
      console.warn("ACE-Step seslendirme başarısız, Edge TTS'e (yedek) düşülüyor:", aceErr.message);
      kaynak = "edge-tts-yedek";
      buffer = await edgeTtsIleUret({
        text: cleanText,
        title,
        voiceKey: gender === "male" ? "male" : "female",
      });
    }

    const blob = await put(`audio/${cleanPostId}.mp3`, buffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    return res.status(200).json({ audioUrl: blob.url, kaynak });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası.", detail: String(e?.message || e).slice(0, 300) });
  }
}
