import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(raw);
  } catch {
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

  const parts = raw.split("-");
  const candidate = parts[parts.length - 1];

  if (/^[A-Za-z0-9]{7}$/.test(candidate)) {
    return candidate;
  }

  return null;
}

function getYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );

  return match ? match[1] : null;
}

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
      .replace(/\s+\S*$/, "") + "…"
  );
}

function getImageInfo(post, postId) {
  if (!post?.image) {
    return null;
  }

  const raw = String(post.image).trim();

  /*
   * Görsel zaten dışarıda bir URL ise onu kullan.
   */
  if (/^https?:\/\//i.test(raw)) {
    const path = raw.split("?")[0].toLowerCase();

    let type = "image/jpeg";

    if (path.endsWith(".png")) {
      type = "image/png";
    } else if (path.endsWith(".webp")) {
      type = "image/webp";
    } else if (path.endsWith(".gif")) {
      type = "image/gif";
    }

    return {
      url: raw,
      type,
    };
  }

  /*
   * Firebase'deki base64 resmi için Facebook'a
   * SABİT ve temiz bir Vercel URL'si veriyoruz.
   *
   * ÖNEMLİ:
   * Burada ?v=... KULLANMIYORUZ.
   */
  if (/^data:image\//i.test(raw)) {
    const match = raw.match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,/i
    );

    return {
      url: `${APP_URL}/api/postImage?id=${encodeURIComponent(postId)}`,
      type: match?.[1] || "image/jpeg",
    };
  }

  return null;
}

