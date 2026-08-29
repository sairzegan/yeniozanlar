// Vercel Serverless Function — GIPHY araması.
// Vercel Environment Variables: GIPHY_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST destekleniyor.' });
  const key = process.env.GIPHY_API_KEY;
  if (!key) return res.status(500).json({ error: 'GIPHY_API_KEY Vercel Environment Variables içinde tanımlı değil.' });

  const query = String(req.body?.query || 'poetry emotional aesthetic').trim().slice(0, 120);
  try {
    const url = new URL('https://api.giphy.com/v1/gifs/search');
    url.searchParams.set('api_key', key);
    url.searchParams.set('q', query || 'poetry emotional aesthetic');
    url.searchParams.set('limit', '12');
    url.searchParams.set('rating', 'g');
    url.searchParams.set('lang', 'en');

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.message || `GIPHY HTTP ${r.status}` });

    const list = Array.isArray(data?.data) ? data.data : [];
    const gif = list.find(x => x?.images?.original?.url) || list.find(x => x?.images?.downsized?.url);
    if (!gif) return res.status(404).json({ error: 'Bu arama için GIF bulunamadı.' });

    return res.status(200).json({
      gifUrl: gif.images.original?.url || gif.images.downsized?.url,
      title: gif.title || '',
      id: gif.id || ''
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'GIPHY bağlantı hatası.' });
  }
}
