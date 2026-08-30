# Yeni Ozanlar — Facebook Paylaşım Önizlemesi Düzeltmesi

## Bulunan hatalar

Facebook'un hata ayıklama aracı `/post/...` linklerinde **500** yanıt kodu
gösteriyordu. İncelemede birden fazla sorun tespit edildi:

1. **ESM/CommonJS uyuşmazlığı (asıl 500 sebebi olabilir)**
   `api/postPreview.js` ve `api/postImage.js` dosyaları `import` söz dizimini
   kullanıyordu, ama projede bunun bir ES Module olarak çalışacağını belirten
   hiçbir ayar yoktu. Vercel/Node.js, ilgili `package.json` içinde
   `"type": "module"` olmadığı sürece `.js` dosyalarını CommonJS olarak
   çalıştırmaya çalışır ve bu durumda fonksiyon "Cannot use import statement
   outside a module" hatasıyla çöküp **500** döner.
   → **Düzeltme:** `api/` klasörüne sadece o klasörü kapsayan bir
   `package.json` (`{"type": "module"}`) eklendi. Ana projenin kendi
   `package.json`'ına dokunmadan sadece API fonksiyonlarını ES Module olarak
   çalıştırır.

2. **`firebase-admin` bağımlılığı derlemeye dahil değildi**
   Vercel, kök dizindeki `package.json`'da listelenmeyen paketleri kurmaz.
   Bu da "Cannot find module 'firebase-admin'" hatasına ve yine 500'e yol
   açabilir.
   → **Düzeltme:** Kök `package.json` içine `firebase-admin` bağımlılığı
   eklendi (aşağıdaki "Kurulum" bölümüne bakın — mevcut bir `package.json`
   dosyanız varsa üzerine yazmayın, sadece bu bağımlılığı ekleyin).

3. **`FIREBASE_SERVICE_ACCOUNT_JSON` biçim hassasiyeti**
   Vercel ortam değişkeni arayüzüne servis hesabı JSON'u yapıştırılırken
   `private_key` alanındaki satır sonları bazen gerçek satır sonuna
   dönüşüp JSON'u bozabiliyor (`JSON.parse` hatası → 500).
   → **Düzeltme:** `JSON.parse` başarısız olursa, satır sonlarını otomatik
   olarak `\n` kaçış diziliğine çevirip tekrar deneyen bir onarım adımı
   eklendi.

4. **Gerçek ziyaretçiler de statik önizleme sayfasına düşüyordu**
   Kod içinde bot tespiti yapan `bot()` fonksiyonu tanımlanmış ama hiçbir
   yerde kullanılmıyordu. Sonuç olarak Facebook botu da, siteye tıklayan
   gerçek bir kullanıcı da aynı sabit HTML sayfasını görüyordu; bu sayfanın
   linki de kendi kendine referans verdiği için kullanıcı asıl uygulamaya
   hiç giremiyordu.
   → **Düzeltme:** `bot()` artık fiilen kullanılıyor. Facebook/Twitter/
   WhatsApp gibi paylaşım botları önizleme (OG etiketli) sayfasını görür;
   gerçek tarayıcılar her zaman asıl uygulamanızı (`index.html`) alır.

5. **ID çıkarma regex'i yanlış eşleşebiliyordu**
   Eski kod, slug içindeki İLK 7 karakterlik alfasayısal bloğu şiir ID'si
   sanıyordu. Başlıktan gelen bir kelime tesadüfen 7 harfli olursa
   (`kelime1-tzpyd43` gibi) yanlış ID yakalanıp Firestore'da kayıt
   bulunamıyor, önizleme kırılıyordu.
   → **Düzeltme:** ID her zaman slug'ın sonunda olduğu için artık SON
   eşleşme alınıyor.

6. **Firebase/Firestore erişilemezse çıplak 500 dönüyordu**
   Facebook bir sayfadan 500 aldığında hiçbir önizleme göstermeden sadece
   çıplak linki bırakır — sizin şikayet ettiğiniz durum tam olarak buydu.
   → **Düzeltme:** Firestore'a ulaşılamasa bile artık genel site bilgileriyle
   (başlık + açıklama, gerekirse görselsiz) bir OG kartı döndürülüyor; 500
   yerine her zaman gösterilebilir bir önizleme veriliyor.

## Güncelleme (v2): "og:image açıkça belirtilmedi" uyarısı

İlk düzeltmeden sonra 500 hatası gitti (yanıt kodu artık 200), fakat Facebook
Hata Ayıklama aracı görseli olmayan bir şiiri test ederken şu uyarıyı verdi:

> The 'og:image' property should be explicitly provided, even if a value can
> be inferred from other tags.

