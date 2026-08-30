import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok.");
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."); }
  return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
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
  let raw = String(slug || "").trim();
  try { raw = decodeURIComponent(raw); } catch {}
  const i = raw.lastIndexOf("-");
  const candidate = i >= 0 ? raw.slice(i + 1) : raw;
  return /^[A-Za-z0-9]{7}$/.test(candidate) ? candidate : null;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Şiirlerini paylaş, oku, puanla.";
  if (clean.length <= 300) return clean;
  return clean.slice(0, 297).replace(/\s+\S*$/, "") + "…";
}

function getImageInfo(post, postId) {
  const raw = String(post?.image || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    let type = "image/jpeg";
    try {
      const pathname = new URL(raw).pathname.toLowerCase();
      if (pathname.endsWith(".png")) type = "image/png";
      else if (pathname.endsWith(".webp")) type = "image/webp";
      else if (pathname.endsWith(".gif")) type = "image/gif";
      else if (pathname.endsWith(".avif")) type = "image/avif";
    } catch {}
    return { url: raw, type };
  }

  const match = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+$/i);
  if (!match) return null;

  return {
    url: `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}`,
    type: match[1].toLowerCase()
  };
}

function getYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function previewHtml(data) {
  const imageTags = data.image ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:url" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:type" content="${esc(data.imageType || "image/jpeg")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">` : `
<meta name="twitter:card" content="summary">`;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.description)}">
<link rel="canonical" href="${esc(data.canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:locale" content="tr_TR">
<meta property="og:url" content="${esc(data.canonical)}">
<meta property="og:title" content="${esc(data.title)}">
<meta property="og:description" content="${esc(data.description)}">
${imageTags}
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
</head>
<body>
<main>
<h1>${esc(data.title)}</h1>
<p>${esc(data.description)}</p>
${data.image ? `<img src="${esc(data.image)}" alt="${esc(data.title)}">` : ""}
<p><a href="${esc(data.canonical)}">Şiiri Yeni Ozanlar'da görüntüle</a></p>
</main>
</body>
</html>`;
}

async function getPost(postId) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Firestore timeout")), 7000)
  );
  const read = db().collection("posts").doc(postId).get();
  return Promise.race([read, timeout]);
}

export default async function handler(req, res) {
  const rawSlug = String(req.query?.slug || "").trim();
  const slug = rawSlug.split("?")[0];
  const postId = getPostId(slug);
  const canonical = `${APP_URL}/post/${encodeURIComponent(slug)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (!postId) {
    return res.status(200).send(previewHtml({
      title: "Yeni Ozanlar 🪶",
      description: "Şiirlerini paylaş, oku, puanla.",
      image: null,
      imageType: null,
      canonical
    }));
  }

  try {
    const snapshot = await getPost(postId);
    if (!snapshot.exists) {
      return res.status(200).send(previewHtml({
        title: "Yeni Ozanlar 🪶",
        description: "Şiirlerini paylaş, oku, puanla.",
        image: null,
        imageType: null,
        canonical
      }));
    }

    const post = snapshot.data() || {};
    let image = getImageInfo(post, postId);

    if (!image && post.youtube) {
      const yt = getYouTubeId(post.youtube);
      if (yt) image = {
        url: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
        type: "image/jpeg"
      };
    }

    return res.status(200).send(previewHtml({
      title: String(post.title || "Yeni Ozanlar 🪶").trim(),
      description: excerpt(post.text),
      image: image?.url || null,
      imageType: image?.type || null,
      canonical
    }));
  } catch (error) {
    console.error("postPreview.js HATASI:", error);
    return res.status(200).send(previewHtml({
      title: "Yeni Ozanlar 🪶",
      description: "Şiirlerini paylaş, oku, puanla.",
      image: null,
      imageType: null,
      canonical
    }));
  }
}
