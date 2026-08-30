const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON eksik.");

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçersiz JSON.");
    }

    initializeApp({
      credential: cert(serviceAccount),
      projectId: PROJECT_ID
    });
  }

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
  const id = i >= 0 ? raw.slice(i + 1) : raw;

  return /^[A-Za-z0-9]{7}$/.test(id) ? id : null;
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
    let type = "image/jpeg";
    try {
      const p = new URL(raw).pathname.toLowerCase();
      if (p.endsWith(".png")) type = "image/png";
      else if (p.endsWith(".webp")) type = "image/webp";
      else if (p.endsWith(".gif")) type = "image/gif";
      else if (p.endsWith(".avif")) type = "image/avif";
    } catch {}
    return { url: raw.split("#")[0], type };
  }

  if (/^data:image\//i.test(raw)) {
    const m = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i);
    return {
      // Sorgu parametresi YOK: Facebook'un temiz ve sabit bir image URL'si olsun.
      url: `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}`,
      type: (m?.[1] || "image/jpeg").toLowerCase()
    };
  }

  return null;
}

function previewHtml({ title, description, image, imageType, canonical }) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:locale" content="tr_TR">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">

${image ? `
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:url" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:type" content="${esc(imageType || "image/jpeg")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="${esc(title)}">
` : `
<meta name="twitter:card" content="summary">
`}

<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}">` : ""}
</body>
</html>`;
}

async function getAppShell() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const r = await fetch(APP_URL + "/", {
      signal: controller.signal,
      headers: { "User-Agent": "YeniOzanlar-AppShell/1.0" }
    });

    if (!r.ok) throw new Error("Ana uygulama HTTP " + r.status);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function isSocialBot(ua) {
  const value = String(ua || "").toLowerCase();
  return [
    "facebookexternalhit",
    "facebot",
    "twitterbot",
    "linkedinbot",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "skypeuripreview",
    "pinterest",
    "google-inspectiontool",
    "googlebot"
  ].some(x => value.includes(x));
}

function injectMeta(html, data) {
  let clean = html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, "")
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");

  const tags = `
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.description)}">
<link rel="canonical" href="${esc(data.canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:locale" content="tr_TR">
<meta property="og:url" content="${esc(data.canonical)}">
<meta property="og:title" content="${esc(data.title)}">
<meta property="og:description" content="${esc(data.description)}">
${data.image ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:url" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:type" content="${esc(data.imageType || "image/jpeg")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">
` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
`;

  return clean.replace(/<head>/i, "<head>" + tags);
}

module.exports = async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();
  const postId = getPostId(slug);
  const canonicalSlug = slug.split("?")[0];
  const canonical = `${APP_URL}/post/${encodeURIComponent(canonicalSlug)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300"
  );

  try {
    let post = null;

    if (postId) {
      const snap = await getDb().collection("posts").doc(postId).get();
      if (snap.exists) post = snap.data() || {};
    }

    // Şiir bulunamazsa genel kart.
    if (!post) {
      return res.status(200).send(previewHtml({
        title: "Yeni Ozanlar 🪶",
        description: "Şiirlerini paylaş, oku, puanla.",
        image: `${APP_URL}/og-default.jpg`,
        imageType: "image/jpeg",
        canonical
      }));
    }

    const title = String(post.title || "Yeni Ozanlar").trim();
    const description = excerpt(post.text);
    const info = imageInfo(post, postId);

    const data = {
      title,
      description,
      image: info?.url || null,
      imageType: info?.type || "image/jpeg",
      canonical
    };

    // Sosyal bot için doğrudan küçük, temiz HTML.
    if (isSocialBot(req.headers["user-agent"])) {
      return res.status(200).send(previewHtml(data));
    }

    // Normal tarayıcı: gerçek uygulama kabuğu + şiire özel OG etiketleri.
    const shell = await getAppShell();
    return res.status(200).send(injectMeta(shell, data));

  } catch (error) {
    console.error("postPreview.js HATASI:", error);

    // Hata halinde bile genel kart dön; 500 üretip Facebook'u tamamen bozma.
    return res.status(200).send(previewHtml({
      title: "Yeni Ozanlar 🪶",
      description: "Şiirlerini paylaş, oku, puanla.",
      image: `${APP_URL}/og-default.jpg`,
      imageType: "image/jpeg",
      canonical
    }));
  }
};
