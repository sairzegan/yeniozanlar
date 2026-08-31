import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      initializeApp({ credential: cert(JSON.parse(raw)), projectId: PROJECT_ID });
    } else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!clientEmail || !privateKey) throw new Error("Firebase Admin ortam değişkenleri eksik.");
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
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

// Şiir ID'si slug'ın SONUNDA duruyor (örn. "yeni-bir-mevsim-36cttew" -> "36cttew").
function getPostId(slug) {
  let s = String(slug || "");
  try { s = decodeURIComponent(s); } catch {}
  const m = s.match(/[A-Za-z0-9]{7}(?=[/?#]|$)/g);
  return m && m.length ? m[m.length - 1] : null;
}

function excerpt(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s) return "Yeni Ozanlar'da paylaşılan bu eşsiz şiiri okumak için tıklayın.";
  return s.length <= 280 ? s : s.slice(0, 277).replace(/\s+\S*$/g, "") + "…";
}


function isBot(ua) {
  return /(facebookexternalhit|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|skypeuripreview|pinterest|applebot|google-inspectiontool|bingbot)/i.test(String(ua || ""));
}

export default async function handler(req, res) {
  const host = req.headers.host;
  const fullUrl = req.url || "";
  const pathWithoutQuery = fullUrl.split("?")[0];
  const pathParts = pathWithoutQuery.split("/");
  const slug = pathParts[pathParts.length - 1] || "siir";
  const canonical = `https://${host}${pathWithoutQuery}`;

  // Gerçek ziyaretçi (bot değil) ise asıl uygulamayı (SPA) alsın.
  if (!isBot(req.headers["user-agent"])) {
    try {
      const r = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(8000) });
      const body = await r.text();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(body);
    } catch (e) {
      res.writeHead(302, { Location: `https://${host}/` });
      return res.end();
    }
  }


  let title = `Şiir: ${decodeURIComponent(slug).replace(/[-_]/g, " ")}`;
  let description = "Yeni Ozanlar'da paylaşılan bu eşsiz şiiri okumak için tıklayın.";
  let imageUrl = null;

  try {
    const id = getPostId(slug);
    if (id) {
      const snap = await getDb().collection("posts").doc(id).get();
      if (snap.exists) {
        const post = snap.data() || {};
        if (post.title) title = String(post.title).trim();
        description = excerpt(post.text);
        // Şiirin GERÇEK görseli, mevcut postImage.js endpoint'i üzerinden.
        if (post.image) imageUrl = `https://${host}/api/postImage?id=${encodeURIComponent(id)}`;
      }
    }
  } catch (e) {
    console.error("postPreview: Firestore HATASI:", e);
    // Veri çekilemezse jenerik başlık/açıklama ile devam edilir, sayfa yine 200 döner.
  }

  const html = `<!DOCTYPE html>
    <html lang="tr">
    <head>
        <meta charset="UTF-8">
        <title>${esc(title)}</title>
        <meta property="og:site_name" content="Yeni Ozanlar">
        <meta property="og:title" content="${esc(title)}" />
        <meta property="og:description" content="${esc(description)}" />
        <meta property="og:url" content="${esc(canonical)}" />
        <meta property="og:type" content="article" />
        ${imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}" />
        <meta property="og:image:secure_url" content="${esc(imageUrl)}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />` : ""}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${esc(title)}" />
        <meta name="twitter:description" content="${esc(description)}" />
        ${imageUrl ? `<meta name="twitter:image" content="${esc(imageUrl)}" />` : ""}
    </head>
    <body>
        <h1>${esc(title)}</h1>
        <p>${esc(description)}</p>
    </body>
    </html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
