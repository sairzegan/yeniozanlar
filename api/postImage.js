import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (raw) {
      initializeApp({
        credential: cert(JSON.parse(raw)),
        projectId: PROJECT_ID
      });
    } else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;

      if (!clientEmail || !privateKey) {
        throw new Error("Firebase Admin ortam değişkenleri eksik.");
      }

      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID || PROJECT_ID,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n")
        })
      });
    }
  }

  return getFirestore();
}

export default async function handler(req, res) {
  try {
    const id = String(req.query?.id || "").trim();

    if (!/^[A-Za-z0-9]{7}$/.test(id)) {
      return res.status(400).send("Geçersiz şiir ID.");
    }

    const snap = await getDb().collection("posts").doc(id).get();

    if (!snap.exists) {
      return res.status(404).send("Şiir bulunamadı.");
    }

    const raw = String(snap.data()?.image || "").trim();

    if (!raw) {
      return res.status(404).send("Şiirin görseli bulunamadı.");
    }

    if (/^https?:\/\//i.test(raw)) {
      return res.redirect(302, raw);
    }

    const m = raw.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/i);

    if (!m) {
      return res.status(404).send("Desteklenmeyen görsel biçimi.");
    }

    const mime = m[1].toLowerCase();
    const buffer = Buffer.from(m[2].replace(/\s/g, ""), "base64");

    if (!buffer.length) {
      return res.status(404).send("Görsel verisi boş.");
    }

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    return res.status(200).send(buffer);
  } catch (e) {
    console.error("postImage HATASI:", e);
    return res.status(500).send("Görsel sunulamadı.");
  }
}
