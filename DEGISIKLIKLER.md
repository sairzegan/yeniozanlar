# Bu güncellemede ne değişti?

## 1) Gerçek hatalar düzeltildi (kota DEĞİL)
- **`api/flux-image.js`** — GIPHY yedeğinde `X-GIPHY-Query` header'ına Türkçe
  karakterler (ş, ğ, ı, İ) çıplak yazılıyordu; bu karakterler Latin-1 header
  aralığının dışında olduğu için Node "Invalid character in header content"
  hatasıyla çöküyordu. Artık `encodeURIComponent(...)` ile yazılıyor.
- **`api/huggingface-image.js`** — Hugging Face, eski
  `api-inference.huggingface.co` adresini tamamen kapattı (artık bağlantı
  hatası / "no longer supported" dönüyor). Bu yüzden "fetch failed"
  görüyordunuz — bu bir kota sorunu değildi, kırılan bir adresti. Dosya artık
  resmi `@huggingface/inference` SDK'sını (`provider:"auto"`) kullanıyor,
  böylece Hugging Face isteği o an FLUX'u hangi sağlayıcı (fal-ai, replicate,
  nebius vb.) üzerinden servis ediyorsa oraya otomatik yönlendiriyor.

## 2) Gerçek kota hataları (kodla düzeltilemez)
- **Cloudflare FLUX — HTTP 429**: "günlük ücretsiz 10.000 nöron hakkınız
  doldu" diyor. Ya yarın sıfırlanmasını bekleyin ya da Cloudflare Workers AI
  Paid plana geçin.
- **Pollinations — HTTP 402**: "Insufficient balance" diyor, yani
  hesabınızda pollen bakiyesi kalmamış. Bakiye eklemeniz gerekiyor.
- Bu ikisinin de **Firestore kotanızla hiçbir ilgisi yok** — tamamen kendi
  sağlayıcı hesaplarınızın kotası/bakiyesiyle ilgili.

## 3) Yeni sağlayıcı: Google Gemini (Nano Banana)
- **`api/gemini-image.js`** (yeni dosya) — `gemini-2.5-flash-image` modeliyle
  görsel üretir, aynı `GEMINI_API_KEY`'i kullanır (şiir yorumlamada
  kullandığınız anahtarla aynı).
- `index.html` içine `geminiGorselDene()` eklendi ve kademeye
  (Cloudflare → Pollinations → Hugging Face → **Gemini**) dahil edildi.

## ⚠️ Firestore kotası hakkında önemli not
Görsel üretme adımı başarılı olsa bile, üretilen görsel son adımda
`db.collection('posts').doc(post.id).update(...)` ile Firestore'a yazılıyor.
**Firestore kotanız gerçekten dolduysa, dört sağlayıcıdan biri görsel
üretmeyi başarsa bile bu son yazma adımı yine başarısız olur.** Bu tamamen
ayrı, çözülmesi gereken bir sorundur (Firestore planını yükseltmek ya da
günlük kotanın sıfırlanmasını beklemek).

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
duyuyor. Bu depoda **sadece bu değişiklikte dokunulan dosyalar** var; kendi
mevcut `package.json` dosyanız varsa (örn. `firebase-admin` gibi başka
bağımlılıklar için), oradaki `dependencies` alanına şunu ekleyin ve bu
depodaki `package.json`'ı KULLANMAYIN — ikisini birleştirin:

```json
"@huggingface/inference": "^4.13.28"
```
