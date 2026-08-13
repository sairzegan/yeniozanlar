const PROJECT_ID = 'yeniozanlar-68b49';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

function firestoreValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(firestoreValue);
  if (v.mapValue) {
    const out = {};
    for (const [key, value] of Object.entries(v.mapValue.fields || {})) {
      out[key] = firestoreValue(value);
    }
    return out;
  }
  return null;
}

async function getPost(id) {
  const response = await fetch(FIRESTORE_URL + encodeURIComponent(id));
  if (!response.ok) return null;

  const data = await response.json();
  const post = {};
  for (const [key, value] of Object.entries(data.fields || {})) {
    post[key] = firestoreValue(value);
  }
  return post;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractId(slug) {
  const match = String(slug || '').match(/-([A-Za-z0-9]{7})$/);
  return match ? match[1] : null;
}

function youtubeId(url) {
  const match = String(url || '').match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function excerpt(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Yeni Ozanlar’da bir şiir.';
  return clean.length <= 300
    ? clean
    : clean.slice(0, 297).replace(/\s+\S*$/, '') + '…';
}

function isCrawler(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  try {
    const slug = String((req.query && req.query.slug) || '');
    const id = extractId(slug);

    if (!id) return res.status(404).send('Şiir bulunamadı.');

    // Normal ziyaretçi: hash adresine dön. Böylece /post/... rewrite döngüsüne girmez.
    if (!isCrawler(req)) {
      return res.redirect(302, `/#postdetail-${encodeURIComponent(id)}`);
    }

    const post = await getPost(id);
    if (!post) return res.status(404).send('Şiir bulunamadı.');

    const origin = getOrigin(req);
    const canonical = `${origin}/post/${encodeURIComponent(slug)}`;
    const title = post.title || 'Yeni Ozanlar';
    const description = excerpt(post.text);

    let image = null;
    if (post.image) {
      const rawImage = String(post.image);
      if (/^data:image\//i.test(rawImage)) {
        image = `${origin}/api/postImage?id=${encodeURIComponent(id)}`;
      } else if (/^https?:\/\//i.test(rawImage)) {
        image = rawImage;
      }
    }

    const yt = youtubeId(post.youtube);
    if (!image && yt) {
      image = `https://img.youtube.com/vi/${yt}/hqdefault.jpg`;
    }

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
${image ? `<meta property="og:image:secure_url" content="${escapeHtml(image)}">` : ''}
${image ? `<meta property="og:image:alt" content="${escapeHtml(title)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(description)}</p>
${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : ''}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (error) {
    console.error('postPreview error:', error);
    return res.status(500).send('Önizleme oluşturulamadı.');
  }
};
