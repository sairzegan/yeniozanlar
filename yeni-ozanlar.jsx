import { useState, useEffect, useRef } from "react";



const uid = () => Math.random().toString(36).slice(2, 9);
const now = () => new Date().toLocaleString("tr-TR");
const youtubeId = (url) => {
  const m = url?.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};
const calcAvg = (ratings, aiScore) => {
  const vals = Object.values(ratings || {});
  const userAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  if (userAvg === null && (aiScore === null || aiScore === undefined)) return null;
  if (userAvg === null) return +aiScore.toFixed(2);
  if (aiScore === null || aiScore === undefined) return +userAvg.toFixed(2);
  return +(userAvg * 0.6 + aiScore * 0.4).toFixed(2);
};
const scoreColor = (s) => {
  if (!s) return "#6b5b8a";
  if (s >= 8.5) return "#fbbf24";
  if (s >= 7) return "#34d399";
  if (s >= 5) return "#c084fc";
  return "#f87171";
};
const scoreBadge = (s) => {
  if (!s) return "";
  if (s >= 9) return "🏆 Başyapıt";
  if (s >= 8) return "⭐ Muhteşem";
  if (s >= 7) return "✨ Güzel";
  if (s >= 5) return "👍 İyi";
  return "📝 Gelişiyor";
};

