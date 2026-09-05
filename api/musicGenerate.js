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
// NOT (v6 → v7 değişikliği): İlk sürümde ACE-Step'in SENKRON "completion"
// modu (/v1/chat/completions) kullanılıyordu; ancak acemusic.ai'nin kendi ağ
// geçidi (gateway) uzun üretimlerde cevabı beklerken zaman aşımına uğrayıp
// HTTP 504 döndürüyordu. Bu yüzden ASENKRON "native" moda geçildi: önce
// /release_task ile bir görev oluşturulur, sonra /query_result ile kısa
// aralıklarla (polling) sonuç sorulur — her tekil istek kısa sürdüğü için
// gateway zaman aşımı sorunu ortadan kalkar.

const ACE_BASE = "https://api.acemusic.ai";
const ACE_TIMEOUT_MS = 20000; // tekil istek zaman aşımı
const ACE_POLL_INTERVAL_MS = 3000;
const ACE_MAX_WAIT_MS = 50000; // aşağıdaki config.maxDuration ile uyumlu olmalı
const VARSAYILAN_PROMPT =
  "calm ambient ballad, soft piano and warm strings, reflective and gentle atmosphere";
const MUZIK_SURESI_SN = 45; // 50sn'lik bekleme penceresine daha güvenli sığması için kısaltıldı

// Vercel'de fonksiyon süresi varsayılan olarak kısadır. Polling'in
// tamamlanabilmesi için artırıyoruz. Pro/Enterprise planındaysanız bu değeri
// (ve yukarıdaki ACE_MAX_WAIT_MS'i) 120-300 sn'ye çıkarabilirsiniz.
export const config = { maxDuration: 60 };

function aceHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.ACE_MUSIC_API_KEY}`,
  };
}

async function aceGorevOlustur(paramObj) {
  const res = await fetch(`${ACE_BASE}/release_task`, {
    method: "POST",
    headers: aceHeaders(),
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
  }
  throw new Error("ACE-Step zaman aşımına uğradı (üretim bekleneni aşan sürede tamamlanamadı).");
}

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

async function aceStepIleMuzikUret(musicPrompt) {
  if (!process.env.ACE_MUSIC_API_KEY) {
    throw new Error(
      "ACE_MUSIC_API_KEY tanımlı değil (acemusic.ai/playground/api-key üzerinden ücretsiz alınabilir)."
    );
  }
  const caption = String(musicPrompt || "").trim() || VARSAYILAN_PROMPT;
  const taskId = await aceGorevOlustur({
    prompt: caption,
    lyrics: "[inst]",
    thinking: true,
    audio_duration: MUZIK_SURESI_SN,
    duration: MUZIK_SURESI_SN,
    audio_format: "mp3",
  });
  const dosyaYolu = await aceSonucuBekle(taskId);
  return await aceDosyaIndir(dosyaYolu);
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
