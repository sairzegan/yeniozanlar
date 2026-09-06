import { put, del } from "@vercel/blob";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs/promises";
import os from "os";
import path from "path";
// NOT: aceStepHfSpaceIleUret ARTIK en üstte statik değil, aşağıda
// (aceStepHfSpaceKatmaniniDene içinde) DİNAMİK olarak import ediliyor —
// nedeni musicGenerate.js'teki aynı notla birebir aynıdır: @gradio/client
// paketi bir sebepten yüklenemezse, üst düzey bir `import` bunu
// YAKALANAMAZ bir çökmeye (boş gövdeli "500") çevirip TÜM fonksiyonu
// (acemusic.ai VE Edge TTS denemeleri dahil) devre dışı bırakır.

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
// - ACE_MUSIC_API_KEY tanımlı değilse VEYA acemusic.ai geçici olarak
//   başarısız olursa (kota/timeout/ağ hatası), 2. YEDEK olarak Hugging
//   Face'teki RESMİ ACE-Step v1.5 Space'i (huggingface.co/spaces/ACE-Step/
//   Ace-Step-v1.5) @gradio/client ile denenir (bkz. _lib/aceStepHfSpace.js).
//   O DA başarısız olursa (Space uyuyor/ücretsiz ZeroGPU kuyruğu doluysa
//   vb.) eskisi gibi Microsoft Edge TTS'e SON YEDEK olarak düşülür —
//   böylece bir paylaşım hiçbir zaman sessiz kalmaz. Edge TTS'e düşülen
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
// ÖNEMLİ: Artık acemusic.ai başarısız olursa/zaman aşımına uğrarsa HF Space
// (bkz. ACESTEP_HF_TIMEOUT_MS) ve gerekirse Edge TTS de aynı fonksiyon
// çağrısı içinde SIRAYLA denendiği için üç aşamanın toplamı Vercel'in
// maxDuration'ını (aşağıda) AŞMAMALI. Bu yüzden acemusic.ai'ye tek başına
// tüm süreyi vermek yerine makul bir pay ayrılıyor.
const ACE_TIMEOUT_MS = 100000;
// HF Space (ACE-Step v1.5) için ayrılan pay — ücretsiz ZeroGPU kuyruğu
// nedeniyle acemusic.ai'den daha yavaş olabilir, bu yüzden biraz daha fazla
// süre tanınıyor.
const ACESTEP_HF_TIMEOUT_MS = 130000;

// Vercel'de (Fluid Compute varsayılan olarak açık) Hobby planı bile 300sn'ye
// kadar fonksiyon süresine izin veriyor; burada 280sn'ye kadar (üç deneme +
// Blob'a yükleme için pay bırakılarak) izin veriliyor. Üç deneme de
// başarısız/yavaş olursa sorun kodda değil, servislerin (acemusic.ai / HF
// ZeroGPU kuyruğu) o an gerçekten yavaş/dolu olmasındadır.
export const config = { maxDuration: 280 };

const EDGE_VOICE_MAP = {
  female: { voice: "tr-TR-EmelNeural", pitch: "-3%", rate: "-8%" },
  male: { voice: "tr-TR-AhmetNeural", pitch: "+0%", rate: "-5%" },
};

const VARSAYILAN_CAPTION =
  "melancholic and tender spoken-word poetry reading, female vocal, soft solo piano, gentle expressive delivery, intimate and clear diction";

// Türkçe, "yumuşak/duygulu, ağır tempolu" bir şiir okuması için kaba bir
// okuma hızı tahmini. ACE-Step sabit süreli müzik ürettiği için (gerçek
// adaptif TTS'in aksine) süre tahmini gerçek okuma süresinden KISA çıkarsa,
// şiir sesin sonunda YARIDA KESİLİR. Bu yüzden:
// - Karakter/sn oranı ESKİDEN 13'tü (çok hızlı bir okumaya karşılık gelir,
//   bu da şiirin çoğu zaman yarıda kesilmesine sebep oluyordu); 9'a
//   düşürüldü — daha yavaş/duygulu bir okumaya daha yakın, ve güvenlik payı
//   bırakıyor (yani sesin fazladan sürmesi, eksik kalmasından iyidir).
const OKUMA_HIZI_KARAKTER_SN = 9;
// Üretilebilecek en uzun ses (saniye). ACE-Step'in kendi üretim süresi de
// bu değerle birlikte uzadığı için (bkz. ACE_TIMEOUT_MS), makul bir tavan
// belirleniyor.
const MAKS_SURE_SN = 220;
const MIN_SURE_SN = 25;
// ÖNEMLİ: lyricsMetin'in kırpılacağı üst karakter sınırı (aşağıda
// kullanılıyor), MAKS_SURE_SN ile TUTARLI olmalı — aksi halde metin sınıra
// kadar gönderilse bile süre yetmediği için yine yarıda kesilebilir.
const MAKS_METIN_KARAKTER = MAKS_SURE_SN * OKUMA_HIZI_KARAKTER_SN;

