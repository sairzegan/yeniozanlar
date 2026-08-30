# Bu güncellemede ne değişti?

## 1) Gerçek hatalar düzeltildi (kota DEĞİL)
- **`api/flux-image.js`** — GIPHY yedeğinde `X-GIPHY-Query` header'ına Türkçe
  karakterler (ş, ğ, ı, İ) çıplak yazılıyordu; Latin-1 header aralığının
  dışında oldukları için Node "Invalid character in header content"
  hatasıyla çöküyordu. Artık `encodeURIComponent(...)` ile yazılıyor.
- **`api/huggingface-image.js`** — Hugging Face eski
  `api-inference.huggingface.co` adresini tamamen kapattı ("fetch failed"
  bu yüzdendi, kota değildi). Artık resmi `@huggingface/inference` SDK'sını
  (`provider:"auto"`) kullanıyor.

## 2) Gerçek kota hataları (kodla düzeltilemez)
- **Cloudflare FLUX — HTTP 429**: günlük 10.000 nöron hakkı dolmuş.
- **Pollinations — HTTP 402**: pollen bakiyesi bitmiş.
- Firestore kotanızla hiçbir ilgisi yok.

## 3) Yeni sağlayıcı: Google Gemini (Nano Banana)
- **`api/gemini-image.js`** (yeni) — `gemini-2.5-flash-image`, aynı
  `GEMINI_API_KEY`'i kullanır. `index.html`'e `geminiGorselDene()` eklendi
  ve kademeye (Cloudflare → Pollinations → Hugging Face → **Gemini**) dahil
  edildi.

## 4) YENİ: Admin panelinde "🎨 Görsel AI Sağlayıcıları Durumu" kartı
Profil → Admin Paneli altına, "🤖 Groq API Kota Durumu" kartının hemen
altına eklendi. Her 4 sağlayıcı (Cloudflare FLUX, Pollinations, Hugging
Face, Gemini) için: son doğrudan test sonucu (✅/❌ + tam hata mesajı) ve
saat damgası gösterir; her biri için ayrı "🔍 Test Et" butonu var. Bu
butonlar otomatik zinciri (Cloudflare→Pollinations→HF→Gemini→GIPHY) atlayıp
sağlayıcıyı DOĞRUDAN çağırır — hangisinin neden başarısız olduğunu net
görmek için.

## 5) DÜZELTME: Bot yorumları (duyu-yorum/katlı-yorum/arı-yorum) artık ana AI
ile TUTARLI
**Sorun neydi:** "Yeniden Değerlendir" butonuna basınca, admin panelinden
Gemini veya Claude seçilse bile 3 bot yorum (duyu-yorum, katlı-yorum,
arı-yorum) HER ZAMAN Groq'u kullanıyordu — çünkü botları zorlayan kod
sadece "ana AI Groq kullandıysa aynı Groq modelini kullan" mantığındaydı;
Gemini/Claude seçiminde botlar kendi Groq kademesine (auto) düşüyordu. Bu
da ana değerlendirme ile 3 botun birbirinden tamamen farklı çıkmasına yol
açıyordu.

**Düzeltme:** Yeni bir `botAICagir()` dispatcher'ı eklendi. Artık:
1. Ana AI (`scorePoem`) çağrısı bitince, `sonBasariliSaglayiciyiBul()` ana
   AI'ın GERÇEKTE hangi sağlayıcıyı/modeli kullandığını okur (Groq'un hangi
   modeli, Gemini, Claude, ya da hepsi başarısız olup yerel algoritmaya mı
   düştü).
2. 3 bot da (`botDuyuPuan`, `botKatliPuan`, `botAriPuan`) artık BUNUNLA
   zorlanıyor — Groq/Gemini/Claude/yerel fark etmeksizin.

Bu, hem tekil "🤖 Yapay Zeka ile Yeniden Değerlendir" butonunda hem de
toplu "🔄 Tüm Şiirleri Yeniden Değerlendir" butonunda düzeltildi.

## ⚠️ Firestore kotası hakkında önemli not
Görsel/yorum üretimi başarılı olsa bile son adım Firestore'a yazıyor.
Firestore kotanız gerçekten dolduysa bu son yazma adımı yine başarısız
olur — ayrı, çözülmesi gereken bir sorun.

## Vercel Environment Variables (gerekli)
| Değişken | Kullanan dosya |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | `api/flux-image.js` |
| `GIPHY_API_KEY` | `api/flux-image.js` (yedek), `api/giphy.js` |
| `POLLINATIONS_API_KEY` | `api/pollinations-image.js` |
| `HUGGINGFACE_API_TOKEN` | `api/huggingface-image.js` |
| `GEMINI_API_KEY` | `api/gemini-image.js` (yeni), `api/gemini.js` (mevcut) |
| `GROQ_API_KEY` | `api/groq.js` (mevcut) |

## Kurulum / deploy notu
`api/huggingface-image.js` artık `@huggingface/inference` paketine ihtiyaç
duyuyor. Kendi mevcut `package.json`'ınız varsa, oraya şunu ekleyin (bu
depodaki `package.json`'ı olduğu gibi ezmeyin):

```json
"@huggingface/inference": "^4.13.28"
```
