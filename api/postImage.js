const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeni tanımlı değil.");
  }

  const serviceAccount = JSON.parse(raw);

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });
}

function db() {
  firebaseAdmin();
  return getFirestore();
}

module.exports = async function handler(req, res) {
  try {
    const postId = String(req.query?.id || "");
    if (!postId) {
      return res.redirect(302, `${APP_URL}/og-image.png`);
    }

    const doc = await db().collection("posts").doc(postId).get();
    const dataUri = doc.exists ? doc.data().image : null;
    const eslesme = dataUri && dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

    if (!eslesme) {
      return res.redirect(302, `${APP_URL}/og-image.png`);
    }

    const mime = eslesme[1];
    const buffer = Buffer.from(eslesme.slice(2).join(","), "base64");

    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("postImage error:", err);
    return res.redirect(302, `${APP_URL}/og-image.png`);
  }
};
