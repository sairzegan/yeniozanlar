export default function handler(req, res) {
  try {
    const fullUrl = req.url || '';
    const pathWithoutQuery = fullUrl.split('?')[0];
    const pathParts = pathWithoutQuery.split('/');
    const slug = pathParts[pathParts.length - 1] || 'siir';

    const cleanTitle = decodeURIComponent(slug).replace(/[-_]/g, ' ');
    const title = `Şiir: ${cleanTitle}`;
    const description = "Yeni Ozanlar'da paylaşılan bu eşsiz şiiri okumak için tıklayın.";
    const imageUrl = `https://${req.headers.host}/logo.png`; // Projenizdeki geçerli bir görsel/logo URL'i
    const currentFullUrl = `https://${req.headers.host}${fullUrl}`;

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
  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html><head><title>Yeni Ozanlar</title></head><body><h1>Yeni Ozanlar</h1></body></html>`);
  }
}
