YENİ OZANLAR - FACEBOOK LINK ÖNİZLEME DÜZELTMESİ

Değiştirilecek dosyalar:
1) api/postPreview.js
2) api/postImage.js
3) vercel.json

ÖNEMLİ:
- FIREBASE_SERVICE_ACCOUNT_JSON Vercel Environment Variables içinde mevcut olmalıdır.
- Değişikliklerden sonra Vercel yeni deployment oluşturmalıdır.
- Facebook Debugger'da eski önbelleği temizlemek için "Tekrar Kazı" yapılabilir.
- Facebook'ta şiirin görseli, /api/postImage endpoint'i üzerinden sunulur; artık eski Firebase Hosting /og-image.png kullanılmaz.
- fb:app_id yalnızca FACEBOOK_APP_ID veya NEXT_PUBLIC_FACEBOOK_APP_ID tanımlıysa eklenir. App ID eksikliği görselin çalışmasını engellemez.
