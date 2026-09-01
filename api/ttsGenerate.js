import { put } from "@vercel/blob";
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
    if (!process.env.BLOB_STORE_ID) {
      return res.status(500).json({ error: "BLOB_STORE_ID tanımlı değil (Blob deposu projeye bağlı mı?)." });
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

    // Vercel Blob'a yükle — access:'public' ile link doğrudan çalınabilir olur.
    const blob = await put(`audio/${cleanPostId}.mp3`, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });

    return res.status(200).json({ audioUrl: blob.url, voiceKey: secilenAnahtar });
  } catch (e) {
    console.error("ttsGenerate HATASI:", e);
    return res.status(500).json({ error: "Sunucu hatası.", detail: String(e?.message || e).slice(0, 300) });
  } finally {
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {});
    }
  }
}
