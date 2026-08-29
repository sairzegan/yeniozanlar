// api/flux-image.js
// Hugging Face Inference API - FLUX.1-schnell
// Vercel Environment Variable: HF_TOKEN

const MODEL = "black-forest-labs/FLUX.1-schnell";
const ENDPOINT =
  `https://router.huggingface.co/hf-inference/models/${MODEL}`;

function createPrompt(title, text) {
  const poem = String(text || "").trim().slice(0, 14000);
  const poemTitle = String(title || "").trim().slice(0, 500);

  return [
    "Create one original landscape image inspired directly by this Turkish poem.",
    "The poem is the primary source of the image.",
    "The image must visually represent the setting, objects, people, actions, symbols and emotions described in the poem.",
    "Do not create a generic poetry image.",
    "Do not add unrelated objects or subjects.",
    "Style: cinematic, poetic, realistic, emotional, atmospheric, elegant composition, dramatic natural lighting, subtle film look, depth of field.",
    "Match the emotional atmosphere of the poem.",
    "If appropriate, reflect romantic, melancholic, nostalgic, dreamy, hopeful or dark emotions.",
    "No text inside the generated image.",
    "No letters, captions, typography, logo, watermark, collage or GIF elements.",
    "Landscape composition suitable for a poetry website.",
    poemTitle ? `Poem title: ${poemTitle}` : "",
    "Turkish poem:",
    poem
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function getError(response) {
  let raw = "";

  try {
    raw = await response.text();
  } catch (_) {}

  try {
    const json = JSON.parse(raw);

    return (
      json?.error?.message ||
      json?.error ||
      json?.message ||
      raw ||
      `HTTP ${response.status}`
    );
  } catch (_) {
    return raw || `HTTP ${response.status}`;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Yalnızca POST isteği kabul edilir."
    });
  }

  const token = String(process.env.HF_TOKEN || "").trim();

  if (!token) {
    return res.status(500).json({
      error:
        "HF_TOKEN bulunamadı. Vercel Environment Variables bölümünde HF_TOKEN tanımlı değil."
    });
  }

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};
  } catch (_) {
    return res.status(400).json({
      error: "Geçersiz JSON isteği."
    });
  }

  const title = body.title || "";
  const text = body.text || "";

  if (!String(text).trim()) {
    return res.status(400).json({
      error: "Şiir metni boş."
    });
  }

  const prompt = createPrompt(title, text);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",

      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "image/png"
      },

      body: JSON.stringify({
        inputs: prompt,

        parameters: {
          width: 1024,
          height: 576,
          num_inference_steps: 4
        },

        options: {
          wait_for_model: true,
          use_cache: false
        }
      })
    });

    if (!response.ok) {
      const error = await getError(response);

      console.error("Hugging Face FLUX error:", response.status, error);

      return res.status(502).json({
        error: `FLUX HTTP ${response.status}: ${String(error).slice(
          0,
          2000
        )}`,

        provider: "huggingface-hf-inference",
        model: MODEL
      });
    }

    const contentType =
      response.headers.get("content-type") || "image/png";

    const arrayBuffer = await response.arrayBuffer();

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return res.status(502).json({
        error: "FLUX boş bir görsel döndürdü.",
        provider: "huggingface-hf-inference",
        model: MODEL
      });
    }

    const imageBuffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Length",
      String(imageBuffer.length)
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
      "X-AI-Provider",
      "huggingface-hf-inference"
    );

    res.setHeader("X-AI-Model", MODEL);

    return res.status(200).send(imageBuffer);

  } catch (error) {
    console.error("FLUX request failed:", error);

    return res.status(502).json({
      error:
        "FLUX bağlantı hatası: " +
        String(error?.message || error).slice(0, 2000),

      provider: "huggingface-hf-inference",
      model: MODEL
    });
  }
}
