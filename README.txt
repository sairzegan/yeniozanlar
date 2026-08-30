BU ZIP TAM PROJE DEĞİL; mevcut projeye uygulanacak düzeltmedir.

1) middleware.js DOSYASINI KULLANMAYIN / SİLİN.
2) vercel.json dosyasını bu sürümle değiştirin.
3) api/postPreview.js ve api/postImage.js dosyalarını değiştirin.
4) KÖK package.json'ı tamamen bununla ezmeyin. Mevcut package.json içinde firebase-admin dependency yoksa ekleyin. @huggingface/inference gibi mevcut bağımlılıkları koruyun.
5) Deploy edin.

Bu sürüm /post URL'sini yalnızca bot User-Agent'ında /api/postPreview'a rewrite eder; normal tarayıcı /index.html'e gider. Görsel artık eski web.app/og-image.png adresine bağlanmaz; şiirin kendi image alanı /api/postImage üzerinden sunulur.
