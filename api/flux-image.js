// Vercel Serverless Function
// Hugging Face Inference Providers -> FLUX.1-schnell
// Requires: HF_TOKEN with "Make calls to Inference Providers" permission.
// Uses the official @huggingface/inference client so provider routing is handled by HF.

const MODEL = 'black-forest-labs/FLUX.1-schnell';

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 14000);
  const heading = String(title || '').trim().slice(0, 500);

  return [
    'Create one original landscape image directly inspired by the Turkish poem below.',
    'The poem is the primary source. Show the specific setting, objects, people, actions, symbols, metaphors and emotions described in the poem.',
    'Do not create a generic poetry image. Do not add unrelated objects or scenes.',
    'Style: cinematic photography, poetic atmosphere, emotional realism, elegant composition, natural dramatic lighting, depth of field, subtle film color grading.',
    'Reflect the actual mood of the poem: romantic, melancholic, nostalgic, hopeful, dark or dreamy only when appropriate.',
    'No readable text, letters, captions, logos, watermark, collage or GIF elements inside the image.',
    'Landscape 16:9 composition suitable for a poetry post.',
    heading ? `Poem title: ${heading}` : '',
    'Turkish poem:',
    poem
  ].filter(Boolean).join('\n\n');
}

function getErrorMessage(err) {
  const parts = [];
  if (err?.message) parts.push(String(err.message));
  if (err?.response?.status) parts.push(`HTTP ${err.response.status}`);
  try {
    const body = err?.response?.data;
    if (body) parts.push(typeof body === 'string' ? body : JSON.stringify(body));
  } catch (_) {}
  const text = parts.join(' | ') || String(err || 'Bilinmeyen Hugging Face hatası');
  return text.slice(0, 2500);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
  }

  const token = String(process.env.HF_TOKEN || '').trim();
  if (!token) {
    return res.status(500).json({
      error: 'HF_TOKEN Vercel Environment Variable bulunamadı. Vercel → Settings → Environment Variables kontrol edin.'
    });
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) {
    return res.status(400).json({ error: 'Şiir metni boş.' });
  }

  try {
    // Official Hugging Face client. "auto" lets HF select an available provider
    // for FLUX.1-schnell instead of calling the old /hf-inference/models URL.
    const { InferenceClient } = await import('@huggingface/inference');
    const client = new InferenceClient(token);

    const imageBlob = await client.textToImage({
      model: MODEL,
      provider: 'auto',
      inputs: buildPrompt(title, text),
      parameters: {
        width: 1024,
        height: 576,
        num_inference_steps: 4
      }
    });

    const buffer = Buffer.from(await imageBlob.arrayBuffer());
    if (!buffer.length) {
      return res.status(502).json({
        error: 'Hugging Face FLUX boş görsel döndürdü.',
        provider: 'huggingface-inference-providers',
        model: MODEL
      });
    }

    const mime = imageBlob.type || 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Provider', 'huggingface-inference-providers');
    res.setHeader('X-AI-Model', MODEL);
    return res.status(200).send(buffer);
  } catch (err) {
    const message = getErrorMessage(err);
    console.error('Hugging Face FLUX error:', message);

    return res.status(502).json({
      error: `Hugging Face FLUX görsel üretimi başarısız: ${message}`,
      provider: 'huggingface-inference-providers',
      model: MODEL,
      hint: 'HF_TOKEN için "Make calls to Inference Providers" iznini ve Hugging Face Inference Providers kredi bakiyesini kontrol edin.'
    });
  }
}
