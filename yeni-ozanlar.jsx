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
  if (userAvg === null && aiScore === null) return null;
  if (userAvg === null) return aiScore;
  if (aiScore === null) return userAvg;
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

async function scorePoem(text) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: `Sen bir şiir eleştirmenisin. Şiiri değerlendir ve SADECE bu JSON ile yanıt ver, başka hiçbir şey yazma:\n{"score":7.5,"yorum":"yorum metni","gucluYonler":"güçlü yön","gelistirmeOnerisi":"öneri"}\n\nŞiir:\n"""\n${text}\n"""` }]
      })
    });
    const data = await res.json();
    const raw = data.content?.map(b => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const j = clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);
    return JSON.parse(j);
  } catch (e) {
    console.error("AI hata:", e);
    return null;
  }
}

const SEED_USERS = [
  { id: "u1", name: "Elif Şahin",   username: "elifsan",    bio: "Kelimelerin içinde kaybolmayı severim 🌙", avatar: "ES", color: "#c084fc" },
  { id: "u2", name: "Kerem Yıldız", username: "keremyildiz", bio: "Müzik ve şiir arasında yaşıyorum 🎵",     avatar: "KY", color: "#fb923c" },
  { id: "u3", name: "Selin Arslan", username: "selinarslan", bio: "Sözcükler benim silahım ✍️",              avatar: "SA", color: "#34d399" },
];

const SEED_POSTS = [
  { id:"p1", authorId:"u1", title:"Sessizliğin Sesi",
    text:"Gökyüzü bazen yalan söyler,\nbulutlar saklı tutar gerçeği.\nAma sen bilirsin —\nsessizliğin içinde bir ses vardır.",
    youtube:null, userRatings:{u2:9,u3:8}, aiScore:8.4,
    aiYorum:"Sessizlik ve gerçek arasındaki gerilimi ustalıkla işlemişsiniz. Gökyüzü metaforu güçlü ve özgün.",
    aiGuclu:"Güçlü imgeler ve içsel ses", aiOneri:"Son dize daha gizemli bırakılabilir",
    comments:[{id:"c1",authorId:"u2",text:"Kalbime dokundu 💜 9 puan verdim!",date:"15.05.2026"}], date:"15.05.2026" },
  { id:"p2", authorId:"u2", title:"Yeni Beste",
    text:"Yeni bir şarkı besteledim! Dinlemenizi isterim 🎶",
    youtube:"https://www.youtube.com/watch?v=dQw4w9WgXcQ", userRatings:{u1:7}, aiScore:6.5,
    aiYorum:"Müzikal paylaşım. Video ile güzel bir bütün oluşturuyor.",
    aiGuclu:"Samimi enerji", aiOneri:"Birkaç satır daha eklenebilir",
    comments:[], date:"15.05.2026" },
  { id:"p3", authorId:"u3", title:"Kalem ve Kâğıt",
    text:"Sabahın ilk ışığında kalem ve kâğıt —\nbir ozan için başka neye ihtiyacı var ki?\nSözcükler uçuşur pencereden,\ngüneş onlara kanadını verir.",
    youtube:null, userRatings:{u1:8,u2:9}, aiScore:8.7,
    aiYorum:"Sabah imgesi ve yaratıcılık harika harmanlanmış. 'Sözcükler uçuşur' metaforu çok başarılı.",
    aiGuclu:"Görsel imgelem ve akıcı ritim", aiOneri:"İkinci dize güçlendirilebilir",
    comments:[{id:"c2",authorId:"u1",text:"Harika! 8 puan verdim ✨",date:"14.05.2026"}], date:"14.05.2026" },
];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0a1a}
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
  return <div className="av" onClick={onClick} style={{ width:size, height:size, fontSize:size*.36, background:`linear-gradient(135deg,${user.color||"#7c3aed"},#a855f7)`, color:"#fff", ...style }}>{user.avatar||user.name?.slice(0,2).toUpperCase()}</div>;
}