function youtubeImage(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

function isSocialBot(userAgent) {
  const ua = String(userAgent || "").toLowerCase();

  const bots = [
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
  ];

  return bots.some((bot) => ua.includes(bot));
}

async function getAppShell() {
  const response = await fetch(`${APP_URL}/`, {
    headers: {
      "User-Agent": "YeniOzanlar-AppShell/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Ana uygulama alınamadı: HTTP ${response.status}`
    );
  }

  return await response.text();
}

function injectMeta(html, data) {
  let clean = html
    .replace(
      /<title>[\s\S]*?<\/title>/i,
      ""
    )
    .replace(
      /<meta\s+name=["']description["'][^>]*>/gi,
      ""
    )
    .replace(
      /<meta\s+property=["']og:[^"']+["'][^>]*>/gi,
      ""
    )
    .replace(
      /<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi,
      ""
    )
    .replace(
      /<link\s+rel=["']canonical["'][^>]*>/gi,
      ""
    );

  const imageTags = data.image
    ? `
<meta property="og:image" content="${esc(data.image)}">
<meta property="og:image:secure_url" content="${esc(data.image)}">
<meta property="og:image:type" content="${esc(data.imageType || "image/jpeg")}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(data.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(data.image)}">
<meta name="twitter:image:alt" content="${esc(data.title)}">
`
    : `
<meta name="twitter:card" content="summary">
`;

  const tags = `
<title>${esc(data.title)}</title>

<meta name="description" content="${esc(data.description)}">

<link
  rel="canonical"
  href="${esc(data.canonical)}"
>

<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:locale" content="tr_TR">

<meta
  property="og:url"
  content="${esc(data.canonical)}"
>

<meta
  property="og:title"
  content="${esc(data.title)}"
>

<meta
  property="og:description"
  content="${esc(data.description)}"
>

${imageTags}

<meta
  name="twitter:title"
  content="${esc(data.title)}"
>

<meta
  name="twitter:description"
  content="${esc(data.description)}"
>
`;

  return clean.replace(
    /<head>/i,
    `<head>${tags}`
  );
}

function previewHtml(data) {
  return `<!doctype html>
<html lang="tr">

<head>

<meta charset="utf-8">

<title>${esc(data.title)}</title>

<meta
  name="description"
  content="${esc(data.description)}"
>

<link
  rel="canonical"
  href="${esc(data.canonical)}"
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
  content="${esc(data.canonical)}"
>

<meta
  property="og:title"
  content="${esc(data.title)}"
>

<meta
  property="og:description"
  content="${esc(data.description)}"
>

${
  data.image
    ? `
<meta
  property="og:image"
  content="${esc(data.image)}"
>

<meta
  property="og:image:secure_url"
  content="${esc(data.image)}"
>

<meta
  property="og:image:type"
  content="${esc(data.imageType || "image/jpeg")}"
>

<meta
  property="og:image:width"
  content="1200"
>

<meta
  property="og:image:height"
  content="630"
>

<meta
  property="og:image:alt"
  content="${esc(data.title)}"
>

<meta
  name="twitter:card"
  content="summary_large_image"
>

<meta
  name="twitter:image"
  content="${esc(data.image)}"
>

<meta
  name="twitter:image:alt"
  content="${esc(data.title)}"
>
`
    : `
<meta
  name="twitter:card"
  content="summary"
>
`
}

<meta
  name="twitter:title"
  content="${esc(data.title)}"
>

<meta
  name="twitter:description"
  content="${esc(data.description)}"
>

</head>

<body>

<h1>${esc(data.title)}</h1>

<p>${esc(data.description)}</p>

${
  data.image
    ? `
<img
  src="${esc(data.image)}"
  alt="${esc(data.title)}"
>
`
    : ""
}

<p>
<a href="${esc(data.canonical)}">
Yeni Ozanlar'da şiiri görüntüle
</a>
</p>

</body>

</html>`;
}

export default async function handler(req, res) {
  try {
    const slug = String(
      req.query?.slug || ""
    ).trim();

    const postId = getPostId(slug);

    if (!postId) {
      const shell = await getAppShell();

      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.status(200).send(shell);
    }

    const snapshot = await db()
      .collection("posts")
      .doc(postId)
      .get();

    if (!snapshot.exists) {
      const shell = await getAppShell();

      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.status(200).send(shell);
    }

    const post = snapshot.data() || {};

    const title = String(
      post.title || "Yeni Ozanlar"
    ).trim();

    const description = excerpt(post.text);

    /*
     * Facebook için kanonik adres:
     *
     * /post/deneme-tzpyd43
     *
     * Burada query string OLMAYACAK.
     */
    const canonical =
      `${APP_URL}/post/${encodeURIComponent(slug)}`;

    let imageInfo =
      getImageInfo(post, postId);

    /*
     * Şiirde doğrudan resim yoksa YouTube
     * küçük resmi kullanılabilir.
     */
    if (!imageInfo && post.youtube) {
      const youtubeId =
        getYouTubeId(post.youtube);

      if (youtubeId) {
        imageInfo = {
          url: youtubeImage(youtubeId),
          type: "image/jpeg"
        };
      }
    }

    const data = {
      title,
      description,
      image: imageInfo?.url || null,
      imageType: imageInfo?.type || null,
      canonical
    };

    const userAgent =
      req.headers?.["user-agent"] || "";

    const bot =
      isSocialBot(userAgent);

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    /*
     * Facebook'un eski hatalı önizlemeyi uzun süre
     * cache'lemesini engelle.
     */
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );

    /*
     * Facebook / Messenger / WhatsApp vb.
     * doğrudan özel OG HTML alır.
     */
    if (bot) {
      return res
        .status(200)
        .send(previewHtml(data));
    }

    /*
     * Normal ziyaretçi gerçek uygulamayı görür.
     */
    const shell =
      await getAppShell();

    return res
      .status(200)
      .send(
        injectMeta(shell, data)
      );

  } catch (error) {
    console.error(
      "postPreview.js HATASI:",
      error
    );

    try {
      const shell =
        await getAppShell();

      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res
        .status(200)
        .send(shell);

    } catch {
      return res
        .status(500)
        .send("Yeni Ozanlar");
    }
  }
}
