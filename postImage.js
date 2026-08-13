const PROJECT_ID = 'yeniozanlar-68b49';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

function firestoreString(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  return null;
}

module.exports = async function handler(req, res) {
  try {
    const id = String((req.query && req.query.id) || '');
    if (!/^[A-Za-z0-9]{7}$/.test(id)) {
      return res.status(400).send('Geçersiz paylaşım ID.');
    }

    const response = await fetch(FIRESTORE_URL + encodeURIComponent(id));
    if (!response.ok) return res.status(404).send('Görsel bulunamadı.');

    const data = await response.json();
    const dataUrl = firestoreString(data.fields && data.fields.image);
    const match = String(dataUrl || '').match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/s
    );

    if (!match) return res.status(404).send('Görsel bulunamadı.');

    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) return res.status(404).send('Görsel bulunamadı.');

    res.setHeader('Content-Type', match[1]);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('postImage error:', error);
    return res.status(500).send('Görsel alınamadı.');
  }
};
