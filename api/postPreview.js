export default function handler(req, res) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const isBot = /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot|Discordbot|SkypeUriPreview/i.test(userAgent);

    // URL'den slug değerini ve query parametrelerini güvenle ayıkla
    const fullUrl = req.url || '';
    const pathWithoutQuery = fullUrl.split('?')[0];
    const pathParts = pathWithoutQuery.split('/');
    const slug = pathParts[pathParts.length - 1] || 'siir';

    // Şiir başlığı ve metin düzenlemesi
    const cleanTitle = decodeURIComponent(slug).replace(/[-_]/g, ' ');
    const title = `Şiir: ${cleanTitle}`;
    const description = "Yeni Ozanlar'da paylaşılan bu eşsiz şiiri okumak için tıklayın.";
    
    // Varsayılan sabit bir Open Graph görseli (projenizde public klasöründe og-image.jpg olmalı veya doğrudan site logonuzun linkini yazabilirsiniz)
    const imageUrl = `https://${req.headers.host}/og-image.jpg`;
    const currentFullUrl = `https://${req.headers.host}${fullUrl}`;

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
            <meta property="og:image" content="${imageUrl}" />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content="${title}" />
            <meta name="twitter:description" content="${description}" />
            <meta name="twitter:image" content="${imageUrl}" />
        </head>
        <body>
            <h1>${title}</h1>
            <p>${description}</p>
        </body>
        </html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    } else {
      // Normal kullanıcılar tarayıcıdan tıkladığında direkt siteye yönlendirilir
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
  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html><head><title>Yeni Ozanlar</title></head><body><h1>Yeni Ozanlar</h1></body></html>`);
  }
}