function Inp({ label, value, onChange, placeholder, type="text" }) {
  return (
    <div>
      {label && <label style={{ display:"block", color:"#a78bfa", fontSize:".85rem", fontFamily:"'Crimson Text',serif", marginBottom:6 }}>{label}</label>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:"1rem" }} />
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [users, setUsers]         = useState(SEED_USERS);
  const [posts, setPosts]         = useState(SEED_POSTS);
  const [me, setMe]               = useState(null);
  const [screen, setScreen]       = useState("landing");
  const [profileId, setProfileId] = useState(null);
  const [postId, setPostId]       = useState(null);
  const [follows, setFollows]     = useState({ u1:["u3"], u2:["u1"], u3:["u1","u2"] });
  const [msgs, setMsgs]           = useState([]);

  const login  = u  => { setMe(u); setScreen("feed"); };
  const logout = () => { setMe(null); setScreen("landing"); };

  const goProfile = id => { setProfileId(id); setScreen("profile"); };
  const goPost    = id => { setPostId(id);    setScreen("postdetail"); };

  const toggleFollow = tid => {
    setFollows(prev => {
      const list = prev[me.id] || [];
      const has  = list.includes(tid);
      return { ...prev, [me.id]: has ? list.filter(x=>x!==tid) : [...list,tid] };
    });
  };
  const isFollowing = tid => (follows[me?.id]||[]).includes(tid);

  const addPost = async pd => {
    const np = { ...pd, id:uid(), authorId:me.id, userRatings:{}, aiScore:null, aiYorum:null, aiGuclu:null, aiOneri:null, comments:[], date:now() };
    setPosts(prev => [np, ...prev]);
    if (pd.text?.trim().length > 10) {
      const r = await scorePoem(pd.text);
      if (r) setPosts(prev => prev.map(p => p.id===np.id ? { ...p, aiScore:r.score, aiYorum:r.yorum, aiGuclu:r.gucluYonler, aiOneri:r.gelistirmeOnerisi } : p));
    }
  };

  const ratePost   = (pid, score) => setPosts(prev => prev.map(p => p.id!==pid ? p : { ...p, userRatings:{ ...p.userRatings, [me.id]:score } }));
  const addComment = (pid, text)  => setPosts(prev => prev.map(p => p.id!==pid ? p : { ...p, comments:[...p.comments,{ id:uid(), authorId:me.id, text, date:now() }] }));
  const sendMsg    = (toId, text) => setMsgs(prev => [...prev,{ id:uid(), fromId:me.id, toId, text, date:now() }]);
  const regUser    = (name, uname) => {
    const u = { id:uid(), name, username:uname, bio:"", avatar:name.slice(0,2).toUpperCase(), color:`hsl(${Math.random()*360},70%,65%)` };
    setUsers(prev=>[...prev,u]); setFollows(prev=>({...prev,[u.id]:[]})); login(u);
  };
  const byId = id => users.find(u=>u.id===id);

  const sp = { users, posts, me, login, logout, regUser, goProfile, profileId, goPost, postId, toggleFollow, isFollowing, addPost, ratePost, addComment, setScreen, byId, msgs, sendMsg, follows };
  const SCREENS = { landing:Landing, login:LoginS, register:RegisterS, feed:Feed, profile:Profile, messages:MsgsS, explore:Explore, leaderboard:Leaderboard, postdetail:PostDetail };
  const Screen = SCREENS[screen] || Landing;

  return (
    <div style={{ fontFamily:"Georgia,serif", minHeight:"100vh", background:"#0f0a1a", color:"#f0e8ff" }}>
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
          <button className="btn" onClick={()=>setScreen("register")} style={PB}>Katıl</button>
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
        <div className="card" style={{ display:"flex", flexDirection:"column", gap:16 }}>{children}</div>
      </div>
    </div>
  );
}

function LoginS({ users, login, setScreen }) {
  const [u, setU] = useState(""); const [err, setErr] = useState("");
  return (
    <AuthWrap title="Hoş geldin" sub="Hesabınla giriş yap">
      <Inp label="Kullanıcı adı" value={u} onChange={setU} placeholder="kullaniciadi" />
      {err && <p style={{ color:"#f87171", fontSize:".85rem" }}>{err}</p>}
      <button className="btn" onClick={()=>{ const x=users.find(v=>v.username===u.trim()); x?login(x):setErr("Kullanıcı bulunamadı."); }} style={PB}>Giriş Yap</button>
      <p style={{ textAlign:"center", color:"#a78bfa", fontSize:".9rem", fontFamily:"'Crimson Text',serif" }}>Hesabın yok mu? <span style={{ color:"#c084fc", cursor:"pointer", textDecoration:"underline" }} onClick={()=>setScreen("register")}>Kayıt ol</span></p>
    </AuthWrap>
  );
}

