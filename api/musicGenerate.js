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

// ═══════════════════════════════════════════════════════════════════════
// DÜZELTME GEÇMİŞİ:
// v1: router.huggingface.co (Inference Providers) üzerinden musicgen-small
//     -> ÇALIŞMADI, HF bu modeli Inference Providers'tan tamamen kaldırmış.
// v2: "@gradio/client" npm paketiyle facebook/MusicGen Space'ini çağırdı
//     -> ÇALIŞMADI (HTTP 500, hiçbir hata mesajı bile dönmedi). Bu paket
//        WebSocket/EventSource gibi tarayıcıya özgü API'lere dayanıyor ve
//        Vercel'in serverless Node ortamında import anında/çalışırken
//        çöküyor olabilir — try/catch'e bile girmeden fonksiyon patlıyor.
// v3 (BU SÜRÜM): Hiçbir ekstra npm paketi KULLANMIYOR. Gradio'nun resmi,
//     dokümante "düz HTTP/curl" API desenini native fetch ile uyguluyor:
//       1) POST {SPACE}/gradio_api/call/predict  {"data":[prompt, null]}
//          -> {"event_id": "..."}
//       2) GET  {SPACE}/gradio_api/call/predict/{event_id}
//          -> "event: complete\ndata: [ {...ses dosyası...} ]" (SSE metni)
//     Eski Gradio sürümleri "/gradio_api/call/..." yerine "/call/..." kullanıyor
//     olabileceğinden iki yol da sırayla denenir.
// Bu YİNE de resmi/garantili bir API değildir (bkz. önceki not: paylaşımlı
// ücretsiz GPU kotası, kuyruk, HF'nin haber vermeden değiştirme ihtimali).
// Ama artık üçüncü parti bir pakete bağımlı olmadığı için "sessizce çökme"
// riski ortadan kalkıyor — her hata artık JSON olarak {error:"..."} dönecek.
// ═══════════════════════════════════════════════════════════════════════

const SPACE_BASE = "https://facebook-musicgen.hf.space";
const TIMEOUT_MS = 55000;
const API_YOLLARI = ["/gradio_api/call/predict", "/call/predict"];

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

// SSE metnini ("event: ...\ndata: ...\n\n" blokları) ayrıştırıp son "data:" satırını döner.
function sseSonVeriyiAyikla(metin) {
  const satirlar = metin.split("\n");
  let sonVeri = null;
  let hataOldu = false;
  let sonEventTipi = "";
  for (const satir of satirlar) {
    if (satir.startsWith("event:")) sonEventTipi = satir.slice(6).trim();
    if (satir.startsWith("data:")) {
      const icerik = satir.slice(5).trim();
      if (sonEventTipi === "error") { hataOldu = true; sonVeri = icerik; }
      else sonVeri = icerik;
    }
  }
  return { veri: sonVeri, hataOldu };
}

async function musicGenCagir(prompt, hfToken, signal) {
  const gövde = JSON.stringify({ data: [prompt, null] });
  const baslikGrubu = { "Content-Type": "application/json" };
  if (hfToken) baslikGrubu["Authorization"] = `Bearer ${hfToken}`;

  let sonHata = null;
  for (const yol of API_YOLLARI) {
    try {
      const postYaniti = await fetch(SPACE_BASE + yol, { method: "POST", headers: baslikGrubu, body: gövde, signal });
      if (!postYaniti.ok) { sonHata = new Error(`(${yol}) POST HTTP ${postYaniti.status}`); continue; }
      const postVeri = await postYaniti.json().catch(() => null);
      const eventId = postVeri?.event_id;
      if (!eventId) { sonHata = new Error(`(${yol}) event_id dönmedi.`); continue; }

      const getYaniti = await fetch(`${SPACE_BASE}${yol}/${eventId}`, {
        headers: { Accept: "text/event-stream", ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}) },
        signal
      });
      if (!getYaniti.ok) { sonHata = new Error(`(${yol}) sonuç HTTP ${getYaniti.status}`); continue; }
      const metin = await getYaniti.text();
      const { veri, hataOldu } = sseSonVeriyiAyikla(metin);
      if (!veri) { sonHata = new Error(`(${yol}) SSE yanıtında veri bulunamadı.`); continue; }
      if (hataOldu) { sonHata = new Error(`(${yol}) MusicGen demo'su hata döndürdü: ${veri.slice(0, 200)}`); continue; }

      const dizi = JSON.parse(veri);
      return dizi;
    } catch (e) {
      sonHata = e;
    }
  }
  throw sonHata || new Error("MusicGen demo'suna hiçbir yoldan ulaşılamadı.");
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
  const hfToken = String(process.env.HUGGINGFACE_API_TOKEN || "").trim() || undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const dizi = await musicGenCagir(prompt, hfToken, controller.signal);
    clearTimeout(timer);

    const cikti = Array.isArray(dizi) ? dizi[0] : null;
    const kaynakYolu = cikti?.url || cikti?.path || (typeof cikti === "string" ? cikti : null);
    if (!kaynakYolu) {
      throw new Error("MusicGen demo'sundan geçerli bir ses dosyası alınamadı (boş/beklenmeyen çıktı).");
    }
    const tamUrl = kaynakYolu.startsWith("http") ? kaynakYolu : `${SPACE_BASE}/gradio_api/file=${kaynakYolu}`;

    const sesYaniti = await fetch(tamUrl, hfToken ? { headers: { Authorization: `Bearer ${hfToken}` } } : undefined);
    if (!sesYaniti.ok) throw new Error(`Üretilen ses dosyası indirilemedi (HTTP ${sesYaniti.status}).`);
    const buffer = Buffer.from(await sesYaniti.arrayBuffer());
    if (!buffer.length) throw new Error("Üretilen ses dosyası boş.");

    const contentType = (sesYaniti.headers.get("content-type") || "audio/wav").split(";")[0];
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
    clearTimeout(timer);
    const msg =
      e?.name === "AbortError"
        ? "Müzik demo'su (facebook/MusicGen) meşgul/kuyrukta — zaman aşımına uğradı. Birkaç dakika sonra tekrar deneyin."
        : `Hugging Face MusicGen demo'su şu an kullanılamıyor: ${String(e?.message || e).slice(0, 250)}`;
    console.error("musicGenerate HATASI:", e);
    return res.status(502).json({ error: msg });
  }
}
