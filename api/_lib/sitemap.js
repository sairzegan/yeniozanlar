// Dinamik sitemap: Firestore'daki tüm (gizli olmayan) şiirleri /sitemap.xml olarak sunar.
// vercel.json içindeki rewrite ile /sitemap.xml -> /api/lib/sitemap yönlenir.
const SITE = 'https://yeniozanlar.vercel.app';
const PROJECT = 'yeniozanlar-68b49';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY';

function slugOlustur(metin) {
  const trMap = {'ç':'c','Ç':'c','ğ':'g','Ğ':'g','ı':'i','İ':'i','ö':'o','Ö':'o','ş':'s','Ş':'s','ü':'u','Ü':'u'};
  let s = (metin || '').toString().trim();
  s = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => trMap[ch]);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\s-]/g, '');
  s = s.trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/, '');
  return s || 'siir';
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function tumSiirler() {
  const sonuc = [];
  let pageToken = '';
  do {
    const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
      '/databases/(default)/documents/posts?pageSize=300&key=' + API_KEY +
      '&mask.fieldPaths=title&mask.fieldPaths=text&mask.fieldPaths=hidden&mask.fieldPaths=ts' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url);
    if (!r.ok) throw new Error('Firestore ' + r.status);
    const j = await r.json();
    for (const d of (j.documents || [])) {
      const f = d.fields || {};
      if (f.hidden && f.hidden.booleanValue === true) continue;
      const id = d.name.split('/').pop();
      const baslik = (f.title && f.title.stringValue) || (f.text && f.text.stringValue) || '';
      const ts = f.ts ? Number(f.ts.integerValue || f.ts.doubleValue || 0) : 0;
      sonuc.push({ id, baslik, ts });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return sonuc;
}

module.exports = async (req, res) => {
  const bugun = new Date().toISOString().slice(0, 10);
  let satirlar = '  <url>\n    <loc>' + SITE + '/</loc>\n    <lastmod>' + bugun + '</lastmod>\n  </url>\n';
  try {
    const siirler = await tumSiirler();
    for (const p of siirler) {
      const loc = SITE + '/post/' + slugOlustur(p.baslik) + '-' + p.id;
      const lastmod = p.ts > 0 ? new Date(p.ts).toISOString().slice(0, 10) : bugun;
      satirlar += '  <url>\n    <loc>' + esc(loc) + '</loc>\n    <lastmod>' + lastmod + '</lastmod>\n  </url>\n';
    }
  } catch (e) {
    console.error('sitemap hata:', e);
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + satirlar + '</urlset>\n');
};
