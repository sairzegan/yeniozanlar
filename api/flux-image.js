// Vercel Serverless Function
// Hugging Face Inference Providers -> FLUX.1-schnell
// Vercel Environment Variable: HF_TOKEN
// Token permission: Make calls to Inference Providers

const ENDPOINT = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

function buildPrompt(title, text) {
  const poem = String(text || '').trim().slice(0, 12000);
  const heading = String(title || '').trim().slice(0, 500);
  return [
    'Create one original landscape image inspired directly by the Turkish poem below.',
    'The poem is the primary source. Visually represent its actual setting, people, objects, actions, metaphors and emotions.',
    'Do not make a generic poetry image and do not add unrelated objects or scenes.',
    'Choose the visual mood from the poem. Use cinematic photography, poetic atmosphere, emotional realism, elegant composition, natural dramatic lighting, depth of field and subtle film color grading.',
    'If the poem is romantic, melancholic, nostalgic, hopeful, dark or dreamy, reflect that mood naturally.',
    'No text, letters, captions, logos, watermark, collage or GIF elements inside the generated image.',
    'Landscape composition suitable for a poetry post.',
    heading ? `Poem title: ${heading}` : '',
    'Turkish poem:',
    poem
  ].filter(Boolean).join('\n\n');
}

async function errorText(response) {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const j = await response.json();
      return String(j?.error || j?.message || j?.detail || JSON.stringify(j)).slice(0, 1500);
    }
    return (await response.text()).slice(0, 1500);
  } catch (_) { return `HTTP ${response.status}`; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Yalnızca POST destekleniyor.'});

  const token = String(process.env.HF_TOKEN || '').trim();
  if (!token) {
    return res.status(500).json({error:'HF_TOKEN Vercel Environment Variable bulunamadı.'});
  }

  const title = req.body?.title || '';
  const text = req.body?.text || '';
  if (!String(text).trim()) return res.status(400).json({error:'Şiir metni boş.'});

  try {
    const r = await fetch(ENDPOINT, {
      method:'POST',
      headers:{
        Authorization:`Bearer ${token}`,
        'Content-Type':'application/json',
        Accept:'image/png'
      },
      body:JSON.stringify({inputs:buildPrompt(title,text)})
    });

    if (!r.ok) {
      return res.status(502).json({
        error:`Hugging Face FLUX ${r.status}: ${await errorText(r)}`,
        provider:'huggingface-flux',
        model:'black-forest-labs/FLUX.1-schnell'
      });
    }

    const type=(r.headers.get('content-type')||'image/png').split(';')[0];
    const buf=Buffer.from(await r.arrayBuffer());
    if (!buf.length || !type.startsWith('image/')) {
      return res.status(502).json({error:'FLUX görsel döndürmedi.',provider:'huggingface-flux'});
    }

    res.setHeader('Content-Type',type);
    res.setHeader('Content-Length',String(buf.length));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-AI-Provider','huggingface-flux');
    res.setHeader('X-AI-Model','black-forest-labs/FLUX.1-schnell');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({error:`Hugging Face bağlantı hatası: ${e?.message||e}`,provider:'huggingface-flux'});
  }
}
