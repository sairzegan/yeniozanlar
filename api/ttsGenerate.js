import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { EdgeTTS } from "node-edge-tts";
import fs from "fs/promises";
import os from "os";
import path from "path";

// ElevenLabs'ten Microsoft Edge'in ücretsiz TTS motoruna geçildi: Edge/Windows
// "Sesli Oku" özelliğinin arkasındaki, API anahtarı GEREKTİRMEYEN, tamamen
// bedava serviste sadece 2 resmi Türkçe nöral ses var: Emel (kadın) ve
// Ahmet (erkek). ElevenLabs'teki 5 farklı sesi birebir taklit edemesek de,
// Groq'un seçtiği 5 "karakter"i bu iki sese, farklı konuşma hızı (rate) ve
// perde (pitch) ayarlarıyla eşleyip biraz tonlama farkı yaratıyoruz.
// ÖNEMLİ: Bu servis Microsoft tarafından resmi/belgeli bir API değil —
// Edge tarayıcısının kullandığı servisi taklit ediyor. Yıllardır stabil
// çalışıyor ama garanti yok; karşılığında ücretsiz ve kotasız.
const VOICE_MAP = {
  huzunlu:  { voice: "tr-TR-EmelNeural",  pitch: "-8%", rate: "-12%" }, // hüzünlü, yavaş, kısık kadın sesi
  romantik: { voice: "tr-TR-EmelNeural",  pitch: "+0%", rate: "-5%"  }, // yumuşak, sıcak kadın sesi
  dramatik: { voice: "tr-TR-AhmetNeural", pitch: "-5%", rate: "-8%"  }, // güçlü, ağır erkek sesi
  sakin:    { voice: "tr-TR-EmelNeural",  pitch: "-3%", rate: "-10%" }, // sakin, dingin kadın sesi
  tutkulu:  { voice: "tr-TR-AhmetNeural", pitch: "+3%", rate: "+2%"  }, // canlı, kararlı erkek sesi
};
const VARSAYILAN_SES = "sakin";

// ============================================================
// BACKBLAZE B2 (S3 uyumlu API) — Vercel Blob yerine kullanılıyor.
// Gerekli ortam değişkenleri:
//   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION
// Bucket, B2 panelinde "Public" olarak ayarlanmalı.
// ============================================================

function getB2Client() {
  const endpoint = String(process.env.B2_ENDPOINT || "").trim();
  const region = String(process.env.B2_REGION || "").trim();
  const keyId = String(process.env.B2_KEY_ID || "").trim();
  const appKey = String(process.env.B2_APPLICATION_KEY || "").trim();

  if (!endpoint || !region || !keyId || !appKey) {
    throw new Error(
      "B2 ortam değişkenleri eksik: B2_ENDPOINT, B2_REGION, B2_KEY_ID, B2_APPLICATION_KEY gerekli."
    );
  }

  return new S3Client({
    endpoint: `https://${endpoint}`,
    region,
    credentials: { accessKeyId: keyId, secretAccessKey: appKey },
    forcePathStyle: true
  });
}

async function uploadToB2(buffer, key, contentType) {
  const bucket = String(process.env.B2_BUCKET_NAME || "").trim();
  if (!bucket) {
    throw new Error("B2_BUCKET_NAME ortam değişkeni eksik.");
  }

  const client = getB2Client();
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );

  return `https://${process.env.B2_ENDPOINT}/${bucket}/${key}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// GITHUB + jsDelivr YEDEK DEPOLAMA (bkz. flux-image.js'teki aynı not)
// ============================================================

async function uploadToGithubFallback(buffer, key, commitMessage) {
  const owner = String(process.env.GITHUB_OWNER || "").trim();
  const repo = String(process.env.GITHUB_REPO || "").trim();
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const branch = String(process.env.GITHUB_BRANCH || "main").trim();

  if (!owner || !repo || !token) {
    throw new Error("GitHub yedek depolama için GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN gerekli.");
  }

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${key}`;
  const response = await fetchWithTimeout(
    apiUrl,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        message: commitMessage || `Yedek yükleme: ${key}`,
        content: buffer.toString("base64"),
        branch
      })
    },
    30000
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`GitHub yedek yükleme başarısız: HTTP ${response.status} — ${raw.slice(0, 300)}`);
  }

  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${key}`;
}

async function uploadWithFallback(buffer, key, contentType, commitMessage) {
  try {
    const url = await uploadToB2(buffer, key, contentType);
    return { url, provider: "b2" };
  } catch (b2Err) {
    console.error("B2 upload başarısız, GitHub yedeğine geçiliyor:", b2Err?.message || b2Err);
    const url = await uploadToGithubFallback(buffer, key, commitMessage);
    return { url, provider: "github", b2Error: b2Err?.message || String(b2Err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Sadece POST." });
  }

  let tmpPath = null;
  try {
    const { text, title, postId, voiceKey } = req.body || {};
    const cleanText = String(text || "").trim();
    const cleanPostId = String(postId || "").trim();

    if (!cleanText || cleanText.length < 5) {
      return res.status(400).json({ error: "Geçersiz metin." });
    }
    if (!/^[A-Za-z0-9]+$/.test(cleanPostId)) {
      return res.status(400).json({ error: "Geçersiz şiir ID." });
    }

    const secilenAnahtar = Object.prototype.hasOwnProperty.call(VOICE_MAP, voiceKey) ? voiceKey : VARSAYILAN_SES;
    const secim = VOICE_MAP[secilenAnahtar];

    const spoken = (title ? `${title}. ` : "") + cleanText;
    // Edge TTS servisi çok uzun metinlerde zaman aşımına uğrayabiliyor,
    // ElevenLabs'teki gibi güvenli bir üst sınır koruyoruz.
    const trimmed = spoken.length > 4500 ? spoken.slice(0, 4500) : spoken;

    const tts = new EdgeTTS({
      voice: secim.voice,
      lang: "tr-TR",
      outputFormat: "audio-24khz-96kbitrate-mono-mp3",
      pitch: secim.pitch,
      rate: secim.rate,
      volume: "default",
      timeout: 20000,
    });

    // Vercel serverless ortamında dosya sistemi salt-okunur, sadece /tmp
    // yazılabilir — bu yüzden Edge TTS'in dosyaya yazma API'sini /tmp'ye
    // yazdırıp sonra buffer olarak geri okuyoruz.
    tmpPath = path.join(os.tmpdir(), `${cleanPostId}-${Date.now()}.mp3`);
    await tts.ttsPromise(trimmed, tmpPath);

    const audioBuffer = await fs.readFile(tmpPath);
    if (!audioBuffer.length) {
      return res.status(502).json({ error: "Boş ses verisi döndü." });
    }

    // Backblaze B2'ye yükle, başarısız olursa GitHub+jsDelivr'e düş.
    // S3 PutObject / GitHub Contents API aynı key ile üzerine yazar,
    // yani ElevenLabs/Vercel Blob'daki "overwrite" davranışı korunuyor.
    const audioKey = `audio/${cleanPostId}.mp3`;
    const uploadResult = await uploadWithFallback(audioBuffer, audioKey, "audio/mpeg", `Ses: ${cleanPostId}`);

    return res.status(200).json({ audioUrl: uploadResult.url, voiceKey: secilenAnahtar, storage: uploadResult.provider });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası.", detail: String(e?.message || e).slice(0, 300) });
  } finally {
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {});
    }
  }
}
