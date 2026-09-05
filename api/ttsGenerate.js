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
// NOT (v2 → v3 değişikliği): İlk sürümde ACE-Step'in SENKRON "completion"
// modu (/v1/chat/completions) kullanılıyordu; ancak uzun üretimlerde
// acemusic.ai'nin kendi ağ geçidi (gateway) cevabı beklerken zaman aşımına
// uğrayıp HTTP 504 döndürüyordu. Bu yüzden ASENKRON "native" moda geçildi:
// önce /release_task ile bir görev oluşturulur, sonra /query_result ile kısa
// aralıklarla (polling) sonucu sorulur. Her tekil istek kısa sürdüğü için
// gateway zaman aşımı sorunu ortadan kalkar.

const ACE_BASE = "https://api.acemusic.ai";
const ACE_TIMEOUT_MS = 20000; // tekil (görev oluşturma / sorgulama) istek zaman aşımı
const ACE_POLL_INTERVAL_MS = 3000;
const ACE_MAX_WAIT_MS = 50000; // Vercel fonksiyon süresine göre ayarlı, aşağıdaki config.maxDuration ile uyumlu olmalı

// Vercel'de fonksiyon süresi varsayılan olarak kısadır (Hobby planında ~10sn).
// Polling'in tamamlanabilmesi için bunu artırıyoruz. Hobby planı 60sn'yi
// desteklediği için burada güvenli bir üst sınır seçildi; Pro/Enterprise
// planındaysanız bu değeri (ve yukarıdaki ACE_MAX_WAIT_MS'i) 120-300 sn'ye
// çıkarabilirsiniz — daha uzun/karmaşık üretimler daha güvenilir tamamlanır.
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

function aceHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.ACE_MUSIC_API_KEY}`,
  };
}

// 1) Görevi kuyruğa alır, task_id döner.
async function aceGorevOlustur(paramObj) {
  const res = await fetch(`${ACE_BASE}/release_task`, {
    method: "POST",
    headers: aceHeaders(),
    // Hem düz alanlar hem de param_obj içinde gönderiyoruz; sunucu hangi
    // adlandırmayı bekliyorsa onu yakalasın diye (API dokümantasyonu tam
    // netleşmediği için savunmacı bir yaklaşım).
    body: JSON.stringify({ ...paramObj, param_obj: paramObj }),
    signal: AbortSignal.timeout(ACE_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(`ACE-Step görev oluşturulamadı (HTTP ${res.status})${data?.error ? ": " + data.error : ""}`);
  }
  const taskId = data?.data?.task_id || data?.task_id || data?.data?.taskId;
  if (!taskId) throw new Error("ACE-Step task_id döndürmedi.");
  return taskId;
}

// 2) Sonucu tamamlanana kadar kısa aralıklarla sorar (status: 0=işleniyor, 1=başarılı, 2=başarısız).
async function aceSonucuBekle(taskId) {
  const baslangic = Date.now();
  while (Date.now() - baslangic < ACE_MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, ACE_POLL_INTERVAL_MS));
    const res = await fetch(`${ACE_BASE}/query_result`, {
      method: "POST",
      headers: aceHeaders(),
      body: JSON.stringify({ task_id_list: [taskId] }),
      signal: AbortSignal.timeout(ACE_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    const item = data?.data?.[0];
    if (!item) continue;
    if (item.status === 1 || item.status === "succeeded") {
      let sonuclar;
      try {
        sonuclar = typeof item.result === "string" ? JSON.parse(item.result) : item.result;
      } catch (e) {
        throw new Error("ACE-Step sonucu ayrıştırılamadı.");
      }
      const ilk = Array.isArray(sonuclar) ? sonuclar[0] : sonuclar;
      const dosyaYolu = ilk?.file || ilk?.first_audio_path || ilk?.audio_paths?.[0];
      if (!dosyaYolu) throw new Error("ACE-Step ses dosya yolu döndürmedi.");
      return dosyaYolu;
    }
    if (item.status === 2 || item.status === "failed") {
      throw new Error("ACE-Step üretimi başarısız: " + (item.error || item.message || "bilinmeyen hata"));
    }
    // status 0 (queued/running) → beklemeye devam
  }
  throw new Error("ACE-Step zaman aşımına uğradı (üretim bekleneni aşan sürede tamamlanamadı).");
}

// 3) Tamamlanan üretimin ses dosyasını indirir.
async function aceDosyaIndir(dosyaYolu) {
  const url = dosyaYolu.startsWith("http") ? dosyaYolu : `${ACE_BASE}${dosyaYolu}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ACE_MUSIC_API_KEY}` },
    signal: AbortSignal.timeout(ACE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ACE-Step ses dosyası indirilemedi (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("ACE-Step boş ses dosyası döndürdü.");
  return buffer;
}

async function aceStepIleUret({ caption, lyrics, vocalLanguage, duration }) {
  if (!process.env.ACE_MUSIC_API_KEY) {
    throw new Error(
      "ACE_MUSIC_API_KEY tanımlı değil (acemusic.ai/playground/api-key üzerinden ücretsiz alınabilir)."
    );
  }
  const taskId = await aceGorevOlustur({
    prompt: caption,
    lyrics,
    thinking: true,
    audio_duration: duration,
    duration,
    vocal_language: vocalLanguage || "tr",
    audio_format: "mp3",
  });
  const dosyaYolu = await aceSonucuBekle(taskId);
  return await aceDosyaIndir(dosyaYolu);
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
