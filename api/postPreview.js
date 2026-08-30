import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";

// Firebase yapılandırmanız (Kendi proje bilgilerinize göre burayı güncellediğinizden emin olun)
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID
};

if (!getApps().length) {
  initializeApp(firebaseConfig);
}
const db = getFirestore();

export default async function handler(req, res) {
  const userAgent = req.headers['user-agent'] || '';
  const isBot = /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Applebot|Discordbot|SkypeUriPreview/i.test(userAgent);

  // URL'den slug değerini al (örn: /post/deneme2-1mmg840 -> deneme2-1mmg840)
  const pathParts = req.url.split('?')[0].split('/');
  const slugWithId = pathParts[pathParts.length - 1];

  let poemData = {
    title: "Yeni Ozanlar",
    description: "Yeni Ozanlar'da paylaşılan şiir ve eserler.",
    image: "",
    youtubeUrl: ""
  };

  try {
    // Firestore'da slug veya id alanına göre veriyi arıyoruz
    const postsRef = collection(db, "posts"); // Veritabanı koleksiyon adınız farklıysa burayı düzeltin (örn: "siirler")
    
    // Hem ID hem de slug alanlarını kontrol edelim
    const q = query(postsRef, where("slug", "==", slugWithId));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const docData = querySnapshot.docs[0].data();
      poemData.title = docData.title || docData.baslik || poemData.title;
      // Şiir yazıarının bir kısmı (açıklama için ilk 160 karakter)
      const rawContent = docData.content || docData.siirMetni || docData.description || "";
      poemData.description = rawContent.length > 160 ? rawContent.substring(0, 157) + "..." : rawContent;
      poemData.image = docData.image || docData.imageUrl || docData.photoUrl || "";
      poemData.youtubeUrl = docData.youtubeUrl || docData.videoUrl || "";
    }
  } catch (error) {
    console.error("Firestore veri çekme hatası:", error);
  }

  // Medya etiketlerini oluşturma
  let mediaTags = '';
  if (poemData.youtubeUrl) {
    const videoId = extractYouTubeId(poemData.youtubeUrl);
    if (videoId) {
      mediaTags = `
        <meta property="og:type" content="video.other" />
        <meta property="og:video" content="https://www.youtube.com/embed/${videoId}" />
        <meta property="og:video:secure_url" content="https://www.youtube.com/embed/${videoId}" />
        <meta property="og:video:type" content="text/html" />
        <meta property="og:video:width" content="1280" />
        <meta property="og:video:height" content="720" />
        <meta name="twitter:card" content="player" />
      `;
    }
  } else if (poemData.image) {
    mediaTags = `
      <meta property="og:image" content="${poemData.image}" />
      <meta property="og:image:secure_url" content="${poemData.image}" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
    `;
  } else {
    // Görsel yoksa varsayılan site görünümü
    mediaTags = `<meta name="twitter:card" content="summary" />`;
  }

  const currentFullUrl = `https://${req.headers.host}${req.url}`;

  if (isBot) {
    // Sosyal medya botları için optimize edilmiş saf HTML ve Open Graph etiketleri
    const html = `<!DOCTYPE html>
      <html lang="tr">
      <head>
          <meta charset="UTF-8">
          <title>${escapeHtml(poemData.title)}</title>
          <meta property="og:site_name" content="Yeni Ozanlar">
          <meta property="og:title" content="${escapeHtml(poemData.title)}" />
          <meta property="og:description" content="${escapeHtml(poemData.description)}" />
          <meta property="og:url" content="${currentFullUrl}" />
          <meta property="og:type" content="article" />
          ${mediaTags}
          <meta name="twitter:title" content="${escapeHtml(poemData.title)}" />
          <meta name="twitter:description" content="${escapeHtml(poemData.description)}" />
          ${poemData.image ? `<meta name="twitter:image" content="${poemData.image}" />` : ''}
      </head>
      <body>
          <h1>${escapeHtml(poemData.title)}</h1>
          <p>${escapeHtml(poemData.description)}</p>
      </body>
      </html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } else {
    // Normal kullanıcılar tarayıcıdan girerse direkt uygulamanıza yönlendirilsin
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
}

function extractYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(틱/g, '&#039;');
}
