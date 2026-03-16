import { useState, useEffect, useRef, useCallback } from "react";
import { loadConfigRemote, createCotizacion, getNextNumero } from "./supabase.js";

// ── CONSTANTES ──
const PLACEMENTS_INFO = [
  { key: "Frente",     label: "Frente",        maxW: 10, maxH: 12, recW: 10, recH: 12, desc: "Área principal. Ideal para logos grandes y diseños completos.", svgX: 38, svgY: 28 },
  { key: "Espalda",    label: "Espalda",        maxW: 10, maxH: 14, recW: 10, recH: 12, desc: "Zona amplia para diseños grandes o textos con mensaje.", svgX: 38, svgY: 28 },
  { key: "Pecho Izq",  label: "Pecho Izquierdo",maxW: 3.5,maxH: 3.5,recW: 3, recH: 3,  desc: "Perfecto para logos pequeños, íconos o iniciales.", svgX: 30, svgY: 35 },
  { key: "Pecho Der",  label: "Pecho Derecho",  maxW: 3.5,maxH: 3.5,recW: 3, recH: 3,  desc: "Complemento al pecho izquierdo. Ideal para numeración.", svgX: 52, svgY: 35 },
  { key: "Manga Izq",  label: "Manga Izquierda",maxW: 3.5,maxH: 12, recW: 3, recH: 10, desc: "Diseño vertical en manga. Muy popular en uniformes.", svgX: 14, svgY: 32 },
  { key: "Manga Der",  label: "Manga Derecha",  maxW: 3.5,maxH: 12, recW: 3, recH: 10, desc: "Complemento a manga izquierda.", svgX: 68, svgY: 32 },
  { key: "Cuello",     label: "Cuello / Nuca",  maxW: 3.5,maxH: 2,  recW: 3, recH: 1.5,desc: "Zona pequeña interna. Bueno para marca o etiqueta.", svgX: 38, svgY: 12 },
  { key: "Bolsillo",   label: "Bolsillo",        maxW: 3,  maxH: 3,  recW: 2.5,recH:2.5,desc: "Área de bolsillo en camisas. Solo si la prenda tiene bolsillo.", svgX: 32, svgY: 42 },
];

const TALLAS_DEFAULT = ["XS","S","M","L","XL","XXL","XXXL"];

