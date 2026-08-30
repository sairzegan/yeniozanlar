const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";

function getDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON eksik.");

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçersiz JSON.");
    }

    initializeApp({
      credential: cert(serviceAccount),
      projectId: PROJECT_ID
    });
  }

  return getFirestore();
}

module.exports = async function handler(req, res) {
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

    // Görsel zaten gerçek bir HTTP URL ise aynen kullan.
    if (/^https?:\/\//i.test(raw)) {
      res.setHeader("Location", raw);
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(302).end();
    }

    // Firestore'daki data:image/...;base64,... kaydını gerçek binary görsele çevir.
    const match = raw.match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/i
    );

    if (!match) {
      return res.status(404).send("Desteklenmeyen görsel biçimi.");
    }

    const mimeType = match[1].toLowerCase();
    const base64 = match[2]
      .replace(/\s/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
      return res.status(404).send("Görsel verisi boş.");
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );
    res.setHeader(
      "Vercel-CDN-Cache-Control",
      "public, max-age=31536000, immutable"
    );

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("postImage.js HATASI:", error);
    return res.status(500).send("Görsel sunulamadı.");
  }
};
