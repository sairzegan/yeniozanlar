// api/postPreview.js
//
// /post/{baslik-slug}-{id} adresine bir istek geldiğinde (vercel.json'daki rewrite
// sayesinde) bu fonksiyon çalışır. Facebook/WhatsApp/Twitter/Discord gibi platformların
// önizleme botları JavaScript ÇALIŞTIRMAZ; bu yüzden şiire özel başlık, kısaltılmış metin
// ve varsa görseli, sayfanın <head> kısmındaki <meta og:...> etiketlerine gömerek,
// normal uygulamanın (index.html) HTML'i içinde döndürüyoruz.
//
// Gerçek kullanıcılar için de dönen HTML birebir aynı uygulamadır — tek fark meta
// etiketlerinin artık o şiire özel olmasıdır. JS her zamanki gibi devreye girip
// (index.html'deki yönlendirme kodu) doğru şiiri açar; kullanıcı hiçbir fark görmez.

const FIREBASE_PROJECT_ID = "yeniozanlar-68b49";
const VARSAYILAN_GORSEL = "https://yeniozanlar-68b49.web.app/og-image.png";

// Şiirin metnini önizleme kartına sığacak kısalıkta, kelime ortasından kesmeden kırpar.
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

// Firestore REST API'sinden tek bir şiiri (id ile) çeker. Koleksiyon herkese açık
// okunabilir olduğu için (uygulama zaten client tarafında aynı şekilde okuyor) ayrı
// bir kimlik doğrulamaya gerek yok.
async function postGetir(id) {
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
}

module.exports = async (req, res) => {
  const baseUrl = `https://${req.headers.host}`;

  try {
    // vercel.json, /post/:slug isteklerini buraya /api/postPreview?slug=:slug olarak yönlendiriyor.
    const slug = (req.query.slug || '').toString();
    const id = slug.includes('-') ? slug.slice(slug.lastIndexOf('-') + 1) : slug;
    const post = id ? await postGetir(id) : null;

    // Uygulamanın kendi index.html'ini aynı deploy üzerinden çekip, sadece meta
    // etiketlerini şiire özel bilgiyle değiştiriyoruz. Böylece uygulamanın geri kalanı
    // (Firebase config, tüm ekranlar, JS) elle kopyalanmadan/bozulmadan aynen kalır.
    const htmlRes = await fetch(`${baseUrl}/index.html`);
    let html = await htmlRes.text();

    const baslik = post && post.title ? `"${post.title}" — Yeni Ozanlar 🪶` : 'Yeni Ozanlar 🪶';
    const aciklama = post ? metniKisalt(post.text) : 'Şiirlerini paylaş, oku, puanla.';
    const gorsel = post && post.image ? post.image : VARSAYILAN_GORSEL;
    const sayfaUrl = `${baseUrl}/post/${slug}`;

    html = html
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${htmlKac(baslik)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${htmlKac(aciklama)}">`)
      .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${htmlKac(gorsel)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${htmlKac(sayfaUrl)}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${htmlKac(baslik)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${htmlKac(aciklama)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${htmlKac(gorsel)}">`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Kısa bir CDN cache: her paylaşım isteğinde Firestore'a gitmesin, ama şiir
    // güncellenirse de 5 dakika içinde önizleme tazelensin.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).send(html);
  } catch (err) {
    console.error('postPreview hatası:', err);
    // Bir şeyler ters giderse en azından uygulamanın normal açılmasını sağla.
    try {
      const htmlRes = await fetch(`${baseUrl}/index.html`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(await htmlRes.text());
    } catch {
      res.status(500).send('Bir hata oluştu.');
    }
  }
};
