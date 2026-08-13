const { db } = require('./firebaseAdmin');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getIdFromSlug(slug) {
  const m = String(slug || '').match(/-([A-Za-z0-9]{7})$/);
  return m ? m[1] : null;
}

function getYouTubeId(url) {
  const m = String(url || '').match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function excerpt(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Yeni Ozanlar’da bir şiir.';
  if (clean.length <= 220) return clean;
  return clean.slice(0, 217).replace(/\s+\S*$/, '') + '…';
}

function titleFromSlug(slug) {
  const clean = String(slug || '').replace(/-[A-Za-z0-9]{7}$/, '').replace(/-/g, ' ').trim();
  return clean ? clean.replace(/\b\w/g, c => c.toUpperCase()) : 'Yeni Ozanlar';
}

function siteOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function isCrawler(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

function currentVersion(req) {
  const raw = String(req.query?.v || '');
  return raw ? `?v=${encodeURIComponent(raw)}` : '';
}

module.exports = async function handler(req, res) {
  try {
    const slug = String(req.query?.slug || '');
    const id = getIdFromSlug(slug);
    const origin = siteOrigin(req);

    if (!id) return res.status(404).send('Şiir bulunamadı.');

    // İnsan ziyaretçisi: SPA'nın gerçek detay ekranına geç.
    if (!isCrawler(req)) {
      return res.redirect(302, `/#postdetail-${encodeURIComponent(id)}`);
    }

    const snap = await db.collection('posts').doc(id).get();
    const post = snap.exists ? snap.data() : null;

    const title = post?.title || titleFromSlug(slug);
    const description = excerpt(post?.text);
    const canonical = `${origin}/post/${encodeURIComponent(slug)}${currentVersion(req)}`;

    let image = null;
    const storedImage = String(post?.image || '');

    if (/^https?:\/\//i.test(storedImage)) {
      image = storedImage;
    } else if (/^data:image\//i.test(storedImage)) {
      image = `${origin}/api/postImage?id=${encodeURIComponent(id)}${post?.ts ? `&v=${encodeURIComponent(post.ts)}` : ''}`;
    }

    const yt = getYouTubeId(post?.youtube);
    if (!image && yt) {
      image = `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;
    }

    const body = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta property="og:image:secure_url" content="${esc(image)}">\n<meta property="og:image:type" content="image/jpeg">\n<meta property="og:image:alt" content="${esc(title)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
</head>
<body>
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${image ? `<img src="${esc(image)}" alt="${esc(title)}">` : ''}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(body);
  } catch (err) {
    console.error('postPreview error:', err);
    return res.status(500).send('Önizleme oluşturulamadı.');
  }
};
