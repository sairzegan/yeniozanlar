import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (raw) {
      initializeApp({
        credential: cert(JSON.parse(raw)),
        projectId: PROJECT_ID
      });
    } else {
      const projectId = process.env.FIREBASE_PROJECT_ID || PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;

      if (!clientEmail || !privateKey) {
        throw new Error("Firebase Admin ortam değişkenleri eksik.");
      }

      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n")
        })
      });
    }
  }

  return getFirestore();
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function postIdFromSlug(slug) {
  let s = String(slug || "").trim();
  try { s = decodeURIComponent(s); } catch {}
  const i = s.lastIndexOf("-");
  const id = i >= 0 ? s.slice(i + 1) : s;
  return /^[A-Za-z0-9]{7}$/.test(id) ? id : null;
}

function description(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "Yeni Ozanlar'da bir şiir.";
  return s.length <= 300 ? s : s.slice(0, 297).replace(/\s+\S*$/, "") + "…";
}

function getImage(post, id) {
  const raw = String(post?.image || "").trim();
  if (!raw) return null;

  if (/^data:image\//i.test(raw)) {
    const m = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i);
    return {
      url: `${APP_URL}/api/postImage?id=${encodeURIComponent(id)}`,
      type: (m?.[1] || "image/jpeg").toLowerCase()
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    let type = "image/jpeg";
    try {
      const p = new URL(raw).pathname.toLowerCase();
      if (p.endsWith(".png")) type = "image/png";
      else if (p.endsWith(".webp")) type = "image/webp";
      else if (p.endsWith(".gif")) type = "image/gif";
      else if (p.endsWith(".avif")) type = "image/avif";
    } catch {}
    return { url: raw, type };
  }

  return null;
}

function youtubeImage(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return m ? {url:`https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`,type:"image/jpeg"} : null;
}

function html(data) {
  const image = data.image ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:url" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:type" content="${esc(data.imageType)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
` : `<meta name="twitter:card" content="summary">`;

  // Facebook botu HTML meta etiketlerini okur; gerçek kullanıcı JS ile asıl şiir sayfasına gider.
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
${image}
<meta name="twitter:title" content="${esc(data.title)}">
<meta name="twitter:description" content="${esc(data.description)}">
<script>
window.location.replace(${JSON.stringify(data.canonical)});
</script>
</head>
<body>
<h1>${esc(data.title)}</h1>
<p>${esc(data.description)}</p>
${data.image ? `<img src="${esc(data.image)}" alt="${esc(data.title)}">` : ""}
<p><a href="${esc(data.canonical)}">Şiiri görüntüle</a></p>
</body>
</html>`;
}

export default async function handler(req, res) {
  const slug = String(req.query?.slug || "").trim();
  const id = postIdFromSlug(slug);
  const canonical = `${APP_URL}/post/${encodeURIComponent(slug)}`;

  let data = {
    title: "Yeni Ozanlar",
    description: "Yeni Ozanlar'da bir şiir.",
    image: null,
    imageType: null,
    canonical
  };

  try {
    if (id) {
      const snap = await getDb().collection("posts").doc(id).get();

      if (snap.exists) {
        const post = snap.data() || {};
        const image = getImage(post, id) || youtubeImage(post.youtube);

        data = {
          title: String(post.title || "Yeni Ozanlar").trim(),
          description: description(post.text),
          image: image?.url || null,
          imageType: image?.type || null,
          canonical
        };
      }
    }
  } catch (e) {
    console.error("postPreview HATASI:", e);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).send(html(data));
}
