import { useState, useEffect, useCallback } from "react";
import PhoneInput from "./PhoneInput.jsx";
import { loadConfigRemote, createCotizacion, getNextNumero } from "./supabase.js";

// ── PLACEMENT INFO (educativo para el cliente) ──
const PLACEMENTS_INFO = [
  { key: "Frente",     label: "Frente",         maxW: 10,  maxH: 12,  recW: 10, recH: 12, desc: "Área principal. Ideal para logos grandes y diseños completos.", svgX: 38, svgY: 30 },
  { key: "Espalda",    label: "Espalda",         maxW: 10,  maxH: 14,  recW: 10, recH: 12, desc: "Zona amplia para diseños grandes o textos con mensaje.", svgX: 38, svgY: 30 },
  { key: "Pecho Izq",  label: "Pecho Izquierdo", maxW: 3.5, maxH: 3.5, recW: 3,  recH: 3,  desc: "Perfecto para logos pequeños, íconos o iniciales.", svgX: 30, svgY: 37 },
  { key: "Pecho Der",  label: "Pecho Derecho",   maxW: 3.5, maxH: 3.5, recW: 3,  recH: 3,  desc: "Complemento al pecho izquierdo. Ideal para numeración.", svgX: 52, svgY: 37 },
  { key: "Manga Izq",  label: "Manga Izquierda", maxW: 3.5, maxH: 12,  recW: 3,  recH: 10, desc: "Diseño vertical en manga. Muy popular en uniformes.", svgX: 14, svgY: 34 },
  { key: "Manga Der",  label: "Manga Derecha",   maxW: 3.5, maxH: 12,  recW: 3,  recH: 10, desc: "Complemento a manga izquierda.", svgX: 68, svgY: 34 },
  { key: "Cuello",     label: "Cuello / Nuca",   maxW: 3.5, maxH: 2,   recW: 3,  recH: 1.5,desc: "Zona pequeña interna. Bueno para marca o etiqueta.", svgX: 38, svgY: 13 },
  { key: "Bolsillo",   label: "Bolsillo",         maxW: 3,   maxH: 3,   recW: 2.5,recH: 2.5,desc: "Área de bolsillo en camisas. Solo si la prenda tiene bolsillo.", svgX: 30, svgY: 44 },
];

const TALLAS_DEFAULT = ["XS","S","M","L","XL","XXL","XXXL"];
const inToCm = in_ => (in_ * 2.54).toFixed(1);