function saniyeTahminEt(metin) {
  const sn = Math.round((metin?.length || 0) / OKUMA_HIZI_KARAKTER_SN);
  return Math.min(MAKS_SURE_SN, Math.max(MIN_SURE_SN, sn || MIN_SURE_SN));
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

// ACE-Step VE Edge TTS yedeği aynı anda başarısız olursa (çok nadir), ham
// teknik hata yerine anlaşılır bir mesaj gösteriyoruz. Teknik detay yine de
// console.error ile sunucu loglarına yazılıyor.
function kullaniciDostuHataMesaji(e) {
  const mesaj = String(e?.message || e || "");
  const gecici = /aborted|timeout|zaman a[şs][iı]m[iı]|50[234]|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(
    mesaj
  );
  if (gecici) {
    return (
      "AI seslendirme servisleri (acemusic.ai, yedek Hugging Face ACE-Step v1.5 " +
      "Space'i ve Edge TTS) şu anda geçici olarak yanıt vermiyor ya da çok " +
      'yoğun. Birkaç dakika sonra "Sesi Yeniden Oluştur" butonuna tekrar ' +
      "basmayı deneyin."
    );
  }
  return `Seslendirme oluşturulamadı: ${mesaj.slice(0, 250)}`;
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
    const tamOkunacakMetin = (title ? `${title}\n` : "") + cleanText;
    // ACE-Step'e gönderilecek metin: başlık + şiir. Üst sınır artık
    // MAKS_METIN_KARAKTER (MAKS_SURE_SN ile tutarlı) — böylece gönderilen
    // metnin tamamı, hesaplanan sürede gerçekten okunabilir; aksi halde
    // metin sınıra kadar gönderilse bile süre yetmeyip yarıda kesilirdi.
    const lyricsMetin = tamOkunacakMetin.slice(0, MAKS_METIN_KARAKTER);
    const duration = saniyeTahminEt(lyricsMetin);
    // ÖNEMLİ: Şiir MAKS_METIN_KARAKTER'i aşıyorsa, ACE-Step (acemusic.ai
    // VEYA HF Space) — sabit süreli üretim yaptığı için — şiiri HER
    // KOŞULDA bir yerde yarıda kesecektir. Bu durumda hiç denemeden
    // doğrudan Edge TTS'e geçiyoruz: arka plan müziğinden feragat edilse
    // de şiirin TAMAMI her zaman okunmuş olur (Edge TTS'in kendi sınırı
    // çok daha yüksek: 4500 karakter, ve okuma süresi metne göre otomatik
    // uzar/kısalır).
    const cokUzunSiir = tamOkunacakMetin.length > MAKS_METIN_KARAKTER;

    let buffer;
    let kaynak = "ace-step";
    if (cokUzunSiir) {
      console.warn(
        `Şiir çok uzun (${tamOkunacakMetin.length} karakter > ${MAKS_METIN_KARAKTER}), ACE-Step yarıda keseceği için doğrudan Edge TTS'e geçiliyor.`
      );
      kaynak = "edge-tts-uzun-siir";
      buffer = await edgeTtsIleUret({
        text: cleanText,
        title,
        voiceKey: gender === "male" ? "male" : "female",
      });
    } else {
    try {
      buffer = await aceStepIleUret({
        caption: finalCaption,
        lyrics: `[Verse]\n${lyricsMetin}`,
        vocalLanguage,
        duration,
      });
    } catch (aceErr) {
      console.warn("acemusic.ai seslendirme başarısız, HF Space (ACE-Step v1.5) deneniyor:", aceErr.message);
      try {
        buffer = await aceStepHfSpaceKatmaniniDene({
          caption: finalCaption,
          lyrics: `[Verse]\n${lyricsMetin}`,
          durationSaniye: duration,
          vocalLanguage,
          instrumental: false,
          timeoutMs: ACESTEP_HF_TIMEOUT_MS,
        });
        kaynak = "ace-step-hf-space";
      } catch (hfErr) {
        console.warn("HF Space (ACE-Step v1.5) de başarısız, Edge TTS'e (son yedek) düşülüyor:", hfErr.message);
        kaynak = "edge-tts-yedek";
        buffer = await edgeTtsIleUret({
          text: cleanText,
          title,
          voiceKey: gender === "male" ? "male" : "female",
        });
      }
    }
    } // else (cokUzunSiir değilse ACE-Step denemesi) bloğunun kapanışı

    // Yeni sesi yüklemeden ÖNCE, aynı şiire ait ESKİ ses dosyasını Blob'dan
    // açıkça siliyoruz. "allowOverwrite: true" zaten aynı isimdeki dosyanın
    // İÇERİĞİNİ değiştirir (ayrı bir "eski dosya" birikmez), ama kullanıcı
    // hiçbir eski verinin Blob'da kalmadığından emin olmak istediği ve bu
    // silme CDN'in en güncel içeriği vermesini de garantiye aldığı için
    // burada ekstra bir adım olarak bunu yapıyoruz. Dosya zaten yoksa
    // (ilk üretimse) del() sessizce görmezden gelinir, hata fırlatmaz.
    await del(`audio/${cleanPostId}.mp3`).catch(() => {});

    const blob = await put(`audio/${cleanPostId}.mp3`, buffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    // ÖNEMLİ: Dosya adı (audio/${postId}.mp3) her üretimde AYNI kaldığı için
    // (allowOverwrite:true) ve cacheControlMaxAge 1 yıl olduğu için, aynı URL
    // tarayıcı/CDN tarafından uzun süre önbelleğe alınır. Blob'u silseniz
    // bile önbellek eski sesi döndürmeye devam edebilir. Bunu önlemek için
    // URL'nin sonuna HER üretimde değişen bir sürüm parametresi ekliyoruz —
    // böylece her yeni üretim, önbellek için "farklı" bir URL olur.
    const versiyonluUrl = `${blob.url}?v=${Date.now()}`;

    return res.status(200).json({ audioUrl: versiyonluUrl, kaynak });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: kullaniciDostuHataMesaji(e), detail: String(e?.message || e).slice(0, 300) });
  }
}
