import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON eksik");
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    const repaired = raw.replace(/\r?\n/g, "\\n");
    sa = JSON.parse(repaired);
  }
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
}

function db() {
  firebaseAdmin();
  return getFirestore();
}

function parse(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const b = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  return b.length ? { type: m[1].toLowerCase(), buffer: b } : null;
}

async function remote(url) {
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "YeniOzanlar-FacebookImage/1.0", Accept: "image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = String(r.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!type.startsWith("image/")) throw new Error("Görsel değil");
  const b = Buffer.from(await r.arrayBuffer());
  return b.length ? { type, buffer: b } : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).send("Method Not Allowed");
    }
    const id = String(req.query?.id || "").trim();
    if (!/^[A-Za-z0-9]{7}$/.test(id)) return res.status(400).send("Geçersiz şiir ID.");

    const s = await db().collection("posts").doc(id).get();
    if (!s.exists) return res.status(404).send("Şiir bulunamadı.");

    const raw = String((s.data() || {}).image || "").trim();
    if (!raw) return res.status(404).send("Şiirin görseli bulunamadı.");

    let im;
    if (/^data:image\//i.test(raw)) im = parse(raw);
    else if (/^https?:\/\//i.test(raw)) im = await remote(raw);
    if (!im) return res.status(404).send("Geçerli bir görsel bulunamadı.");

    res.setHeader("Content-Type", im.type);
    res.setHeader("Content-Length", String(im.buffer.length));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(im.buffer);
  } catch (e) {
    console.error("postImage.js HATASI", e);
    return res.status(500).send("Görsel sunulamadı.");
  }
}
