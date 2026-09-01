# Blaze GEREKMEZ — Vercel Blob'a geçildi

## 1) Vercel'de Blob deposu oluşturun (ücretsiz, kredi kartı istemez)
1. Vercel Dashboard → projeniz (yeniozanlar) → üstteki **Storage** sekmesi
2. **Create Database** → **Blob** seçin
3. İsim verip oluşturun, projenize otomatik bağlanır
4. Bu işlem otomatik olarak `BLOB_READ_WRITE_TOKEN` ortam değişkenini ekler
   (elle bir şey girmenize gerek yok)

## 2) package.json'a bağımlılık ekleyin
Mevcut `package.json`'ınızın `"dependencies"` kısmına şunu ekleyin:
```json
"@vercel/blob": "^0.27.0"
```
(Firebase Storage artık kullanılmıyor, firebase-admin diğer dosyalar için
hâlâ gerekli, onu SİLMEYİN.)

## 3) ElevenLabs ses kütüphanesi (daha önce söylediğim, hâlâ gerekli)
elevenlabs.io → Voice Library → şu 5 sesi arayıp her birinde
"Add to my voices" deyin: **Rachel, Bella, Antoni, Adam, Elli**
(Yapmazsanız 402 "payment_required" hatası almaya devam edersiniz.)

## 4) api/ttsGenerate.js dosyasını üzerine yazın (ekteki dosya)

## Test edildi
- Sahte bir ElevenLabs yanıtıyla ve sahte @vercel/blob `put()` fonksiyonuyla
  uçtan uca simüle edildi: doğru dosya yolu, doğru içerik türü, doğru
  genel-erişim URL'si döndüğü doğrulandı.
