# Yeni Ozanlar — Admin geliştirmeleri

Bu paket mevcut `index.html` dosyasına aşağıdaki geliştirmeleri ekler:

1. **Admin → Üste Taşı**
   - Admin istediği şiiri akışın en üstüne sabitleyebilir.
   - `📌 Üste Taşı` / `📍 Üstten Kaldır` şeklinde çalışır.
   - Firebase'de `pinnedAt` alanı saklanır; sayfa yenilense de sıralama korunur.

2. **Admin → AI Görseli Yenile**
   - Mevcut `🤖 Yapay Zeka ile Yeniden Değerlendir` butonunun yanına `🎨 AI Görseli Yenile` eklenmiştir.
   - Admin bastığında şiirin konusu, atmosferi ve metni Gemini tarafından analiz edilir.
   - Yeni görsel şiire uygun üretilir ve şiirden kısa bir Türkçe bölüm görselin üzerine yazdırılır.
   - Yeni görsel Firebase Storage'a yüklenir ve Firestore'daki `posts/{postId}` kaydındaki `image` alanı güncellenir.

3. **Otomatik GIF yerine AI görseli**
   - Kullanıcı yeni bir şiir paylaşırken kendi görselini veya YouTube bağlantısını vermediyse, arka planda GIPHY yerine Gemini ile normal bir şiir görseli oluşturulur.
   - Kullanıcının kendi yüklediği görsele dokunulmaz.
   - Mevcut yorumlardaki GIPHY özelliği korunmuştur.

## Vercel kurulumu

Vercel projesinde Environment Variables bölümüne şunu ekleyin:

`GEMINI_API_KEY=Google_AI_Studio_API_anahtarınız`

Sonra yeniden deploy edin.

Google'ın güncel dokümantasyonuna göre görüntü üretimi için önerilen model `gemini-3.1-flash-image` (Nano Banana 2)'dir. Imagen modelleri 17 Ağustos 2026'da kapatıldığı için bu geliştirmede Imagen kullanılmamıştır.

## GitHub'a ekleme

Bu pakette:

- `index.html` → güncellenmiş ana dosya
- `api/ai-image.js` → Gemini görsel üretim endpoint'i
- `README.md` → kurulum notları

Mevcut projenizdeki diğer `api/` dosyalarını silmeyin. Sadece `api/ai-image.js` dosyasını ekleyin ve `index.html` dosyanızı bununla değiştirin.

> Not: Mevcut projenizde Firebase Storage kuralları `ai-post-images/` yoluna yazmayı engelliyorsa Storage rules dosyanızda bu yol için mevcut kullanıcı-yazma politikanıza uygun bir izin eklemeniz gerekir.
