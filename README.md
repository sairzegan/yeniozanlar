# Yeni Ozanlar — güvenli düzeltme paketi

Bu paket, önceki hatalı geliştirmeyi geri alıp kullanıcının yüklediği ORİJİNAL `index.html` üzerinden hazırlanmıştır.

## Önemli
Bu paketi mevcut GitHub projesinin üzerine **birleştir**. Eski `api/groq.js`, `api/gemini.js`, `api/claude.js`, `api/facebookScrape.js` vb. mevcut serverless dosyalarını silme.

Kopyalanacaklar:
- `index.html` → mevcut orijinal index.html yerine
- `api/ai-image.js` → yeni dosya
- `api/giphy.js` → mevcut giphy.js yoksa ekle; varsa mevcut dosyanı bununla karşılaştırıp yalnızca eksikse kullan

## Environment Variables
Vercel'de:
- `GIPHY_API_KEY` — mevcut GIPHY anahtarın
- `GEMINI_API_KEY` — Gemini API anahtarın

Görsel butonu `POST /api/ai-image` çağırır. Görsel tarayıcıya data olarak gelir, sonra mevcut Firebase Storage'a yüklenir. Böylece Firestore'a büyük base64 görsel yazılmaz.

## Eklenen özellikler
- Admin: `📌 Üste Taşı / 📍 Üstten Kaldır`
- Admin: `🎨 Yapay Zeka ile Yeniden Resim Oluştur`
- Yeni paylaşımlarda mevcut otomatik GIPHY akışı korunmuştur; AI görsel sistemi GIPHY'nin yerine geçirilmemiştir.
