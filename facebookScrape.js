// api/facebookScrape.js
//
// Facebook Sharing Debugger'daki "Scrape Again" butonunun kod karşılığıdır.
// Facebook, bir Graph API çağrısıyla (scrape=true) belirli bir linkin önbelleğini
// programatik olarak tazeleme imkânı sunar. Bu fonksiyon o çağrıyı yapar; böylece
// bir şiir paylaşıldığında/düzenlendiğinde uygulama otomatik olarak Facebook'a
// "bu linki yeniden tara" der, kimse elle Debugger'a girmek zorunda kalmaz.
//
// KURULUM (bir kerelik):
// 1) developers.facebook.com üzerinden ücretsiz bir "Uygulama" (App) oluşturun
//    (Tip: "Diğer" / "Business" fark etmez, inceleme/onay gerekmez, sadece App ID
//    ve App Secret almak için).
// 2) Uygulama panelinde Ayarlar > Temel (Settings > Basic) kısmından
//    "Uygulama Kimliği" (App ID) ve "Uygulama Sırrı" (App Secret)'ı kopyalayın.
// 3) Vercel projenizde: Settings > Environment Variables kısmına ekleyin:
//      FB_APP_ID     = <App ID>
//      FB_APP_SECRET = <App Secret>
//    (Secret'ı ASLA index.html gibi client tarafı bir dosyaya koymayın — sadece
//    burada, sunucu tarafında kullanılır.)
// 4) Değişkenleri ekledikten sonra Vercel'de projeyi yeniden deploy edin
//    (environment variable eklemek otomatik yeniden deploy tetiklemez).
//
// KULLANIM:
//  - Uygulama içinden: POST /api/facebookScrape  body: { "url": "https://.../post/..." }
//  - Tek seferlik manuel test için tarayıcıdan:
//      https://SITENIZ/api/facebookScrape?url=https://SITENIZ/post/BASLIK-ID

module.exports = async (req, res) => {
  try {
    const url = (req.method === 'POST' ? req.body?.url : req.query.url) || '';
    if (!url || !/^https?:\/\//.test(url)) {
      res.status(400).json({ ok: false, error: 'Geçerli bir url gerekli.' });
      return;
    }

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) {
      res.status(500).json({
        ok: false,
        error: 'FB_APP_ID / FB_APP_SECRET ortam değişkenleri tanımlı değil. Vercel > Settings > Environment Variables kısmına ekleyip yeniden deploy edin.'
      });
      return;
    }

    const graphUrl = `https://graph.facebook.com/v19.0/?id=${encodeURIComponent(url)}&scrape=true&access_token=${encodeURIComponent(appId + '|' + appSecret)}`;
    const fbRes = await fetch(graphUrl, { method: 'POST' });
    const fbData = await fbRes.json().catch(() => null);

    if (!fbRes.ok) {
      res.status(502).json({ ok: false, error: 'Facebook API hata döndürdü.', detay: fbData });
      return;
    }

    res.status(200).json({ ok: true, facebook: fbData });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
