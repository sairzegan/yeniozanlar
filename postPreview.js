// api/postPreview.js
//
// vercel.json'daki kural sayesinde /post/{baslik-slug}-{id} adresine gelen HER istek
// (bot ya da gerçek kullanıcı, ayrım yapmadan) bu fonksiyona düşer. Fonksiyon:
//   1) URL'deki ID ile Firestore'dan ilgili şiiri çeker,
//   2) uygulamanın kendi index.html dosyasını DİSKTEN (ağ üzerinden tekrar
//      indirmeden — önceki sürümdeki kırılganlığın kaynağı buydu) okur,
//   3) sadece <meta og:...>/<meta twitter:...> etiketlerini o şiire özel bilgiyle
//      değiştirip aynı HTML'i (yani UYGULAMANIN TAMAMINI) geri döndürür.
// Böylece Facebook/WhatsApp/Twitter botu ilk uğradığı anda zaten doğru bilgiyi görür
// (elle "yeniden tara" yapmaya hiç gerek kalmaz) ve gerçek kullanıcı da her zamanki
// çalışan uygulamayı görmeye devam eder — ikisi de AYNI yanıtı alır.

const fs = require('fs');
const path = require('path');

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

  // Uygulamanın gerçek index.html'i — deploy'a dahil edildiğinden emin olmak için
  // vercel.json'da "includeFiles": "index.html" tanımlı olmalı.
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
  } catch (err) {
    // index.html hiç okunamazsa (beklenmedik bir durum), en azından hata vermeden
    // kullanıcıyı uygulamanın kök adresine yönlendir.
    res.writeHead(302, { Location: baseUrl + '/' });
    res.end();
    return;
  }

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

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${htmlKac(baslik)}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${htmlKac(baslik)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${htmlKac(aciklama)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${htmlKac(gorsel)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${htmlKac(sayfaUrl)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${htmlKac(baslik)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${htmlKac(aciklama)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${htmlKac(gorsel)}">`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
