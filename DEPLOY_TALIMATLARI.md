# Şiir Paylaşım Önizlemesi — Kurulum Talimatları

Bu klasördeki dosyalar, bir şiir linki Facebook/WhatsApp/Twitter'da paylaşıldığında
o şiirin başlığını, bir bölümünü ve görselini önizleme kartında göstermeyi sağlar.

## 1) Neden bir sunucu fonksiyonu gerekiyor?

Uygulamanız (index.html) tamamen tarayıcıda JavaScript ile çiziliyor. Facebook'un
"önizleme botu" bir linke istek attığında JavaScript ÇALIŞTIRMAZ — sadece ham HTML'i
okur. Bu yüzden şiirin içeriğini gösterebilmemiz için, bot geldiğinde ona doğru
`<meta property="og:...">` etiketleriyle küçük bir HTML sunacak bir sunucu parçasına
ihtiyaç var. `functions/index.js` işte bunu yapıyor.

## 2) Gereksinim: Firebase Blaze Planı

Cloud Functions (dışa istek atabilen HTTP fonksiyonları) için projenizin
**Blaze (kullandıkça öde)** planında olması gerekir. Firebase konsolunda
Project Settings → Usage and billing kısmından yükseltebilirsiniz. Bu fonksiyonlar
çok düşük trafikte pratikte ücretsiz sınırlar içinde kalır.

## 3) Dosyaları yerleştirin

Projenizin kök klasöründe (index.html'in olduğu yer) şu yapı olmalı:

```
proje-klasörü/
├── index.html          ← (zaten var)
├── og-image.png         ← (verdiğim varsayılan önizleme görseli, kök dizine koyun)
├── firebase.json         ← (bu klasördeki dosya)
└── functions/
    ├── index.js
    └── package.json
```

## 4) Firebase CLI ile deploy edin

```bash
npm install -g firebase-tools     # yoksa kurun
firebase login
cd proje-klasörü
cd functions && npm install && cd ..
firebase deploy --only functions,hosting
```

## 5) SITE_URL'i kontrol edin

`functions/index.js` içindeki en üstteki `SITE_URL` sabitinin, sitenizin gerçek
adresiyle eşleştiğinden emin olun (özel bir alan adınız varsa onu yazın).

## 6) Test edin

Deploy bittikten sonra, uygulamada bir şiirin 🔗 linkini kopyalayın
(artık `https://siteniz/post/ŞİİR_ID` formatında olacak) ve şu adrese yapıştırıp
test edin:

👉 https://developers.facebook.com/tools/debug/

"Scrape Again" (yeniden tara) butonuna basarsanız, önbelleğe alınmış eski
önizlemeyi de temizler.

## Not

`og-image.png`, henüz görseli olmayan şiirler veya sitenin genel linki paylaşıldığında
kullanılan varsayılan karttır. İsterseniz kendi logonuzla değiştirebilirsiniz —
tek şart 1200×630 boyutlarında bir PNG/JPG olması.
