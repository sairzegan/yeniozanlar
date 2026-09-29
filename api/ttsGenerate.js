import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const R2_GUVENLIK_LIMITI = 9 * 1024 * 1024 * 1024;
function r2AyAnahtari() {
  const d = new Date();
  return `_meta/r2-kullanim-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.json`;
}
async function r2KullanimOku(client, bucket) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: r2AyAnahtari() }));
    const text = await res.Body.transformToString();
    return Number(JSON.parse(text)?.bytes) || 0;
  } catch (_) { return 0; }
}
function r2KullanimYaz(client, bucket, bytes) {
  client.send(new PutObjectCommand({ Bucket: bucket, Key: r2AyAnahtari(), Body: JSON.stringify({ bytes }), ContentType: "application/json" })).catch(() => {});
}
import { EdgeTTS } from "node-edge-tts";
import fs from "fs/promises";
import os from "os";
import path from "path";

// ElevenLabs'ten Microsoft Edge'in ücretsiz TTS motoruna geçildi: API anahtarı
// GEREKTİRMEYEN, tamamen bedava serviste sadece 2 resmi Türkçe nöral ses var:
// Emel (kadın) ve Ahmet (erkek). Groq'un seçtiği 5 "karakter"i bu iki sese,
// farklı konuşma hızı (rate) ve perde (pitch) ayarlarıyla eşleyip tonlama
// farkı yaratıyoruz.
const VOICE_MAP = {
  huzunlu:  { voice: "tr-TR-EmelNeural",  pitch: "-8%", rate: "-12%" },
  romantik: { voice: "tr-TR-EmelNeural",  pitch: "+0%", rate: "-5%"  },
  dramatik: { voice: "tr-TR-AhmetNeural", pitch: "-5%", rate: "-8%"  },
  sakin:    { voice: "tr-TR-EmelNeural",  pitch: "-3%", rate: "-10%" },
  tutkulu:  { voice: "tr-TR-AhmetNeural", pitch: "+3%", rate: "+2%"  },
};
const VARSAYILAN_SES = "sakin";

// ============================================================
// CLOUDFLARE R2 (S3 uyumlu API)
// Gerekli ortam değişkenleri:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
// ============================================================

function getR2Client() {
  const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 ortam değişkenleri eksik: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY gerekli.");
  }

  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestChecksumValidation: "WHEN_REQUIRED",
    responseChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
}

