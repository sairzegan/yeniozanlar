# Yeni Ozanlar – GIPHY geri yükleme sürümü

Bu paket, mevcut `index.html` geliştirmelerini korurken GIPHY API dosyasını kullanıcının gönderdiği eski çalışan sürüme geri döndürür.

## Önemli
Mevcut projenizdeki diğer `api/*.js` dosyalarını silmeyin.

Kopyalanacak:
- `index.html` → mevcut index.html'nin yerine
- `api/giphy.js` → mevcut api/giphy.js'nin yerine
- `api/ai-image.js` → AI görsel özelliğini kullanacaksanız

Vercel Environment Variables:
- `GIPHY_API_KEY`
- `GEMINI_API_KEY` (AI görsel için)

GIPHY endpoint'i istemcinin beklediği `{ gifUrl, title }` yanıtını ve `{ error: { message } }` hata biçimini korur.
