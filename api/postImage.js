const { db } = require('./firebaseAdmin');

module.exports = async function handler(req, res) {
  try {
    const id = String(req.query?.id || '');
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send('Geçersiz ID.');

    const snap = await db.collection('posts').doc(id).get();
    if (!snap.exists) return res.status(404).send('Görsel bulunamadı.');

    const dataUrl = String(snap.data()?.image || '');
    const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/s);
    if (!match) return res.status(404).send('Görsel bulunamadı.');

    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) return res.status(404).send('Görsel bulunamadı.');

    res.setHeader('Content-Type', match[1]);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('postImage error:', err);
    return res.status(500).send('Görsel alınamadı.');
  }
};