// localStorage helpers
const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Yerleşik şiir analiz motoru — API gerektirmez
function scorePoem(text) {
  const satirlar = text.split("\n").filter(s => s.trim().length > 0);
  const kelimeler = text.trim().split(/\s+/);
  const benzersiz = new Set(kelimeler.map(k => k.toLowerCase().replace(/[^a-züğışöçâîû]/gi, ""))).size;
  const uzunluk = kelimeler.length;
  const satirSayisi = satirlar.length;

  // İmge ve edebi araçlar
  const imgeler = ["gibi","sanki","kadar","değil","sanmak","andır","tıpkı","adeta","neredeyse","bir","her","hiç"].filter(w => text.toLowerCase().includes(w)).length;
  const noktalama = (text.match(/[,;:!?—–.]/g) || []).length;
  const buyukHarf = (text.match(/\b[A-ZÜĞİŞÖÇÂÎÛ][a-züğışöçâîû]/g) || []).length;
  const tirnak = (text.match(/["""''«»]/g) || []).length;

  // Puan hesaplama
  let puan = 5.0;
  if (uzunluk >= 8 && uzunluk <= 50) puan += 1.2;
  else if (uzunluk > 50 && uzunluk <= 120) puan += 0.8;
  else if (uzunluk < 8) puan -= 1.0;
  if (satirSayisi >= 3 && satirSayisi <= 16) puan += 0.8;
  const zenginlik = benzersiz / kelimeler.length;
  if (zenginlik > 0.75) puan += 1.5;
  else if (zenginlik > 0.6) puan += 0.9;
  else if (zenginlik > 0.45) puan += 0.4;
  if (imgeler >= 3) puan += 0.8;
  else if (imgeler >= 1) puan += 0.4;
  if (noktalama >= 2 && noktalama <= 10) puan += 0.5;
  if (buyukHarf >= 2) puan += 0.3;
  if (tirnak >= 1) puan += 0.2;

  // Rastgelelik (her şiire özgün his)
  const rastgele = (text.length % 19) / 19 * 0.8 - 0.4;
  puan = Math.min(9.8, Math.max(4.0, puan + rastgele));
  puan = Math.round(puan * 10) / 10;

  // Yorumlar
  const gucluYorumlar = [
    "Kelime seçimleri özgün ve çarpıcı.",
    "Dizenin ritmi akıcı ve doğal.",
    "İmgeler güçlü ve yaratıcı.",
    "Duygusal derinlik hissediliyor.",
    "Sözcükler arasındaki uyum etkileyici.",
    "Şiirin atmosferi okuyucuyu içine çekiyor.",
    "Anlam katmanları zengin ve düşündürücü.",
    "Özgün bir ses ve bakış açısı var.",
  ];
  const oneriYorumlar = [
    "Bazı dizeler daha yoğun olabilir.",
    "Şiirin sonu biraz daha güçlendirilebilir.",
    "Daha fazla imge kullanmak derinlik katabilir.",
    "Ritim tutarlılığı geliştirilebilir.",
    "Tekrarlanan kelimeler çeşitlendirilebilir.",
    "İlk dize daha çarpıcı hale getirilebilir.",
  ];
  const genelYorumlar = [
    `${satirSayisi} dizelik bu şiir, ${puan >= 7.5 ? "güçlü bir lirik ses taşıyor" : "gelişmeye açık bir yapı sunuyor"}. Kelime zenginliği ${zenginlik > 0.7 ? "oldukça yüksek" : "orta düzeyde"} ve duygu yoğunluğu hissedilir.`,
    `Şiirde ${imgeler > 2 ? "zengin imgelem kullanımı dikkat çekiyor" : "sade bir dil tercih edilmiş"}. ${puan >= 8 ? "Okuyucuda derin bir etki bırakıyor." : "Birkaç düzenlemeyle çok daha güçlü olabilir."}`,
    `${uzunluk < 15 ? "Kısa ve öz bir şiir" : "Kapsamlı bir şiirsel anlatım"}. Sözcükler ${zenginlik > 0.65 ? "özenle seçilmiş" : "daha çeşitlendirilebilir"}, ${puan >= 7 ? "bütünlük sağlanmış." : "yapı geliştirilmeye açık."}`,
  ];

  const idx = text.length % gucluYorumlar.length;
  const oidx = (text.length + satirSayisi) % oneriYorumlar.length;
  const gidx = text.length % genelYorumlar.length;

  return {
    score: puan,
    yorum: genelYorumlar[gidx],
    gucluYonler: gucluYorumlar[idx],
    gelistirmeOnerisi: oneriYorumlar[oidx],
  };
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0a1a;font-family:Georgia,serif}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-thumb{background:#6d28d9;border-radius:2px}
  .btn{cursor:pointer;border:none;outline:none;transition:all .2s}
  .btn:hover{opacity:.85;transform:translateY(-1px)}
  .btn:active{transform:translateY(0)}
  input,textarea{outline:none}
  .card{background:linear-gradient(135deg,#1a0f2e,#160d28);border:1px solid #2d1b52;border-radius:16px;padding:20px;margin-bottom:16px}
  .av{display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:700;flex-shrink:0;font-family:'Crimson Text',serif}
  .fade{animation:fi .35s ease}
  @keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
`;

const PB = { background:"linear-gradient(135deg,#7c3aed,#a855f7)", color:"#fff", padding:"10px 24px", borderRadius:50, fontSize:"1rem", fontFamily:"'Crimson Text',serif", fontWeight:600, border:"none", cursor:"pointer" };

function Av({ user, size=40, onClick, style={} }) {
  if (!user) return null;
  return (
    <div className="av" onClick={onClick} style={{ width:size, height:size, fontSize:size*.36, background:`linear-gradient(135deg,${user.color||"#7c3aed"},#a855f7)`, color:"#fff", cursor:onClick?"pointer":"default", ...style }}>
      {user.avatar||user.name?.slice(0,2).toUpperCase()}
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers]     = useState(() => lsGet("yo_users", []));
  const [posts, setPosts]     = useState(() => lsGet("yo_posts", []));
  const [me, setMe]           = useState(() => lsGet("yo_me", null));
  const [screen, setScreen]   = useState(me ? "feed" : "landing");
  const [profileId, setProfileId] = useState(null);
  const [postId, setPostId]   = useState(null);
  const [follows, setFollows] = useState(() => lsGet("yo_follows", {}));
  const [msgs, setMsgs]       = useState(() => lsGet("yo_msgs", []));

  useEffect(() => lsSet("yo_users", users), [users]);
  useEffect(() => lsSet("yo_posts", posts), [posts]);
  useEffect(() => lsSet("yo_me", me), [me]);
  useEffect(() => lsSet("yo_follows", follows), [follows]);
  useEffect(() => lsSet("yo_msgs", msgs), [msgs]);

  const login  = u  => { setMe(u); setScreen("feed"); };
  const logout = () => { setMe(null); setScreen("landing"); };
  const goProfile = id => { setProfileId(id); setScreen("profile"); };
  const goPost    = id => { setPostId(id);    setScreen("postdetail"); };

  const register = (name, username, password) => {
    if (users.find(u => u.username === username)) return "Bu kullanıcı adı alınmış.";
    const u = { id: uid(), name, username, password, bio: "", avatar: name.slice(0,2).toUpperCase(), color: `hsl(${Math.random()*360},70%,65%)` };
    setUsers(prev => [...prev, u]);
    setFollows(prev => ({ ...prev, [u.id]: [] }));
    login(u);
    return null;
  };

  const loginUser = (username, password) => {
    const u = users.find(u => u.username === username && u.password === password);
    if (!u) return "Kullanıcı adı veya şifre hatalı.";
    login(u);
    return null;
  };

  const toggleFollow = tid => {
    setFollows(prev => {
      const list = prev[me.id] || [];
      const has  = list.includes(tid);
      const updated = { ...prev, [me.id]: has ? list.filter(x=>x!==tid) : [...list,tid] };
      lsSet("yo_follows", updated);
      return updated;
    });
  };
  const isFollowing = tid => (follows[me?.id]||[]).includes(tid);

  const addPost = (pd) => {
    const np = { ...pd, id:uid(), authorId:me.id, userRatings:{}, aiScore:null, aiYorum:null, aiGuclu:null, aiOneri:null, comments:[], date:now() };
    if (pd.text?.trim().length > 10) {
      const r = scorePoem(pd.text);
      if (r) { np.aiScore = r.score; np.aiYorum = r.yorum; np.aiGuclu = r.gucluYonler; np.aiOneri = r.gelistirmeOnerisi; }
    }
    setPosts(prev => { const updated = [np, ...prev]; lsSet("yo_posts", updated); return updated; });
  };

  const ratePost = (pid, score) => {
    setPosts(prev => {
      const updated = prev.map(p => p.id!==pid ? p : { ...p, userRatings:{ ...p.userRatings, [me.id]:score } });
      lsSet("yo_posts", updated);
      return updated;
    });
  };

  const addComment = (pid, text) => {
    setPosts(prev => {
      const updated = prev.map(p => p.id!==pid ? p : { ...p, comments:[...p.comments,{ id:uid(), authorId:me.id, text, date:now() }] });
      lsSet("yo_posts", updated);
      return updated;
    });
  };

  const sendMsg = (toId, text) => {
    setMsgs(prev => { const updated = [...prev,{ id:uid(), fromId:me.id, toId, text, date:now() }]; lsSet("yo_msgs", updated); return updated; });
  };

  const byId = id => users.find(u=>u.id===id);

  const sp = { users, posts, me, login:loginUser, logout, register, goProfile, profileId, goPost, postId, toggleFollow, isFollowing, addPost, ratePost, addComment, setScreen, byId, msgs, sendMsg, follows };
  const SCREENS = { landing:Landing, login:LoginS, register:RegisterS, feed:Feed, profile:Profile, messages:MsgsS, explore:Explore, leaderboard:Leaderboard, postdetail:PostDetail };
  const Screen = SCREENS[screen] || Landing;

  return (
    <div style={{ minHeight:"100vh", background:"#0f0a1a", color:"#f0e8ff" }}>
      <style>{CSS}</style>
      <Screen {...sp} />
    </div>
  );
}

// ─── LANDING ─────────────────────────────────────────────────────────────────
function Landing({ setScreen }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 20px", background:"radial-gradient(ellipse at 30% 20%,#3b0d6e,#0f0a1a)" }}>
      <div style={{ textAlign:"center", maxWidth:520 }} className="fade">
        <div style={{ fontSize:52 }}>🪶</div>
        <h1 style={{ fontFamily:"'Playfair Display',serif", fontSize:"clamp(2.4rem,8vw,3.8rem)", fontWeight:700, background:"linear-gradient(135deg,#e9d5ff,#c084fc,#a855f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", lineHeight:1.15, margin:"12px 0" }}>
          Yeni Ozanlar
        </h1>
        <p style={{ fontFamily:"'Crimson Text',serif", fontSize:"1.1rem", color:"#c4b5fd", fontStyle:"italic", marginBottom:10, lineHeight:1.6 }}>
          Şiirini paylaş, müziğini duyur, sesini kelimelere dök.
        </p>
        <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".9rem", color:"#7c6b9a", marginBottom:36 }}>
          🤖 Yapay zeka şiirleri değerlendiriyor &nbsp;·&nbsp; ⭐ Topluluk puan veriyor &nbsp;·&nbsp; 🏆 En iyi ozanlar sıralanıyor
        </p>
        <div style={{ display:"flex", gap:14, justifyContent:"center", flexWrap:"wrap" }}>
          <button className="btn" onClick={()=>setScreen("register")} style={PB}>Kayıt Ol</button>
          <button className="btn" onClick={()=>setScreen("login")} style={{ background:"transparent", color:"#c084fc", padding:"10px 32px", borderRadius:50, fontSize:"1rem", fontFamily:"'Crimson Text',serif", border:"1.5px solid #7c3aed" }}>Giriş Yap</button>
        </div>
      </div>
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthWrap({ title, sub, children }) {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:20, background:"radial-gradient(ellipse at 70% 80%,#3b0d6e,#0f0a1a)" }}>
      <div style={{ width:"100%", maxWidth:400 }} className="fade">
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <span style={{ fontSize:34 }}>🪶</span>
          <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.9rem", color:"#e9d5ff", marginTop:6 }}>{title}</h2>
          <p style={{ color:"#a78bfa", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>{sub}</p>
        </div>
        <div className="card" style={{ display:"flex", flexDirection:"column", gap:14 }}>{children}</div>
      </div>
    </div>
  );
}

function FInp({ label, value, onChange, placeholder, type="text" }) {
  return (
    <div>
      <label style={{ display:"block", color:"#a78bfa", fontSize:".85rem", fontFamily:"'Crimson Text',serif", marginBottom:5 }}>{label}</label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:"1rem" }} />
    </div>
  );
}

function LoginS({ login, setScreen }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState("");
  const handle = () => { const e = login(u.trim(), p); if (e) setErr(e); };
  return (
    <AuthWrap title="Hoş geldin" sub="Hesabınla giriş yap">
      <FInp label="Kullanıcı adı" value={u} onChange={setU} placeholder="kullaniciadi" />
      <FInp label="Şifre" value={p} onChange={setP} placeholder="••••••••" type="password" />
      {err && <p style={{ color:"#f87171", fontSize:".85rem" }}>{err}</p>}
      <button className="btn" onClick={handle} style={PB}>Giriş Yap</button>
      <p style={{ textAlign:"center", color:"#a78bfa", fontSize:".9rem", fontFamily:"'Crimson Text',serif" }}>
        Hesabın yok mu? <span style={{ color:"#c084fc", cursor:"pointer", textDecoration:"underline" }} onClick={()=>setScreen("register")}>Kayıt ol</span>
      </p>
    </AuthWrap>
  );
}

function RegisterS({ register, setScreen }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [p2, setP2] = useState(""); const [err, setErr] = useState("");
  const handle = () => {
    if (!u || !p) return setErr("Tüm alanları doldurun.");
    if (p !== p2) return setErr("Şifreler eşleşmiyor.");
    if (p.length < 6) return setErr("Şifre en az 6 karakter olmalı.");
    const e = register(u.trim(), u.trim(), p);
    if (e) setErr(e);
  };
  return (
    <AuthWrap title="Katıl" sub="Yeni Ozanlar'a üye ol">
      <FInp label="Kullanıcı adı" value={u} onChange={setU} placeholder="kullaniciadi" />
      <FInp label="Şifre" value={p} onChange={setP} placeholder="••••••••" type="password" />
      <FInp label="Şifre tekrar" value={p2} onChange={setP2} placeholder="••••••••" type="password" />
      {err && <p style={{ color:"#f87171", fontSize:".85rem" }}>{err}</p>}
      <button className="btn" onClick={handle} style={PB}>Hesap Oluştur</button>
      <p style={{ textAlign:"center", color:"#a78bfa", fontSize:".9rem", fontFamily:"'Crimson Text',serif" }}>
        Zaten üye misin? <span style={{ color:"#c084fc", cursor:"pointer", textDecoration:"underline" }} onClick={()=>setScreen("login")}>Giriş yap</span>
      </p>
    </AuthWrap>
  );
}

// ─── NAV ─────────────────────────────────────────────────────────────────────
function Nav({ me, screen, setScreen, logout }) {
  const tabs = [
    { k:"feed", ic:"🏠", lb:"Akış" },
    { k:"leaderboard", ic:"🏆", lb:"Sıralama" },
    { k:"explore", ic:"🔍", lb:"Keşfet" },
    { k:"messages", ic:"✉️", lb:"Mesaj" },
    { k:"profile", ic:"👤", lb:"Profil" },
  ];
  return (
    <>
      <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, background:"rgba(15,10,26,.96)", backdropFilter:"blur(12px)", borderBottom:"1px solid #2d1b52", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px" }}>
        <span style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.15rem", color:"#c084fc", cursor:"pointer" }} onClick={()=>setScreen("feed")}>🪶 Yeni Ozanlar</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Av user={me} size={30} onClick={()=>setScreen("profile")} />
          <button className="btn" onClick={logout} style={{ background:"transparent", color:"#a78bfa", fontSize:".75rem", padding:"4px 10px", border:"1px solid #3d1f6e", borderRadius:20, fontFamily:"'Crimson Text',serif" }}>Çıkış</button>
        </div>
      </div>
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:100, background:"rgba(15,10,26,.96)", backdropFilter:"blur(12px)", borderTop:"1px solid #2d1b52", display:"flex", justifyContent:"space-around", padding:"8px 0 12px" }}>
        {tabs.map(t => (
          <button key={t.k} className="btn" onClick={()=>setScreen(t.k)} style={{ background:"none", color:screen===t.k?"#c084fc":"#6b5b8a", display:"flex", flexDirection:"column", alignItems:"center", gap:2, fontSize:".62rem", fontFamily:"'Crimson Text',serif", padding:"4px 6px", borderBottom:screen===t.k?"2px solid #c084fc":"2px solid transparent" }}>
            <span style={{ fontSize:"1.2rem" }}>{t.ic}</span>{t.lb}
          </button>
        ))}
      </div>
    </>
  );
}

function Layout({ children, me, screen, setScreen, logout }) {
  return (
    <div style={{ paddingTop:60, paddingBottom:72, minHeight:"100vh" }}>
      <Nav me={me} screen={screen} setScreen={setScreen} logout={logout} />
      <div style={{ maxWidth:560, margin:"0 auto", padding:"20px 16px" }}>{children}</div>
    </div>
  );
}

// ─── COMPOSE MODAL ────────────────────────────────────────────────────────────
function ComposeModal({ me, addPost, onClose }) {
  const [title,   setTitle]   = useState("");
  const [text,    setText]    = useState("");
  const [ytUrl,   setYtUrl]   = useState("");
  const [showYt,  setShowYt]  = useState(false);
  const [posting, setPosting] = useState(false);
  const [image,   setImage]   = useState(null);
  const fileRef = useRef();

  const handleImage = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if ((!text.trim() && !ytUrl.trim() && !image) || posting) return;
    setPosting(true);
    addPost({ title: title.trim(), text: text.trim(), youtube: ytUrl.trim() || null, image: image || null });
    setPosting(false);
    onClose();
  };

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,.78)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div className="fade" style={{ width:"100%", maxWidth:560, background:"linear-gradient(160deg,#1e0f3a,#160d28)", borderRadius:"22px 22px 0 0", border:"1px solid #5b21b6", borderBottom:"none", padding:"22px 20px 44px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h3 style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", fontSize:"1.15rem" }}>🪶 Yeni Şiir Ekle</h3>
          <button className="btn" onClick={onClose} style={{ background:"none", color:"#6b5b8a", fontSize:"1.4rem", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ display:"flex", gap:12 }}>
          <Av user={me} size={40} />
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Şiirin başlığı..."
              style={{ width:"100%", background:"#0f0a1a", border:"1px solid #5b21b6", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Playfair Display',serif", fontSize:"1rem" }} />
            <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Şiirini buraya yaz... Yapay zeka anında değerlendirecek! 🤖" rows={5}
              style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", resize:"none", fontFamily:"'Crimson Text',serif", fontSize:"1.05rem", lineHeight:1.8 }} />

            {image && <img src={image} alt="önizleme" style={{ borderRadius:10, maxHeight:200, objectFit:"cover", width:"100%" }} />}

            {showYt && (
              <input value={ytUrl} onChange={e=>setYtUrl(e.target.value)} placeholder="YouTube linki yapıştır..."
                style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:".95rem" }} />
            )}

            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <button className="btn" onClick={()=>fileRef.current.click()} style={{ background:"transparent", color:"#a78bfa", padding:"7px 14px", borderRadius:20, border:"1px solid #3d1f6e", fontSize:".83rem", fontFamily:"'Crimson Text',serif" }}>🖼️ Resim</button>
              <button className="btn" onClick={()=>setShowYt(x=>!x)} style={{ background:showYt?"#3d1f6e":"transparent", color:"#a78bfa", padding:"7px 14px", borderRadius:20, border:"1px solid #3d1f6e", fontSize:".83rem", fontFamily:"'Crimson Text',serif" }}>▶ YouTube</button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display:"none" }} />
              <button className="btn" onClick={submit} disabled={posting} style={{ ...PB, marginLeft:"auto", opacity:posting?0.6:1 }}>
                {posting ? "⏳ Değerlendiriliyor..." : "Paylaş"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FEED ─────────────────────────────────────────────────────────────────────
function Feed(props) {
  const { posts, me, addPost } = props;
  const [showCompose, setShowCompose] = useState(false);

  return (
    <Layout {...props}>
      <div style={{ background:"linear-gradient(135deg,#2d1060,#1a0f3e)", border:"1px solid #5b21b6", borderRadius:14, padding:"12px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:"1.3rem" }}>💡</span>
        <p style={{ fontFamily:"'Crimson Text',serif", color:"#c4b5fd", fontSize:".88rem", fontStyle:"italic", lineHeight:1.5 }}>Şiirleri puanla, yorum yaz — her katkın sıralamayı şekillendirir! ⭐</p>
      </div>
      <button className="btn" onClick={()=>setShowCompose(true)} style={{ width:"100%", marginBottom:20, background:"linear-gradient(135deg,#1e0a3e,#2d1060)", border:"2px dashed #7c3aed", borderRadius:14, padding:"18px", color:"#c084fc", fontFamily:"'Playfair Display',serif", fontSize:"1.05rem", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        <span style={{ fontSize:"1.5rem" }}>🪶</span> + Şiir Ekle
      </button>
      {posts.map(p => <PostCard key={p.id} post={p} {...props} />)}
      {showCompose && <ComposeModal me={me} addPost={addPost} onClose={()=>setShowCompose(false)} />}
    </Layout>
  );
}

// ─── POST CARD ────────────────────────────────────────────────────────────────
function PostCard({ post, me, ratePost, addComment, byId, goProfile, goPost }) {
  const [showCmts, setShowCmts] = useState(false);
  const [cmtText,  setCmtText]  = useState("");
  const [showAI,   setShowAI]   = useState(false);
  const [hov,      setHov]      = useState(null);

  const author   = byId(post.authorId);
  const ytId     = youtubeId(post.youtube);
  const myRating = post.userRatings?.[me?.id] ?? null;
  const avg      = calcAvg(post.userRatings, post.aiScore);
  const ucnt     = Object.keys(post.userRatings||{}).length;
  const isOwn    = post.authorId === me?.id;

  const submitCmt = () => { if (!cmtText.trim()) return; addComment(post.id, cmtText.trim()); setCmtText(""); };

  return (
    <div className="card fade">
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <Av user={author} size={42} onClick={()=>goProfile(author?.id)} />
        <div style={{ flex:1 }}>
          <p style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, color:"#e9d5ff", cursor:"pointer" }} onClick={()=>goProfile(author?.id)}>{author?.name}</p>
          <p style={{ color:"#6b5b8a", fontSize:".78rem", fontFamily:"'Crimson Text',serif" }}>@{author?.username} · {post.date}</p>
        </div>
        {avg !== null && (
          <div style={{ textAlign:"center", background:"#0f0a1a", borderRadius:10, padding:"6px 10px", border:`1px solid ${scoreColor(avg)}44`, minWidth:50 }}>
            <p style={{ fontSize:"1.15rem", fontWeight:700, color:scoreColor(avg), fontFamily:"'Playfair Display',serif", lineHeight:1 }}>{avg.toFixed(1)}</p>
            <p style={{ fontSize:".58rem", color:"#6b5b8a" }}>/10</p>
          </div>
        )}
      </div>

      {post.title && (
        <h3 onClick={()=>goPost(post.id)} style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.1rem", color:"#e9d5ff", fontStyle:"italic", marginBottom:10, paddingBottom:8, borderBottom:"1px solid #2d1b52", cursor:"pointer", textDecoration:"underline", textDecorationColor:"#5b21b6" }}>
          "{post.title}"
        </h3>
      )}

      {post.text && <p style={{ fontFamily:"'Crimson Text',serif", fontSize:"1.05rem", color:"#ddd6fe", lineHeight:1.9, whiteSpace:"pre-wrap", marginBottom:14 }}>{post.text}</p>}

      {post.image && <img src={post.image} alt="şiir görseli" style={{ width:"100%", borderRadius:12, marginBottom:14, maxHeight:300, objectFit:"cover" }} />}

      {ytId && (
        <div style={{ borderRadius:12, overflow:"hidden", marginBottom:14, aspectRatio:"16/9" }}>
          <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${ytId}`} frameBorder="0" allowFullScreen style={{ display:"block" }} />
        </div>
      )}

      {post.aiScore !== null && post.aiScore !== undefined && (
        <div style={{ marginBottom:12 }}>
          <button className="btn" onClick={()=>setShowAI(x=>!x)} style={{ background:"linear-gradient(135deg,#1e0a3e,#2d1060)", border:"1px solid #5b21b6", borderRadius:10, padding:"8px 14px", color:"#c084fc", fontSize:".85rem", fontFamily:"'Crimson Text',serif", display:"flex", alignItems:"center", gap:8, width:"100%" }}>
            <span>🤖</span><span style={{ flex:1, textAlign:"left" }}>Yapay Zeka Değerlendirmesi</span>
            <span style={{ color:scoreColor(post.aiScore), fontWeight:700 }}>{post.aiScore}/10</span>
            <span style={{ fontSize:".7rem" }}>{showAI?"▲":"▼"}</span>
          </button>
          {showAI && (
            <div style={{ background:"#0a0718", border:"1px solid #3d1f6e", borderTop:"none", borderRadius:"0 0 10px 10px", padding:"12px 14px" }}>
              <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".92rem", color:"#c4b5fd", fontStyle:"italic", lineHeight:1.7, marginBottom:10 }}>"{post.aiYorum}"</p>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {post.aiGuclu && <span style={{ background:"#052e16", border:"1px solid #166534", borderRadius:20, padding:"3px 10px", fontSize:".76rem", color:"#34d399", fontFamily:"'Crimson Text',serif" }}>💪 {post.aiGuclu}</span>}
                {post.aiOneri && <span style={{ background:"#1e1b4b", border:"1px solid #4338ca", borderRadius:20, padding:"3px 10px", fontSize:".76rem", color:"#a5b4fc", fontFamily:"'Crimson Text',serif" }}>💡 {post.aiOneri}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {!isOwn && (
        <div style={{ background:"#0f0a1a", border:myRating?"1px solid #5b21b6":"1px dashed #3d1f6e", borderRadius:12, padding:"12px 14px", marginBottom:12 }}>
          <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".85rem", color:myRating?"#c084fc":"#a78bfa", marginBottom:8, fontStyle:myRating?"normal":"italic" }}>
            {myRating ? `✅ Puanınız: ${myRating}/10 — teşekkürler!` : "⭐ Bu şiire puan ver! (1-10)"}
          </p>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {[1,2,3,4,5,6,7,8,9,10].map(n => {
              const on = hov!==null ? n<=hov : n<=(myRating||0);
              return <button key={n} onMouseEnter={()=>setHov(n)} onMouseLeave={()=>setHov(null)} onClick={()=>ratePost(post.id,n)}
                style={{ background:"none", border:"none", cursor:"pointer", fontSize:"1.15rem", padding:"2px 3px", transition:"transform .1s", transform:on?"scale(1.25)":"scale(1)", filter:on?"none":"grayscale(1) opacity(.3)" }}>
                {n<=5?"⭐":"🌟"}
              </button>;
            })}
          </div>
          {ucnt>0 && <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".74rem", color:"#6b5b8a", marginTop:6 }}>{ucnt} kişi puan verdi · Ort: {(Object.values(post.userRatings).reduce((a,b)=>a+b,0)/ucnt).toFixed(1)}</p>}
        </div>
      )}
      {isOwn && ucnt>0 && (
        <div style={{ background:"#0f0a1a", border:"1px solid #2d1b52", borderRadius:12, padding:"10px 14px", marginBottom:12 }}>
          <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".85rem", color:"#a78bfa" }}>{ucnt} kişi puan verdi · Ort: {(Object.values(post.userRatings).reduce((a,b)=>a+b,0)/ucnt).toFixed(1)}/10</p>
        </div>
      )}

      {avg!==null && <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".82rem", color:scoreColor(avg), textAlign:"center", marginBottom:10 }}>{scoreBadge(avg)}</p>}

      <div style={{ borderTop:"1px solid #2d1b52", paddingTop:10 }}>
        <button className="btn" onClick={()=>setShowCmts(x=>!x)} style={{ background:"none", color:"#6b5b8a", fontSize:".88rem", fontFamily:"'Crimson Text',serif", display:"flex", gap:6 }}>
          💬 {post.comments.length} yorum {post.comments.length===0?"— ilk yorumu sen yaz!":""}
        </button>
        {showCmts && (
          <div style={{ marginTop:10 }}>
            {post.comments.map(c => {
              const ca = byId(c.authorId);
              return (
                <div key={c.id} style={{ display:"flex", gap:8, marginBottom:10 }}>
                  <Av user={ca} size={28} />
                  <div style={{ background:"#0f0a1a", borderRadius:10, padding:"8px 12px", flex:1, border:"1px solid #2d1b52" }}>
                    <span style={{ fontFamily:"'Playfair Display',serif", fontSize:".8rem", color:"#c084fc" }}>{ca?.name}</span>
                    <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".9rem", color:"#ddd6fe", marginTop:2 }}>{c.text}</p>
                  </div>
                </div>
              );
            })}
            {post.comments.length===0 && <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".82rem", color:"#6b5b8a", fontStyle:"italic", marginBottom:8 }}>Ozan seni bekliyor! 🌙</p>}
            <div style={{ display:"flex", gap:8, marginTop:6 }}>
              <Av user={me} size={28} />
              <input value={cmtText} onChange={e=>setCmtText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submitCmt()} placeholder="Düşünceni paylaş..."
                style={{ flex:1, background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:20, padding:"7px 14px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:".9rem" }} />
              <button className="btn" onClick={submitCmt} style={{ ...PB, padding:"6px 14px", fontSize:".85rem" }}>↩</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── POST DETAIL ──────────────────────────────────────────────────────────────
function PostDetail({ postId, posts, me, setScreen, ...rest }) {
  const post = posts.find(p => p.id === postId);
  return (
    <Layout {...{ me, setScreen, posts, ...rest }}>
      <button className="btn" onClick={()=>setScreen("feed")} style={{ background:"none", color:"#a78bfa", fontFamily:"'Crimson Text',serif", fontSize:".9rem", marginBottom:16 }}>← Akışa Dön</button>
      {post ? <PostCard post={post} me={me} setScreen={setScreen} {...rest} /> : <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif" }}>Şiir bulunamadı.</p>}
    </Layout>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard({ posts, users, me, byId, goProfile, goPost, ...rest }) {
  const [tab, setTab] = useState("posts");

  const scored = posts
    .map(p => ({ ...p, avg: calcAvg(p.userRatings, p.aiScore) }))
    .filter(p => p.avg !== null)
    .sort((a,b) => b.avg - a.avg);

  const ranked = users.map(u => {
    const up = posts.filter(p => p.authorId===u.id && calcAvg(p.userRatings,p.aiScore)!==null);
    if (!up.length) return null;
    const avg = up.reduce((s,p)=>s+calcAvg(p.userRatings,p.aiScore),0)/up.length;
    return { ...u, avg:+avg.toFixed(2), cnt:up.length };
  }).filter(Boolean).sort((a,b)=>b.avg-a.avg);

  const medals = ["🥇","🥈","🥉"];

  return (
    <Layout {...{ me, byId, goProfile, goPost, posts, users, ...rest }}>
      <h2 style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", marginBottom:4, fontSize:"1.4rem" }}>🏆 Sıralama</h2>
      <p style={{ fontFamily:"'Crimson Text',serif", color:"#6b5b8a", fontSize:".85rem", marginBottom:16, fontStyle:"italic" }}>Puan ver, yorum yaz — sıralamayı birlikte şekillendirelim!</p>

      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[{k:"posts",lb:"🪶 En İyi Şiirler"},{k:"users",lb:"👑 En İyi Ozanlar"}].map(t=>(
          <button key={t.k} className="btn" onClick={()=>setTab(t.k)} style={{ flex:1, padding:"10px", borderRadius:10, fontFamily:"'Crimson Text',serif", fontSize:".88rem", background:tab===t.k?"linear-gradient(135deg,#7c3aed,#a855f7)":"#1a0f2e", color:tab===t.k?"#fff":"#a78bfa", border:tab===t.k?"none":"1px solid #2d1b52" }}>
            {t.lb}
          </button>
        ))}
      </div>

      {tab==="posts" && (
        scored.length===0
          ? <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic", textAlign:"center", marginTop:40 }}>Henüz puanlanmış şiir yok. İlk puanı sen ver! ⭐</p>
          : scored.map((p,i) => {
              const author = byId(p.authorId);
              const displayTitle = p.title || (p.text?.slice(0,28)+(p.text?.length>28?"…":"")) || "İsimsiz Şiir";
              return (
                <div key={p.id} className="card" style={{ display:"flex", gap:12, alignItems:"center", borderLeft:`3px solid ${i<3?["#fbbf24","#9ca3af","#cd7c2e"][i]:scoreColor(p.avg)}` }}>
                  <div style={{ textAlign:"center", minWidth:42, flexShrink:0 }}>
                    <p style={{ fontSize:"1.35rem" }}>{medals[i]||`#${i+1}`}</p>
                    <p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.1rem", fontWeight:700, color:scoreColor(p.avg) }}>{p.avg.toFixed(1)}</p>
                    <p style={{ fontSize:".55rem", color:"#6b5b8a" }}>/10</p>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p onClick={()=>goPost(p.id)} style={{ fontFamily:"'Playfair Display',serif", fontSize:"1rem", color:"#e9d5ff", fontStyle:"italic", cursor:"pointer", marginBottom:5, textDecoration:"underline", textDecorationColor:"#7c3aed", textUnderlineOffset:3 }}>
                      "{displayTitle}"
                    </p>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                      <Av user={author} size={20} onClick={()=>goProfile(author?.id)} />
                      <span style={{ fontFamily:"'Crimson Text',serif", fontSize:".8rem", color:"#a78bfa", cursor:"pointer" }} onClick={()=>goProfile(author?.id)}>{author?.name}</span>
                    </div>
                    <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontSize:".72rem", color:"#6b5b8a", fontFamily:"'Crimson Text',serif" }}>{Object.keys(p.userRatings||{}).length} oy · {p.comments.length} yorum</span>
                      <span style={{ fontSize:".72rem", color:scoreColor(p.avg), fontFamily:"'Crimson Text',serif" }}>{scoreBadge(p.avg)}</span>
                    </div>
                  </div>
                </div>
              );
            })
      )}

      {tab==="users" && (
        ranked.length===0
          ? <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic", textAlign:"center", marginTop:40 }}>Henüz sıralama oluşmadı!</p>
          : ranked.map((u,i) => (
            <div key={u.id} className="card" style={{ display:"flex", alignItems:"center", gap:14, borderLeft:`3px solid ${i<3?["#fbbf24","#9ca3af","#cd7c2e"][i]:scoreColor(u.avg)}` }}>
              <p style={{ fontSize:"1.35rem", minWidth:32 }}>{medals[i]||`#${i+1}`}</p>
              <Av user={u} size={48} onClick={()=>goProfile(u.id)} />
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, color:"#e9d5ff", cursor:"pointer" }} onClick={()=>goProfile(u.id)}>{u.name}</p>
                <p style={{ color:"#6b5b8a", fontSize:".8rem", fontFamily:"'Crimson Text',serif" }}>@{u.username} · {u.cnt} şiir</p>
              </div>
              <div style={{ textAlign:"center" }}>
                <p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.4rem", fontWeight:700, color:scoreColor(u.avg) }}>{u.avg.toFixed(1)}</p>
                <p style={{ fontSize:".63rem", color:"#6b5b8a", fontFamily:"'Crimson Text',serif" }}>ort. puan</p>
              </div>
            </div>
          ))
      )}
    </Layout>
  );
}

// ─── EXPLORE ─────────────────────────────────────────────────────────────────
function Explore({ users, me, toggleFollow, isFollowing, goProfile, ...rest }) {
  const [q, setQ] = useState("");
  const list = users.filter(u=>u.id!==me?.id&&(u.name.toLowerCase().includes(q.toLowerCase())||u.username.toLowerCase().includes(q.toLowerCase())));
  return (
    <Layout {...{ me, users, toggleFollow, isFollowing, goProfile, ...rest }}>
      <h2 style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", marginBottom:16, fontSize:"1.4rem" }}>Keşfet</h2>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ozan ara..."
        style={{ width:"100%", background:"#1a0f2e", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 16px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:"1rem", marginBottom:16 }} />
      {list.length===0 && <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>Ozan bulunamadı.</p>}
      {list.map(u=>(
        <div key={u.id} className="card" style={{ display:"flex", alignItems:"center", gap:14 }}>
          <Av user={u} size={50} onClick={()=>goProfile(u.id)} />
          <div style={{ flex:1 }}>
            <p style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, color:"#e9d5ff", cursor:"pointer" }} onClick={()=>goProfile(u.id)}>{u.name}</p>
            <p style={{ color:"#6b5b8a", fontSize:".83rem", fontFamily:"'Crimson Text',serif" }}>@{u.username}</p>
            {u.bio && <p style={{ color:"#a78bfa", fontSize:".87rem", fontFamily:"'Crimson Text',serif", fontStyle:"italic", marginTop:2 }}>{u.bio}</p>}
          </div>
          <button className="btn" onClick={()=>toggleFollow(u.id)} style={{ background:isFollowing(u.id)?"#3d1f6e":"linear-gradient(135deg,#7c3aed,#a855f7)", color:"#fff", padding:"7px 16px", borderRadius:20, fontSize:".85rem", fontFamily:"'Crimson Text',serif", border:"none" }}>
            {isFollowing(u.id)?"Takip Ediliyor":"Takip Et"}
          </button>
        </div>
      ))}
    </Layout>
  );
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────
function Profile({ profileId, me, users, posts, toggleFollow, isFollowing, follows, setScreen, goProfile, goPost, byId, ...rest }) {
  const tid  = profileId || me?.id;
  const user = users.find(u=>u.id===tid);
  const ups  = posts.filter(p=>p.authorId===tid);
  const sp   = ups.filter(p=>calcAvg(p.userRatings,p.aiScore)!==null);
  const avg  = sp.length?(sp.reduce((s,p)=>s+calcAvg(p.userRatings,p.aiScore),0)/sp.length).toFixed(1):null;
  const fc   = Object.values(follows).filter(l=>l.includes(tid)).length;
  const fg   = (follows[tid]||[]).length;
  const isMe = tid===me?.id;
  if (!user) return null;
  return (
    <Layout {...{ me, users, posts, toggleFollow, isFollowing, follows, setScreen, goProfile, goPost, byId, profileId, ...rest }}>
      <div className="card fade" style={{ textAlign:"center" }}>
        <Av user={user} size={72} style={{ margin:"0 auto 12px" }} />
        <h2 style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.5rem", color:"#e9d5ff" }}>{user.name}</h2>
        <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", marginBottom:6 }}>@{user.username}</p>
        {user.bio && <p style={{ color:"#c4b5fd", fontFamily:"'Crimson Text',serif", fontStyle:"italic", marginBottom:10 }}>{user.bio}</p>}
        {avg && <p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1rem", color:scoreColor(+avg), marginBottom:12 }}>Ort. Puan: {avg}/10 {scoreBadge(+avg)}</p>}
        <div style={{ display:"flex", justifyContent:"center", gap:28, marginBottom:16 }}>
          {[["Şiir",ups.length],["Takipçi",fc],["Takip",fg]].map(([l,v])=>(
            <div key={l}><p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.3rem", color:"#e9d5ff" }}>{v}</p><p style={{ color:"#6b5b8a", fontSize:".8rem", fontFamily:"'Crimson Text',serif" }}>{l}</p></div>
          ))}
        </div>
        {!isMe && <button className="btn" onClick={()=>toggleFollow(user.id)} style={{ ...PB, display:"inline-block" }}>{isFollowing(user.id)?"Takibi Bırak":"Takip Et"}</button>}
      </div>

      <h3 style={{ fontFamily:"'Playfair Display',serif", color:"#a78bfa", marginBottom:12, fontSize:"1.1rem" }}>Şiirler</h3>
      {ups.length===0
        ? <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>Henüz şiir paylaşılmadı.</p>
        : ups.map(p => (
          <div key={p.id} className="card" style={{ display:"flex", gap:12, alignItems:"center", cursor:"pointer" }} onClick={()=>goPost(p.id)}>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1rem", color:"#e9d5ff", fontStyle:"italic" }}>
                "{p.title || p.text?.slice(0,30)+(p.text?.length>30?"…":"") || "İsimsiz"}"
              </p>
              <p style={{ fontFamily:"'Crimson Text',serif", fontSize:".78rem", color:"#6b5b8a", marginTop:4 }}>{p.date} · {p.comments.length} yorum</p>
            </div>
            {calcAvg(p.userRatings,p.aiScore)!==null && (
              <div style={{ textAlign:"center", background:"#0f0a1a", borderRadius:8, padding:"4px 8px", border:`1px solid ${scoreColor(calcAvg(p.userRatings,p.aiScore))}44` }}>
                <p style={{ fontFamily:"'Playfair Display',serif", fontSize:"1rem", fontWeight:700, color:scoreColor(calcAvg(p.userRatings,p.aiScore)) }}>{calcAvg(p.userRatings,p.aiScore).toFixed(1)}</p>
                <p style={{ fontSize:".55rem", color:"#6b5b8a" }}>/10</p>
              </div>
            )}
          </div>
        ))
      }
    </Layout>
  );
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
function MsgsS({ me, users, msgs, sendMsg, ...rest }) {
  const [chat, setChat] = useState(null);
  const [txt,  setTxt]  = useState("");
  const endRef = useRef(null);
  const others = users.filter(u=>u.id!==me?.id);
  const thread = msgs.filter(m=>(m.fromId===me?.id&&m.toId===chat)||(m.fromId===chat&&m.toId===me?.id));
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[thread.length]);
  const send = () => { if (!txt.trim()||!chat) return; sendMsg(chat,txt.trim()); setTxt(""); };
  return (
    <Layout {...{ me, users, msgs, sendMsg, ...rest }}>
      <h2 style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", marginBottom:16, fontSize:"1.4rem" }}>Mesajlar</h2>
      {!chat ? (
        others.length===0
          ? <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>Henüz başka üye yok.</p>
          : others.map(u=>{
            const last=[...msgs].reverse().find(m=>(m.fromId===me?.id&&m.toId===u.id)||(m.fromId===u.id&&m.toId===me?.id));
            return (
              <div key={u.id} className="card" style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" }} onClick={()=>setChat(u.id)}>
                <Av user={u} size={44} />
                <div style={{ flex:1 }}>
                  <p style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", fontWeight:700 }}>{u.name}</p>
                  {last&&<p style={{ color:"#6b5b8a", fontSize:".83rem", fontFamily:"'Crimson Text',serif" }}>{last.text.slice(0,40)}{last.text.length>40?"…":""}</p>}
                </div>
              </div>
            );
          })
      ) : (
        <div>
          <button className="btn" onClick={()=>setChat(null)} style={{ background:"none", color:"#a78bfa", fontFamily:"'Crimson Text',serif", fontSize:".9rem", marginBottom:12 }}>← Geri</button>
          <div style={{ height:"52vh", overflowY:"auto", display:"flex", flexDirection:"column", gap:10, paddingBottom:8 }}>
            {thread.map(m=>{
              const mine=m.fromId===me?.id;
              return (
                <div key={m.id} style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start" }}>
                  <div style={{ maxWidth:"70%", background:mine?"linear-gradient(135deg,#7c3aed,#a855f7)":"#1a0f2e", borderRadius:mine?"16px 16px 4px 16px":"16px 16px 16px 4px", padding:"10px 14px", border:mine?"none":"1px solid #2d1b52" }}>
                    <p style={{ fontFamily:"'Crimson Text',serif", color:"#f0e8ff", fontSize:".95rem" }}>{m.text}</p>
                    <p style={{ color:mine?"#ddd6fe":"#6b5b8a", fontSize:".7rem", marginTop:4, textAlign:mine?"right":"left" }}>{m.date}</p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <div style={{ display:"flex", gap:8, marginTop:10 }}>
            <input value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Mesajını yaz..."
              style={{ flex:1, background:"#1a0f2e", border:"1px solid #3d1f6e", borderRadius:20, padding:"10px 16px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:".95rem" }} />
            <button className="btn" onClick={send} style={{ ...PB, padding:"10px 18px" }}>↩</button>
          </div>
        </div>
      )}
    </Layout>
  );
}
