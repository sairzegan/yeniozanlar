// /api/musicGenerate.js
// Hugging Face "Inference Providers" (hf-inference) üzerinden Meta'nın
// MusicGen (facebook/musicgen-small) modeliyle ÜCRETSİZ enstrümantal müzik
// üretir ve Vercel Blob'a yükler. ttsGenerate.js ile AYNI sözleşmeyi izler:
// {audioUrl-benzeri bir alan} döndürür, burada alan adı "musicUrl".
//
// ÖNEMLİ SINIRLAMA (kullanıcıya da anlatılmalı): MusicGen SÖZLÜ ŞARKI/VOKAL
// ÜRETEMEZ — yalnızca enstrümantal (sözsüz) müzik üretir. Türkçe sözlü,
// gerçekten "söylenen" bir şarkı üreten, API-anahtarı gerektirmeyen/ücretsiz
// ve resmi bir servis şu an mevcut değil (Suno/Udio gibi servisler ücretli
// ve resmi genel API sunmuyor). Bu yüzden burada üretilen şey, şiirin
// duygusuna uygun sözsüz bir arka plan/tema müziğidir.
//
// Vercel Environment Variable (huggingface-image.js ile PAYLAŞILIR):
// HUGGINGFACE_API_TOKEN = hf_...
//
// Vercel Environment (package.json) bağımlılığı (huggingface-image.js ile
// PAYLAŞILIR, ayrıca kurulum gerekmez):
// "@huggingface/inference"
//
// NOT: MusicGen "hf-inference" sağlayıcısında CPU üzerinde çalışıyor, bu
// yüzden görsel/TTS üretimine göre daha YAVAŞ olabilir ve ilk istekte model
// "soğuk" ise (henüz belleğe yüklenmemişse) 500/503 hatası dönebilir — bu
// durumda birkaç saniye sonra tekrar denemek genelde çalışır.

import { put } from "@vercel/blob";
import { Client } from "@gradio/client";

// ═══════════════════════════════════════════════════════════════════════
// ÖNEMLİ / DÜZELTME GEÇMİŞİ:
// İlk sürüm, Hugging Face "Inference Providers" (router.huggingface.co)
// üzerinden facebook/musicgen-small'ı çağırıyordu. Bu, ŞU AN çalışmıyor —
// Hugging Face, MusicGen'i (ve genel olarak text-to-music modellerini)
// Inference Providers ağından tamamen KALDIRDI. Model sayfasında artık
// "This model isn't deployed by any Inference Provider" yazıyor. Bu bir
// prompt/parametre hatası DEĞİL, kaldırılmış bir özellik.
//
// ÇÖZÜM (en iyi çaba / best-effort): Hugging Face'in kendi herkese açık
// demo sayfasını (huggingface.co/spaces/facebook/MusicGen) bir "Gradio
// API"si gibi çağırıyoruz. Bu resmi/dokümante edilmiş, garantili bir API
// DEĞİLDİR — paylaşımlı ücretsiz GPU (ZeroGPU) kotasına dayanır:
//   • Yoğun saatlerde kuyrukta bekleyebilir veya zaman aşımına uğrayabilir.
//   • Hugging Face bu demo sayfasını haber vermeden değiştirebilir/kaldırabilir.
//   • Sadece ~15 saniyelik, ENSTRÜMANTAL (sözsüz) bir klip üretir.
// Buna karşılık tamamen ücretsizdir ve zaten var olan HUGGINGFACE_API_TOKEN
// ile (varsa) daha öncelikli kotadan çalışır; token yoksa anonim/misafir
// kotasıyla dener.
//
// Vercel Environment (package.json) bağımlılığı — YENİ, eklenmesi gerekiyor:
// "@gradio/client"
// ═══════════════════════════════════════════════════════════════════════

const SPACE = "facebook/MusicGen";
const TIMEOUT_MS = 55000;

function buildPrompt(customPrompt, title) {
  const custom = String(customPrompt || "").trim();
  if (custom) return custom.slice(0, 300);
  const heading = String(title || "").trim().slice(0, 120);
  return [
    "Instrumental cinematic theme music, no vocals, no singing, no lyrics, no words.",
    "Emotional, atmospheric, slow tempo, soft piano and strings, melancholic mood, fits a Turkish poem.",
    heading ? `Poem title (for mood reference only): ${heading}` : ""
  ].filter(Boolean).join(" ");
}

function zamanAsimi(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms));
}

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }
  if (!process.env.BLOB_STORE_ID) {
    return res.status(500).json({ error: "BLOB_STORE_ID tanımlı değil (Blob deposu projeye bağlı mı?)." });
  }

  const { title, postId, musicPrompt } = req.body || {};
  const cleanPostId = String(postId || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
    return res.status(400).json({ error: "Geçersiz şiir ID." });
  }

  const prompt = buildPrompt(musicPrompt, title);
  // HF token varsa (huggingface-image.js ile paylaşılan) öncelikli kota için kullanılır.
  const hfToken = String(process.env.HUGGINGFACE_API_TOKEN || "").trim() || undefined;

  try {
    const client = await Promise.race([
      Client.connect(SPACE, hfToken ? { hf_token: hfToken } : {}),
      zamanAsimi(TIMEOUT_MS)
    ]);

    // Arayüz: [1] "Describe your music" (metin), [2] "Condition on a melody" (ses, opsiyonel).
    const result = await Promise.race([
      client.predict("/predict", [prompt, null]),
      zamanAsimi(TIMEOUT_MS)
    ]);

    const cikti = Array.isArray(result?.data) ? result.data[0] : null;
    const kaynakUrl = cikti?.url || cikti?.path || (typeof cikti === "string" ? cikti : null);
    if (!kaynakUrl) {
      throw new Error("MusicGen demo'sundan geçerli bir ses dosyası alınamadı (boş/beklenmeyen çıktı).");
    }

    const kaynakYaniti = await fetch(kaynakUrl.startsWith("http") ? kaynakUrl : `https://facebook-musicgen.hf.space/file=${kaynakUrl}`);
    if (!kaynakYaniti.ok) throw new Error(`Üretilen ses dosyası indirilemedi (HTTP ${kaynakYaniti.status}).`);
    const buffer = Buffer.from(await kaynakYaniti.arrayBuffer());
    if (!buffer.length) throw new Error("Üretilen ses dosyası boş.");

    const contentType = (kaynakYaniti.headers.get("content-type") || "audio/wav").split(";")[0];
    const ext = contentType.includes("wav") ? "wav" : (contentType.includes("mpeg") ? "mp3" : "wav");

    const uploaded = await put(`music/${cleanPostId}.${ext}`, buffer, {
      access: "public",
      contentType: contentType.startsWith("audio/") ? contentType : "audio/wav",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000
    });

    return res.status(200).json({ musicUrl: uploaded.url, prompt });
  } catch (e) {
    const msg =
      e?.message === "TIMEOUT"
        ? "Müzik demo'su (facebook/MusicGen) meşgul/kuyrukta — zaman aşımına uğradı. Birkaç dakika sonra tekrar deneyin."
        : `Hugging Face MusicGen demo'su şu an kullanılamıyor: ${String(e?.message || e).slice(0, 250)}`;
    console.error("musicGenerate HATASI:", e);
    return res.status(502).json({ error: msg });
  }
}
