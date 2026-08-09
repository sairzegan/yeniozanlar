// api/postPreview.js
//
// vercel.json'daki kural sayesinde bu fonksiyon YALNIZCA bilinen önizleme botları
// (Facebook, Twitter, WhatsApp, Slack, LinkedIn, Telegram, Discord, Google vb.)
// /post/{baslik-slug}-{id} adresine geldiğinde çalışır. Gerçek kullanıcılar bu
// fonksiyona hiç uğramaz; onlar doğrudan (ve önceden çalıştığı doğrulanmış şekilde)
// /index.html'e gider. Bu ayrım riski izole eder: bu fonksiyonda bir sorun olsa bile
// siteyi gezen gerçek kullanıcılar etkilenmez, sadece paylaşım kartı düşer.
//
// Botlar JavaScript çalıştırmadığı ve sayfanın geri kalanıyla ilgilenmediği için,
// burada uygulamanın tamamını değil, sadece doğru <meta og:...> etiketlerini içeren
// küçük/bağımsız bir HTML döndürüyoruz.

const FIREBASE_PROJECT_ID = "yeniozanlar-68b49";
const VARSAYILAN_GORSEL = "https://yeniozanlar-68b49.web.app/og-image.png";

function metniKisalt(metin, uzunluk = 160) {
  if (!metin) return "Şiirlerini paylaş, oku, puanla.";
  const temiz = metin.replace(/\s+/g, ' ').trim();
  if (temiz.length <= uzunluk) return temiz;
  const kirpilmis = temiz.slice(0, uzunluk);
  const sonBosluk = kirpilmis.lastIndexOf(' ');
  return (sonBosluk > 0 ? kirpilmis.slice(0, sonBosluk) : kirpilmis).trim() + '…';
}

function htmlKac(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function postGetir(id) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/posts/${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.fields || {};
    return {
      id,
      title: f.title?.stringValue || '',
      text: f.text?.stringValue || '',
      image: f.image?.stringValue || '',
    };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const baseUrl = `https://${req.headers.host}`;
  const slug = (req.query.slug || '').toString();
  const id = slug.includes('-') ? slug.slice(slug.lastIndexOf('-') + 1) : slug;

  const post = id ? await postGetir(id) : null;

  const baslik = post && post.title ? `"${post.title}" — Yeni Ozanlar 🪶` : 'Yeni Ozanlar 🪶';
  const aciklama = post ? metniKisalt(post.text) : 'Şiirlerini paylaş, oku, puanla.';
  const gorsel = post && post.image ? post.image : VARSAYILAN_GORSEL;
  const sayfaUrl = `${baseUrl}/post/${slug}`;

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>${htmlKac(baslik)}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:title" content="${htmlKac(baslik)}">
<meta property="og:description" content="${htmlKac(aciklama)}">
<meta property="og:image" content="${htmlKac(gorsel)}">
<meta property="og:url" content="${htmlKac(sayfaUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${htmlKac(baslik)}">
<meta name="twitter:description" content="${htmlKac(aciklama)}">
<meta name="twitter:image" content="${htmlKac(gorsel)}">
<meta http-equiv="refresh" content="0; url=${htmlKac(sayfaUrl)}">
</head>
<body>
<p><a href="${htmlKac(sayfaUrl)}">${htmlKac(baslik)}</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
