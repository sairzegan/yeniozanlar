# Yeni Ozanlar — Facebook önizleme düzeltmesi

Bu ZIP yalnızca Facebook/OG önizlemesi için gereken dosyaları içerir.

## Yapılacaklar

1. KÖK dizindeki `package.json` dosyasını bununla değiştirin.
2. `api/postPreview.js` dosyasını bununla değiştirin.
3. `api/postImage.js` dosyasını bununla değiştirin.
4. `vercel.json` dosyasını bununla değiştirin.
5. **`api/package.json` varsa SİLİN.** Artık `api` klasöründe package.json olmamalı.
6. Vercel'e yeniden deploy edin.
7. Facebook Debugger'da eski URL için `Tekrar Kazı` yapın.

Kök package.json içinde `firebase-admin` özellikle bırakıldı; Firestore'dan şiir ve şiirin görselini okuyabilmesi için gereklidir.

Bu sürümde:
- Şiirin kendi görseli `og:image` olarak kullanılır.
- Firestore'daki `data:image;base64,...` görseli `/api/postImage?id=...` üzerinden gerçek image response'una çevrilir.
- Şiir başlığı `og:title` olur.
- Şiir metninin ilk bölümü `og:description` olur.
- Facebook botuna uygulama kabuğu yerine doğrudan temiz OG HTML verilir; gereksiz 3.5 saniyelik uygulama fetch'i bot yolundan çıkarılır.
- Normal ziyaretçiye ise gerçek uygulama kabuğu gösterilir.
- `og:image` URL'sinden `?v=...` kaldırıldı; Facebook için sabit ve temiz URL kullanılıyor.
