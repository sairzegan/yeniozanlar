// api/postImage.js
//
// Vercel bu dosyayı OTOMATİK olarak şu adreste yayınlar:
//   https://SIZIN-PROJENIZ.vercel.app/api/postImage?id=ŞİİR_ID
//
// Firestore'daki base64 resmi GERÇEK bir görsel dosyası (doğru Content-Type ile
// ham byte) olarak sunar. og:image, base64/data-uri kabul etmediği için
// postPreview.js bu adresi kullanır.

const PROJECT_ID = "yeniozanlar-68b49"; // Firebase proje ID'niz
const API_KEY = "AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY";
const SITE_URL = "https://yeniozanlar-68b49.web.app";

module.exports = async (req, res) => {
  const postId = req.query.id;
  if (!postId) {
    res.writeHead(302, { Location: `${SITE_URL}/og-image.png` });
    return res.end();
  }

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/${encodeURIComponent(postId)}?key=${API_KEY}`;
    const r = await fetch(firestoreUrl);
    if (!r.ok) {
      res.writeHead(302, { Location: `${SITE_URL}/og-image.png` });
      return res.end();
    }
    const data = await r.json();
    const dataUri = data.fields?.image?.stringValue || "";
    const eslesme = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!eslesme) {
      res.writeHead(302, { Location: `${SITE_URL}/og-image.png` });
      return res.end();
    }
    const mime = eslesme[1];
    const buffer = Buffer.from(eslesme[2], "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("postImage hata:", err);
    res.writeHead(302, { Location: `${SITE_URL}/og-image.png` });
    return res.end();
  }
};
