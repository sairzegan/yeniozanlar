# Bu paket ne ekliyor

## Sesli okuma oynatıcısı
- **Devamını gör**'e basınca: post.audioUrl varsa oynatıcı görünür, otomatik
  çalar; "▲ Kapat"a basınca veya tekrar kapatınca durur ve başa sarar.
- **Kaydır modu**: ekrana gelen şiirin sesi otomatik başlar; sola/sağa
  kaydırınca (veya ok tuşlarıyla) önceki ses durur, yeni şiirin sesi otomatik
  başlar; sekmeyi (✕) kapatınca da durur.
- Kontroller (ikisinde de aynı, mor-yeşil tema): ▶️/⏸️ oynat-duraklat,
  ⏹️ durdur, 🔊 ses seviyesi kaydırıcısı.

## Ses/duygu seçimi — Groq ile (görsel promptundaki gibi)
- Yeni fonksiyon: `aiSesYonlendirmesiGroqlaOlustur(title, text)`. Şiiri
  Groq'a analiz ettirip 5 sabit karakterden birini seçtiriyor:
  huzunlu / romantik / dramatik / sakin / tutkulu — artı stability/style
  (0-1) değerleri.
  Groq başarısız olursa güvenli varsayılan ("sakin") kullanılır.
- ÖNEMLİ güvenlik notu: Groq sadece bir ANAHTAR seçer (örn. "dramatik").
  Gerçek ElevenLabs ses ID'leri `api/ttsGenerate.js` içinde SABİT olarak
  tanımlı; Groq'un uydurabileceği geçersiz/yanlış bir ID asla ElevenLabs'e
  gönderilmez.
- Kullanılan sesler: huzunlu→Elli, romantik→Bella, dramatik→Antoni,
  sakin→Rachel, tutkulu→Adam (ElevenLabs standart sesleri). Değiştirmek
  istersen `api/ttsGenerate.js` içindeki `VOICE_MAP`'i düzenle.

## Test
- `api/ttsGenerate.js`: doğru ses ID'sinin seçildiği, stability/style
  değerlerinin doğru iletildiği ve geçersiz bir voiceKey gelirse güvenli
  varsayılana düştüğü simüle edilerek doğrulandı.
- `index.html`: tüm JavaScript, değişiklik sonrası Node ile sözdizimi
  kontrolünden geçirildi, hata yok. Yeni eklenen tüm fonksiyon/değişken
  isimleri (sesOynaticiOlustur, aiSesYonlendirmesiGroqlaOlustur, _sesAudio,
  aktifSes) dosya genelinde tutarlı şekilde kullanılıyor, kalıntı referans yok.

## Önceki paketten hatırlatma
- Görsel AI sağlayıcıları: Cloudflare FLUX → Hugging Face (Pollinations ve
  Gemini kaldırıldı).
- Admin panelindeki tüm "Test Et" butonları kaldırıldı.
