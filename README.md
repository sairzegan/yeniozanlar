# Yeni Ozanlar – Gemini kota fallback

Admin "🎨 Yapay Zeka ile Yeniden Resim Oluştur" butonuna bastığında önce Gemini AI görseli denenir.
Gemini kota/AI isteği başarısız olursa işlem durmaz; mevcut şiirin temasına göre `/api/giphy` üzerinden farklı bir GIF aranır ve mevcut GIF'ten farklı bir sonuç seçilmeye çalışılır.

Mevcut çalışan `api/giphy.js` dosyası korunmuştur.

## Dosyalar
- index.html
- api/giphy.js
- api/ai-image.js

## Vercel
- GIPHY_API_KEY mevcut olmalı.
- Gemini kullanmak için GEMINI_API_KEY mevcut olmalı; Gemini kotası dolsa bile GIPHY fallback çalışır.
