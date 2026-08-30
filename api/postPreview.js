export default async function handler(req, res) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const isBot = /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot|Discordbot|SkypeUriPreview/i.test(userAgent);

    // URL'den slug/id değerini güvenli şekilde alalım
    const pathParts = req.url.split('?')[0].split('/');
    const slugWithId = pathParts[pathParts.length - 1];

    // Şiir verisi (Veritabanı bağlantısı serverless ortamda hata verse bile sayfa çökmesin diye try-catch içinde)
    let title = "Yeni Ozanlar";
    let description = "Yeni Ozanlar'da paylaşılan bu güzel şiiri okuyun.";
    let imageUrl = "";

    // Eğer slug varsa başlığa yansıtabiliriz
    if (slugWithId && slugWithId !== 'post') {
      title = `Şiir: ${slugWithId.replace(/-/g, ' ')}`;
    }

    const currentFullUrl = `https://${req.headers.host}${req.url}`;

    if (isBot) {
      const html = `<!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <meta property="og:site_name" content="Yeni Ozanlar">
            <meta property="og:title" content="${title}" />
            <meta property="og:description" content="${description}" />
            <meta property="og:url" content="${currentFullUrl}" />
            <meta property="og:type" content="article" />
            ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ''}
            <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
            <meta name="twitter:title" content="${title}" />
            <meta name="twitter:description" content="${description}" />
            ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}
        </head>
        <body>
            <h1>${title}</h1>
            <p>${description}</p>
        </body>
        </html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    } else {
      // Normal kullanıcılar için yönlendirme
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${currentFullUrl}">
          </head>
          <body>
            <script>window.location.href = "${currentFullUrl}";</script>
          </body>
        </html>`);
    }
  } catch (err) {
    // Sunucu patlasa bile Facebook'a her zaman 200 dön ki 500 hatası alınmasın
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html><head><title>Yeni Ozanlar</title><meta property="og:title" content="Yeni Ozanlar"><meta property="og:description" content="Yeni Ozanlar şiir platformu."></head><body><h1>Yeni Ozanlar</h1></body></html>`);
  }
}
