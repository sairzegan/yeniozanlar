import { Client } from "@gradio/client";

// api/_lib/aceStepHfSpace.js
//
// acemusic.ai (birincil ACE-Step API'si) başarısız olursa devreye giren
// 2. YEDEK katman: Hugging Face'teki RESMİ ACE-Step v1.5 Space'i
// (huggingface.co/spaces/ACE-Step/Ace-Step-v1.5) — yani modelin kendi
// ücretsiz Gradio demosu — programatik olarak (@gradio/client ile) denenir.
//
// ⚠️ ÖNEMLİ SINIRLAMALAR (lütfen okuyun):
// 1) Bu Space'in resmi/dokümante edilmiş bir REST API'si YOKTUR. Space'in
//    kendi deposundaki docs/en/API.md dosyası (/v1/music/generate vb.),
//    SADECE bu projeyi KENDİ sunucunuzda `uv run acestep-api` ile
//    çalıştırdığınızda geçerlidir — herkese açık HF Space'e uygulanmaz.
//    Herkese açık Space, sadece bir Gradio ARAYÜZÜDÜR; ona ancak
//    @gradio/client ile, tarayıcının yaptığı gibi "sanki bir buton tıklanmış
//    gibi" erişilebilir.
// 2) Space'in iç fonksiyon adı (api_name) ve parametre isimleri resmi olarak
//    sabit/garanti değildir; yazar arayüzü güncelledikçe değişebilir. Bu
//    yüzden burada ÖNCE client.view_api() ile Space'in O ANKİ arayüzü
//    keşfedilir, SONRA "açıklama/söz/süre" gibi alanları olan en uygun uç
//    nokta bir HEURİSTİKLE seçilir. Otomatik seçim yanlış çıkarsa,
//    ACESTEP_HF_API_NAME ortam değişkeniyle doğru uç nokta adı ELLE
//    sabitlenebilir (Space sayfasındaki "Use via API" bağlantısından tam adı
//    görebilirsiniz, örn. "/generate_music").
// 3) Bu Space ÜCRETSİZ PAYLAŞILAN ZeroGPU kuyruğunda çalışır: yoğun
//    saatlerde uzun süre kuyrukta bekleyebilir, GPU alamayabilir veya
//    modelin ilk kez yüklenmesi (soğuk başlangıç) uzun sürebilir. Bu yüzden
//    acemusic.ai kadar güvenilir DEĞİLDİR — sadece ek bir şans olarak
//    kullanılmalıdır.
// 4) İsteğe bağlı: HF_TOKEN ortam değişkeni tanımlarsanız (huggingface.co
//    hesabınızdan alınan bir "access token"), istekler o hesap üzerinden
//    gider; bu genelde anonim erişime göre ZeroGPU kuyruğunda biraz daha
//    iyi/istikrarlı bir öncelik sağlar (garanti değildir).

const HF_SPACE = process.env.ACESTEP_HF_SPACE || "ACE-Step/Ace-Step-v1.5";
const FORCED_API_NAME = process.env.ACESTEP_HF_API_NAME || null;
const HF_TOKEN = process.env.HF_TOKEN || undefined;

// Bağlantıyı (view_api dahil) fonksiyon çağrıları arasında önbelleğe alıyoruz
// ki her istekte Space'e yeniden bağlanıp yeniden keşif yapmayalım. Bir
// bağlanma hatası olursa önbellek temizlenir ki bir sonraki istek yeniden
// denesin (Space o an "sleeping"/yeniden başlıyor olabilir).
let clientPromiseCache = null;
function baglantiAl() {
  if (!clientPromiseCache) {
    clientPromiseCache = Client.connect(
      HF_SPACE,
      HF_TOKEN ? { hf_token: HF_TOKEN } : {}
    ).catch((err) => {
      clientPromiseCache = null;
      throw err;
    });
  }
  return clientPromiseCache;
}

// Bir metni tek satırda küçük harfe indirger (eşleştirme için).
function normalize(...parcalar) {
  return parcalar.filter(Boolean).join(" ").toLowerCase();
}

// view_api() çıktısından, "metin açıklaması ver → müzik/ses üret" işini
// yapan en olası uç noktayı puanlayarak seçer.
function enUygunUcNoktayiSec(apiInfo) {
  const named = apiInfo?.named_endpoints || {};
  const adaylar = [];
  for (const [apiName, info] of Object.entries(named)) {
    const params = info?.parameters || [];
    const donenler = info?.returns || [];
    const paramMetni = normalize(
      apiName,
      ...params.map((p) => normalize(p?.label, p?.parameter_name, p?.python_type?.type))
    );
    const donenMetni = normalize(
      ...donenler.map((r) => normalize(r?.label, r?.component, r?.python_type?.type))
    );

    let puan = 0;
    if (/caption|description|desc|prompt|tag/.test(paramMetni)) puan += 3;
    if (/lyric|söz|sarki[_ ]?soz/.test(paramMetni)) puan += 2;
    if (/duration|süre|sure/.test(paramMetni)) puan += 1;
    if (/generat|text2music|simple|music/.test(apiName.toLowerCase())) puan += 2;
    if (/audio|ses/.test(donenMetni)) puan += 2;
    // Eğitim/ön yükleme/oturum başlatma gibi işlerle karışmasın diye
    // bunlara benzeyen uç noktaları cezalandırıyoruz.
    if (/train|lora|init|load|session|preprocess/.test(apiName.toLowerCase())) puan -= 5;

    if (puan > 0) adaylar.push({ apiName, puan, params });
  }
  adaylar.sort((a, b) => b.puan - a.puan);
  return adaylar[0] || null;
}

