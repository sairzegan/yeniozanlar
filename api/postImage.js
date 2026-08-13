const PROJECT_ID = "yeniozanlar-68b49";
const FIREBASE_API_KEY = "AIzaSyC6sshBjUU7xZf_KgjwW2yWuvE1ZG9oZWY";
const FIRESTORE_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/`;

module.exports = async function handler(req, res) {
  try {
    const id = String(req.query?.id || "");
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send("Geçersiz ID.");

    const url = FIRESTORE_URL + encodeURIComponent(id) + "?key=" + encodeURIComponent(FIREBASE_API_KEY);
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return res.status(404).send("Görsel bulunamadı.");

    const d = await r.json();
    const dataUrl = d.fields?.image?.stringValue;
    const m = String(dataUrl || "").match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/s
    );
    if (!m) return res.status(404).send("Görsel bulunamadı.");

    const body = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    if (!body.length) return res.status(404).send("Görsel bulunamadı.");

    res.setHeader("Content-Type", m[1]);
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(body);
  } catch (err) {
    console.error("postImage:", err);
    return res.status(500).send("Görsel alınamadı.");
  }
};