async function uploadToR2(buffer, key, contentType) {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  const publicBase = String(process.env.R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!bucket) throw new Error("R2_BUCKET_NAME ortam değişkeni eksik.");
  if (!publicBase) throw new Error("R2_PUBLIC_URL ortam değişkeni eksik.");

  const client = getR2Client();
  const mevcutBayt = await r2KullanimOku(client, bucket);
  if (mevcutBayt + buffer.length > R2_GUVENLIK_LIMITI) {
    throw new Error("R2 aylık güvenlik limiti (9GB) aşılıyor.");
  }

  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );
  r2KullanimYaz(client, bucket, mevcutBayt + buffer.length);

  return `${publicBase}/${key}`;
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
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  // Aynı key (audio/{postId}.mp3) tekrar yazılabiliyor — GitHub üzerine
  // yazarken mevcut sürümün "sha" değerini istiyor, önce onu alıyoruz.
  let sha;
  try {
    const getRes = await fetchWithTimeout(
      `${apiUrl}?ref=${encodeURIComponent(branch)}`,
      { headers: ghHeaders },
      15000
    );
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData?.sha;
    }
  } catch (_) {
    // sha alınamadıysa yeni dosya varsayılarak devam ediyoruz.
  }

  const response = await fetchWithTimeout(
    apiUrl,
    {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage || `Yedek yükleme: ${key}`,
        content: buffer.toString("base64"),
        branch,
        ...(sha ? { sha } : {})
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

// TEŞHİS: gerçek anahtarları loglamıyoruz, sadece uzunluk + ilk birkaç karakter.
function r2TeshisBilgisi() {
  const maskele = (v) => {
    const s = String(v || "");
    return s ? `uzunluk=${s.length}, başlangıç="${s.slice(0, 4)}…"` : "(tanımsız)";
  };
  return `[R2_ACCESS_KEY_ID: ${maskele(process.env.R2_ACCESS_KEY_ID)} | R2_SECRET_ACCESS_KEY: ${maskele(process.env.R2_SECRET_ACCESS_KEY)} | R2_ACCOUNT_ID="${process.env.R2_ACCOUNT_ID || "(tanımsız)"}" | R2_BUCKET_NAME="${process.env.R2_BUCKET_NAME || "(tanımsız)"}" | R2_PUBLIC_URL="${process.env.R2_PUBLIC_URL || "(tanımsız)"}"]`;
}

async function uploadWithFallback(buffer, key, contentType, commitMessage) {
  try {
    const url = await uploadToR2(buffer, key, contentType);
    return { url, provider: "r2" };
  } catch (r2Err) {
    const teshis = r2TeshisBilgisi();
    console.error("R2 upload başarısız, GitHub yedeğine geçiliyor:", r2Err?.message || r2Err, teshis);
    const url = await uploadToGithubFallback(buffer, key, commitMessage);
    return { url, provider: "github", r2Error: `${r2Err?.message || String(r2Err)} ${teshis}` };
  }
}


// ============================================================
// ACE-Step (acemusic.ai, ÜCRETSİZ) — şiiri YAPAY ZEKA VOKALİYLE söyletir.
// musicGenerate.js ile aynı uç nokta / aynı ACE_MUSIC_API_KEY. Fark: burada
// enstrümantal DEĞİL, şiirin kendisi `lyrics` olarak gönderiliyor.
// Başarısız olursa (kota, zaman aşımı, çok uzun şiir, boş cevap...) sessizce
// Edge TTS (düz okuma) devreye girer, yani ses her koşulda üretilir.
// Kapatmak için Vercel'de SES_MOTORU=edge tanımla.
// ============================================================
const ACE_ENDPOINT = "https://api.acemusic.ai/v1/chat/completions";
const ACE_TIMEOUT_MS = 90000;
const ACE_MAX_SIIR_KARAKTER = 1200; // daha uzun şiirler şarkıya sığmaz -> Edge TTS ile tam okunur

const ACE_STIL = {
  huzunlu:  "slow melancholic ballad, soft piano, sad emotional vocal, intimate and gentle",
  romantik: "romantic slow ballad, warm acoustic guitar and strings, tender vocal",
  dramatik: "dramatic cinematic ballad, deep emotional male vocal, piano and strings, powerful",
  sakin:    "calm ambient ballad, soft piano, gentle soothing vocal, peaceful and reflective",
  tutkulu:  "passionate emotional ballad, expressive male vocal, guitar and strings, intense",
};

function aceKullanilabilirMi(cleanText) {
  if (String(process.env.SES_MOTORU || "").trim().toLowerCase() === "edge") return false;
  if (!process.env.ACE_MUSIC_API_KEY) return false;
  return cleanText.length <= ACE_MAX_SIIR_KARAKTER;
}

async function aceStepIleSesUret(title, cleanText, voiceKey) {
  const stil = ACE_STIL[voiceKey] || ACE_STIL[VARSAYILAN_SES];
  const lyrics = "[Verse]\n" + cleanText.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n");
  const res = await fetch(ACE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ACE_MUSIC_API_KEY}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: `<prompt>${stil}</prompt>\n<lyrics>${lyrics}</lyrics>` }],
      stream: false,
      audio_config: { format: "mp3", instrumental: false, vocal_language: "tr" },
    }),
    signal: AbortSignal.timeout(ACE_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detay = "";
    try { const j = await res.json(); detay = j?.error?.message || j?.detail || JSON.stringify(j).slice(0, 200); } catch (_) {}
    throw new Error(`ACE-Step HTTP ${res.status}${detay ? ": " + detay : ""}`);
  }
  const data = await res.json();
  const dataUrl = data?.choices?.[0]?.message?.audio?.[0]?.audio_url?.url;
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error("ACE-Step ses verisi döndürmedi.");
  }
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (!buf.length) throw new Error("ACE-Step boş ses döndürdü.");
  return buf;
}

// Vercel varsayılan süre sınırı (10 sn) TTS + yükleme için yetmez.
export const maxDuration = 180;

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
    const trimmed = spoken.length > 4500 ? spoken.slice(0, 4500) : spoken;

    let audioBuffer = null;
    let motor = "edge-tts";
    let aceHata = null;

    if (aceKullanilabilirMi(cleanText)) {
      try {
        audioBuffer = await aceStepIleSesUret(title, cleanText, secilenAnahtar);
        motor = "ace-step";
      } catch (aceErr) {
        aceHata = String(aceErr?.message || aceErr).slice(0, 300);
        console.warn("ACE-Step ses üretimi başarısız, Edge TTS'e geçiliyor:", aceHata);
        audioBuffer = null;
      }
    }

    if (!audioBuffer) {
      const tts = new EdgeTTS({
        voice: secim.voice,
        lang: "tr-TR",
        outputFormat: "audio-24khz-96kbitrate-mono-mp3",
        pitch: secim.pitch,
        rate: secim.rate,
        volume: "default",
        timeout: 20000,
      });

      tmpPath = path.join(os.tmpdir(), `${cleanPostId}-${Date.now()}.mp3`);
      await tts.ttsPromise(trimmed, tmpPath);
      audioBuffer = await fs.readFile(tmpPath);
    }

    if (!audioBuffer.length) {
      return res.status(502).json({ error: "Boş ses verisi döndü." });
    }

    const audioKey = `audio/${cleanPostId}.mp3`;
    const uploadResult = await uploadWithFallback(audioBuffer, audioKey, "audio/mpeg", `Ses: ${cleanPostId}`);

    return res.status(200).json({
      audioUrl: uploadResult.url,
      voiceKey: secilenAnahtar,
      engine: motor,
      aceError: aceHata,
      storage: uploadResult.provider,
      r2Error: uploadResult.r2Error || null
    });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası.", detail: String(e?.message || e).slice(0, 300) });
  } finally {
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {});
    }
  }
}
