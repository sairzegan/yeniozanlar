# Pollinations düzeltmesi

Sadece iki dosya değiştirildi:
- `api/ai-image.js`
- `index.html`

## Neden bu sürüm farklı?
Pollinations görselini önceki sürümlerde base64 + JSON olarak Vercel'den döndürüyorduk. Bu gereksiz büyük yanıt oluşturabiliyordu. Yeni sürümde Pollinations görseli `image/*` olarak doğrudan serverless response'tan gönderiliyor; istemci bunu Blob olarak alıp Firebase Storage'a yüklüyor.

Pollinations için:
- `POLLINATIONS_API_KEY` Vercel Environment Variable'dan okunur.
- Önce Bearer header ile `/image/{prompt}?model=flux` denenir.
- Yetkilendirme/edge davranışı nedeniyle başarısız olursa aynı istek `key=` query parametresi ile server-side ikinci kez denenir.
- Başarısız olursa mevcut Gemini -> GIPHY fallback akışı devam eder.

`api/giphy.js` bu pakette yoktur ve değiştirilmemelidir.
