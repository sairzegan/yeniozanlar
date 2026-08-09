// api/postPreview.js
//
// Vercel bu dosyayı OTOMATİK olarak şu adreste yayınlar:
//   https://SIZIN-PROJENIZ.vercel.app/api/postPreview?id=ŞİİR_ID
//
// Hiçbir ek kurulum/kütüphane gerekmez — Firestore'a düz bir HTTP isteğiyle (REST API)
// bağlanır. Bir bot (Facebook/WhatsApp/Twitter önizleme botu) geldiğinde şiirin
// başlığını/bir bölümünü/görselini gösteren bir kart üretir. Gerçek ziyaretçiyi ise
// doğrudan uygulamaya yönlendirir.

// ⚠️ Bu iki değeri kendi projenize göre değiştirin gerekirse:
const SITE_URL = "https://yeniozanlar-68b49.web.app"; // sitenizin gerçek adresi
const PROJECT_ID = "yeniozanlar-68b49"; // Firebase proje ID'niz
const API_KEY = "AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY"; // zaten uygulamanızda (client'ta) herkese açık olan aynı anahtar

const BOT_UA_REGEX = /facebookexternalhit|Facebot|Twitterbot|Slackbot|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Googlebot|Pinterest|redditbot|SkypeUriPreview|vkShare|Applebot/i;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = async (req, res) => {
  const postId = req.query.id;
  const ua = req.headers["user-agent"] || "";
  const isBot = BOT_UA_REGEX.test(ua);

  if (!postId) {
    res.writeHead(302, { Location: SITE_URL });
    return res.end();
  }

  // GERÇEK KULLANICI: doğrudan uygulamaya (ilgili şiire) yönlendir.
  if (!isBot) {
    res.writeHead(302, { Location: `${SITE_URL}/#postdetail-${encodeURIComponent(postId)}` });
    return res.end();
  }

  // BOT: şiiri Firestore REST API'siyle oku, önizleme HTML'i üret.
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/${encodeURIComponent(postId)}?key=${API_KEY}`;
    const r = await fetch(firestoreUrl);
    if (!r.ok) {
      res.writeHead(302, { Location: SITE_URL });
      return res.end();
    }
    const data = await r.json();
    const fields = data.fields || {};

    const postTitle = fields.title?.stringValue || "";
    const postText = fields.text?.stringValue || "";
    const postImage = fields.image?.stringValue || "";

    const baslik = postTitle ? `"${postTitle}" — Yeni Ozanlar` : "Yeni Ozanlar'da bir şiir";
    const hamMetin = postText.replace(/\s+/g, " ").trim();
    const aciklama = hamMetin.length > 160
      ? hamMetin.slice(0, 157) + "…"
      : (hamMetin || "Yeni Ozanlar'da paylaşılan bir şiir.");

    // Resim base64 (data:image/...;base64,...) olduğu için og:image için gerçek bir
    // HTTP adresine çeviren postImage fonksiyonuna yönlendiriyoruz.
    const tabanAdres = `https://${req.headers.host}`;
    const gorsel = postImage
      ? `${tabanAdres}/api/postImage?id=${encodeURIComponent(postId)}`
      : `${SITE_URL}/og-image.png`;

    const uygulamaLinki = `${SITE_URL}/#postdetail-${encodeURIComponent(postId)}`;

    const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(baslik)}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:title" content="${escapeHtml(baslik)}">
<meta property="og:description" content="${escapeHtml(aciklama)}">
<meta property="og:image" content="${escapeHtml(gorsel)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(baslik)}">
<meta name="twitter:description" content="${escapeHtml(aciklama)}">
<meta name="twitter:image" content="${escapeHtml(gorsel)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(uygulamaLinki)}">
</head>
<body>
<p>Yönlendiriliyor… <a href="${escapeHtml(uygulamaLinki)}">Şiiri görüntülemek için tıklayın</a></p>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    return res.status(200).send(html);
  } catch (err) {
    console.error("postPreview hata:", err);
    res.writeHead(302, { Location: SITE_URL });
    return res.end();
  }
};
