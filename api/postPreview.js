import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "yeniozanlar-68b49";
const APP_URL = "https://yeniozanlar.vercel.app";

function firebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON eksik");
  let serviceAccount = JSON.parse(raw);
  if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  return initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
}
function db() { firebaseAdmin(); return getFirestore(); }
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
function getPostId(slug){let s=String(slug||"").trim();try{s=decodeURIComponent(s)}catch{}; const m=s.match(/([A-Za-z0-9]{7})(?:[/?#]|$)/); return m?m[1]:null;}
function excerpt(t){const s=String(t||"").replace(/\s+/g," ").trim();return !s?"Yeni Ozanlar'da bir şiir.":s.length<=280?s:s.slice(0,277).replace(/\s+\S*$/g,"")+"…";}
function imageType(post){const r=String(post?.image||"").trim(); const m=r.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,/i); if(m)return m[1].toLowerCase(); const p=r.split("?")[0].toLowerCase(); if(p.endsWith(".png"))return"image/png";if(p.endsWith(".webp"))return"image/webp";if(p.endsWith(".gif"))return"image/gif";if(p.endsWith(".avif"))return"image/avif";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return"image/jpeg";return null;}
function imageUrl(post,id){return post?.image?`${APP_URL}/api/postImage?id=${encodeURIComponent(id)}&v=${encodeURIComponent(String(post.ts||"1"))}`:null;}
function yt(url){const m=String(url||"").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);return m?m[1]:null;}
function bot(ua){ua=String(ua||"").toLowerCase();return ["facebookexternalhit","facebot","meta-externalagent","meta-externalfetcher","twitterbot","linkedinbot","whatsapp","telegrambot","discordbot","slackbot","skypeuripreview","pinterest"].some(x=>ua.includes(x));}
function html(d){return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(d.title)}</title><meta name="description" content="${esc(d.description)}"><link rel="canonical" href="${esc(d.canonical)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Yeni Ozanlar"><meta property="og:locale" content="tr_TR"><meta property="og:url" content="${esc(d.canonical)}"><meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(d.description)}">${d.image?`<meta property="og:image" content="${esc(d.image)}"><meta property="og:image:secure_url" content="${esc(d.image)}"><meta property="og:image:type" content="${esc(d.imageType||"image/jpeg")}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(d.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(d.image)}">`:``}<meta name="twitter:title" content="${esc(d.title)}"><meta name="twitter:description" content="${esc(d.description)}"></head><body><h1>${esc(d.title)}</h1><p>${esc(d.description)}</p>${d.image?`<img src="${esc(d.image)}" alt="${esc(d.title)}">`:""}<p><a href="${esc(d.canonical)}">Yeni Ozanlar'da şiiri görüntüle</a></p></body></html>`;}
async function shell(){const r=await fetch(`${APP_URL}/`,{headers:{"User-Agent":"YeniOzanlar-AppShell/1.0"}});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text();}
export default async function handler(req,res){try{const slug=String(req.query?.slug||"").trim();const id=getPostId(slug);if(!id){const s=await shell();res.setHeader("Content-Type","text/html; charset=utf-8");return res.status(200).send(s);}const snap=await db().collection("posts").doc(id).get();if(!snap.exists){const s=await shell();res.setHeader("Content-Type","text/html; charset=utf-8");return res.status(200).send(s);}const post=snap.data()||{};const d={title:String(post.title||"Yeni Ozanlar").trim(),description:excerpt(post.text),image:imageUrl(post,id),imageType:imageType(post),canonical:`${APP_URL}/post/${encodeURIComponent(slug.split("?")[0])}`};if(!d.image&&post.youtube){const y=yt(post.youtube);if(y){d.image=`https://img.youtube.com/vi/${y}/hqdefault.jpg`;d.imageType="image/jpeg";}}res.setHeader("Content-Type","text/html; charset=utf-8");res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=3600");return res.status(200).send(html(d));}catch(e){console.error("postPreview.js HATASI",e);return res.status(500).send("Şiir önizlemesi oluşturulamadı.");}}