// Seçilen uç noktanın parametrelerini, anlamlarına göre isim bazlı eşleştirip
// bir girdi (payload) nesnesi oluşturur. Eşleşmeyen ama varsayılanı olan
// parametreler varsayılanıyla, varsayılanı da olmayanlar boş bırakılır
// (Gradio genelde component'in kendi varsayılanını kullanır).
function girdiOlustur(params, { caption, lyrics, durationSaniye, vocalLanguage, instrumental }) {
  const girdi = {};
  for (const p of params) {
    const ad = p?.parameter_name;
    if (!ad) continue;
    const metin = normalize(p?.label, ad);
    if (/caption|description|desc|prompt|tag/.test(metin)) {
      girdi[ad] = caption;
    } else if (/lyric|söz|sarki[_ ]?soz/.test(metin)) {
      girdi[ad] = instrumental ? "[instrumental]" : lyrics || "";
    } else if (/instrumental|enstrü/.test(metin)) {
      girdi[ad] = !!instrumental;
    } else if (/duration|süre|sure/.test(metin)) {
      girdi[ad] = durationSaniye;
    } else if (/language|dil/.test(metin)) {
      girdi[ad] = vocalLanguage || "tr";
    } else if (p?.parameter_has_default) {
      girdi[ad] = p.parameter_default;
    }
  }
  return girdi;
}

// sonuc.data içindeki (iç içe olabilen) değerler arasından bir ses
// dosyasına ait { url } bilgisini bulur (Gradio FileData şekli).
function sesDosyasiBul(veri) {
  if (!veri) return null;
  if (Array.isArray(veri)) {
    for (const eleman of veri) {
      const bulunan = sesDosyasiBul(eleman);
      if (bulunan) return bulunan;
    }
    return null;
  }
  if (typeof veri === "object") {
    if (typeof veri.url === "string") {
      const gorunenAd = String(veri.orig_name || veri.path || veri.url);
      const sesMi =
        /\.(mp3|wav|flac|ogg)(\?|$)/i.test(gorunenAd) ||
        /^audio\//i.test(String(veri.mime_type || ""));
      if (sesMi) return veri;
    }
    for (const v of Object.values(veri)) {
      const bulunan = sesDosyasiBul(v);
      if (bulunan) return bulunan;
    }
  }
  return null;
}

function zamanAsimiIle(promise, ms, mesaj) {
  let zamanlayici;
  const timeout = new Promise((_, reject) => {
    zamanlayici = setTimeout(() => reject(new Error(mesaj)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(zamanlayici));
}

// Ana giriş noktası: caption/lyrics/süre vererek HF Space'te üretim dener ve
// üretilen sesin Buffer'ını döndürür. Başarısız olursa hata fırlatır.
export async function aceStepHfSpaceIleUret({
  caption,
  lyrics,
  durationSaniye,
  vocalLanguage,
  instrumental,
  timeoutMs = 130000,
}) {
  const calisan = (async () => {
    const client = await baglantiAl();
    const apiInfo = await client.view_api();

    let secim = null;
    if (FORCED_API_NAME) {
      const info = apiInfo?.named_endpoints?.[FORCED_API_NAME];
      if (info) secim = { apiName: FORCED_API_NAME, params: info.parameters || [] };
      else {
        console.warn(
          `ACESTEP_HF_API_NAME="${FORCED_API_NAME}" Space'in mevcut uç noktaları arasında bulunamadı, otomatik seçime dönülüyor.`
        );
      }
    }
    if (!secim) secim = enUygunUcNoktayiSec(apiInfo);
    if (!secim) {
      throw new Error(
        "HF Space üzerinde uygun bir müzik/ses üretim uç noktası bulunamadı (view_api uyumsuz döndü ya da Space arayüzü değişmiş olabilir; ACESTEP_HF_API_NAME ile elle belirtmeyi deneyin)."
      );
    }

    const girdi = girdiOlustur(secim.params, {
      caption,
      lyrics,
      durationSaniye,
      vocalLanguage,
      instrumental,
    });

    const sonuc = await client.predict(secim.apiName, girdi);
    const dosya = sesDosyasiBul(sonuc?.data);
    if (!dosya?.url) {
      throw new Error(
        `HF Space ("${secim.apiName}") yanıtında bir ses dosyası bulunamadı.`
      );
    }

    const res = await fetch(dosya.url, HF_TOKEN ? { headers: { Authorization: `Bearer ${HF_TOKEN}` } } : undefined);
    if (!res.ok) throw new Error(`HF Space ses dosyası indirilemedi (HTTP ${res.status}).`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error("HF Space boş ses verisi döndürdü.");
    return buffer;
  })();

  return zamanAsimiIle(
    calisan,
    timeoutMs,
    "HF Space (ACE-Step v1.5) zaman aşımına uğradı (ücretsiz ZeroGPU kuyruğu yoğun olabilir)."
  );
}
