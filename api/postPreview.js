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

function getPostId(slug) {
  if (!slug) return null;
  const match = String(slug).match(/-([A-Za-z0-9]{7})$/);
  if (match) return match[1];
  return slug;
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
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot|applebot|skypeuripreview|vkshare|redditbot/i.test(ua);
}

module.exports = async function handler(req, res) {
  try {
    const rawSlug = String(req.query?.slug || "");
    const slug = rawSlug.split("?")[0].trim();
    const postId = getPostId(slug);

    if (!postId) {
      return res.redirect(302, APP_URL);
    }

    if (!isCrawler(req)) {
      return res.redirect(302, `${APP_URL}/#postdetail-${encodeURIComponent(postId)}`);
    }

    let snap = await db().collection("posts").doc(postId).get();

    if (!snap.exists) {
      const querySnap = await db().collection("posts").where("slug", "==", slug).limit(1).get();
      if (!querySnap.empty) {
        snap = querySnap.docs[0];
      }
    }

    if (!snap.exists) {
      return res.status(404).send("Şiir bulunamadı.");
    }

    const post = snap.data() || {};
    const title = post.title || "Yeni Ozanlar";
    const description = excerpt(post.text);
    const realPostId = snap.id;

    let image = null;

    if (post.image) {
      const raw = String(post.image);
      if (/^https?:\/\//i.test(raw)) {
        image = raw;
      } else if (/^data:image\//i.test(raw)) {
        image = `${APP_URL}/api/postImage?id=${encodeURIComponent(realPostId)}`;
      }
    }

    const youtube = getYouTubeId(post.youtube);
    if (!image && youtube) {
      image = `https://img.youtube.com/vi/${youtube}/maxresdefault.jpg`;
    }

    const cleanSlug = slug || realPostId;
    const canonical = `${APP_URL}/post/${encodeURIComponent(cleanSlug)}`;
    const uygulamaLinki = `${APP_URL}/#postdetail-${encodeURIComponent(realPostId)}`;

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
<meta http-equiv="refresh" content="0; url=${esc(uygulamaLinki)}">
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}" style="max-width:100%;height:auto">` : ""}
<p><a href="${esc(uygulamaLinki)}">Şiiri görüntülemek için tıklayın</a></p>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(html);
  } catch (error) {
    console.error("postPreview error:", error);
    return res.redirect(302, APP_URL);
  }
};
