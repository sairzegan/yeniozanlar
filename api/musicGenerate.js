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
import { InferenceClient } from "@huggingface/inference";

const MODEL = "facebook/musicgen-small";
const TIMEOUT_MS = 55000;
// ~50 audio token/saniye üretir; 500 token ≈ 10 saniyelik bir tema.
// Ücretsiz/serverless CPU zaman aşımına takılmamak için kısa tutuluyor.
const MAX_NEW_TOKENS = 500;

function buildPrompt(customPrompt, title) {
  const custom = String(customPrompt || "").trim();
  if (custom) return custom.slice(0, 400);
  // Groq prompt üretemezse (veya çağrılmadıysa) kullanılacak genel yedek.
  const heading = String(title || "").trim().slice(0, 120);
  return [
    "Instrumental cinematic theme music, no vocals, no singing, no lyrics, no words.",
    "Emotional, atmospheric, slow tempo, soft piano and strings, melancholic mood, fits a Turkish poem.",
    heading ? `Poem title (for mood reference only): ${heading}` : ""
  ].filter(Boolean).join(" ");
}

export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }

  const token = String(process.env.HUGGINGFACE_API_TOKEN || "").trim();
  if (!token) {
    return res.status(500).json({
      error: "HUGGINGFACE_API_TOKEN Vercel Environment Variables içinde bulunamadı."
    });
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = new InferenceClient(token);

    // provider: "hf-inference" — MusicGen'i sunan tek genel/ücretsiz
    // sağlayıcı budur (görsellerdeki gibi fal-ai/replicate zinciri yok).
    const blob = await client.textToSpeech(
      {
        model: MODEL,
        inputs: prompt,
        provider: "hf-inference",
        parameters: { max_new_tokens: MAX_NEW_TOKENS }
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    if (!blob || typeof blob.arrayBuffer !== "function") {
      return res.status(502).json({ error: "Hugging Face (MusicGen) beklenmeyen bir cevap döndürdü." });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    if (!buffer.length) {
      return res.status(502).json({ error: "Hugging Face (MusicGen) boş ses verisi döndürdü." });
    }

    // MusicGen çıktısı genelde WAV'dır; sağlayıcı başka bir audio/* tipi
    // dönerse (ör. mpeg) onu kullan, aksi halde wav varsay.
    const contentType = blob.type && blob.type.startsWith("audio/") ? blob.type : "audio/wav";
    const ext = contentType.includes("wav") ? "wav" : (contentType.includes("mpeg") ? "mp3" : "wav");

    const uploaded = await put(`music/${cleanPostId}.${ext}`, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000
    });

    return res.status(200).json({ musicUrl: uploaded.url, prompt });
  } catch (e) {
    clearTimeout(timer);
    const msg =
      e?.name === "AbortError"
        ? "Müzik isteği zaman aşımına uğradı (model 'ısınıyor' olabilir, birazdan tekrar deneyin)."
        : String(e?.message || e).slice(0, 300);
    console.error("musicGenerate HATASI:", e);
    return res.status(502).json({ error: msg });
  }
}
