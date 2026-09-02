// /api/musicGenerate.js
// v5 — HİÇBİR dış AI servisi ÇAĞIRMAZ. Bunun yerine, sizin Colab'da bir kez
// ürettiğiniz ve Vercel Blob'a yüklediğiniz sabit bir müzik KÜTÜPHANESİNDEN,
// şiirin ruh haline (Groq'un ürettiği musicPrompt'taki anahtar kelimelere)
// göre en uygun parçayı seçer. Böylece:
//   - Asla dış servis hatası / 404 / kota / ücret sorunu olmaz (%100 ücretsiz).
//   - Her şiire aynı müzik gitmez (8 farklı ruh hali + eşleştirme + rastgelelik).
//   - Frontend'de HİÇBİR DEĞİŞİKLİK gerekmez; eski "🎵 Yapay Zeka ile Müzik
//     Oluştur" butonu ve adminMuzikYenile() fonksiyonu aynen çalışmaya devam
//     eder, çünkü aynı { musicUrl, prompt } sözleşmesini döndürüyoruz.
//
// KURULUM:
// 1) musicgen_kutuphane.ipynb notebook'unu Colab'da çalıştırıp 8 mp3 üretin.
// 2) Hepsini Vercel Blob'a yükleyin (Storage > Blob store > Yüklemek).
// 3) Her birinin public URL'sini kopyalayıp aşağıdaki TRACKS listesindeki
//    ilgili "url" alanına yapıştırın (şu an hepsi "REPLACE_ME" yazıyor).
// ═══════════════════════════════════════════════════════════════════════

// Notebook'taki dosya adları ve etiketlerle BİREBİR eşleşiyor.
// url alanlarını Blob'a yükledikten sonra kendi linklerinizle değiştirin.
const TRACKS = [
  {
    file: "melankolik_piano",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/melankolik_piano.mp3",
    tags: ["melancholic", "sad", "piano", "hüzün", "kayıp", "yalnızlık", "gözyaşı", "acı"]
  },
  {
    file: "umutlu_gitar",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/umutlu_gitar.mp3",
    tags: ["hopeful", "warm", "guitar", "umut", "sevinç", "aşk", "mutluluk"]
  },
  {
    file: "sakin_ambient",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/sakin_ambient.mp3",
    tags: ["calm", "ambient", "peaceful", "sakin", "huzur", "doğa", "dinginlik"]
  },
  {
    file: "hazin_keman",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/hazin_keman.mp3",
    tags: ["mournful", "violin", "emotional", "hüzün", "ayrılık", "gözyaşı", "veda"]
  },
  {
    file: "epik_orkestra",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/epik_orkestra.mp3",
    tags: ["epic", "orchestral", "powerful", "güçlü", "savaş", "kahramanlık", "mücadele"]
  },
  {
    file: "romantik_yayli",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/romantik_yayli.mp3",
    tags: ["romantic", "strings", "tender", "aşk", "romantik", "özlem", "sevgili"]
  },
  {
    file: "gizemli_karanlik",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/gizemli_karanlik.mp3",
    tags: ["mysterious", "dark", "tense", "gizem", "karanlık", "korku", "endişe"]
  },
  {
    file: "nostaljik_lofi",
    url: "https://se7mxjrrxj6hacua.public.blob.vercel-storage.com/audio/nostaljik_lofi.mp3",
    tags: ["nostalgic", "lofi", "soft", "nostalji", "anı", "geçmiş", "hatıra"]
  }
];

function enUygunParcayiSec(musicPrompt, title) {
  const metin = `${musicPrompt || ""} ${title || ""}`.toLowerCase();

  let enIyi = null;
  let enIyiPuan = -1;
  const adaylar = []; // en yuksek puana esit birden fazla parca olursa rastgele sec

  for (const parca of TRACKS) {
    let puan = 0;
    for (const etiket of parca.tags) {
      if (metin.includes(etiket.toLowerCase())) puan++;
    }
    if (puan > enIyiPuan) {
      enIyiPuan = puan;
      adaylar.length = 0;
      adaylar.push(parca);
    } else if (puan === enIyiPuan) {
      adaylar.push(parca);
    }
  }

  // Hicbir eslesme yoksa (puan 0), tamamen rastgele sec (adaylar = hepsi olur zaten)
  const secilenler = enIyiPuan > 0 ? adaylar : TRACKS;
  enIyi = secilenler[Math.floor(Math.random() * secilenler.length)];
  return enIyi;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }

  const eksikUrl = TRACKS.find(t => !t.url || t.url.startsWith("REPLACE_ME"));
  if (eksikUrl) {
    return res.status(500).json({
      error: `Müzik kütüphanesi henüz kurulmamış: "${eksikUrl.file}" için gerçek bir Blob URL'si girilmemiş. ` +
             `musicGenerate.js dosyasındaki TRACKS listesini Vercel Blob'a yüklediğiniz gerçek linklerle güncelleyin.`
    });
  }

  const { title, postId, musicPrompt } = req.body || {};
  const cleanPostId = String(postId || "").trim();
  if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
    return res.status(400).json({ error: "Geçersiz şiir ID." });
  }

  try {
    const secilen = enUygunParcayiSec(musicPrompt, title);
    return res.status(200).json({ musicUrl: secilen.url, prompt: musicPrompt || "" });
  } catch (e) {
    console.error("musicGenerate HATASI:", e);
    return res.status(502).json({ error: `Müzik seçilemedi: ${String(e?.message || e).slice(0, 250)}` });
  }
}
