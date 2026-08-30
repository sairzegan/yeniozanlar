import { db } from './firebaseAdmin.js';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

export default async function handler(req, res) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const isBot = /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot|Discordbot|SkypeUriPreview/i.test(userAgent);

    // URL'den slug veya id değerini alalım
    const fullUrl = req.url || '';
    const pathParts = fullUrl.split('?')[0].split('/');
    const postId = pathParts[pathParts.length - 1];

    let title = "Yeni Ozanlar";
    let description = "Yeni Ozanlar'da paylaşılan şiir ve eserler.";
    let imageUrl = "";

    // Firestore'dan şiir verisini çekmeye çalışalım
    if (postId && postId !== 'post' && db) {
      try {
        // Önce doğrudan ID ile deneyelim
        let docRef = doc(db, "posts", postId);
        let docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          // Bulunamazsa slug alanı ile sorgulayalım
          const q = query(collection(db, "posts"), where("slug", "==", postId));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            docSnap = querySnapshot.docs[0];
          }
        }

        if (docSnap && docSnap.exists()) {
          const data = docSnap.data();
          title = data.title || data.baslik || title;
          const rawContent = data.content || data.siirMetni || data.description || "";
          description = rawContent.length > 160 ? rawContent.substring(0, 157) + "..." : rawContent;
          imageUrl = data.image || data.imageUrl || data.photoUrl || "";
        }
      } catch (dbError) {
        console.error("Firestore okuma hatası:", dbError);
      }
    }

    const currentFullUrl = `https://${req.headers.host}${fullUrl}`;

    if (isBot) {
      // Facebook ve X botları için OG etiketleri
      const html = `<!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <title>${escapeHtml(title)}</title>
            <meta property="og:site_name" content="Yeni Ozanlar">
            <meta property="og:title" content="${escapeHtml(title)}" />
            <meta property="og:description" content="${escapeHtml(description)}" />
            <meta property="og:url" content="${currentFullUrl}" />
            <meta property="og:type" content="article" />
            ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ''}
            ${imageUrl ? `<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />` : ''}
            <meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />
            <meta name="twitter:title" content="${escapeHtml(title)}" />
            <meta name="twitter:description" content="${escapeHtml(description)}" />
            ${imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : ''}
        </head>
        <body>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(description)}</p>
        </body>
        </html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    } else {
      // Normal kullanıcılar için yönlendirme döngüsü yaratmamak adına 
      // doğrudan ana index sayfasına veya istemci tarafına akışı bırakıyoruz.
      // Vercel rewrites zaten index.html'e düşürür, burada istek yakalandıysa 
      // tarayıcının kendi routing'ine devam etmesi için boş bir html dönebiliriz 
      // veya istemcinin React uygulamasını yüklemesini sağlayabiliriz.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${currentFullUrl}"></head><body></body></html>`);
    }
  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html><html><head><title>Yeni Ozanlar</title></head><body><h1>Yeni Ozanlar</h1></body></html>`);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
