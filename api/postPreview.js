import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) {
    return getApps()[0];
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde bulunamadı."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });
}

function db() {
  firebaseAdmin();
  return getFirestore();
}

/*
 * HTML içine güvenli şekilde veri koymak için.
 */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
 * /post/guncelleme-hnxk3bm
 *
 * son "-" işaretinden sonraki 7 karakteri şiir ID'si kabul eder.
 *
 * Ayrıca eski:
 * /post/hnxk3bm
 *
 * formatını da destekler.
 */
function getPostId(slug) {
  let raw = String(slug || "");

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const lastDash = raw.lastIndexOf("-");

  const candidate =
    lastDash !== -1
      ? raw.slice(lastDash + 1)
      : raw;

  if (!/^[A-Za-z0-9]{7}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

/*
 * YouTube video ID'sini bul.
 */
function getYouTubeId(url) {
  const value = String(url || "");

  const match = value.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );

  return match ? match[1] : null;
}

/*
 * Facebook / X açıklaması için şiirden kısa bölüm.
 */
function excerpt(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return "Yeni Ozanlar'da bir şiir.";
  }

  if (clean.length <= 280) {
    return clean;
  }

  return (
    clean
      .slice(0, 277)
      .replace(/\s+\S*$/, "") +
    "…"
  );
}

/*
 * Şiirin görselini belirle.
 *
 * 1. Normal HTTPS görsel → doğrudan kullan.
 * 2. data:image → /api/postImage üzerinden sun.
 */
function getImageUrl(post, postId) {
  if (!post || !post.image) {
    return null;
  }

  const raw = String(post.image).trim();

  /*
   * Cloudinary / Firebase Storage / başka CDN
   * gibi normal HTTP görseller.
   */
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  /*
   * Eski kayıtlar data:image;base64 şeklindeyse
   * sosyal medya bunu doğrudan okuyamaz.
   *
   * Bu nedenle kendi API endpoint'imize çeviriyoruz.
   */
  if (/^data:image\//i.test(raw)) {
    const version = encodeURIComponent(
      post.ts || post.date || Date.now()
    );

    return (
      `${APP_URL}/api/postImage` +
      `?id=${encodeURIComponent(postId)}` +
      `&v=${version}`
    );
  }

  return null;
}

/*
 * YouTube görselini kullanmak için.
 */
function getYouTubeImage(videoId) {
  if (!videoId) {
    return null;
  }

  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/*
 * Sosyal medya botlarına verilecek HTML.
 *
 * Burada özellikle sadece gerekli <head> kısmını oluşturuyoruz.
 * Artık index.html'i Vercel fonksiyonunun içinden tekrar fetch etmiyoruz.
 *
 * Böylece:
 *
 * Facebook botu
 * X botu
 * WhatsApp
 * Telegram
 * LinkedIn
 * vb.
 *
 * doğrudan şiire ait OG bilgilerini alabilir.
 */
function buildHtml({
  title,
  description,
  image,
  canonical,
}) {
  const safeTitle = esc(title);
  const safeDescription = esc(description);
  const safeCanonical = esc(canonical);
  const safeImage = image ? esc(image) : "";

  const imageTags = image
    ? `
<meta property="og:image" content="${safeImage}">
<meta property="og:image:secure_url" content="${safeImage}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${safeTitle}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${safeImage}">
<meta name="twitter:image:alt" content="${safeTitle}">
`
    : `
<meta name="twitter:card" content="summary">
`;

  /*
   * İnsan ziyaretçi geldiğinde tarayıcı bu sayfadan
   * gerçek uygulamaya geçsin.
   *
   * Sosyal medya botları ise meta etiketlerini okuyabilir.
   */
  return `<!DOCTYPE html>
<html lang="tr">
<head>

<meta charset="UTF-8">

<title>${safeTitle}</title>

<meta
  name="description"
  content="${safeDescription}"
>

<link
  rel="canonical"
  href="${safeCanonical}"
>

<meta
  property="og:type"
  content="article"
>

<meta
  property="og:site_name"
  content="Yeni Ozanlar"
>

<meta
  property="og:locale"
  content="tr_TR"
>

<meta
  property="og:url"
  content="${safeCanonical}"
>

<meta
  property="og:title"
  content="${safeTitle}"
>

<meta
  property="og:description"
  content="${safeDescription}"
>

${imageTags}

<meta
  name="twitter:title"
  content="${safeTitle}"
>

<meta
  name="twitter:description"
  content="${safeDescription}"
>

<meta
  name="robots"
  content="index,follow"
>

<style>
html,body{
  margin:0;
  padding:0;
  background:#0d0718;
  color:#e9d5ff;
  font-family:Georgia,serif;
}

body{
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
}

main{
  width:min(900px,92%);
  padding:40px 20px;
  box-sizing:border-box;
}

h1{
  font-size:2rem;
  margin:0 0 20px;
}

p{
  font-size:1.15rem;
  line-height:1.8;
  white-space:pre-wrap;
}

img{
  max-width:100%;
  height:auto;
  border-radius:14px;
  margin-top:20px;
}

a{
  color:#c084fc;
}
</style>

</head>

<body>

<main>

<h1>${safeTitle}</h1>

<p>${safeDescription}</p>

${
  image
    ? `<img src="${safeImage}" alt="${safeTitle}">`
    : ""
}

<p>
<a href="${safeCanonical}">
Yeni Ozanlar'da şiiri görüntüle
</a>
</p>

</main>

</body>
</html>`;
}

/*
 * Vercel Function
 */
export default async function handler(req, res) {
  try {
    const slug =
      String(req.query?.slug || "").trim();

    if (!slug) {
      return res.status(400).send(
        "Şiir bağlantısı bulunamadı."
      );
    }

    const postId = getPostId(slug);

    if (!postId) {
      return res.status(404).send(
        "Geçersiz şiir bağlantısı."
      );
    }

    /*
     * Firestore'dan şiiri al.
     */
    const snapshot = await db()
      .collection("posts")
      .doc(postId)
      .get();

    if (!snapshot.exists) {
      return res.status(404).send(
        "Şiir bulunamadı."
      );
    }

    const post = snapshot.data() || {};

    /*
     * Başlık
     */
    const title =
      String(
        post.title ||
        "Yeni Ozanlar"
      ).trim();

    /*
     * Şiir metninden Facebook/X açıklaması.
     */
    const description =
      excerpt(post.text);

    /*
     * Önce şiirin kendi görseli.
     */
    let image =
      getImageUrl(
        post,
        postId
      );

    /*
     * Şiirin resmi yoksa YouTube küçük resmi.
     */
    if (!image && post.youtube) {
      const youtubeId =
        getYouTubeId(
          post.youtube
        );

      if (youtubeId) {
        image =
          getYouTubeImage(
            youtubeId
          );
      }
    }

    /*
     * Canonical paylaşım adresi.
     */
    const canonical =
      `${APP_URL}/post/${encodeURIComponent(slug)}`;

    /*
     * Sosyal medya için HTML.
     */
    const html =
      buildHtml({
        title,
        description,
        image,
        canonical,
      });

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    /*
     * Facebook/X bazen eski önizlemeyi cache'ler.
     * Kısa süreli cache kullanıyoruz.
     */
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );

    return res
      .status(200)
      .send(html);

  } catch (error) {
    console.error(
      "postPreview.js HATASI:",
      error
    );

    return res
      .status(500)
      .send(
        "Yeni Ozanlar önizleme sunucusu hatası."
      );
  }
}
