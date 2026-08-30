import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";
const DEFAULT_IMAGE = `${APP_URL}/og-image.png`;

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok.");
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil.");
  }
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
  if (!clean) return "Yeni Ozanlar'da bir şiir.";
  if (clean.length <= 280) return clean;
  return clean.slice(0, 277).replace(/\s+\S*$/, "") + "…";
}

function imageInfo(post, postId) {
  const raw = String(post?.image || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    const clean = raw.split("#")[0];
    const pathname = (() => { try { return new URL(clean).pathname.toLowerCase(); } catch { return ""; } })();
    let type = "image/jpeg";
    if (pathname.endsWith(".png")) type = "image/png";
    else if (pathname.endsWith(".webp")) type = "image/webp";
    else if (pathname.endsWith(".gif")) type = "image/gif";
    else if (pathname.endsWith(".avif")) type = "image/avif";
    return { url: clean, type };
  }

  if (/^data:image\//i.test(raw)) {
    const m = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i);
    return {
      url: `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}`,
      type: (m?.[1] || "image/jpeg").toLowerCase()
    };
  }

  return null;
}

function previewHtml(data) {
  const image = data.image || DEFAULT_IMAGE;
  const imageType = data.imageType || "image/png";

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
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:url" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:type" content="${esc(imageType)}">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">
</head>
<body>
<h1>${esc(data.title)}</h1>
<p>${esc(data.description)}</p>
<img src="${esc(image)}" alt="${esc(data.title)}">
</body>
</html>`;
}

export default async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();
  const postId = getPostId(slug);
  const canonicalSlug = slug.split("?")[0];
  const canonical = `${APP_URL}/post/${encodeURIComponent(canonicalSlug)}`;

  // This function is intended for social crawlers only. Normal visitors are
  // sent to the SPA by vercel.json and never execute this Firebase query.
  if (!postId) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(previewHtml({
      title: "Yeni Ozanlar 🪶",
      description: "Şiirlerini paylaş, oku, puanla.",
      image: DEFAULT_IMAGE,
      imageType: "image/png",
      canonical
    }));
  }

  try {
    const snapshot = await db().collection("posts").doc(postId).get();

    if (!snapshot.exists) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      return res.status(200).send(previewHtml({
        title: "Yeni Ozanlar 🪶",
        description: "Şiirlerini paylaş, oku, puanla.",
        image: DEFAULT_IMAGE,
        imageType: "image/png",
        canonical
      }));
    }

    const post = snapshot.data() || {};
    const title = String(post.title || "Yeni Ozanlar").trim();
    const description = excerpt(post.text);
    const info = imageInfo(post, postId);

    const data = {
      title,
      description,
      image: info?.url || DEFAULT_IMAGE,
      imageType: info?.type || "image/png",
      canonical
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("Vercel-CDN-Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(previewHtml(data));
  } catch (error) {
    console.error("postPreview.js HATASI:", error);
    // Never turn a social preview request into a 500/redirect loop.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(previewHtml({
      title: "Yeni Ozanlar 🪶",
      description: "Şiirlerini paylaş, oku, puanla.",
      image: DEFAULT_IMAGE,
      imageType: "image/png",
      canonical
    }));
  }
}
