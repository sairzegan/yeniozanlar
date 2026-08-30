import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: PROJECT_ID,
  });
}

function db() {
  firebaseAdmin();
  return getFirestore();
}

export default async function handler(req, res) {
  try {
    const id = String(req.query?.id || "").trim();

    if (!/^[A-Za-z0-9]{7}$/.test(id)) {
      return res.status(400).send("Geçersiz şiir ID.");
    }

    const snapshot = await db()
      .collection("posts")
      .doc(id)
      .get();

    if (!snapshot.exists) {
      return res.status(404).send("Şiir bulunamadı.");
    }

    const post = snapshot.data() || {};
    const raw = String(post.image || "").trim();

    if (!raw) {
      return res.status(404).send("Şiirin görseli bulunamadı.");
    }

    /*
     * Görsel zaten URL ise doğrudan yönlendir.
     */
    if (/^https?:\/\//i.test(raw)) {
      res.setHeader("Location", raw);
      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000"
      );

      return res.status(302).end();
    }

    /*
     * Firebase'de data:image/...;base64,... olarak
     * saklanan resmi gerçek binary görsele çevir.
     */
    const match = raw.match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,([\s\S]+)$/i
    );

    if (!match) {
      console.error(
        "postImage: Geçersiz image formatı:",
        raw.substring(0, 100)
      );

      return res.status(404).send(
        "Şiirin görseli bulunamadı."
      );
    }

    const mimeType = match[1];

    const base64Data = match[2]
      .replace(/\s/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const buffer = Buffer.from(base64Data, "base64");

    if (!buffer.length) {
      return res.status(404).send(
        "Görsel verisi boş."
      );
    }

    /*
     * Facebook / Messenger / WhatsApp / LinkedIn
     * crawler'larının resmi okuyabilmesi için.
     */
    res.setHeader("Content-Type", mimeType);
    res.setHeader(
      "Content-Length",
      String(buffer.length)
    );
    res.setHeader(
      "Content-Disposition",
      "inline"
    );
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );
    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );

    return res.status(200).send(buffer);

  } catch (error) {
    console.error(
      "postImage.js HATASI:",
      error
    );

    return res.status(500).send(
      "Görsel sunulamadı."
    );
  }
}
