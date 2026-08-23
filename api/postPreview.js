const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");

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
// Böylece daha önce eski formatta paylaşılmış bir link de artık düzgün önizleme üretir.
function getPostId(slug) {
  let raw = String(slug || "");
  try { raw = decodeURIComponent(raw); } catch {}
  const sonTireIndex = raw.lastIndexOf("-");
  const aday = sonTireIndex !== -1 ? raw.slice(sonTireIndex + 1) : raw;
  return /^[A-Za-z0-9]{7}$/.test(aday) ? aday : null;
}

function getYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Yeni Ozanlar'da bir şiir.";
  if (clean.length <= 280) return clean;
  return clean.slice(0, 277).replace(/\s+\S*$/, "") + "…";
}

function isCrawler(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  return /facebookexternalhit|facebot|meta-externalagent|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

module.exports = async function handler(req, res) {
  try {
    const slug = String(req.query?.slug || "");
    const postId = getPostId(slug);

    if (!postId) {
      return res.status(404).send("Şiir bulunamadı.");
    }

    // Normal tarayıcı: mevcut uygulamanın kendi post route'una dön.
    if (!isCrawler(req)) {
      return res.redirect(302, `${APP_URL}${req.url}`);
    }

    const snap = await db().collection("posts").doc(postId).get();

    if (!snap.exists) {
      return res.status(404).send("Şiir bulunamadı.");
    }

    const post = snap.data() || {};
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
      image = `https://img.youtube.com/vi/${youtube}/maxresdefault.jpg`;
    }

    const canonical = `${APP_URL}${req.url}`;

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
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
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}" style="max-width:100%;height:auto">` : ""}
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(html);
  } catch (error) {
    console.error("postPreview:", error);
    return res.status(500).send("Önizleme oluşturulamadı.");
  }
};
