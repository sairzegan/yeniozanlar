import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok.");
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."); }
  return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
}
function db() { firebaseAdmin(); return getFirestore(); }

export default async function handler(req, res) {
  try {
    const id = String(req.query?.id || "").trim();
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send("Geçersiz şiir ID.");
    const snapshot = await db().collection("posts").doc(id).get();
    if (!snapshot.exists) return res.status(404).send("Şiir bulunamadı.");
    const post = snapshot.data() || {};
    const raw = String(post.image || "").trim();

    if (/^https?:\/\//i.test(raw)) {
      res.setHeader("Location", raw);
      return res.status(302).end();
    }

    const match = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return res.status(404).send("Şiirin görseli bulunamadı.");

    const mimeType = match[1];
    const buffer = Buffer.from(match[2].replace(/\s/g,""), "base64");
    if (!buffer.length) return res.status(404).send("Görsel verisi boş.");

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("postImage.js HATASI:", error);
    return res.status(500).send("Görsel sunulamadı.");
  }
}
