import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Vercel ortam değişkeninde yok.");

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON geçerli JSON değil.");
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

function isValidId(id) {
  return /^[A-Za-z0-9]{7}$/.test(id);
}

function parseDataImage(raw) {
  const match = String(raw || "").trim().match(
    /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return null;

  return { mimeType, buffer };
}

async function fetchRemoteImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "YeniOzanlar-FacebookImage/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Uzak görsel HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!contentType.startsWith("image/")) {
      throw new Error(`Uzak URL görsel döndürmedi: ${contentType || "bilinmiyor"}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) throw new Error("Uzak görsel boş döndü.");

    return { mimeType: contentType, buffer };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).send("Method Not Allowed");
    }

    const id = String(req.query?.id || "").trim();
    if (!isValidId(id)) return res.status(400).send("Geçersiz şiir ID.");

    const snapshot = await db().collection("posts").doc(id).get();
    if (!snapshot.exists) return res.status(404).send("Şiir bulunamadı.");

    const post = snapshot.data() || {};
    const raw = String(post.image || "").trim();
    if (!raw) return res.status(404).send("Şiirin görseli bulunamadı.");

    let image;

    if (/^data:image\//i.test(raw)) {
      image = parseDataImage(raw);
    } else if (/^https?:\/\//i.test(raw)) {
      image = await fetchRemoteImage(raw);
    }

    if (!image) return res.status(404).send("Geçerli bir görsel bulunamadı.");

    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Length", String(image.buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(image.buffer);
  } catch (error) {
    console.error("postImage.js HATASI:", error);
    return res.status(500).send("Görsel sunulamadı.");
  }
}
