import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) initializeApp({ credential: cert(JSON.parse(raw)), projectId: PROJECT_ID });
    else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!clientEmail || !privateKey) throw new Error("Firebase Admin ortam değişkenleri eksik.");
      initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") }) });
    }
  }
  return getFirestore();
}

export default async function handler(req, res) {
  try {
    const id = String(req.query?.id || "").trim();
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send("Geçersiz şiir ID.");
    const snap = await getDb().collection("posts").doc(id).get();
    if (!snap.exists) return res.status(404).send("Şiir bulunamadı.");
    const raw = String(snap.data()?.image || "").trim();
    if (!raw) return res.status(404).send("Şiirin görseli bulunamadı.");

    let buffer;
    let contentType;
    if (/^data:image\//i.test(raw)) {
      const m = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/i);
      if (!m) return res.status(415).send("Desteklenmeyen görsel biçimi.");
      contentType = m[1].toLowerCase();
      buffer = Buffer.from(m[2].replace(/\s/g, ""), "base64");
    } else if (/^https?:\/\//i.test(raw)) {
      const r = await fetch(raw, { redirect: "follow" });
      if (!r.ok) return res.status(502).send(`Kaynak görsel alınamadı: ${r.status}`);
      contentType = (r.headers.get("content-type") || "").split(";")[0].toLowerCase();
      buffer = Buffer.from(await r.arrayBuffer());
      if (!contentType.startsWith("image/")) {
        const path = new URL(raw).pathname.toLowerCase();
        if (path.endsWith(".png")) contentType = "image/png";
        else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (path.endsWith(".webp")) contentType = "image/webp";
        else return res.status(415).send("Kaynak URL resim döndürmüyor.");
      }
    } else return res.status(415).send("Desteklenmeyen görsel biçimi.");

    if (!buffer?.length) return res.status(404).send("Görsel verisi boş.");
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType || "image/jpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(buffer);
  } catch (e) {
    console.error("postImage HATASI:", e);
    return res.status(500).send("Görsel sunulamadı.");
  }
}
