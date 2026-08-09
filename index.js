// functions/index.js
//
// AMAÇ: Bir şiir linki (https://SITENIZ/post/ID) Facebook, WhatsApp, Twitter/X,
// Discord, Telegram, LinkedIn gibi bir sitede paylaşıldığında, o sitenin "önizleme
// botu" bu adrese istek atar. Bu bot JavaScript ÇALIŞTIRMAZ, sadece ham HTML'i okur
// ve <meta property="og:..."> etiketlerine bakar.
//
// Uygulamamız tamamen istemci tarafında (JS ile) çizildiği için, bot bu HTML'i
// görene kadar şiirin içeriğini bilemez. Bu fonksiyon, isteği atanın bir bot mu
// yoksa gerçek bir ziyaretçi mi olduğunu User-Agent'tan anlar:
//   - BOT ise  → Firestore'dan o şiiri okur, başlığını/metninin bir bölümünü/
//                görselini içeren KÜÇÜK bir HTML üretir (og:title, og:description,
//                og:image dolu). Bot bunu okur, Facebook'ta güzel bir kart çıkar.
//   - İNSAN ise → doğrudan gerçek uygulamaya (kök adres + #postdetail-ID) yönlendirilir,
//                normal SPA deneyimine hiç dokunulmaz.

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// Bilinen paylaşım/önizleme botlarının User-Agent imzaları.
const BOT_UA_REGEX = /facebookexternalhit|Facebot|Twitterbot|Slackbot|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Googlebot|Pinterest|redditbot|SkypeUriPreview|vkShare|Applebot/i;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ⚠️ Sitenizin gerçek adresiyle değiştirin (Firebase Hosting varsayılanı budur;
// özel bir alan adınız varsa onu yazın).
const SITE_URL = "https://yeniozanlar-68b49.web.app";

exports.postPreview = functions.https.onRequest(async (req, res) => {
  const match = req.path.match(/^\/post\/([^/]+)/);
  const postId = match ? decodeURIComponent(match[1]) : null;
  const ua = req.headers["user-agent"] || "";
  const isBot = BOT_UA_REGEX.test(ua);

  if (!postId) {
    return res.redirect(302, SITE_URL);
  }

  // GERÇEK KULLANICI: hiç beklemeden doğrudan uygulamaya (ilgili şiire) yönlendir.
  if (!isBot) {
    return res.redirect(302, `${SITE_URL}/#postdetail-${encodeURIComponent(postId)}`);
  }

  // BOT: şiiri Firestore'dan oku ve önizleme HTML'i üret.
  try {
    const doc = await db.collection("posts").doc(postId).get();
    if (!doc.exists) {
      return res.redirect(302, SITE_URL);
    }
    const post = doc.data();

    const baslik = post.title ? `"${post.title}" — Yeni Ozanlar` : "Yeni Ozanlar'da bir şiir";
    const hamMetin = (post.text || "").replace(/\s+/g, " ").trim();
    const aciklama = hamMetin.length > 160
      ? hamMetin.slice(0, 157) + "…"
      : (hamMetin || "Yeni Ozanlar'da paylaşılan bir şiir.");
    // ÖNEMLİ: post.image, Firestore'da base64 (data:image/...;base64,....) olarak
    // duruyor — bu, og:image için GEÇERSİZ bir değerdir (Facebook onu bir HTTP
    // adresi olarak açamaz). Bu yüzden gerçek bir görsel varsa, base64'ü gerçek
    // bir görsele çeviren /post-image/ID ucuna yönlendiriyoruz (aşağıdaki
    // postImage fonksiyonuna bakın). Görsel yoksa siteye ait varsayılan kartı kullanır.
    const gorsel = post.image
      ? `${SITE_URL}/post-image/${encodeURIComponent(postId)}`
      : `${SITE_URL}/og-image.png`;
    const sayfaUrl = `${SITE_URL}/post/${encodeURIComponent(postId)}`;
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
<meta property="og:url" content="${escapeHtml(sayfaUrl)}">
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

    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    return res.status(200).send(html);
  } catch (err) {
    console.error("postPreview hata:", err);
    return res.redirect(302, SITE_URL);
  }
});

// /post-image/ID → Firestore'daki base64 resmi GERÇEK bir görsel dosyası
// (doğru Content-Type ile ham byte) olarak sunar. og:image, base64/data-uri kabul
// etmediği için postPreview yukarıda bu adresi kullanır.
exports.postImage = functions.https.onRequest(async (req, res) => {
  const match = req.path.match(/^\/post-image\/([^/]+)/);
  const postId = match ? decodeURIComponent(match[1]) : null;
  if (!postId) return res.redirect(302, `${SITE_URL}/og-image.png`);

  try {
    const doc = await db.collection("posts").doc(postId).get();
    const dataUri = doc.exists ? doc.data().image : null;
    const eslesme = dataUri && dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!eslesme) {
      return res.redirect(302, `${SITE_URL}/og-image.png`);
    }
    const mime = eslesme[1];
    const buffer = Buffer.from(eslesme[2], "base64");
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("postImage hata:", err);
    return res.redirect(302, `${SITE_URL}/og-image.png`);
  }
});