function RegisterS({ regUser, setScreen }) {
  const [name, setName] = useState(""); const [uname, setUname] = useState("");
  return (
    <AuthWrap title="Katıl" sub="Yeni Ozanlar'a üye ol">
      <Inp label="Adın" value={name} onChange={setName} placeholder="Adın Soyadın" />
      <Inp label="Kullanıcı adı" value={uname} onChange={setUname} placeholder="kullaniciadi" />
      <button className="btn" onClick={()=>name&&uname&&regUser(name,uname)} style={PB}>Hesap Oluştur</button>
      <p style={{ textAlign:"center", color:"#a78bfa", fontSize:".9rem", fontFamily:"'Crimson Text',serif" }}>Zaten üye misin? <span style={{ color:"#c084fc", cursor:"pointer", textDecoration:"underline" }} onClick={()=>setScreen("login")}>Giriş yap</span></p>
    </AuthWrap>
  );
}

// ─── NAV ─────────────────────────────────────────────────────────────────────
function Nav({ me, screen, setScreen, logout }) {
  const tabs = [
    { k:"feed",        ic:"🏠", lb:"Akış" },
    { k:"leaderboard", ic:"🏆", lb:"Sıralama" },
    { k:"explore",     ic:"🔍", lb:"Keşfet" },
    { k:"messages",    ic:"✉️", lb:"Mesaj" },
    { k:"profile",     ic:"👤", lb:"Profil" },
  ];
  return (
    <>
      <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, background:"rgba(15,10,26,.96)", backdropFilter:"blur(12px)", borderBottom:"1px solid #2d1b52", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px" }}>
        <span style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.15rem", color:"#c084fc", cursor:"pointer" }} onClick={()=>setScreen("feed")}>🪶 Yeni Ozanlar</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Av user={me} size={30} onClick={()=>setScreen("profile")} style={{ cursor:"pointer" }} />
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

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
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

  const submit = async () => {
    if ((!text.trim() && !ytUrl.trim()) || posting) return;
    setPosting(true);
    await addPost({ title: title.trim(), text: text.trim(), youtube: ytUrl.trim() || null });
    setPosting(false);
    onClose();
  };

  return (
    <div
      onClick={e => e.target===e.currentTarget && onClose()}
      style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(0,0,0,.78)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div className="fade" style={{ width:"100%", maxWidth:560, background:"linear-gradient(160deg,#1e0f3a,#160d28)", borderRadius:"22px 22px 0 0", border:"1px solid #5b21b6", borderBottom:"none", padding:"22px 20px 44px" }}>
        {/* başlık satırı */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h3 style={{ fontFamily:"'Playfair Display',serif", color:"#e9d5ff", fontSize:"1.15rem" }}>🪶 Yeni Şiir Ekle</h3>
          <button className="btn" onClick={onClose} style={{ background:"none", color:"#6b5b8a", fontSize:"1.4rem", lineHeight:1, padding:"0 4px" }}>✕</button>
        </div>

        <div style={{ display:"flex", gap:12 }}>
          <Av user={me} size={40} />
          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:10 }}>
            {/* şiir başlığı */}
            <input
              value={title} onChange={e=>setTitle(e.target.value)}
              placeholder="Şiirin başlığı..."
              style={{ width:"100%", background:"#0f0a1a", border:"1px solid #5b21b6", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Playfair Display',serif", fontSize:"1rem" }}
            />
            {/* şiir metni */}
            <textarea
              value={text} onChange={e=>setText(e.target.value)}
              placeholder="Şiirini buraya yaz... Yapay zeka anında değerlendirecek! 🤖"
              rows={5}
              style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", resize:"none", fontFamily:"'Crimson Text',serif", fontSize:"1.05rem", lineHeight:1.8 }}
            />
            {/* youtube */}
            {showYt && (
              <input value={ytUrl} onChange={e=>setYtUrl(e.target.value)} placeholder="YouTube linki yapıştır..."
                style={{ width:"100%", background:"#0f0a1a", border:"1px solid #3d1f6e", borderRadius:10, padding:"10px 14px", color:"#e9d5ff", fontFamily:"'Crimson Text',serif", fontSize:".95rem" }} />
            )}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <button className="btn" onClick={()=>setShowYt(x=>!x)} style={{ background:showYt?"#3d1f6e":"transparent", color:"#a78bfa", padding:"7px 14px", borderRadius:20, border:"1px solid #3d1f6e", fontSize:".83rem", fontFamily:"'Crimson Text',serif" }}>
                ▶ YouTube Ekle
              </button>
              <button className="btn" onClick={submit} disabled={posting} style={{ ...PB, opacity:posting?0.6:1 }}>
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
      {/* teşvik */}
      <div style={{ background:"linear-gradient(135deg,#2d1060,#1a0f3e)", border:"1px solid #5b21b6", borderRadius:14, padding:"12px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:"1.3rem" }}>💡</span>
        <p style={{ fontFamily:"'Crimson Text',serif", color:"#c4b5fd", fontSize:".88rem", fontStyle:"italic", lineHeight:1.5 }}>Şiirleri puanla, yorum yaz — her katkın sıralamayı şekillendirir! ⭐</p>
      </div>

      {/* ŞİİR EKLE BUTONU */}
      <button
        className="btn"
        onClick={() => setShowCompose(true)}
        style={{ width:"100%", marginBottom:20, background:"linear-gradient(135deg,#1e0a3e,#2d1060)", border:"2px dashed #7c3aed", borderRadius:14, padding:"18px", color:"#c084fc", fontFamily:"'Playfair Display',serif", fontSize:"1.05rem", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
        <span style={{ fontSize:"1.5rem" }}>🪶</span> + Şiir Ekle
      </button>

      {posts.map(p => <PostCard key={p.id} post={p} {...props} />)}

      {showCompose && <ComposeModal me={me} addPost={addPost} onClose={()=>setShowCompose(false)} />}
    </Layout>
  );
}

// ─── POST CARD ────────────────────────────────────────────────────────────────
function PostCard({ post, me, ratePost, addComment, byId, goProfile }) {
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
      {/* header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <Av user={author} size={42} onClick={()=>goProfile(author?.id)} style={{ cursor:"pointer" }} />
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

      {/* başlık */}
      {post.title && (
        <h3 style={{ fontFamily:"'Playfair Display',serif", fontSize:"1.1rem", color:"#e9d5ff", fontStyle:"italic", marginBottom:10, paddingBottom:8, borderBottom:"1px solid #2d1b52" }}>
          "{post.title}"
        </h3>
      )}

      {/* metin */}
      {post.text && <p style={{ fontFamily:"'Crimson Text',serif", fontSize:"1.05rem", color:"#ddd6fe", lineHeight:1.9, whiteSpace:"pre-wrap", marginBottom:14 }}>{post.text}</p>}

      {/* youtube */}
      {ytId && (
        <div style={{ borderRadius:12, overflow:"hidden", marginBottom:14, aspectRatio:"16/9" }}>
          <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${ytId}`} frameBorder="0" allowFullScreen style={{ display:"block" }} />
        </div>
      )}

      {/* AI panel */}
      {post.aiScore !== null && (
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

      {/* puanlama */}
      {!isOwn && post.text && (
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

      {/* yorumlar */}
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
      <button className="btn" onClick={()=>setScreen("feed")} style={{ background:"none", color:"#a78bfa", fontFamily:"'Crimson Text',serif", fontSize:".9rem", marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>
        ← Akışa Dön
      </button>
      {post
        ? <PostCard post={post} me={me} setScreen={setScreen} {...rest} />
        : <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>Şiir bulunamadı.</p>}
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
                    {/* TIKLANABİLİR BAŞLIK */}
                    <p onClick={()=>goPost(p.id)} style={{ fontFamily:"'Playfair Display',serif", fontSize:"1rem", color:"#e9d5ff", fontStyle:"italic", cursor:"pointer", marginBottom:5, textDecoration:"underline", textDecorationColor:"#7c3aed", textUnderlineOffset:3 }}>
                      "{displayTitle}"
                    </p>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                      <Av user={author} size={20} onClick={()=>goProfile(author?.id)} style={{ cursor:"pointer" }} />
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
          ? <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic", textAlign:"center", marginTop:40 }}>Henüz sıralama oluşmadı. Şiirleri puanlamaya başla! ⭐</p>
          : ranked.map((u,i) => (
            <div key={u.id} className="card" style={{ display:"flex", alignItems:"center", gap:14, borderLeft:`3px solid ${i<3?["#fbbf24","#9ca3af","#cd7c2e"][i]:scoreColor(u.avg)}` }}>
              <p style={{ fontSize:"1.35rem", minWidth:32 }}>{medals[i]||`#${i+1}`}</p>
              <Av user={u} size={48} onClick={()=>goProfile(u.id)} style={{ cursor:"pointer" }} />
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
      {list.map(u=>(
        <div key={u.id} className="card" style={{ display:"flex", alignItems:"center", gap:14 }}>
          <Av user={u} size={50} onClick={()=>goProfile(u.id)} style={{ cursor:"pointer" }} />
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
      {ups.length===0 && <p style={{ color:"#6b5b8a", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>Henüz gönderi yok.</p>}
      {ups.map(p=><PostCard key={p.id} post={p} me={me} byId={byId} goProfile={goProfile} {...rest} />)}
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
      {!chat ? others.map(u=>{
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
      }) : (
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