// ── SHIRT DIAGRAM SVG ──
function ShirtDiagram({ side, selected, onToggle }) {
  const zones = side === "back"
    ? [PLACEMENTS_INFO[1]] // Espalda only
    : PLACEMENTS_INFO.filter(p => p.key !== "Espalda");

  return (
    <svg viewBox="0 0 100 120" style={{ width: "100%", maxWidth: 240, display: "block", margin: "0 auto" }}>
      <path d="M20 18 L8 46 L22 48 L22 112 L78 112 L78 48 L92 46 L80 18 L64 8 Q58 4 50 7 Q42 4 36 8 Z"
        fill="#0D1018" stroke="#252D3F" strokeWidth="1.5" />
      <path d="M20 18 L8 46 L22 48 L22 36 Z" fill="#131720" stroke="#252D3F" strokeWidth="1" />
      <path d="M80 18 L92 46 L78 48 L78 36 Z" fill="#131720" stroke="#252D3F" strokeWidth="1" />
      <path d="M36 8 Q50 15 64 8" fill="none" stroke="#252D3F" strokeWidth="1.5" />
      {zones.map(p => {
        const isOn = selected.includes(p.key);
        const scale = 2.1;
        const w = Math.min(p.maxW * scale, 24);
        const h = Math.min(p.maxH * scale, 30);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onToggle(p.key)}>
            <rect x={p.svgX - w/2} y={p.svgY - h/2} width={w} height={h} rx={2}
              fill={isOn ? "rgba(34,211,238,.3)" : "rgba(34,211,238,.06)"}
              stroke={isOn ? "#22D3EE" : "rgba(34,211,238,.25)"} strokeWidth={isOn ? 1.5 : 1}
              strokeDasharray={isOn ? "none" : "3,2"} />
            <text x={p.svgX} y={p.svgY + 1.5} textAnchor="middle" fontSize={3.2}
              fill={isOn ? "#22D3EE" : "#4A5568"} fontFamily="Sora" fontWeight={isOn ? "700" : "400"}>
              {p.key.replace("Manga ","").replace("Pecho ","")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const STEPS = ["Tus datos", "Prenda y tallas", "Posiciones", "Confirmar"];

export default function ClientApp() {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shirtSide, setShirtSide] = useState("front");
  const [showInfoPos, setShowInfoPos] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [quoteNum, setQuoteNum] = useState("....");

  // Step 0
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");

  // Step 1
  const [prendaId, setPrendaId] = useState("");
  const [color, setColor] = useState("");
  const [tallas, setTallas] = useState({});
  const [notas, setNotas] = useState("");

  // Step 2
  const [selectedPos, setSelectedPos] = useState([]);

  useEffect(() => {
    const init = async () => {
      const remoteCfg = await loadConfigRemote();
      if (remoteCfg) setCfg(remoteCfg);
      const num = await getNextNumero();
      setQuoteNum(num);
      setLoading(false);
    };
    init();
  }, []);

  const prendas = cfg?.prendas ?? [];
  const businessName = cfg?.businessName ?? "ARTAMPA";
  const whatsappBiz = cfg?.whatsappBiz ?? "";
  const validezDias = cfg?.validezDias ?? 15;
  const prenda = prendas.find(p => p.id === prendaId);
  const totalQty = Object.values(tallas).reduce((s, q) => s + (parseInt(q) || 0), 0);
  const tallaResumen = Object.entries(tallas).filter(([,v])=>v>0).map(([t,v])=>`${t}:${v}`).join(", ");

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const lines = [{
        qty: totalQty,
        prendaLabel: prenda?.name ?? "Prenda",
        color,
        cfgLabel: selectedPos.join(" + "),
        tallasSummary: tallaResumen,
        sellPrice: 0,
        lineTotal: 0,
      }];
      await createCotizacion({
        numero: quoteNum,
        cliente: nombre.trim(),
        email: email.trim(),
        telefono: whatsapp.trim(),
        total: 0,
        estado: "Pendiente",
        notas: `Pedido web | ${prenda?.name ?? "?"} ${color} | ${selectedPos.join(", ")}${notas ? " | Nota: " + notas : ""}`,
        lines,
      });

      // Send WhatsApp notification to business
      if (whatsappBiz) {
        const msg = encodeURIComponent(
          `🔔 *Nueva solicitud de cotización DTF*\n\n` +
          `📋 Solicitud #${quoteNum}\n` +
          `👤 *${nombre}*\n` +
          `📱 ${whatsapp || "No indicado"}\n` +
          `👕 ${prenda?.name ?? "?"} — ${color}\n` +
          `🎨 Posiciones: ${selectedPos.join(", ")}\n` +
          `📏 Tallas: ${tallaResumen}\n` +
          `📦 Total prendas: ${totalQty}\n` +
          (notas ? `📝 Nota: ${notas}\n` : "") +
          `\n_Revisa el panel admin para aprobar y cotizar._`
        );
        window.open(`https://wa.me/${whatsappBiz}?text=${msg}`, "_blank");
      }

      setSubmitted(true);
    } catch (e) {
      console.error(e);
      alert("Error al enviar. Intentá de nuevo.");
    }
    setSubmitting(false);
  };

  const canStep1 = nombre.trim().length >= 2;
  const canStep2 = prendaId && totalQty > 0;
  const canStep3 = selectedPos.length > 0;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#080A10", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:14, fontFamily:"Sora" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"/>
      <div style={{ width:36, height:36, border:"3px solid #22D3EE", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 1s linear infinite" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ color:"#4A5568", fontSize:13 }}>Cargando…</div>
    </div>
  );

  // ── SUCCESS SCREEN ──
  if (submitted) return (
    <div style={{ minHeight:"100vh", background:"#080A10", display:"flex", alignItems:"center", justifyContent:"center", padding:20, fontFamily:"'Sora',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet"/>
      <div style={{ maxWidth:400, width:"100%", textAlign:"center" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"rgba(52,211,153,.15)", border:"2px solid rgba(52,211,153,.4)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div style={{ fontWeight:800, fontSize:24, color:"#E2E8F4", marginBottom:8 }}>¡Solicitud enviada!</div>
        <div style={{ color:"#94A3B8", fontSize:14, lineHeight:1.7, marginBottom:20 }}>
          Tu solicitud <b style={{ color:"#22D3EE", fontFamily:"'JetBrains Mono'" }}>#{quoteNum}</b> fue recibida por <b style={{ color:"#E2E8F4" }}>{businessName}</b>. Te contactaremos por WhatsApp con tu cotización personalizada.
        </div>
        <div style={{ background:"#0D1018", border:"1px solid #1E2535", borderRadius:14, padding:16, marginBottom:20, textAlign:"left" }}>
          <div style={{ fontSize:11, color:"#4A5568", textTransform:"uppercase", letterSpacing:".08em", marginBottom:10 }}>Resumen de tu solicitud</div>
          {[
            ["Referencia", `#${quoteNum}`],
            ["Nombre", nombre],
            ["Prenda", `${prenda?.name ?? "?"} — ${color}`],
            ["Posiciones", selectedPos.join(", ")],
            ["Tallas", tallaResumen || "—"],
            ["Total prendas", `${totalQty}`],
            ...(notas ? [["Nota", notas]] : []),
          ].map(([k,v]) => (
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #131720", fontSize:13 }}>
              <span style={{ color:"#64748B" }}>{k}</span>
              <span style={{ color:"#E2E8F4", fontWeight:600, textAlign:"right", maxWidth:"60%", wordBreak:"break-word" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize:12, color:"#4A5568", marginBottom:20 }}>
          Tiempo de respuesta: generalmente el mismo día hábil.
        </div>
        <button onClick={() => { setSubmitted(false); setStep(0); setNombre(""); setWhatsapp(""); setEmail(""); setPrendaId(""); setColor(""); setTallas({}); setSelectedPos([]); setNotas(""); }}
          style={{ background:"#22D3EE", border:"none", borderRadius:12, padding:"13px 28px", fontSize:14, fontWeight:800, color:"#080A10", cursor:"pointer", width:"100%" }}>
          Nueva solicitud
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#080A10", color:"#E2E8F4", fontFamily:"'Sora',sans-serif" }} role="document">
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@700;800&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{--accent:#22D3EE;--bg:#080A10;--bg2:#0D1018;--bg3:#131720;--border:#1E2535;--border2:#252D3F;--text:#E2E8F4;--text2:#94A3B8;--text3:#4A5568;--green:#34D399;--warn:#FBBF24}
        .cinp{width:100%;background:#0D1018;border:1.5px solid #1E2535;border-radius:10px;padding:12px 14px;font-size:15px;color:#E2E8F4;font-family:'Sora';outline:none;transition:border .15s}
        .cinp:focus{border-color:#22D3EE}
        .cinp::placeholder{color:#4A5568}
        .cbtn{background:#22D3EE;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:800;color:#080A10;cursor:pointer;font-family:'Sora';width:100%;transition:opacity .15s}
        .cbtn:disabled{opacity:.4;cursor:not-allowed}
        .cbtn-out{background:transparent;border:1.5px solid #252D3F;border-radius:12px;padding:13px 20px;font-size:14px;font-weight:700;color:#94A3B8;cursor:pointer;font-family:'Sora';white-space:nowrap}
        .card{background:#0D1018;border:1px solid #1E2535;border-radius:16px;padding:20px;margin-bottom:14px}
        .chip{display:inline-flex;align-items:center;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid;transition:all .15s;user-select:none}
        .chip.on{background:rgba(34,211,238,.15);border-color:#22D3EE;color:#22D3EE}
        .chip.off{background:transparent;border-color:#252D3F;color:#64748B}
        .lbl{font-size:11px;font-weight:700;color:#94A3B8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp .3s ease forwards}
        @media(max-width:480px){.card{padding:14px}}
      `}</style>

      {/* HEADER */}
      <header style={{ background:"rgba(13,16,24,.92)", backdropFilter:"blur(20px)", borderBottom:"1px solid #1E2535", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:560, margin:"0 auto", padding:"0 16px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <h1 style={{ fontWeight:800, fontSize:17, letterSpacing:"-.3px", color:"#22D3EE", margin:0 }}>{businessName}</h1>
            <p style={{ fontSize:9, color:"#4A5568", letterSpacing:".1em", textTransform:"uppercase", fontFamily:"'JetBrains Mono'", margin:0 }}>{cfg?.seoSlogan || "DTF · Solicitar cotización"}</p>
          </div>

        </div>
      </header>

      {/* STEP INDICATOR */}
      <div style={{ maxWidth:560, margin:"0 auto", padding:"18px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:20 }}>
          {STEPS.map((s,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:6, flex: i<STEPS.length-1 ? 1 : "none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, transition:"all .3s",
                  background: i<step ? "#22D3EE" : i===step ? "rgba(34,211,238,.15)" : "#131720",
                  border: `2px solid ${i<=step ? "#22D3EE" : "#252D3F"}`,
                  color: i<step ? "#080A10" : i===step ? "#22D3EE" : "#4A5568" }}>
                  {i<step ? "✓" : i+1}
                </div>
                <span style={{ fontSize:11, fontWeight:i===step?700:400, color:i===step?"#E2E8F4":"#4A5568", whiteSpace:"nowrap", display: window.innerWidth < 380 ? (i===step ? "block" : "none") : "block" }}>{s}</span>
              </div>
              {i<STEPS.length-1 && <div style={{ flex:1, height:2, background:i<step?"#22D3EE":"#1E2535", borderRadius:2, minWidth:8 }}/>}
            </div>
          ))}
        </div>
      </div>

      <div id="main-content" style={{ maxWidth:560, margin:"0 auto", padding:"0 16px 100px" }}>

        {/* ══ STEP 0: DATOS ══ */}
        {step===0 && (
          <div className="fade-up">
            <div className="card">
              <div style={{ marginBottom:20 }}>
                <h2 style={{ fontSize:22, fontWeight:800, marginBottom:6, margin:"0 0 6px" }}>¡Hola! 👋</h2>
                <div style={{ fontSize:14, color:"#94A3B8", lineHeight:1.6 }}>
                  Completá este formulario y te enviaremos una cotización personalizada por WhatsApp. <b style={{ color:"#E2E8F4" }}>Sin costo, sin compromiso.</b>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                <div>
                  <div className="lbl">Tu nombre completo *</div>
                  <input className="cinp" placeholder="Ej: María García" aria-label="Tu nombre completo" value={nombre} onChange={e=>setNombre(e.target.value)} autoFocus/>
                </div>
                <div>
                  <div className="lbl">WhatsApp *</div>
                  <PhoneInput value={whatsapp} onChange={setWhatsapp} placeholder="tu número" style={{ height:46 }} />
                  <div style={{ fontSize:11, color:"#4A5568", marginTop:5 }}>Usaremos este número para enviarte la cotización</div>
                </div>
                <div>
                  <div className="lbl">Correo electrónico (opcional)</div>
                  <input className="cinp" placeholder="tu@correo.com" value={email} aria-label="Correo electrónico" onChange={e=>setEmail(e.target.value)} type="email"/>
                </div>
              </div>
            </div>

            {/* DTF info cards */}
            <div style={{ background:"rgba(34,211,238,.05)", border:"1px solid rgba(34,211,238,.12)", borderRadius:16, padding:16, marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#22D3EE", marginBottom:10 }}>✨ ¿Qué es el estampado DTF?</div>
              <div style={{ fontSize:13, color:"#94A3B8", lineHeight:1.7, marginBottom:12 }}>
                <b style={{ color:"#E2E8F4" }}>Direct-to-Film</b> es la tecnología de personalización más versátil del mercado. Tu diseño se imprime en película especial y se transfiere con calor — funciona en <b style={{ color:"#E2E8F4" }}>cualquier tela</b>.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[["💧 +50 lavados","Resistente y duradero"],["🎨 Colores ilimitados","Sin restricciones de diseño"],["⚡ Entrega rápida","24–48 horas hábiles"],["👕 Cualquier prenda","Camisas, hoodies, gorras…"]].map(([t,d])=>(
                  <div key={t} style={{ background:"#080A10", borderRadius:10, padding:"10px 12px" }}>
                    <div style={{ fontSize:12, fontWeight:700 }}>{t}</div>
                    <div style={{ fontSize:11, color:"#4A5568", marginTop:2 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>

            <button className="cbtn" disabled={!canStep1 || !whatsapp} onClick={()=>setStep(1)}>
              Continuar →
            </button>
            {(!nombre.trim() || !whatsapp) && (
              <div style={{ fontSize:11, color:"#4A5568", textAlign:"center", marginTop:8 }}>Nombre y WhatsApp son requeridos</div>
            )}
          </div>
        )}

        {/* ══ STEP 1: PRENDA Y TALLAS ══ */}
        {step===1 && (
          <div className="fade-up">
            {/* Prenda */}
            <div className="card">
              <div className="lbl">Tipo de prenda *</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {prendas.map(p=>(
                  <button key={p.id} className={`chip ${prendaId===p.id?"on":"off"}`}
                    onClick={()=>{ setPrendaId(p.id); setColor(""); setTallas({}); }}>
                    {p.name}
                  </button>
                ))}
                {prendas.length===0 && <div style={{ color:"#4A5568", fontSize:13 }}>Cargando prendas…</div>}
              </div>
            </div>

            {/* Color */}
            {prenda && (
              <div className="card fade-up">
                <div className="lbl">Color de prenda *</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
                  {(prenda.colores ?? []).map(c=>(
                    <button key={c} className={`chip ${color===c?"on":"off"}`} onClick={()=>setColor(c)}>{c}</button>
                  ))}
                </div>
                <input className="cinp" placeholder="O escribe otro color…" value={color} onChange={e=>setColor(e.target.value)} style={{ marginTop:4 }}/>
              </div>
            )}

            {/* Tallas */}
            {prenda && color && (
              <div className="card fade-up">
                <div className="lbl">Tallas y cantidades *</div>
                <div style={{ fontSize:12, color:"#4A5568", marginBottom:12 }}>Ingresá cuántas prendas necesitás por talla</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))", gap:8 }}>
                  {(prenda.tallas ?? TALLAS_DEFAULT).map(t=>(
                    <div key={t} style={{ background:"#080A10", border:`1.5px solid ${(tallas[t]??0)>0?"#22D3EE":"#1E2535"}`, borderRadius:10, padding:"10px 8px", textAlign:"center" }}>
                      <div style={{ fontSize:13, fontWeight:800, color:(tallas[t]??0)>0?"#22D3EE":"#64748B", marginBottom:6, fontFamily:"'JetBrains Mono'" }}>{t}</div>
                      <input type="number" min={0} max={999} value={tallas[t]??""} placeholder="0"
                        onChange={e=>setTallas(prev=>({...prev,[t]:parseInt(e.target.value)||0}))} aria-label={`Cantidad talla ${t}`}
                        style={{ width:"100%", textAlign:"center", background:"transparent", border:"none", outline:"none", fontSize:18, fontWeight:800, fontFamily:"'JetBrains Mono'", color:"#E2E8F4" }}/>
                    </div>
                  ))}
                </div>
                {totalQty>0 && (
                  <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(34,211,238,.08)", border:"1px solid rgba(34,211,238,.2)", borderRadius:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:13, color:"#94A3B8" }}>Total prendas</span>
                    <span style={{ fontFamily:"'JetBrains Mono'", fontWeight:800, fontSize:22, color:"#22D3EE" }}>{totalQty}</span>
                  </div>
                )}
              </div>
            )}

            {/* Notas */}
            {totalQty > 0 && (
              <div className="card fade-up">
                <div className="lbl">Notas adicionales (opcional)</div>
                <textarea className="cinp" placeholder="Ej: El diseño tiene 2 colores, necesito entrega urgente, tengo el arte listo…"
                  value={notas} onChange={e=>setNotas(e.target.value)} rows={3}
                  style={{ resize:"vertical", minHeight:80 }}/>
              </div>
            )}

            <div style={{ display:"flex", gap:10 }}>
              <button className="cbtn-out" onClick={()=>setStep(0)}>← Atrás</button>
              <button className="cbtn" disabled={!canStep2} onClick={()=>setStep(2)}>Elegir posiciones →</button>
            </div>
          </div>
        )}

        {/* ══ STEP 2: POSICIONES ══ */}
        {step===2 && (
          <div className="fade-up">
            <div className="card">
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>¿Dónde va el estampado?</div>
              <div style={{ fontSize:13, color:"#64748B", marginBottom:16 }}>Tocá las zonas en el diagrama o seleccioná de la lista. Podés elegir varias posiciones.</div>

              <div style={{ display:"flex", justifyContent:"center", gap:10, marginBottom:12 }}>
                {["front","back"].map(side=>(
                  <button key={side} onClick={()=>setShirtSide(side)}
                    style={{ padding:"7px 18px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer", border:"none", background:shirtSide===side?"#22D3EE":"#131720", color:shirtSide===side?"#080A10":"#64748B" }}>
                    {side==="front"?"👕 Frente":"👕 Espalda"}
                  </button>
                ))}
              </div>
              <ShirtDiagram side={shirtSide} selected={selectedPos}
                onToggle={key=>setSelectedPos(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key])}/>
              <div style={{ fontSize:11, color:"#4A5568", textAlign:"center", marginTop:6 }}>Tocá las zonas punteadas para seleccionarlas</div>
            </div>

            {/* Position list */}
            <div className="card">
              <div className="lbl">Posiciones y medidas</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {PLACEMENTS_INFO.map(p=>{
                  const isOn = selectedPos.includes(p.key);
                  const showInfo = showInfoPos===p.key;
                  return (
                    <div key={p.key}>
                      <div onClick={()=>setSelectedPos(prev=>prev.includes(p.key)?prev.filter(k=>k!==p.key):[...prev,p.key])}
                        style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:isOn?"rgba(34,211,238,.07)":"#080A10", border:`1.5px solid ${isOn?"#22D3EE":"#1E2535"}`, borderRadius:12, cursor:"pointer", transition:"all .15s" }}>
                        <div style={{ width:22, height:22, borderRadius:6, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center",
                          background:isOn?"#22D3EE":"#131720", border:`2px solid ${isOn?"#22D3EE":"#252D3F"}` }}>
                          {isOn && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.8 3L10 3" stroke="#080A10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, color:isOn?"#22D3EE":"#E2E8F4" }}>{p.label}</div>
                          <div style={{ fontSize:11, color:"#64748B", marginTop:2, fontFamily:"'JetBrains Mono'" }}>
                            Máx: {p.maxW}"×{p.maxH}" · {inToCm(p.maxW)}×{inToCm(p.maxH)} cm
                          </div>
                        </div>
                        <button onClick={e=>{e.stopPropagation();setShowInfoPos(showInfo?null:p.key)}}
                          style={{ background:"none", border:"none", cursor:"pointer", color:"#4A5568", fontSize:18, padding:4, lineHeight:1 }}>ⓘ</button>
                      </div>
                      {showInfo && (
                        <div style={{ background:"rgba(34,211,238,.05)", border:"1px solid rgba(34,211,238,.12)", borderRadius:"0 0 12px 12px", padding:"10px 14px", fontSize:12, color:"#94A3B8", marginTop:-4 }}>
                          {p.desc}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Arte info */}
            <div style={{ background:"rgba(251,191,36,.05)", border:"1px solid rgba(251,191,36,.18)", borderRadius:16, padding:16, marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#FBBF24", marginBottom:8 }}>📁 ¿Qué archivo necesitamos?</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {[["✅ PNG sin fondo (transparente)","Resolución mínima 300 DPI"],["✅ Vector (AI, PDF, SVG)","Ideal para logos — escala sin perder calidad"],["⚠️ JPG de alta resolución","+1500px, puede funcionar"],["❌ Word, PowerPoint, Facebook","No apto — requiere rediseño adicional"]].map(([t,d])=>(
                  <div key={t} style={{ background:"#080A10", borderRadius:8, padding:"8px 12px" }}>
                    <div style={{ fontSize:12, fontWeight:700 }}>{t}</div>
                    <div style={{ fontSize:11, color:"#4A5568", marginTop:1 }}>{d}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11, color:"#4A5568", marginTop:10 }}>Si no tenés el arte listo, podemos diseñarlo por un costo adicional — indicalo en las notas.</div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button className="cbtn-out" onClick={()=>setStep(1)}>← Atrás</button>
              <button className="cbtn" disabled={!canStep3} onClick={()=>setStep(3)}>Revisar solicitud →</button>
            </div>
          </div>
        )}

        {/* ══ STEP 3: CONFIRMACIÓN ══ */}
        {step===3 && (
          <div className="fade-up">
            <div className="card">
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>Revisá tu solicitud</div>
              <div style={{ fontSize:13, color:"#64748B", marginBottom:16 }}>Confirmá los datos antes de enviar. Te contactaremos con la cotización exacta.</div>

              <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                {[
                  ["Nombre",    nombre],
                  ["WhatsApp",  whatsapp || "—"],
                  ["Correo",    email    || "—"],
                  ["Prenda",    `${prenda?.name ?? "?"} — ${color}`],
                  ["Tallas",    tallaResumen || "—"],
                  ["Total prendas", `${totalQty}`],
                  ["Posiciones", selectedPos.join(", ")],
                  ...(notas ? [["Notas", notas]] : []),
                ].map(([k,v])=>(
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid #131720", gap:12 }}>
                    <span style={{ fontSize:13, color:"#64748B", flexShrink:0 }}>{k}</span>
                    <span style={{ fontSize:13, fontWeight:600, textAlign:"right", wordBreak:"break-word", maxWidth:"65%" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* No price shown */}
            <div style={{ background:"rgba(34,211,238,.06)", border:"1px solid rgba(34,211,238,.15)", borderRadius:14, padding:16, marginBottom:14, textAlign:"center" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#22D3EE", marginBottom:6 }}>💬 ¿Cuánto cuesta?</div>
              <div style={{ fontSize:13, color:"#94A3B8", lineHeight:1.6 }}>
                Revisaremos tu solicitud y te enviaremos la cotización exacta por WhatsApp. El precio depende del diseño, cantidad y posiciones.
              </div>
              <div style={{ fontSize:12, color:"#4A5568", marginTop:8 }}>⏱ Tiempo de respuesta: el mismo día hábil</div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <button className="cbtn-out" onClick={()=>setStep(2)}>← Atrás</button>
              <button className="cbtn" disabled={submitting} onClick={handleSubmit}
                style={{ flex:1 }}>
                {submitting ? "Enviando…" : "✓ Enviar solicitud"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
