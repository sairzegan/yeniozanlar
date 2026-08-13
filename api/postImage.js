const PROJECT_ID = 'yeniozanlar-68b49';
const FIREBASE_API_KEY = 'AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

function decodeFirestoreValue(v) {
  if (!v) return null;
  if (Object.prototype.hasOwnProperty.call(v, 'stringValue')) return v.stringValue;
  if (Object.prototype.hasOwnProperty.call(v, 'integerValue')) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, 'doubleValue')) return Number(v.doubleValue);
  if (Object.prototype.hasOwnProperty.call(v, 'booleanValue')) return v.booleanValue;
  return null;
}

module.exports = async function handler(req, res) {
  try {
    const id = String(req.query?.id || '');
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send('Geçersiz ID.');

    const response = await fetch(FIRESTORE_BASE + encodeURIComponent(id) + '?key=' + encodeURIComponent(FIREBASE_API_KEY), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return res.status(404).send('Görsel bulunamadı.');

    const data = await response.json();
    const dataUrl = decodeFirestoreValue(data.fields?.image);
    const match = String(dataUrl || '').match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/s);
    if (!match) return res.status(404).send('Görsel bulunamadı.');

    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) return res.status(404).send('Görsel bulunamadı.');

    res.setHeader('Content-Type', match[1]);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('postImage:', error);
    return res.status(500).send('Görsel alınamadı.');
  }
};