Bunun sebebi basit: o test şiirinin (`deneme-tzpyd43`) görseli yoktu ve eski
kodda görseli olmayan şiirler için `og:image` etiketi hiç eklenmiyordu.
Facebook, gösterecek hiçbir görsel bulamayınca bu uyarıyı veriyor.

**Düzeltme:** Artık görseli (ve YouTube kapak resmi de) olmayan şiirlerde,
hatta Firestore'a hiç ulaşılamadığında bile, varsayılan bir site görseli
(`${APP_URL}/og-default.jpg`) kullanılıyor. Böylece paylaşılan her linkte
mutlaka bir görsel gösteriliyor.

**Sizin yapmanız gereken tek şey:** Projenizin `public/` klasörüne
`og-default.jpg` adında, 1200x630 piksel boyutlarında bir görsel (logo,
site banner'ı vb.) eklemek. Dosya orada olduğu sürece kod otomatik olarak
onu kullanır; eklemezseniz sadece o görsel linki kırık olur, site geri kalanı
etkilenmez.

## Güncelleme (v3): "Invalid Image Content Type" hatası → kalıcı çözüm

`og-default.jpg` dosyasını `public/` klasörüne eklediğinizde Facebook şu hatayı
verdi:

> Provided og:image URL, https://yeniozanlar.vercel.app/og-default.jpg could
> not be processed as an image because it has an invalid content type.

**Sebep:** Statik dosyaların projenizde tam olarak hangi yoldan servis
edildiğini (build/çıktı klasör yapınızı) tam olarak bilmediğimiz için, kökten
yapılan `/og-default.jpg` isteği `vercel.json`'daki son genel kurala
(`"/(.*)" -> "/index.html"`) takılıp HTML döndürüyordu. Facebook görsel
beklerken HTML aldığı için hata veriyordu.

**Kalıcı çözüm:** Statik dosya sunumuna hiç güvenmek yerine, varsayılan
görseli doğrudan **kodun içine gömdüm** ve `/api/og-default` adında ayrı bir
fonksiyon üzerinden sunuyorum (`api/og-default.js`). Bu fonksiyon, tıpkı
zaten çalıştığı doğrulanmış `postPreview`/`postImage` fonksiyonları gibi
çalışır: Content-Type başlığını kendi elimizle `image/jpeg` olarak ayarlar,
hiçbir klasör yapısına veya rewrite kuralına bağımlı değildir.

Bu sürümü yerel olarak çalıştırıp test ettim: `/api/og-default` isteği
**200 durum kodu, `Content-Type: image/jpeg`** ve geçerli 1200×630 boyutunda
bir JPEG dosyası döndürüyor (aşağıdaki görsel kodun içine gömülü olan
görseldir).

**Sizin yapmanız gereken hiçbir ek adım yok** — `public/` klasörüne ayrıca
bir görsel yüklemenize gerek kalmadı, her şey kodun içinde hazır.

## Değiştirilen/eklenen dosyalar

```
api/package.json      (YENİ — API fonksiyonlarını ES Module yapar)
api/postPreview.js    (düzeltildi)
api/postImage.js      (düzeltildi)
api/og-default.js     (YENİ — varsayılan paylaşım görseli, koda gömülü)
vercel.json           (değişmedi, sıralama zaten doğruydu)
package.json          (YENİ veya mevcut olana firebase-admin eklenmeli)
.gitignore            (YENİ)
```

## Kurulum / mevcut projenize entegrasyon

Projenizde zaten bir `package.json` varsa, buradaki `package.json` dosyasının
üzerine yazmayın. Bunun yerine kendi dosyanızın `"dependencies"` kısmına şunu
ekleyin:

```json
"firebase-admin": "^12.0.0"
```

Diğer tüm dosyaları (`api/package.json`, `api/postPreview.js`,
`api/postImage.js`, `api/og-default.js`, `vercel.json`) doğrudan
projenizdeki aynı yollara kopyalayıp üzerine yazabilirsiniz.

## Vercel ortam değişkeni

Vercel projenizde **Settings → Environment Variables** kısmında
`FIREBASE_SERVICE_ACCOUNT_JSON` adında bir değişken olmalı ve değeri Firebase
servis hesabınızın **tüm JSON içeriği** olmalı (tek satır, tırnaksız
yapıştırın). Bu değişken yoksa veya yanlışsa önizleme genel (görselsiz)
içerikle dönecek, poem-özel önizleme çalışmayacaktır.

## GitHub'a push etme

```bash
git init
git add .
git commit -m "Facebook/OG paylasim onizlemesi duzeltmesi"
git branch -M main
git remote add origin <REPO_URL_NIZ>
git push -u origin main
```

Vercel'e bağladıktan/deploy ettikten sonra Facebook Paylaşım Ayıklayıcısı'nda
(`developers.facebook.com/tools/debug/`) linkinizi "Tekrar Kazı" ile yeniden
tarayarak sonucu kontrol edin.
