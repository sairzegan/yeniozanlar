# En Kolay Yol: GitHub + Vercel (kod yazmadan)

Bu klasördeki her şeyi olduğu gibi GitHub'a yükleyin, Vercel'e bağlayın — bitti.
Google Cloud Console yok, terminal yok, "entry point" yok.

## 1) GitHub'a yükleyin

1. github.com'da yeni bir repo (depo) oluşturun (Public olabilir).
2. Repo sayfasında **"Add file" → "Upload files"** butonuna tıklayın.
3. Bu klasördeki HER ŞEYİ (index.html, og-image.png, package.json ve **api** klasörünün
   tamamı — klasörü de sürükleyip bırakabilirsiniz) oraya sürükleyip bırakın.
4. Altta "Commit changes" butonuna basın.

## 2) Vercel'e bağlayın

1. vercel.com adresine gidin, **"Continue with GitHub"** ile giriş yapın (tek tık).
2. **"Add New..." → "Project"** deyin.
3. Az önce yüklediğiniz repoyu listede bulup **"Import"** deyin.
4. Hiçbir ayarı değiştirmeden **"Deploy"** butonuna basın.
5. 30-60 saniye içinde size bir adres verecek, örn: `https://yeniozanlar-abc123.vercel.app`

## 3) Bana o adresi gönderin

Vercel'in size verdiği adresi bana yapıştırın. Ben `index.html` içindeki
`PAYLASIM_SUNUCUSU` satırını o adrese göre güncenleyip size son, tamamen hazır
dosyayı vereceğim — siz de onu tekrar GitHub'a yükleyeceksiniz (yine sürükle-bırak,
Vercel otomatik olarak yeniden yayınlar).

## Not

- `index.html` bu klasörde zaten en güncel haliyle var — GitHub'a yüklediğiniz bu
  dosya, sitenizin YENİ adresi olacak (`https://...vercel.app`). Yani sitenizi
  buradan yayınlamış olacaksınız. Eğer siteniz hâlâ başka bir yerde (Firebase Hosting
  gibi) yayınlıysa ve orayı kullanmaya devam etmek isterseniz, o zaman sadece
  `api` klasörünü ayrı, küçük bir GitHub reposu olarak yükleyip Vercel'e onu
  bağlamanız yeterli — `index.html`'i o depoya koymanıza gerek yok. Hangisini
  istediğinizi bana söylerseniz ona göre dosyaları ayarlarım.