// Shirt SVG front/back diagrams
function ShirtDiagram({ side = "front", selected = [], onToggle }) {
  const zones = side === "front"
    ? PLACEMENTS_INFO.filter(p => !["Espalda"].includes(p.key))
    : [PLACEMENTS_INFO.find(p => p.key === "Espalda")];

  return (
    <svg viewBox="0 0 100 120" style={{ width: "100%", maxWidth: 220, display: "block", margin: "0 auto" }}>
      {/* Shirt body */}
      <path d="M20 20 L10 45 L20 47 L20 110 L80 110 L80 47 L90 45 L80 20 L65 10 Q60 5 50 8 Q40 5 35 10 Z"
        fill="var(--bg2)" stroke="var(--border2)" strokeWidth="1.5" />
      {/* Sleeves */}
      <path d="M20 20 L10 45 L20 47 L20 38 Z" fill="var(--bg3)" stroke="var(--border2)" strokeWidth="1" />
      <path d="M80 20 L90 45 L80 47 L80 38 Z" fill="var(--bg3)" stroke="var(--border2)" strokeWidth="1" />
      {/* Collar */}
      <path d="M35 10 Q50 16 65 10" fill="none" stroke="var(--border2)" strokeWidth="1.5" />

      {/* Clickable zones */}
      {PLACEMENTS_INFO.filter(p => side === "back" ? p.key === "Espalda" : p.key !== "Espalda").map(p => {
        const isSelected = selected.includes(p.key);
        const scale = 2.2;
        const w = Math.min(p.maxW * scale, 22);
        const h = Math.min(p.maxH * scale, 28);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onToggle(p.key)}>
            <rect
              x={p.svgX - w/2} y={p.svgY - h/2} width={w} height={h}
              rx={2} fill={isSelected ? "rgba(34,211,238,.35)" : "rgba(34,211,238,.08)"}
              stroke={isSelected ? "#22D3EE" : "rgba(34,211,238,.3)"} strokeWidth={isSelected ? 1.5 : 1}
              strokeDasharray={isSelected ? "none" : "2,2"}
            />
            <text x={p.svgX} y={p.svgY + 1} textAnchor="middle" fontSize={3.5}
              fill={isSelected ? "#22D3EE" : "#64748B"} fontFamily="Sora" fontWeight={isSelected ? "700" : "400"}>
              {p.key.replace(" Izq","L").replace(" Der","R")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function inToCm(inches) { return (inches * 2.54).toFixed(1); }

const STEPS = ["Tus datos", "Tu pedido", "Posiciones", "Resumen"];

export default function ClientApp() {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bchRate, setBchRate] = useState(25.5);
  const [showUSD, setShowUSD] = useState(false);
  const [shirtSide, setShirtSide] = useState("front");

  // Step 0 — client info
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  // Step 1 — order
  const [prendaId, setPrendaId] = useState("");
  const [color, setColor] = useState("");
  const [tallas, setTallas] = useState({}); // { talla: qty }

  // Step 2 — positions
  const [selectedPos, setSelectedPos] = useState([]);
  const [showInfoPos, setShowInfoPos] = useState(null);

  // Step 3 — quote result
  const [quote, setQuote] = useState(null);
  const [quoteNum, setQuoteNum] = useState("....");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load config from Supabase
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const remoteCfg = await loadConfigRemote();
      if (remoteCfg) setCfg(remoteCfg);
      // BCH rate
      try {
        const r = await fetch("https://open.er-api.com/v6/latest/USD");
        const d = await r.json();
        if (d?.rates?.HNL) setBchRate(parseFloat(d.rates.HNL.toFixed(2)));
      } catch {}
      const num = await getNextNumero();
      setQuoteNum(num);
      setLoading(false);
    };
    init();
  }, []);

  const prendas = cfg?.prendas ?? [];
  const placements = cfg?.placements ?? [];
  const sheets = cfg?.sheets ?? [];
  const volTiers = cfg?.volTiers ?? [];
  const businessName = cfg?.businessName ?? "ARTAMPA";
  const whatsappNum = cfg?.whatsappBiz || "50499999999";

  const prenda = prendas.find(p => p.id === prendaId);
  const totalQty = Object.values(tallas).reduce((s, q) => s + (parseInt(q) || 0), 0);

  // Calculate quote
  const calcQuote = useCallback(() => {
    if (!prenda || !selectedPos.length || totalQty < 1) return null;

    const prendaCost = prenda.cost;
    const poliRate = (cfg?.poliBolsa ?? 900) / (cfg?.poliGramos ?? 907);
    const energyCost = ((cfg?.prensaWatts ?? 1000) / 1000) * ((cfg?.prensaSeg ?? 15) / 3600) * (cfg?.tarifaKwh ?? 4.62);
    const margin = cfg?.margin ?? 80;

    // DTF cost (simplified: use placement areas)
    let poliTotal = 0;
    const pieces = [];
    let pidx = 0;
    for (let u = 0; u < totalQty; u++) {
      selectedPos.forEach(posKey => {
        const pl = placements.find(p => p.label === posKey) || PLACEMENTS_INFO.find(p => p.key === posKey);
        if (pl) {
          const w = pl.w ?? pl.maxW;
          const h = pl.h ?? pl.maxH;
          poliTotal += w * h * 0.0774;
          pieces.push({ w, h, _idx: pidx++, label: posKey, color: pl.color || "#22D3EE" });
        }
      });
    }

    // Simple DTF cost: cheapest sheet that fits all pieces proportionally
    const sortedSheets = [...sheets].sort((a, b) => a.price - b.price);
    let dtfCost = 0;
    if (sortedSheets.length) {
      // Estimate: total area / sheet area * sheet price
      const totalArea = pieces.reduce((s, p) => s + p.w * p.h, 0);
      const bestSheet = sortedSheets.find(sh => sh.w * sh.h >= (totalArea / Math.max(totalQty * selectedPos.length, 1)) * 1.2) || sortedSheets[sortedSheets.length - 1];
      const sheetsNeeded = Math.ceil(totalArea / (bestSheet.w * bestSheet.h * 0.75));
      dtfCost = sheetsNeeded * bestSheet.price;
    }

    const dtfPU = totalQty > 0 ? dtfCost / totalQty : 0;
    const poliCost = poliTotal * poliRate;
    const poliCostPU = poliCost / totalQty;

    // Volume tier
    const tier = [...volTiers].sort((a, b) => b.minQty - a.minQty).find(t => totalQty >= t.minQty) || volTiers[0];

    const uc = prendaCost + poliCostPU + dtfPU + energyCost;
    const sp = Math.ceil((uc * (1 + margin / 100)) / 10) * 10;
    const sub = sp * totalQty;
    const disc = tier ? Math.round(sub * (tier.discPct || 0) / 100) : 0;
    const total = sub - disc;

    return { sp, sub, disc, total, totalQty, tier, dtfCost, poliCost, energyCost, margin };
  }, [prenda, selectedPos, totalQty, cfg, sheets, placements, volTiers]);

  const handleGenerateQuote = () => {
    const q = calcQuote();
    setQuote(q);
    setStep(3);
    // Save to Supabase
    if (q) {
      const lines = [{
        qty: totalQty,
        prendaLabel: prenda?.name ?? "Prenda",
        color,
        cfgLabel: selectedPos.join(" + "),
        tallasSummary: Object.entries(tallas).filter(([,v]) => v > 0).map(([t,v]) => `${t}:${v}`).join(" "),
        sellPrice: q.sp,
        lineTotal: q.total,
      }];
      createCotizacion({
        numero: quoteNum,
        cliente: nombre || "Cliente web",
        email: "",
        telefono: whatsapp,
        total: q.total,
        estado: "Cotizado",
        notas: `Pedido web · ${selectedPos.join(", ")}`,
        lines,
      }).then(() => setSaved(true)).catch(() => {});
    }
  };

  const handlePDF = async () => {
    if (!quote) return;
    setPdfLoading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { jsPDF } = await import("jspdf");
      const el = document.getElementById("client-quote-print");
      if (!el) return;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const imgW = 210;
      const imgH = (canvas.height * imgW) / canvas.width;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgW, Math.min(imgH, 297));
      pdf.save(`Cotizacion-${quoteNum}-${businessName}.pdf`);
    } catch (e) { console.error(e); }
    setPdfLoading(false);
  };

  const handleWhatsApp = () => {
    if (!quote) return;
    const tallaStr = Object.entries(tallas).filter(([,v]) => v > 0).map(([t,v]) => `${t}:${v}`).join(", ");
    const msg = encodeURIComponent(
      `Hola ${businessName}! 👋\n\n` +
      `📋 *Cotización #${quoteNum}*\n` +
      `👤 ${nombre || "Cliente"}\n` +
      `👕 ${prenda?.name ?? "Prenda"} — ${color}\n` +
      `🎨 Posiciones: ${selectedPos.join(", ")}\n` +
      `📏 Tallas: ${tallaStr}\n` +
      `📦 Cantidad total: ${totalQty} prendas\n` +
      `💰 Total: L${quote.total.toLocaleString()}\n\n` +
      `Me interesa confirmar este pedido.`
    );
    window.open(`https://wa.me/${whatsappNum}?text=${msg}`, "_blank");
  };

  const canStep1 = nombre.trim().length >= 2;
  const canStep2 = prendaId && totalQty > 0;
  const canStep3 = selectedPos.length > 0;

  // ── LOADING ──
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080A10", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "3px solid #22D3EE", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ color: "#4A5568", fontFamily: "Sora", fontSize: 13 }}>Cargando cotizador…</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080A10", color: "#E2E8F4", fontFamily: "'Sora',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --accent: #22D3EE; --bg: #080A10; --bg2: #0D1018; --bg3: #131720; --border: #1E2535; --border2: #252D3F; --text: #E2E8F4; --text2: #94A3B8; --text3: #4A5568; --green: #34D399; --red: #F87171; --warn: #FBBF24; }
        .cinp { width:100%; background: #0D1018; border: 1.5px solid #1E2535; border-radius: 10px; padding: 12px 14px; font-size: 15px; color: #E2E8F4; font-family: 'Sora'; outline: none; transition: border .15s; }
        .cinp:focus { border-color: #22D3EE; }
        .cbtn { background: #22D3EE; border: none; border-radius: 12px; padding: 14px 28px; font-size: 15px; font-weight: 800; color: #080A10; cursor: pointer; font-family: 'Sora'; width: 100%; transition: opacity .15s; }
        .cbtn:disabled { opacity: .4; cursor: not-allowed; }
        .cbtn-out { background: transparent; border: 1.5px solid #1E2535; border-radius: 12px; padding: 13px 28px; font-size: 15px; font-weight: 700; color: #94A3B8; cursor: pointer; font-family: 'Sora'; width: 100%; }
        .card { background: #0D1018; border: 1px solid #1E2535; border-radius: 16px; padding: 20px; margin-bottom: 14px; }
        .chip { display:inline-flex; align-items:center; gap:6px; padding: 8px 14px; border-radius: 20px; font-size: 13px; font-weight: 700; cursor: pointer; border: 1.5px solid; transition: all .15s; }
        .chip.on { background: rgba(34,211,238,.15); border-color: #22D3EE; color: #22D3EE; }
        .chip.off { background: transparent; border-color: #252D3F; color: #64748B; }
        .step-dot { width:10px; height:10px; border-radius:50%; transition: all .3s; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fadeUp .3s ease forwards; }
        @media (max-width:480px) { .card { padding: 14px; } }
      `}</style>

      {/* HEADER */}
      <header style={{ background: "rgba(13,16,24,.9)", backdropFilter: "blur(20px)", borderBottom: "1px solid #1E2535", position: "sticky", top: 0, zIndex: 50, padding: "0 16px" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.3px", color: "#22D3EE" }}>{businessName}</div>
            <div style={{ fontSize: 9, color: "#4A5568", letterSpacing: ".1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono'" }}>DTF · Cotizador online</div>
          </div>
          <a href="/admin" style={{ fontSize: 11, color: "#252D3F", textDecoration: "none" }}>Admin</a>
        </div>
      </header>

      {/* STEP INDICATOR */}
      {step < 3 && (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            {STEPS.slice(0,3).map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flex: i < 2 ? 1 : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: i < step ? "#22D3EE" : i === step ? "rgba(34,211,238,.2)" : "#131720", border: `2px solid ${i <= step ? "#22D3EE" : "#252D3F"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: i < step ? "#080A10" : i === step ? "#22D3EE" : "#4A5568", transition: "all .3s" }}>
                    {i < step ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 400, color: i === step ? "#E2E8F4" : "#4A5568", whiteSpace: "nowrap" }}>{s}</span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 1.5, background: i < step ? "#22D3EE" : "#1E2535", borderRadius: 2 }} />}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px 80px" }}>

        {/* ══ STEP 0: DATOS DEL CLIENTE ══ */}
        {step === 0 && (
          <div className="fade-up">
            <div className="card">
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>¡Hola! 👋</div>
                <div style={{ fontSize: 14, color: "#94A3B8" }}>Armá tu cotización de estampado DTF en minutos. Sin necesidad de crear cuenta.</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>Tu nombre *</div>
                  <input className="cinp" placeholder="Ej: María García" value={nombre} onChange={e => setNombre(e.target.value)} autoFocus />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".06em" }}>WhatsApp (con código de país)</div>
                  <input className="cinp" placeholder="Ej: 50498765432" value={whatsapp} onChange={e => setWhatsapp(e.target.value.replace(/\D/g, ""))} type="tel" />
                  <div style={{ fontSize: 11, color: "#4A5568", marginTop: 4 }}>Honduras: 504 + tu número</div>
                </div>
              </div>
            </div>

            {/* Info educativa */}
            <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#22D3EE", marginBottom: 10 }}>🎨 ¿Qué es DTF?</div>
              <div style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.7 }}>
                <b style={{ color: "#E2E8F4" }}>Direct-to-Film</b> es la tecnología de estampado más versátil del mercado. Imprimimos tu diseño en una película especial y lo transferimos con calor a tu prenda. Funciona en <b style={{ color: "#E2E8F4" }}>cualquier tela</b> — algodón, polyester, hoodies, gorras y más.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                {[["💧 Resistente al lavado", "+50 lavados garantizados"],["🎨 Colores vivos", "Sin límite de colores"],["⚡ Entrega rápida","Pedidos en 24-48h"],["📐 Cualquier tamaño","Diseños chicos o grandes"]].map(([t,d]) => (
                  <div key={t} style={{ background: "#080A10", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F4" }}>{t}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>

            <button className="cbtn" disabled={!canStep1} onClick={() => setStep(1)}>Continuar →</button>
          </div>
        )}

        {/* ══ STEP 1: PEDIDO ══ */}
        {step === 1 && (
          <div className="fade-up">
            {/* Prenda */}
            <div className="card">
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.25)", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#22D3EE" }}>1</span>
                Tipo de prenda
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {prendas.map(p => (
                  <button key={p.id} onClick={() => { setPrendaId(p.id); setColor(""); setTallas({}); }}
                    className={`chip ${prendaId === p.id ? "on" : "off"}`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Color */}
            {prenda && (
              <div className="card fade-up">
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.25)", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#22D3EE" }}>2</span>
                  Color de prenda
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {(prenda.colores ?? []).map(c => (
                    <button key={c} onClick={() => setColor(c)} className={`chip ${color === c ? "on" : "off"}`}>{c}</button>
                  ))}
                </div>
                <input className="cinp" placeholder="O escribe otro color…" value={color} onChange={e => setColor(e.target.value)} style={{ marginTop: 4 }} />
              </div>
            )}

            {/* Tallas */}
            {prenda && color && (
              <div className="card fade-up">
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.25)", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#22D3EE" }}>3</span>
                  Tallas y cantidades
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>Ingresá cuántas prendas querés por talla (dejá en 0 las que no necesités)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                  {(prenda.tallas ?? TALLAS_DEFAULT).map(t => (
                    <div key={t} style={{ background: "#080A10", border: `1.5px solid ${(tallas[t] ?? 0) > 0 ? "#22D3EE" : "#1E2535"}`, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: (tallas[t] ?? 0) > 0 ? "#22D3EE" : "#94A3B8", marginBottom: 6, fontFamily: "'JetBrains Mono'" }}>{t}</div>
                      <input type="number" min={0} max={999} value={tallas[t] ?? ""} placeholder="0"
                        onChange={e => setTallas(prev => ({ ...prev, [t]: parseInt(e.target.value) || 0 }))}
                        style={{ width: "100%", textAlign: "center", background: "transparent", border: "none", outline: "none", fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono'", color: "#E2E8F4" }} />
                    </div>
                  ))}
                </div>
                {totalQty > 0 && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(34,211,238,.08)", border: "1px solid rgba(34,211,238,.2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#94A3B8" }}>Total de prendas</span>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 20, color: "#22D3EE" }}>{totalQty}</span>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button className="cbtn-out" onClick={() => setStep(0)} style={{ flex: "0 0 auto", width: "auto", padding: "13px 20px" }}>← Atrás</button>
              <button className="cbtn" disabled={!canStep2} onClick={() => setStep(2)}>Elegir posiciones →</button>
            </div>
          </div>
        )}

        {/* ══ STEP 2: POSICIONES ══ */}
        {step === 2 && (
          <div className="fade-up">
            <div className="card">
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>¿Dónde va el estampado?</div>
              <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Tocá la zona en el diagrama o seleccioná de la lista. Podés elegir varias posiciones.</div>

              {/* Shirt diagram */}
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 12 }}>
                {["front","back"].map(side => (
                  <button key={side} onClick={() => setShirtSide(side)}
                    style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", background: shirtSide === side ? "#22D3EE" : "#131720", color: shirtSide === side ? "#080A10" : "#64748B" }}>
                    {side === "front" ? "👕 Frente" : "👕 Espalda"}
                  </button>
                ))}
              </div>
              <ShirtDiagram side={shirtSide} selected={selectedPos}
                onToggle={key => setSelectedPos(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])} />
              <div style={{ fontSize: 11, color: "#4A5568", textAlign: "center", marginTop: 6 }}>Tocá las zonas punteadas para seleccionarlas</div>
            </div>

            {/* Position list with sizes */}
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 700, color: "#94A3B8", marginBottom: 12, textTransform: "uppercase", letterSpacing: ".06em" }}>Posiciones disponibles</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {PLACEMENTS_INFO.map(p => {
                  const isOn = selectedPos.includes(p.key);
                  const showInfo = showInfoPos === p.key;
                  return (
                    <div key={p.key}>
                      <div onClick={() => setSelectedPos(prev => prev.includes(p.key) ? prev.filter(k => k !== p.key) : [...prev, p.key])}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: isOn ? "rgba(34,211,238,.08)" : "#080A10", border: `1.5px solid ${isOn ? "#22D3EE" : "#1E2535"}`, borderRadius: 12, cursor: "pointer", transition: "all .15s" }}>
                        <div style={{ width: 20, height: 20, borderRadius: 6, background: isOn ? "#22D3EE" : "#131720", border: `2px solid ${isOn ? "#22D3EE" : "#252D3F"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {isOn && <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.5 2.5L9 3" stroke="#080A10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: isOn ? "#22D3EE" : "#E2E8F4" }}>{p.label}</div>
                          <div style={{ fontSize: 11, color: "#64748B", marginTop: 2, fontFamily: "'JetBrains Mono'" }}>
                            Máx: {p.maxW}"×{p.maxH}" ({inToCm(p.maxW)}×{inToCm(p.maxH)} cm) · Rec: {p.recW}"×{p.recH}"
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); setShowInfoPos(showInfo ? null : p.key); }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#4A5568", fontSize: 16, padding: 4, flexShrink: 0 }}>ⓘ</button>
                      </div>
                      {showInfo && (
                        <div style={{ background: "rgba(34,211,238,.06)", border: "1px solid rgba(34,211,238,.15)", borderRadius: "0 0 12px 12px", padding: "10px 14px", fontSize: 12, color: "#94A3B8", marginTop: -4 }}>
                          {p.desc}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Arte info */}
            <div style={{ background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24", marginBottom: 8 }}>📁 ¿Qué archivo necesitamos de tu arte?</div>
              <div style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.7 }}>
                Para impresión DTF de calidad, tu diseño debe cumplir estos requisitos:
              </div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["✅ PNG sin fondo", "Fondo transparente (sin blanco), resolución mínima 300 DPI"],
                  ["✅ Vector (AI, PDF, SVG)", "Ideal para logos — escala sin perder calidad"],
                  ["⚠️ JPG/imagen web", "Puede funcionar si es de alta resolución (+1500px)"],
                  ["❌ Word, PowerPoint", "No apto — requiere rediseño adicional"],
                ].map(([t,d]) => (
                  <div key={t} style={{ background: "#080A10", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E2E8F4" }}>{t}</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 1 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button className="cbtn-out" onClick={() => setStep(1)} style={{ flex: "0 0 auto", width: "auto", padding: "13px 20px" }}>← Atrás</button>
              <button className="cbtn" disabled={!canStep3} onClick={handleGenerateQuote}>Ver cotización →</button>
            </div>
          </div>
        )}

        {/* ══ STEP 3: RESULTADO ══ */}
        {step === 3 && quote && (
          <div className="fade-up">
            {/* Print area */}
            <div id="client-quote-print" style={{ background: "#fff", color: "#111", borderRadius: 16, padding: 24, marginBottom: 14, fontFamily: "'Sora',sans-serif" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: "2px solid #111" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#111", letterSpacing: "-0.5px" }}>{businessName}</div>
                  <div style={{ fontSize: 10, color: "#999", letterSpacing: ".1em", textTransform: "uppercase" }}>DTF · Estampado Digital</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: ".08em" }}>Cotización</div>
                  <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono'" }}>#{quoteNum}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{new Date().toLocaleDateString("es-HN", { year:"numeric", month:"long", day:"numeric" })}</div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "#999", marginBottom: 4 }}>Cliente</div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{nombre || "—"}</div>
                {whatsapp && <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>WhatsApp: {whatsapp}</div>}
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr>
                    {["Descripción","Cant.","P/U","Total"].map(h => (
                      <th key={h} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#999", padding: "6px 8px", textAlign: h === "Descripción" ? "left" : "right", borderBottom: "2px solid #eee" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "10px 8px", fontSize: 13, borderBottom: "1px solid #f0f0f0" }}>
                      <div style={{ fontWeight: 700 }}>{prenda?.name} — {color}</div>
                      <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{selectedPos.join(" + ")}</div>
                      <div style={{ fontSize: 10, color: "#aaa", marginTop: 1, fontFamily: "monospace" }}>
                        {Object.entries(tallas).filter(([,v])=>v>0).map(([t,v])=>`${t}:${v}`).join("  ")}
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, borderBottom: "1px solid #f0f0f0" }}>{totalQty}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", borderBottom: "1px solid #f0f0f0" }}>L{quote.sp.toLocaleString()}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, borderBottom: "1px solid #f0f0f0" }}>L{quote.sub.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <table style={{ width: 220 }}>
                  <tbody>
                    {quote.disc > 0 && (
                      <tr>
                        <td style={{ fontSize: 12, color: "#555", padding: "3px 8px" }}>Descuento volumen ({quote.tier?.label})</td>
                        <td style={{ fontSize: 12, color: "#16a34a", textAlign: "right", padding: "3px 8px", fontFamily: "monospace", fontWeight: 700 }}>-L{quote.disc.toLocaleString()}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={{ fontSize: 16, fontWeight: 800, padding: "10px 8px", borderTop: "2px solid #111" }}>TOTAL</td>
                      <td style={{ fontSize: 20, fontWeight: 800, textAlign: "right", padding: "10px 8px", borderTop: "2px solid #111", fontFamily: "monospace" }}>L{quote.total.toLocaleString()}</td>
                    </tr>
                    {showUSD && (
                      <tr>
                        <td style={{ fontSize: 11, color: "#999", padding: "2px 8px" }}>Equivalente USD</td>
                        <td style={{ fontSize: 13, fontWeight: 700, textAlign: "right", padding: "2px 8px", fontFamily: "monospace", color: "#555" }}>${(quote.total / bchRate).toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #eee", fontSize: 11, color: "#aaa", textAlign: "center" }}>
                Cotización válida por {cfg?.validezDias ?? 15} días · {businessName} · Honduras · Precios en Lempiras (HNL)
              </div>
            </div>

            {/* USD toggle */}
            <div style={{ background: "#0D1018", border: "1px solid #1E2535", borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Ver en dólares (USD)</div>
                <div style={{ fontSize: 11, color: "#4A5568" }}>Tasa BCH: L{bchRate} por $1 — actualizado hoy</div>
              </div>
              <button onClick={() => setShowUSD(v => !v)}
                style={{ width: 44, height: 24, borderRadius: 12, background: showUSD ? "#22D3EE" : "#252D3F", border: "none", cursor: "pointer", position: "relative", transition: "background .2s" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: showUSD ? 23 : 3, transition: "left .2s" }} />
              </button>
            </div>

            {showUSD && (
              <div style={{ background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.25)", borderRadius: 12, padding: "14px 16px", marginBottom: 14, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#64748B", marginBottom: 4 }}>Total aproximado en USD</div>
                <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 32, color: "#34D399" }}>${(quote.total / bchRate).toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "#4A5568", marginTop: 4 }}>Tasa oficial BCH: L{bchRate} = $1.00</div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={handleWhatsApp}
                style={{ background: "#25D366", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 800, color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                {whatsappNum === "50499999999" ? "WhatsApp (sin configurar)" : `Enviar por WhatsApp a ${businessName}`}
              </button>
              <button onClick={handlePDF} disabled={pdfLoading}
                style={{ background: "#22D3EE", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 800, color: "#080A10", cursor: pdfLoading ? "wait" : "pointer", opacity: pdfLoading ? .7 : 1 }}>
                {pdfLoading ? "Generando PDF…" : "⬇ Descargar PDF"}
              </button>
              <button onClick={() => { setStep(0); setSelectedPos([]); setTallas({}); setColor(""); setPrendaId(""); setQuote(null); setSaved(false); }}
                className="cbtn-out">
                Nueva cotización
              </button>
            </div>

            {saved && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(52,211,153,.08)", border: "1px solid rgba(52,211,153,.2)", borderRadius: 10, fontSize: 12, color: "#34D399", textAlign: "center" }}>
                ✓ Cotización registrada — {businessName} ya tiene tu solicitud
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
