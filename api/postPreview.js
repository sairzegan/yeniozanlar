import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

// Facebook, og:image hiç verilmediğinde "explicitly provided" uyarısı veriyor
// ve önizlemede görsel göstermiyor. Bu yüzden görseli olmayan şiirlerde ve
// Firebase/Firestore'a hiç ulaşılamayan durumlarda da HER ZAMAN bir görsel
// göstermek için varsayılan bir site görseli tanımlanıyor.
// Bu dosyayı /public/og-default.jpg olarak deponuza eklemeniz yeterli
// (1200x630 px, jpg/png, ideal boyut Facebook'un önerdiği ölçüdür).
const DEFAULT_OG_IMAGE = `${APP_URL}/og-default.jpg`;
const DEFAULT_OG_IMAGE_TYPE = "image/jpeg";

const DEFAULT_OG = {
  title: "Yeni Ozanlar",
  description: "Şiirlerini paylaş, oku, puanla.",
  image: DEFAULT_OG_IMAGE,
  imageType: DEFAULT_OG_IMAGE_TYPE,
};

let firebaseInitError = null;

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON eksik");
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    // Vercel ortam değişkeni bazen private_key içindeki gerçek satır sonlarını
    // JSON'u bozacak şekilde saklayabiliyor. \n kaçışlı biçime çevirip tekrar dene.
    const repaired = raw.replace(/\r?\n/g, "\\n");
    serviceAccount = JSON.parse(repaired);
  }
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
  return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
}

function db() {
  firebaseAdmin();
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

// ÖNEMLİ DÜZELTME: eski regex slug içindeki İLK 7 karakterlik alfasayısal
// bloğu ID sanıyordu. Başlık kelimelerinden biri tesadüfen 7 harf olursa
// (örn. "kelime1-tzpyd43") yanlış ID yakalanıp Firestore'da kayıt bulunamıyor
// ve önizleme kırılıyordu. ID her zaman slug'ın SONUNDA olduğundan artık
// SON eşleşme alınıyor.
function getPostId(slug) {
  let s = String(slug || "").trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  const matches = s.match(/[A-Za-z0-9]{7}(?=[/?#]|$)/g);
  return matches && matches.length ? matches[matches.length - 1] : null;
}

function excerpt(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s) return "Yeni Ozanlar'da bir şiir.";
  return s.length <= 280 ? s : s.slice(0, 277).replace(/\s+\S*$/g, "") + "…";
}

function imageType(post) {
  const r = String(post?.image || "").trim();
  const m = r.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i);
  if (m) return m[1].toLowerCase();
  const p = r.split("?")[0].toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".avif")) return "image/avif";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function imageUrl(post, id) {
  return post?.image
    ? `${APP_URL}/api/postImage?id=${encodeURIComponent(id)}&v=${encodeURIComponent(String(post.ts || "1"))}`
    : null;
}

function yt(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function bot(ua) {
  ua = String(ua || "").toLowerCase();
  return [
    "facebookexternalhit",
    "facebot",
    "meta-externalagent",
    "meta-externalfetcher",
    "twitterbot",
    "linkedinbot",
    "whatsapp",
    "telegrambot",
    "discordbot",
    "slackbot",
    "skypeuripreview",
    "pinterest",
    "google-inspectiontool", // Google zengin sonuç / önizleme testi
    "bingbot",
  ].some((x) => ua.includes(x));
}

function html(d) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(d.title)}</title><meta name="description" content="${esc(d.description)}"><link rel="canonical" href="${esc(d.canonical)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Yeni Ozanlar"><meta property="og:locale" content="tr_TR"><meta property="og:url" content="${esc(d.canonical)}"><meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(d.description)}">${
    d.image
      ? `<meta property="og:image" content="${esc(d.image)}"><meta property="og:image:secure_url" content="${esc(d.image)}"><meta property="og:image:type" content="${esc(d.imageType || "image/jpeg")}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(d.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(d.image)}">`
      : ``
  }<meta name="twitter:title" content="${esc(d.title)}"><meta name="twitter:description" content="${esc(d.description)}"></head><body><h1>${esc(d.title)}</h1><p>${esc(d.description)}</p>${
    d.image ? `<img src="${esc(d.image)}" alt="${esc(d.title)}">` : ""
  }<p><a href="${esc(d.canonical)}">Yeni Ozanlar'da şiiri görüntüle</a></p></body></html>`;
}

async function shell() {
  const r = await fetch(`${APP_URL}/`, {
    headers: { "User-Agent": "YeniOzanlar-AppShell/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export default async function handler(req, res) {
  const ua = req.headers?.["user-agent"] || "";
  const isBot = bot(ua);

  try {
    const slug = String(req.query?.slug || "").trim();
    const id = getPostId(slug);

    // GERÇEK ZİYARETÇİLER (bot olmayan tarayıcılar): her zaman asıl uygulamayı
    // (index.html) alsınlar. Önceki sürümde herkese bu sabit önizleme sayfası
    // gösteriliyordu; böylece siteye tıklayan gerçek kullanıcılar uygulamanın
    // içine değil, kendine referans veren statik bir sayfaya düşüyordu.
    if (!isBot) {
      const s = await shell();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(s);
    }

    if (!id) {
      const s = await shell();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(s);
    }

    const canonical = `${APP_URL}/post/${encodeURIComponent(slug.split("?")[0])}`;

    let post = null;
    try {
      const snap = await db().collection("posts").doc(id).get();
      if (snap.exists) post = snap.data() || {};
    } catch (dbErr) {
      // Firestore/Firebase erişilemezse tüm isteği 500 ile çökertmek yerine
      // genel site bilgileriyle bir OG kartı döndür; Facebook en azından
      // görsel+metin içeren bir önizleme gösterebilsin.
      console.error("postPreview.js Firestore HATASI", dbErr);
      firebaseInitError = dbErr;
    }

    let d;
    if (post) {
      d = {
        title: String(post.title || "Yeni Ozanlar").trim(),
        description: excerpt(post.text),
        image: imageUrl(post, id),
        imageType: imageType(post),
        canonical,
      };
      if (!d.image && post.youtube) {
        const y = yt(post.youtube);
        if (y) {
          d.image = `https://img.youtube.com/vi/${y}/hqdefault.jpg`;
          d.imageType = "image/jpeg";
        }
      }
      // Şiirin kendi görseli (ve YouTube kapak resmi) yoksa bile og:image'in
      // boş kalmaması için varsayılan görsele düş.
      if (!d.image) {
        d.image = DEFAULT_OG_IMAGE;
        d.imageType = DEFAULT_OG_IMAGE_TYPE;
      }
    } else {
      d = { ...DEFAULT_OG, canonical };
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).send(html(d));
  } catch (e) {
    console.error("postPreview.js HATASI", firebaseInitError || e);
    // Son çare: yine de link yerine boş bir kart gitmesin diye genel bir
    // önizleme dönüyoruz. 500 döndürmek Facebook'un hiçbir şey göstermeden
    // sadece çıplak linki bırakmasına yol açıyordu.
    try {
      const slug = String(req.query?.slug || "").trim();
      const canonical = `${APP_URL}/post/${encodeURIComponent(slug.split("?")[0] || "")}`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(html({ ...DEFAULT_OG, canonical: canonical || APP_URL }));
    } catch {
      return res.status(500).send("Şiir önizlemesi oluşturulamadı.");
    }
  }
}
