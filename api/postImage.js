const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeni tanımlı değil.");
  }

  return initializeApp({
    credential: cert(JSON.parse(raw)),
    projectId: PROJECT_ID,
  });
}

module.exports = async function handler(req, res) {
  try {
    firebaseAdmin();

    const id = String(req.query?.id || "");

    if (!/^[A-Za-z0-9]{7}$/.test(id)) {
      return res.status(400).send("Geçersiz ID.");
    }

    const snap = await getFirestore().collection("posts").doc(id).get();

    if (!snap.exists) {
      return res.status(404).send("Görsel bulunamadı.");
    }

    const dataUrl = String(snap.data()?.image || "");

    const match = dataUrl.match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/
    );

    if (!match) {
      return res.status(404).send("Görsel bulunamadı.");
    }

    const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

    res.setHeader("Content-Type", match[1]);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("postImage:", error);
    return res.status(500).send("Görsel alınamadı.");
  }
};
