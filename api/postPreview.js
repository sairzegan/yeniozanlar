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


// ---- SITEMAP (/sitemap.xml -> /api/postPreview?sitemap=1) ----
const SITE = "https://yeniozanlar.vercel.app";

function slugOlustur(metin) {
  const trMap = { "ç":"c","Ç":"c","ğ":"g","Ğ":"g","ı":"i","İ":"i","ö":"o","Ö":"o","ş":"s","Ş":"s","ü":"u","Ü":"u" };
  let s = (metin || "").toString().trim();
  s = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => trMap[ch]);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\s-]/g, "");
  s = s.trim().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/, "");
  return s || "siir";
}

let SITEMAP_ONBELLEK = { xml: null, zaman: 0 };
const SITEMAP_SURE_MS = 6 * 60 * 60 * 1000; // 6 saat: Firestore okuma kotasını korumak için

async function sitemapGonder(res) {
  // Sunucu belleğinde taze bir kopya varsa Firestore'a hiç gitme.
  if (SITEMAP_ONBELLEK.xml && Date.now() - SITEMAP_ONBELLEK.zaman < SITEMAP_SURE_MS) {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).send(SITEMAP_ONBELLEK.xml);
  }
  const bugun = new Date().toISOString().slice(0, 10);
  let satirlar = `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${bugun}</lastmod>\n  </url>\n`;
  try {
    const snap = await getDb().collection("posts").select("title", "text", "hidden", "ts").get();
    snap.forEach((d) => {
      const p = d.data() || {};
      if (p.hidden === true) return;
      const loc = `${SITE}/post/${slugOlustur(p.title || p.text || "")}-${d.id}`;
      const ts = Number(p.ts) || 0;
      const lastmod = ts > 0 ? new Date(ts).toISOString().slice(0, 10) : bugun;
      satirlar += `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
    });
  } catch (e) {
    console.error("sitemap HATASI:", e);
    // Eski başarılı kopya varsa onu ver; yoksa 503 dön (Google sonra tekrar dener).
    // Eksik/boş sitemap'i "başarılı" gibi 200 ile VERMİYORUZ ve önbelleğe almıyoruz.
    res.setHeader("Cache-Control", "no-store");
    if (SITEMAP_ONBELLEK.xml) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      return res.status(200).send(SITEMAP_ONBELLEK.xml);
    }
    res.setHeader("Retry-After", "3600");
    return res.status(503).send("Sitemap gecici olarak olusturulamadi.");
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${satirlar}</urlset>\n`;
  SITEMAP_ONBELLEK = { xml, zaman: Date.now() };
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).send(xml);
}

export default async function handler(req, res) {
  // /sitemap.xml isteği (vercel.json rewrite ile buraya yönlenir)
  if ((req.url || "").split("?")[0] === "/sitemap.xml" || (req.query && req.query.sitemap)) {
    return sitemapGonder(res);
  }

  const host = req.headers.host;
  const fullUrl = req.url || "";
  const pathWithoutQuery = fullUrl.split("?")[0];
  const pathParts = pathWithoutQuery.split("/");
  const slug = pathParts[pathParts.length - 1] || "siir";
  const canonical = `https://${host}${pathWithoutQuery}`;

  if (!isBot(req.headers["user-agent"])) {
    // Gerçek ziyaretçi: asıl uygulamayı (SPA) aynı adreste sun ki tarayıcı
    // /post/:slug URL'sinde kalsın ve React router doğru şiiri açsın.
    // index.html statik bir dosya olduğu için (Firestore'a gitmiyor) bu
    // istek her zaman hızlıdır; yine de güvenlik için 4 saniyelik bir
    // zaman sınırı var. Süre aşılırsa veya istek başarısız olursa ana
    // sayfaya yönlendirilir (sonsuz beklemek yerine).
    try {
      const r = await fetch(`https://${host}/index.html`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.text();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(body);
    } catch (e) {
      console.error("postPreview: index.html getirilemedi:", e);
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
      // Firestore isteğine sabit bir zaman sınırı: soğuk başlangıç veya ağ
      // gecikmesi yüzünden istek uzun sürerse fonksiyon sonsuza kadar
      // beklemez, süre dolunca hemen (görselsiz) geçerli bir OG cevabına
      // düşer. Facebook'un "Curl Molası" (zaman aşımı) hatasının tekrar
      // yaşanmaması için bu sınır kritik.
      const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("Firestore zaman aşımı")), ms));
      const snap = await Promise.race([
        getDb().collection("posts").doc(id).get(),
        timeout(6000),
      ]);
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
    // Veri çekilemezse veya zaman aşımına uğrarsa jenerik başlık/açıklama
    // ile devam edilir; sayfa YİNE DE hemen ve 200 ile döner.
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
