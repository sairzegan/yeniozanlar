// generate-sitemap.js
//
// Firestore'daki TÜM şiirleri okuyup, her biri için index.html'deki paylasimLinki()
// ile BİREBİR AYNI mantıkla ("başlık-slug-ID") bir <url> satırı üreten script.
// Sabit sayfalar (anasayfa, keşfet, lider tablosu vb.) da ayrıca eklenir.
//
// Neden statik bir sitemap.xml elle yazılamıyor?
// Şiirler kullanıcılar tarafından sürekli eklenip silindiği için sitemap'in de
// her deploy'da güncellenmesi gerekiyor. Bu script'i her "vercel deploy"dan hemen
// önce (ya da bir build adımı olarak) çalıştırmanız yeterli.
//
// KULLANIM:
//   node generate-sitemap.js
// (Node.js 18+ gerekir; fetch() yerleşik olarak gelir.)
//
// Bunu her deploy öncesi otomatik çalıştırmak isterseniz, package.json'a şunu
// ekleyip Vercel'in "Build Command" ayarını "npm run build" yapabilirsiniz:
//   "scripts": { "build": "node generate-sitemap.js" }

const SITE_URL = "https://yeniozanlar.vercel.app"; // kendi Vercel adresinizle değiştirin
const FIREBASE_PROJECT_ID = "yeniozanlar-68b49";
const OUTPUT_FILE = "sitemap.xml";

// --- index.html'deki slugOlustur() ile birebir aynı mantık ---
function slugOlustur(metin) {
  const trMap = { 'ç':'c','Ç':'c','ğ':'g','Ğ':'g','ı':'i','İ':'i','ö':'o','Ö':'o','ş':'s','Ş':'s','ü':'u','Ü':'u' };
  let s = (metin || '').toString().trim();
  s = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => trMap[ch]);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\s-]/g, '');
  s = s.trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/, '');
  return s || 'siir';
}

function xmlKac(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Firestore REST API'sinden tüm "posts" dokümanlarını çeker (sayfalama destekli).
async function tumPostlariGetir() {
  const posts = [];
  let pageToken = null;
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/posts`;
  do {
    const url = new URL(baseUrl);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Firestore isteği başarısız (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    for (const doc of data.documents || []) {
      const f = doc.fields || {};
      const id = f.id?.stringValue || doc.name.split('/').pop();
      const title = f.title?.stringValue || '';
      const text = f.text?.stringValue || '';
      const ts = f.ts?.integerValue ? Number(f.ts.integerValue) : (f.ts?.doubleValue || null);
      posts.push({ id, title, text, ts });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return posts;
}

async function main() {
  console.log('Firestore\'dan şiirler çekiliyor...');
  const posts = await tumPostlariGetir();
  console.log(`${posts.length} şiir bulundu.`);

  const sabitSayfalar = [
    { loc: `${SITE_URL}/`, priority: '1.0' },
    { loc: `${SITE_URL}/#leaderboard/`, priority: '0.8' },
    { loc: `${SITE_URL}/#explore/`, priority: '0.8' },
    { loc: `${SITE_URL}/#profile/`, priority: '0.8' },
    { loc: `${SITE_URL}/#feed/`, priority: '0.8' },
  ];

  const postSatirlari = posts.map(p => {
    const slug = slugOlustur(p.title || p.text || '');
    const loc = `${SITE_URL}/post/${slug}-${p.id}`;
    const lastmod = p.ts ? new Date(p.ts).toISOString().slice(0, 10) : null;
    return { loc, priority: '0.6', lastmod };
  });

  const tumSatirlar = [...sabitSayfalar, ...postSatirlari];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${tumSatirlar.map(u => `  <url>
    <loc>${xmlKac(u.loc)}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  const fs = await import('node:fs');
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf-8');
  console.log(`✅ ${OUTPUT_FILE} güncellendi (${tumSatirlar.length} link).`);
}

main().catch(err => {
  console.error('❌ Sitemap üretilemedi:', err.message);
  process.exit(1);
});
