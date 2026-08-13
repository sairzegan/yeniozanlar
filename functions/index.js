const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const APP_URL = "https://yeniozanlar.vercel.app";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function postIdFromSlug(slug) {
  const match = String(slug || "").match(/-([A-Za-z0-9]{7})$/);
  return match ? match[1] : null;
}

function youtubeId(url) {
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
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

function getShareUrl(slug, query) {
  const suffix = query ? `?${query}` : "";
  return `${APP_URL}/post/${encodeURIComponent(slug)}${suffix}`;
}

function getImageUrl(id) {
  return `https://us-central1-yeniozanlar-68b49.cloudfunctions.net/postImage?id=${encodeURIComponent(id)}`;
}

async function loadPost(id) {
  const snap = await db.collection("posts").doc(id).get();
  if (!snap.exists) return null;
  return snap.data();
}

exports.postPreview = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 15 },
  async (req, res) => {
    try {
      const slug = String(req.query.slug || "");
      const id = postIdFromSlug(slug);

      if (!id) {
        res.status(404).send("Şiir bulunamadı.");
        return;
      }

      // Normal ziyaretçi: gerçek SPA detay ekranına gönder.
      if (!isCrawler(req)) {
        res.redirect(302, `${APP_URL}/#postdetail-${encodeURIComponent(id)}`);
        return;
      }

      const post = await loadPost(id);

      if (!post) {
        res.status(404).send("Şiir bulunamadı.");
        return;
      }

      const title = post.title || "Yeni Ozanlar";
      const description = excerpt(post.text);

      let image = null;

      if (post.image) {
        const raw = String(post.image);
        if (/^data:image\//i.test(raw)) {
          image = getImageUrl(id);
        } else if (/^https?:\/\//i.test(raw)) {
          image = raw;
        }
      }

      const yt = youtubeId(post.youtube);
      if (!image && yt) {
        image = `https://img.youtube.com/vi/${yt}/maxresdefault.jpg`;
      }

      const shareUrl = getShareUrl(slug, req.headers["x-forwarded-query"] || "");

      const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${esc(shareUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}" style="max-width:100%;height:auto">` : ""}
</body>
</html>`;

      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "public, max-age=60, s-maxage=300");
      res.status(200).send(html);
    } catch (error) {
      console.error("postPreview:", error);
      res.status(500).send("Önizleme oluşturulamadı.");
    }
  }
);

exports.postImage = onRequest(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 15 },
  async (req, res) => {
    try {
      const id = String(req.query.id || "");

      if (!/^[A-Za-z0-9]{7}$/.test(id)) {
        res.status(400).send("Geçersiz ID.");
        return;
      }

      const post = await loadPost(id);
      const dataUrl = String(post?.image || "");

      const match = dataUrl.match(
        /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/
      );

      if (!match) {
        res.status(404).send("Görsel bulunamadı.");
        return;
      }

      const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

      if (!buffer.length) {
        res.status(404).send("Görsel bulunamadı.");
        return;
      }

      res.set("Content-Type", match[1]);
      res.set("Content-Length", String(buffer.length));
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.status(200).send(buffer);
    } catch (error) {
      console.error("postImage:", error);
      res.status(500).send("Görsel alınamadı.");
    }
  }
);
