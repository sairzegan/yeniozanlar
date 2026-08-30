import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  getFirestore,
} from "firebase-admin/firestore";

const PROJECT_ID =
  "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length) {
    return getApps()[0];
  }

  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde bulunamadı."
    );
  }

  let serviceAccount;

  try {
    serviceAccount =
      JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil."
    );
  }

  return initializeApp({
    credential:
      cert(serviceAccount),
    projectId:
      PROJECT_ID,
  });
}

function db() {
  firebaseAdmin();

  return getFirestore();
}

/*
 * Vercel / Facebook / X gibi dış sistemlerin
 * şiirin görselini HTTP üzerinden okuyabilmesi için
 * Firestore'daki eski data:image kayıtlarını
 * gerçek image response'una çeviriyoruz.
 */
export default async function handler(
  req,
  res
) {
  try {

    const id =
      String(
        req.query?.id || ""
      ).trim();

    /*
     * Şiir ID'leri 7 karakter.
     */
    if (
      !/^[A-Za-z0-9]{7}$/.test(id)
    ) {
      return res
        .status(400)
        .send(
          "Geçersiz şiir ID."
        );
    }

    /*
     * Firestore'dan şiiri al.
     */
    const snapshot =
      await db()
        .collection("posts")
        .doc(id)
        .get();

    if (!snapshot.exists) {
      return res
        .status(404)
        .send(
          "Şiir bulunamadı."
        );
    }

    const post =
      snapshot.data() || {};

    const dataUrl =
      String(
        post.image || ""
      ).trim();

    /*
     * Bu endpoint sadece data:image
     * kayıtlarını dönüştürür.
     */
    const match =
      dataUrl.match(
        /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/
      );

    if (!match) {

      /*
       * Eğer resim zaten normal bir URL ise
       * buradan 404 vermek yerine onu kullanmaya
       * çalışan istemciler için yardımcı cevap veriyoruz.
       */
      if (
        /^https?:\/\//i.test(
          dataUrl
        )
      ) {
        return res
          .status(302)
          .setHeader(
            "Location",
            dataUrl
          )
          .end();
      }

      return res
        .status(404)
        .send(
          "Şiirin görseli bulunamadı."
        );
    }

    const mimeType =
      match[1];

    const base64 =
      match[2]
        .replace(/\s/g, "");

    const buffer =
      Buffer.from(
        base64,
        "base64"
      );

    if (!buffer.length) {
      return res
        .status(404)
        .send(
          "Görsel verisi boş."
        );
    }

    /*
     * Sosyal medya botlarının görseli
     * doğrudan okuyabilmesi için gerçek
     * image/jpeg, image/png vb. response.
     */
    res.setHeader(
      "Content-Type",
      mimeType
    );

    res.setHeader(
      "Content-Length",
      String(buffer.length)
    );

    /*
     * Aynı görseli tekrar tekrar çekmesin.
     */
    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );

    return res
      .status(200)
      .send(buffer);

  } catch (error) {

    console.error(
      "postImage.js HATASI:",
      error
    );

    return res
      .status(500)
      .send(
        "Görsel sunulamadı."
      );
  }
}
