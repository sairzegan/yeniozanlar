# Yeni Ozanlar — Gemini → Pollinations → GIPHY

Bu sürüm mevcut çalışan GIPHY sistemini korur ve adminin **🎨 Yapay Zeka ile Yeniden Resim Oluştur** butonuna ikinci bir AI görsel sağlayıcısı ekler.

## Akış

1. Gemini (`GEMINI_API_KEY`)
2. Gemini kota/servis hatası verirse Pollinations (`POLLINATIONS_API_KEY`)
3. Gemini + Pollinations ikisi de başarısızsa mevcut istemci tarafı farklı-GIPHY fallback'i

## Vercel Environment Variables

```text
GEMINI_API_KEY=...
POLLINATIONS_API_KEY=...
GIPHY_API_KEY=...
```

`POLLINATIONS_API_KEY` olarak Pollinations'tan oluşturduğunuz **secret `sk_...`** anahtarı kullanın. Bu anahtar frontend koduna yazılmaz; sadece `api/ai-image.js` içinde sunucu tarafında okunur.

## Görsel promptu

Prompt doğrudan şiirin başlığını ve şiirin kendisini içerir. Ayrıca sinematik, şiirsel, gerçekçi ve şiirin duygusuna göre romantik/melankolik/rüya gibi atmosfer yönlendirmeleri bulunur. Görsel modeline rastgele bir "poetry" görseli üretmesi değil, şiirin gerçek konusu ve imgeleri üzerinden sahne kurması söylenir.

Görselin içine metin yazdırmıyoruz; Türkçe tipografiyi görsel üreticinin yerine web arayüzünde yapmak daha güvenilirdir.

## Not

`api/giphy.js` değiştirilmedi. Mevcut çalışan GIPHY endpoint'i korunmuştur.
