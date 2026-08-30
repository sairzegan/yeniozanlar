import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

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
  let raw = String(slug || "").trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {}

  // deneme-tzpyd43 -> tzpyd43
  const match = raw.match(/([A-Za-z0-9]{7})$/);
  return match ? match[1] : null;
}

function getYouTubeId(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "Yeni Ozanlar'da bir şiir.";
  if (clean.length <= 280) return clean;
  return clean.slice(0, 277).replace(/\s+\S*$/, "") + "…";
}

function getImageType(post) {
  const raw = String(post?.image || "").trim();
  if (!raw) return null;

  const dataMatch = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i);
  if (dataMatch) return dataMatch[1].toLowerCase();

  const path = raw.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function getImageUrl(post, postId) {
  if (!post?.image) return null;
  return `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}&v=${encodeURIComponent(
    String(post.ts || "1")
  )}`;
}

function youtubeImage(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

function isSocialBot(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  return [
    "facebookexternalhit",
    "facebot",
    "meta-externalagent",
    "meta-externalfetcher",
    "facebookcatalog",
    "twitterbot",
    "linkedinbot",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "skypeuripreview",
    "pinterest",
    "google-inspectiontool",
    "googlebot",
  ].some((x) => ua.includes(x));
}

async function getAppShell() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const r = await fetch(`${APP_URL}/`, {
      headers: { "User-Agent": "YeniOzanlar-AppShell/1.0" },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Ana uygulama alınamadı: HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function injectMeta(html, data) {
  let clean = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']fb:app_id["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");

  const image = data.image
    ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">
`
    : `<meta name="twitter:card" content="summary">`;

  const appId = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const fbAppId = appId ? `\n<meta property="fb:app_id" content="${esc(appId)}">` : "";

  const tags = `
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.description)}">
<link rel="canonical" href="${esc(data.canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:locale" content="tr_TR">
<meta property="og:url" content="${esc(data.canonical)}">
<meta property="og:title" content="${esc(data.title)}">
<meta property="og:description" content="${esc(data.description)}">${fbAppId}
${image}
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
`;

  return clean.replace(/<head>/i, `<head>${tags}`);
}

function previewHtml(data) {
  const image = data.image
    ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">`
    : `<meta name="twitter:card" content="summary">`;

  const appId = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const fbAppId = appId
    ? `<meta property="fb:app_id" content="${esc(appId)}">`
    : "";

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
${fbAppId}
${image}
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
</head>
<body>
<h1>${esc(data.title)}</h1>
<p>${esc(data.description)}</p>
${data.image ? `<img src="${esc(data.image)}" alt="${esc(data.title)}">` : ""}
<p><a href="${esc(data.canonical)}">Yeni Ozanlar'da şiiri görüntüle</a></p>
</body>
</html>`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).send("Method Not Allowed");
    }

    const slug = String(req.query?.slug || "").trim();
    const postId = getPostId(slug);

    // /post/... isteği gerçek bir şiir değilse SPA'ya bırak.
    if (!postId) {
      const shell = await getAppShell();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(shell);
    }

    const snapshot = await db().collection("posts").doc(postId).get();
    if (!snapshot.exists) {
      const shell = await getAppShell();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(shell);
    }

    const post = snapshot.data() || {};
    const title = String(post.title || "Yeni Ozanlar").trim();
    const description = excerpt(post.text);
    const canonical = `${APP_URL}/post/${encodeURIComponent(slug.replace(/[?#].*$/, ""))}`;

    let image = getImageUrl(post, postId);
    let imageType = getImageType(post);

    if (!image && post.youtube) {
      const yt = getYouTubeId(post.youtube);
      if (yt) {
        image = youtubeImage(yt);
        imageType = "image/jpeg";
      }
    }

    const data = {
      title,
      description,
      image,
      imageType,
      canonical,
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.setHeader("X-Robots-Tag", "index,follow");

    // Meta/Facebook/WhatsApp için doğrudan küçük HTML döndürülür.
    if (isSocialBot(req.headers?.["user-agent"] || "")) {
      return res.status(200).send(previewHtml(data));
    }

    // Normal kullanıcı gerçek SPA sayfasını görmeye devam eder.
    try {
      const shell = await getAppShell();
      return res.status(200).send(injectMeta(shell, data));
    } catch (shellError) {
      console.error("postPreview shell HATASI:", shellError);
      // En önemli nokta: Hata halinde eski index.html meta etiketlerine dönme.
      return res.status(200).send(previewHtml(data));
    }
  } catch (error) {
    console.error("postPreview.js HATASI:", error);
    return res.status(500).send("Şiir önizlemesi oluşturulamadı.");
  }
}
