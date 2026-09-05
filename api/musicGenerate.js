import { put } from "@vercel/blob";
// NOT: aceStepHfSpaceIleUret ARTIK en üstte statik olarak değil, aşağıda
// (aceStepHfSpaceKatmaniniDene içinde) DİNAMİK olarak import ediliyor.
// Sebep: @gradio/client paketi bir nedenle (eksik kurulum, Vercel'in Node
// çalışma zamanıyla uyumsuzluk, bir alt bağımlılığın tarayıcıya özel bir
// API'ye — ör. WebSocket/EventSource — ihtiyaç duyması vb.) YÜKLENEMEZSE,
// üst düzey bir `import` bunu YAKALANAMAZ bir çökmeye çevirir ve TÜM
// fonksiyonu (acemusic.ai denemesi dahil) devre dışı bırakır — tam olarak
// yaşanan "boş gövdeli 500" budur. Dinamik import ise try/catch içinde
// yakalanabildiği için, bu paket yüklenemese BİLE sadece bu yedek katman
// devre dışı kalır, acemusic.ai denemesi ve fonksiyonun geri kalanı normal
// çalışmaya devam eder.

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
//
// NOT (v8): acemusic.ai başarısız/zaman aşımına uğrarsa artık 2. bir yedek
// devreye giriyor: Hugging Face'teki RESMİ ACE-Step v1.5 Space'i
// (huggingface.co/spaces/ACE-Step/Ace-Step-v1.5), @gradio/client ile
// programatik olarak denenir (bkz. _lib/aceStepHfSpace.js). Bu Space'in
// dokümante edilmiş bir REST API'si olmadığından (bkz. o dosyadaki notlar)
// bu katman acemusic.ai kadar güvenilir değildir; sadece ek bir şanstır.
// İkisi de başarısız olursa (musicGenerate.js'te Edge TTS gibi müziksiz bir
// son çare olmadığından) istek 502 ile başarısız döner.

const ACE_ENDPOINT = "https://api.acemusic.ai/v1/chat/completions";
// ÖNEMLİ: acemusic.ai başarısız olursa HF Space aynı fonksiyon çağrısı
// içinde SIRAYLA denendiği için iki aşamanın toplamı Vercel'in
// maxDuration'ını (aşağıda) AŞMAMALI — bu yüzden tüm süre acemusic.ai'ye
// ayrılmıyor.
const ACE_TIMEOUT_MS = 100000;
// HF Space (ACE-Step v1.5) için ayrılan pay — ücretsiz ZeroGPU kuyruğu
// nedeniyle acemusic.ai'den daha yavaş olabilir.
const ACESTEP_HF_TIMEOUT_MS = 150000;
const VARSAYILAN_PROMPT =
  "calm ambient ballad, soft piano and warm strings, reflective and gentle atmosphere";
const MUZIK_SURESI_SN = 45;

// Vercel'de (Fluid Compute varsayılan olarak açık) Hobby planı bile 300sn'ye
// kadar fonksiyon süresine izin veriyor; burada 280sn'ye kadar (iki deneme +
// Blob'a yükleme için pay bırakılarak) izin veriliyor.
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
      "AI müzik servisleri (acemusic.ai ve yedek olarak denenen Hugging Face " +
      "ACE-Step v1.5 Space'i) şu anda geçici olarak yanıt vermiyor ya da çok " +
      'yoğun. Bu genelde kısa süreli bir durumdur — birkaç dakika sonra "Yapay ' +
      'Zeka ile Müzik Oluştur" butonuna tekrar basmayı deneyin.'
    );
  }
  return `Müzik oluşturulamadı: ${mesaj.slice(0, 250)}`;
}

// HF Space yedek katmanını GÜVENLİ şekilde dener: modülün import edilmesi
// bile (ör. @gradio/client kurulu değilse/yüklenemiyorsa) başarısız olabilir;
// bu durumu da normal bir üretim hatası gibi ele alıp anlaşılır bir hata
// fırlatıyoruz — üst düzey bir çökmeye asla izin vermiyoruz.
async function aceStepHfSpaceKatmaniniDene(params) {
  let aceStepHfSpaceIleUret;
  try {
    ({ aceStepHfSpaceIleUret } = await import("./_lib/aceStepHfSpace.js"));
  } catch (yuklemeHatasi) {
    throw new Error(
      `HF Space yedek modülü yüklenemedi (@gradio/client paketi kurulu/uyumlu mu kontrol edin): ${yuklemeHatasi.message}`
    );
  }
  return aceStepHfSpaceIleUret(params);
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

  let buffer;
  let kaynak = "ace-step";
  try {
    buffer = await aceStepIleMuzikUret(musicPrompt);
  } catch (aceErr) {
    console.warn("acemusic.ai müzik üretimi başarısız, HF Space (ACE-Step v1.5) deneniyor:", aceErr.message);
    try {
      buffer = await aceStepHfSpaceKatmaniniDene({
        caption: String(musicPrompt || "").trim() || VARSAYILAN_PROMPT,
        lyrics: "",
        durationSaniye: MUZIK_SURESI_SN,
        instrumental: true,
        timeoutMs: ACESTEP_HF_TIMEOUT_MS,
      });
      kaynak = "ace-step-hf-space";
    } catch (hfErr) {
      console.error("musicGenerate HATASI (acemusic.ai + HF Space ikisi de başarısız):", hfErr);
      return res.status(502).json({ error: kullaniciDostuHataMesaji(hfErr) });
    }
  }

  try {
    // NOT: dosya adı ttsGenerate.js'nin ürettiği `audio/${postId}.mp3` (seslendirme)
    // ile ÇAKIŞMASIN diye "-music" son eki kullanılıyor.
    const blob = await put(`audio/${cleanPostId}-music.mp3`, buffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    return res.status(200).json({ musicUrl: blob.url, prompt: musicPrompt || "", kaynak });
  } catch (e) {
    console.error("musicGenerate HATASI (Blob yükleme):", e);
    return res.status(502).json({ error: kullaniciDostuHataMesaji(e) });
  }
}
