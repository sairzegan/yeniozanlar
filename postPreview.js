// api/postPreview.js
//
// vercel.json'daki kural sayesinde /post/{baslik-slug}-{id} adresine gelen HER istek
// bu fonksiyona düşer. Dosya sistemine veya ağ üzerinden index.html'i tekrar çekmeye
// hiç ihtiyaç duymadan çalışır (önceki sürümlerdeki kırılganlığın kaynağı buydu):
//
//   1) URL'deki ID ile Firestore'dan ilgili şiiri çeker.
//   2) O şiire özel <meta og:...>/<meta twitter:...> etiketlerini içeren, KÜÇÜK VE
//      BAĞIMSIZ bir HTML üretir. Facebook/WhatsApp/Twitter botları zaten sadece bu
//      etiketleri okur, JavaScript çalıştırmaz — bu yüzden botlar için bu kadarı yeterli.
//   3) Gerçek bir tarayıcıya (insan) ise, bu sayfa anında (<meta refresh> ile,
//      görünmeyecek kadar hızlı) uygulamanın kendisine (index.html'e, #postdetail-ID
//      ile) yönlendirir — orada uygulama zaten çalışan, test edilmiş kodla şiiri açar.

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

// index.html'deki ytId() ile aynı mantık: bir YouTube linkinden video ID'sini çıkarır.
function ytIdBul(url) {
  const m = url?.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
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
      youtube: f.youtube?.stringValue || '',
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
  let gorsel = VARSAYILAN_GORSEL;
  if (post?.image) {
    gorsel = post.image;
  } else if (post?.youtube) {
    const yid = ytIdBul(post.youtube);
    if (yid) gorsel = `https://img.youtube.com/vi/${yid}/hqdefault.jpg`;
  }
  const sayfaUrl = `${baseUrl}/post/${slug}`;
  // Gerçek kullanıcı buraya (uygulamanın çalışan haline) yönlendirilir.
  const uygulamaUrl = `${baseUrl}/index.html#postdetail-${encodeURIComponent(id)}`;

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${htmlKac(baslik)}</title>
<meta property="og:type" content="article">
<meta property="og:site_name" content="Yeni Ozanlar">
<meta property="og:title" content="${htmlKac(baslik)}">
<meta property="og:description" content="${htmlKac(aciklama)}">
<meta property="og:image" content="${htmlKac(gorsel)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${htmlKac(sayfaUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${htmlKac(baslik)}">
<meta name="twitter:description" content="${htmlKac(aciklama)}">
<meta name="twitter:image" content="${htmlKac(gorsel)}">
<meta http-equiv="refresh" content="0; url=${htmlKac(uygulamaUrl)}">
<script>location.replace(${JSON.stringify(uygulamaUrl)});</script>
</head>
<body>
<p><a href="${htmlKac(uygulamaUrl)}">${htmlKac(baslik)}</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
