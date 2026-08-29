const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeni tanımlı değil.");
  }

  const serviceAccount = JSON.parse(raw);

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });
}

function db() {
  firebaseAdmin();
  return getFirestore();
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Şiirin ID'sini linkten çıkarır. İki format da desteklenir:
//  - "baslik-slug-ID"  → yeni format (bkz. index.html → postYolu()/paylasimLinki())
//  - "ID"              → eski format (slug özelliği eklenmeden ÖNCE paylaşılmış,
//                         Facebook/X'te hâlâ dolaşımda olan geçmiş linkler)
// Mantık, uygulamanın (index.html) kendi ID ayrıştırma mantığıyla BİREBİR aynıdır:
// son "-" işaretinden sonraki kısım alınır; hiç "-" yoksa girdinin tamamı ID sayılır.
function getPostId(slug) {
  let raw = String(slug || "");
  try { raw = decodeURIComponent(raw); } catch {}
  const sonTireIndex = raw.lastIndexOf("-");
  const aday = sonTireIndex !== -1 ? raw.slice(sonTireIndex + 1) : raw;
  return /^[A-Za-z0-9]{7}$/.test(aday) ? aday : null;
}

function getYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Yeni Ozanlar'da bir şiir.";
  if (clean.length <= 280) return clean;
  return clean.slice(0, 277).replace(/\s+\S*$/, "") + "…";
}

// Bir HTTP isteğini, çok uzun sürerse kesip varsayılana düşecek şekilde yapar.
async function timeoutlu(url, options, ms) {
  const controller = new AbortController();
  const zamanAsimi = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(zamanAsimi);
  }
}

// YouTube, "maxresdefault.jpg" üretilmemiş videolarda da HTTP 200 döner ama
// birkaç KB'lık gri bir "yer tutucu" görsel verir — bu yüzden var olup olmadığını
// sadece durum koduna bakarak anlayamayız. Dosya boyutu küçükse (yer tutucu),
// HER videoda garanti üretilen "hqdefault.jpg"ye düşüyoruz.
async function ytKapakResmi(videoId) {
  const maxres = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const r = await timeoutlu(maxres, { method: "HEAD" }, 2500);
    const uzunluk = Number(r.headers.get("content-length") || 0);
    if (r.ok && uzunluk > 8000) return maxres;
  } catch {}
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// Uygulamanın canlı, gerçek "index.html" kabuğunu (tüm script/style/uygulama
// koduyla birlikte) olduğu gibi getirir. Böylece hem botlar hem gerçek
// ziyaretçiler İÇİN AYNI, tamamen çalışan sayfayı döndürüyoruz — sadece
// <head> içindeki paylaşım bilgilerini o şiire özel hale getireceğiz.
// Bu sayede hiçbir User-Agent/bot listesine ihtiyaç kalmıyor: Facebook, X,
// NSOSYAL ya da yarın çıkacak herhangi bir platform, hangi tarayıcı adını
// kullanırsa kullansın otomatik olarak doğru önizlemeyi görür.
async function uygulamaKabugunuGetir() {
  const r = await timeoutlu(`${APP_URL}/`, {}, 4000);
  if (!r.ok) throw new Error("Uygulama kabuğu alınamadı: " + r.status);
  return await r.text();
}

// Kabuğun <head> kısmındaki title/description/og:*/twitter:* etiketlerini
// söküp yerine bu şiire özel olanları koyar. Geri kalan her şey (fontlar,
// stiller, script'ler, uygulamanın kendisi) birebir korunur.
function metaEnjekteEt(html, { title, description, image, canonical }) {
  let temiz = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

  const etiketler = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">
` : `
<meta name="twitter:card" content="summary">
`}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
`;

  return temiz.replace(/<head>/i, `<head>${etiketler}`);
}

module.exports = async function handler(req, res) {
  try {
    const slug = String(req.query?.slug || "");
    const postId = getPostId(slug);
    const canonical = `${APP_URL}${req.url}`;

    // Kabuğu her durumda getiriyoruz: ID geçersizse ya da şiir bulunamazsa bile,
    // ziyaretçiyi (insan ya da bot) boş/ham bir 404 metniyle değil, uygulamanın
    // kendisiyle karşılıyoruz — "Şiir bulunamadı" mesajını zaten client taraflı
    // PostDetail ekranı kendisi gösteriyor.
    const kabuk = await uygulamaKabugunuGetir();

    let post = null;
    if (postId) {
      const snap = await db().collection("posts").doc(postId).get();
      if (snap.exists) post = snap.data() || null;
    }

    let html;
    if (post) {
      const title = post.title || "Yeni Ozanlar";
      const description = excerpt(post.text);

      let image = null;
      if (post.image) {
        const raw = String(post.image);
        if (/^https?:\/\//i.test(raw)) {
          image = raw;
        } else if (/^data:image\//i.test(raw)) {
          image = `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}&v=${encodeURIComponent(post.ts || Date.now())}`;
        }
      }

      const youtube = getYouTubeId(post.youtube);
      if (!image && youtube) {
        image = await ytKapakResmi(youtube);
      }

      html = metaEnjekteEt(kabuk, { title, description, image, canonical });
    } else {
      // Geçersiz/eski/bulunamayan ID: kabuğu olduğu gibi döndür, uygulama
      // client tarafında kendi "bulunamadı" akışını zaten yönetiyor.
      html = kabuk;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(html);
  } catch (error) {
    console.error("postPreview:", error);
    // Bir şeyler ters giderse bile kullanıcıyı yarı yolda bırakmamak için
    // uygulamanın ana sayfasına yönlendiriyoruz (aynı /post/ yoluna değil —
    // aksi halde hata kalıcıysa bu fonksiyon kendi kendini tekrar tetikleyip
    // sonsuz bir yönlendirme döngüsüne girebilirdi). Bu durumda paylaşım
    // önizlemesi eksik olur ama site erişilemez hâle gelmez.
    return res.redirect(302, APP_URL + "/");
  }
};
