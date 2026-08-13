const PROJECT_ID = "yeniozanlar-68b49";
const FIREBASE_API_KEY = "AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY";
const FIRESTORE_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

function fv(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(fv);
  if (v.mapValue) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fv(x);
    return o;
  }
  return null;
}

async function getPost(id) {
  const url = FIRESTORE_URL + encodeURIComponent(id) + "?key=" + encodeURIComponent(FIREBASE_API_KEY);
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) return null;
  const d = await r.json();
  const out = {};
  for (const [k, v] of Object.entries(d.fields || {})) out[k] = fv(v);
  return out;
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function idFromSlug(slug) {
  const m = String(slug || "").match(/-([A-Za-z0-9]{7})$/);
  return m ? m[1] : null;
}

function ytId(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function excerpt(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "Yeni Ozanlar'da bir şiir.";
  return s.length <= 300 ? s : s.slice(0, 297).replace(/\s+\S*$/, "") + "…";
}

function origin(req) {
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

function crawler(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

function fallbackTitle(slug) {
  const raw = String(slug || "").replace(/-[A-Za-z0-9]{7}$/, "").replace(/-/g, " ").trim();
  return raw ? raw.replace(/\b\w/g, c => c.toUpperCase()) : "Yeni Ozanlar";
}

module.exports = async function handler(req, res) {
  try {
    const slug = String(req.query?.slug || "");
    const id = idFromSlug(slug);
    const site = origin(req);

    if (!id) return res.status(404).send("Şiir bulunamadı.");

    // Normal browser: uygulamanın hash tabanlı detay ekranına git.
    if (!crawler(req)) {
      return res.redirect(302, `/#postdetail-${encodeURIComponent(id)}`);
    }

    const post = await getPost(id);

    // Firestore okunamasa bile Facebook'a boş HTML dönme.
    const title = post?.title || fallbackTitle(slug);
    const description = excerpt(post?.text);
    const sharedUrl = `${site}/post/${encodeURIComponent(slug)}${req.url.includes("?v=") ? ("?v=" + new URL(req.url, site).searchParams.get("v")) : ""}`;

    let image = null;
    const rawImage = String(post?.image || "");
    if (/^data:image\//i.test(rawImage)) {
      image = `${site}/api/postImage?id=${encodeURIComponent(id)}`;
    } else if (/^https?:\/\//i.test(rawImage)) {
      image = rawImage;
    }

    const yt = ytId(post?.youtube);
    if (!image && yt) image = `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${esc(sharedUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(title)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ""}
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}">` : ""}
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).send(html);
  } catch (err) {
    console.error("postPreview:", err);
    return res.status(500).send("Önizleme oluşturulamadı.");
  }
};
