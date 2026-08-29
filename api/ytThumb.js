// api/ytThumb.js
// YouTube video kapak görselini kendi sunucumuz üzerinden (aynı origin'den)
// geçirerek tarayıcıya verir. Böylece Instagram hikaye görseli oluşturulurken
// canvas'a çizilirken CORS kısıtlaması olmaz (aynı origin'den geldiği için
// "tainted canvas" hatası oluşmaz) ve gerçek video kapak resmi gömülebilir.
export default async function handler(req, res) {
  const vid = (req.query.vid || '').toString().trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(vid)) {
    res.status(400).send('Geçersiz video kimliği');
    return;
  }

  // "maxresdefault" bazı videolarda mevcut olmayabilir; sırayla dener,
  // ilk gerçekten var olan kapağı döner.
  const adaylar = [
    `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
  ];

  for (const url of adaylar) {
    try {
      const ytRes = await fetch(url);
      if (!ytRes.ok) continue;
      const buf = Buffer.from(await ytRes.arrayBuffer());
      // Kapağı olmayan videolar için YouTube küçük gri bir "yok" görseli
      // döndürür; onu ayıklamak için minimum boyut kontrolü yapıyoruz.
      if (buf.length < 1000) continue;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.status(200).send(buf);
      return;
    } catch { /* sıradaki adaya geç */ }
  }
  res.status(404).send('Kapak görseli bulunamadı');
}
