const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON Vercel Environment Variables içinde yok."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID
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
  let raw = String(slug || "");

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  const sonTire = raw.lastIndexOf("-");

  const aday =
    sonTire !== -1
      ? raw.slice(sonTire + 1)
      : raw;

  if (!/^[A-Za-z0-9]{7}$/.test(aday)) {
    return null;
  }

  return aday;
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

async function timeoutlu(url, options = {}, ms = 7000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, ms);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ytKapakResmi(videoId) {
  const maxres =
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  try {
    const r = await timeoutlu(
      maxres,
      { method: "HEAD" },
      3000
    );

    const size = Number(
      r.headers.get("content-length") || 0
    );

    if (r.ok && size > 8000) {
      return maxres;
    }
  } catch {}

  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

async function uygulamaKabugunuGetir() {
  const r = await timeoutlu(
    `${APP_URL}/`,
    {
      method: "GET",
      headers: {
        "User-Agent": "YeniOzanlar-Preview/1.0"
      }
    },
    7000
  );

  if (!r.ok) {
    throw new Error(
      `Uygulama kabuğu alınamadı: HTTP ${r.status}`
    );
  }

  return await r.text();
}

function metaEnjekteEt(
  html,
  {
    title,
    description,
    image,
    canonical
  }
) {
  let temiz = html
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

  const etiketler = `
    <title>${esc(title)}</title>

    <meta
      name="description"
      content="${esc(description)}"
    >

    <link
      rel="canonical"
      href="${esc(canonical)}"
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
      content="${esc(canonical)}"
    >

    <meta
      property="og:title"
      content="${esc(title)}"
    >

    <meta
      property="og:description"
      content="${esc(description)}"
    >

    ${
      image
        ? `
    <meta
      property="og:image"
      content="${esc(image)}"
    >

    <meta
      property="og:image:secure_url"
      content="${esc(image)}"
    >

    <meta
      property="og:image:type"
      content="image/jpeg"
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
      content="${esc(title)}"
    >

    <meta
      name="twitter:card"
      content="summary_large_image"
    >

    <meta
      name="twitter:image"
      content="${esc(image)}"
    >

    <meta
      name="twitter:image:alt"
      content="${esc(title)}"
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
      content="${esc(title)}"
    >

    <meta
      name="twitter:description"
      content="${esc(description)}"
    >
  `;

  return temiz.replace(
    /<head>/i,
    `<head>${etiketler}`
  );
}

module.exports = async function handler(req, res) {
  try {
    const slug = String(
      req.query?.slug || ""
    );

    const postId = getPostId(slug);

    const canonical =
      `${APP_URL}/post/${encodeURIComponent(slug)}`;

    const kabuk =
      await uygulamaKabugunuGetir();

    if (!postId) {
      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.status(200).send(kabuk);
    }

    const snap =
      await db()
        .collection("posts")
        .doc(postId)
        .get();

    if (!snap.exists) {
      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res.status(200).send(kabuk);
    }

    const post = snap.data() || {};

    const title =
      String(post.title || "Yeni Ozanlar");

    const description =
      excerpt(post.text);

    let image = null;

    /*
      1. Öncelik şiirin kendi görseli.
      Cloudinary URL'si ise doğrudan kullanılır.
    */
    if (post.image) {
      const raw =
        String(post.image).trim();

      if (/^https?:\/\//i.test(raw)) {
        image = raw;
      }

      /*
        Eski şiirlerde data:image;base64
        tutulmuş olabilir.

        Sosyal medya data URL kabul etmediği için
        postImage endpoint'ine çeviriyoruz.
      */
      else if (
        /^data:image\//i.test(raw)
      ) {
        image =
          `${APP_URL}/api/postImage` +
          `?id=${encodeURIComponent(postId)}` +
          `&v=${encodeURIComponent(
            post.ts || Date.now()
          )}`;
      }
    }

    /*
      Görsel yoksa YouTube küçük resmi.
    */
    if (!image && post.youtube) {
      const youtube =
        getYouTubeId(post.youtube);

      if (youtube) {
        image =
          await ytKapakResmi(youtube);
      }
    }

    const finalHtml =
      metaEnjekteEt(
        kabuk,
        {
          title,
          description,
          image,
          canonical
        }
      );

    res.setHeader(
      "Content-Type",
      "text/html; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=3600"
    );

    return res
      .status(200)
      .send(finalHtml);

  } catch (error) {
    console.error(
      "Yeni Ozanlar postPreview hatası:",
      error
    );

    /*
      Hata durumunda bile siteyi bozma.
    */
    try {
      const kabuk =
        await uygulamaKabugunuGetir();

      res.setHeader(
        "Content-Type",
        "text/html; charset=utf-8"
      );

      return res
        .status(200)
        .send(kabuk);

    } catch {
      return res
        .status(500)
        .send("Yeni Ozanlar");
    }
  }
};
