// Vercel Serverless Function
// Hugging Face Inference Providers -> FLUX.1-schnell
// Vercel Environment Variable: HF_TOKEN

const MODEL='black-forest-labs/FLUX.1-schnell';
const TIMEOUT_MS=70000;

function buildPrompt(title,text){
  const poem=String(text||'').trim().slice(0,12000);
  const heading=String(title||'').trim().slice(0,500);
  return [
    'Create one original landscape image directly inspired by the Turkish poem below.',
    'The poem is the primary source. Show its concrete setting, people, objects, actions, symbols, metaphors and emotions.',
    'Do not create a generic poetry image and do not add unrelated subjects.',
    'Style: cinematic photography, poetic atmosphere, emotional realism, elegant composition, natural dramatic lighting, depth of field, subtle film color grading.',
    "Reflect the poem's actual mood: romantic, melancholic, nostalgic, hopeful, dark or dreamy only when appropriate.",
    'No readable text, letters, captions, logos, watermark, collage or GIF elements inside the image.',
    'Landscape 16:9 composition suitable for a poetry post.',
    heading ? `Poem title: ${heading}` : '',
    'Turkish poem:', poem
  ].filter(Boolean).join('\n\n');
}

function errText(err){
  const msg=err?.message||String(err||'Bilinmeyen hata');
  return msg.slice(0,2500);
}

export const maxDuration=75;

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Yalnızca POST destekleniyor.'});

  const token=String(process.env.HF_TOKEN||'').trim();
  if(!token) return res.status(500).json({error:'HF_TOKEN Vercel Environment Variable bulunamadı.'});

  const title=req.body?.title||'';
  const text=req.body?.text||'';
  if(!String(text).trim()) return res.status(400).json({error:'Şiir metni boş.'});

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);

  try{
    const {InferenceClient}=await import('@huggingface/inference');
    const client=new InferenceClient(token);

    // FLUX.1-schnell için Hugging Face'in resmi Inference Providers yönlendirmesi.
    // fal-ai şu anda model için desteklenen bir text-to-image sağlayıcısıdır.
    const imageBlob=await client.textToImage({
      model:MODEL,
      provider:'fal-ai',
      inputs:buildPrompt(title,text),
      parameters:{width:1024,height:576,num_inference_steps:4}
    });

    if(!imageBlob) throw new Error('Hugging Face boş yanıt döndürdü.');
    const buffer=Buffer.from(await imageBlob.arrayBuffer());
    if(!buffer.length) throw new Error('FLUX boş görsel döndürdü.');

    const mime=imageBlob.type||'image/png';
    res.setHeader('Content-Type',mime);
    res.setHeader('Content-Length',String(buffer.length));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-AI-Provider','huggingface');
    res.setHeader('X-AI-Model',MODEL);
    return res.status(200).send(buffer);
  }catch(err){
    const msg=err?.name==='AbortError'?'Hugging Face FLUX isteği 70 saniyede tamamlanmadı.':errText(err);
    console.error('FLUX error:',msg);
    return res.status(502).json({error:`FLUX görsel üretimi başarısız: ${msg}`,provider:'huggingface',model:MODEL});
  }finally{
    clearTimeout(timer);
  }
}
