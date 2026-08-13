const PROJECT_ID = 'yeniozanlar-68b49';
const FIREBASE_API_KEY = 'AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeFirestoreValue(v) {
  if (!v) return null;
  if (Object.prototype.hasOwnProperty.call(v, 'stringValue')) return v.stringValue;
  if (Object.prototype.hasOwnProperty.call(v, 'integerValue')) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, 'doubleValue')) return Number(v.doubleValue);
  if (Object.prototype.hasOwnProperty.call(v, 'booleanValue')) return v.booleanValue;
  if (Object.prototype.hasOwnProperty.call(v, 'timestampValue')) return v.timestampValue;
  if (Object.prototype.hasOwnProperty.call(v, 'nullValue')) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if (v.mapValue) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = decodeFirestoreValue(val);
    return out;
  }
  return null;
}

async function getPost(id) {
  const url = FIRESTORE_BASE + encodeURIComponent(id) + '?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Firestore ${response.status}: ${detail.slice(0, 400)}`);
  }
  const data = await response.json();
  const post = {};
  for (const [key, value] of Object.entries(data.fields || {})) {
    post[key] = decodeFirestoreValue(value);
  }
  return post;
}

function getPostId(slug) {
  const match = String(slug || '').match(/-([A-Za-z0-9]{7})$/);
  return match ? match[1] : null;
}

function getYouTubeId(url) {
  const match = String(url || '').match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function makeExcerpt(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Yeni Ozanlar’da bir şiir.';
  if (clean.length <= 260) return clean;
  return clean.slice(0, 257).replace(/\s+\S*$/, '') + '…';
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function isCrawler(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|pinterest|slackbot|discordbot|googlebot/i.test(ua);
}

module.exports = async function handler(req, res) {
  const slug = String(req.query?.slug || '');
  const id = getPostId(slug);
  const origin = getOrigin(req);

  if (!id) return res.status(404).send('Şiir bulunamadı.');

  // Normal ziyaretçi uygulamaya gitsin.
  if (!isCrawler(req)) {
    return res.redirect(302, `/#postdetail-${encodeURIComponent(id)}`);
  }

  try {
    const post = await getPost(id);
    const title = post.title || 'Yeni Ozanlar';
    const description = makeExcerpt(post.text);

    let image = null;
    const storedImage = String(post.image || '');

    if (/^https?:\/\//i.test(storedImage)) {
      image = storedImage;
    } else if (/^data:image\//i.test(storedImage)) {
      image = `${origin}/api/postImage?id=${encodeURIComponent(id)}${post.ts ? `&v=${encodeURIComponent(post.ts)}` : ''}`;
    }

    const youtube = getYouTubeId(post.youtube);
    if (!image && youtube) {
      image = `https://img.youtube.com/vi/${youtube}/maxresdefault.jpg`;
    }

    const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:url" content="${esc(`${origin}${req.url}`)}">
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
${image ? `<img src="${esc(image)}" alt="${esc(title)}" style="max-width:100%;height:auto">` : ''}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).send(html);
  } catch (error) {
    console.error('postPreview:', error);
    return res.status(200).send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta property="og:title" content="Yeni Ozanlar"><meta property="og:description" content="Yeni Ozanlar’da bir şiir."><meta name="twitter:card" content="summary"></head><body><h1>Yeni Ozanlar</h1><p>Yeni Ozanlar’da bir şiir.</p></body></html>`);
  }
};
