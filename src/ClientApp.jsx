import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PhoneInput from "./PhoneInput.jsx";
import { loadConfigRemote, createCotizacion, getNextNumero } from "./supabase.js";

// ── PLACEMENT INFO ──
const PLACEMENTS_INFO = [
  { key: "Frente",     label: "Frente",         maxW: 10,  maxH: 12,  recW: 10, recH: 12, desc: "Área principal. Ideal para logos grandes y diseños completos.", svgX: 38, svgY: 30 },
  { key: "Espalda",    label: "Espalda",         maxW: 10,  maxH: 14,  recW: 10, recH: 12, desc: "Zona amplia para diseños grandes o textos con mensaje.", svgX: 38, svgY: 30 },
  { key: "Pecho Izq",  label: "Pecho Izquierdo", maxW: 3.5, maxH: 3.5, recW: 3,  recH: 3,  desc: "Perfecto para logos pequeños, íconos o iniciales.", svgX: 30, svgY: 37 },
  { key: "Pecho Der",  label: "Pecho Derecho",   maxW: 3.5, maxH: 3.5, recW: 3,  recH: 3,  desc: "Complemento al pecho izquierdo. Ideal para numeración.", svgX: 52, svgY: 37 },
  { key: "Manga Izq",  label: "Manga Izquierda", maxW: 3.5, maxH: 12,  recW: 3,  recH: 10, desc: "Diseño vertical en manga. Muy popular en uniformes.", svgX: 14, svgY: 34 },
  { key: "Manga Der",  label: "Manga Derecha",   maxW: 3.5, maxH: 12,  recW: 3,  recH: 10, desc: "Complemento a manga izquierda.", svgX: 68, svgY: 34 },
  { key: "Cuello",     label: "Cuello / Nuca",   maxW: 3.5, maxH: 2,   recW: 3,  recH: 1.5,desc: "Zona pequeña interna. Bueno para marca o etiqueta.", svgX: 38, svgY: 13 },
  { key: "Bolsillo",   label: "Bolsillo",         maxW: 3,   maxH: 3,   recW: 2.5,recH: 2.5,desc: "Área de bolsillo. Solo si la prenda tiene bolsillo.", svgX: 30, svgY: 44 },
];

const TALLAS_DEFAULT = ["XS","S","M","L","XL","XXL","XXXL"];
const inToCm = in_ => (in_ * 2.54).toFixed(1);
const buildVariantKey = (color, talla) => JSON.stringify([color, talla]);
const uniqueValues = (items = []) => [...new Set(items.filter(Boolean))];
const skuPart = (value, fallback = "NA") => {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
  return normalized || fallback;
};
const buildVariantSku = ({ prendaLabel, color, talla }) => [skuPart(prendaLabel, "PRENDA"), skuPart(color, "SIN-COLOR"), skuPart(talla, "STD")].join("-");
const formatVariantSummary = (groups) => groups.map(group => `${group.color}: ${group.items.map(item => `${item.talla}:${item.qty}`).join(", ")}`).join(" · ");

// ── SHIRT DIAGRAM ──
function ShirtDiagram({ side, selected, onToggle }) {
  const zones = side === "back" ? [PLACEMENTS_INFO[1]] : PLACEMENTS_INFO.filter(p => p.key !== "Espalda");
  return (
    <svg viewBox="0 0 100 120" style={{ width: "100%", maxWidth: 260, display: "block", margin: "0 auto" }}>
      <defs>
        <linearGradient id="shirtGrad" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#1a1f2e" /><stop offset="100%" stopColor="#0e1219" /></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <path d="M20 18 L8 46 L22 48 L22 112 L78 112 L78 48 L92 46 L80 18 L64 8 Q58 4 50 7 Q42 4 36 8 Z" fill="url(#shirtGrad)" stroke="#2a3348" strokeWidth="1.2" />
      <path d="M20 18 L8 46 L22 48 L22 36 Z" fill="#141927" stroke="#2a3348" strokeWidth=".8" />
      <path d="M80 18 L92 46 L78 48 L78 36 Z" fill="#141927" stroke="#2a3348" strokeWidth=".8" />
      <path d="M36 8 Q50 15 64 8" fill="none" stroke="#2a3348" strokeWidth="1.2" />
      {zones.map(p => {
        const isOn = selected.includes(p.key);
        const scale = 2.1, w = Math.min(p.maxW * scale, 24), h = Math.min(p.maxH * scale, 30);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onToggle(p.key)} filter={isOn ? "url(#glow)" : undefined}>
            <rect x={p.svgX - w/2} y={p.svgY - h/2} width={w} height={h} rx={2.5}
              fill={isOn ? "rgba(99,225,217,.18)" : "rgba(99,225,217,.04)"} stroke={isOn ? "#63E1D9" : "rgba(99,225,217,.2)"} strokeWidth={isOn ? 1.6 : .8} strokeDasharray={isOn ? "none" : "3,2"} />
            <text x={p.svgX} y={p.svgY + 1.5} textAnchor="middle" fontSize={3} letterSpacing=".03em" fill={isOn ? "#63E1D9" : "#4a5a72"} fontFamily="'Outfit'" fontWeight={isOn ? "700" : "500"}>
              {p.key.replace("Manga ","").replace("Pecho ","")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const STEPS = ["Tus datos", "Prenda y variantes", "Posiciones", "Confirmar"];

function AnimatedNumber({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.transform = "translateY(-4px)"; ref.current.style.opacity = "0";
    const t = setTimeout(() => { if (ref.current) { ref.current.style.transform = "translateY(0)"; ref.current.style.opacity = "1"; } }, 50);
    return () => clearTimeout(t);
  }, [value]);
  return <span ref={ref} style={{ display: "inline-block", transition: "all .3s cubic-bezier(.4,0,.2,1)" }}>{value}</span>;
}

export default function ClientApp() {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shirtSide, setShirtSide] = useState("front");
  const [showInfoPos, setShowInfoPos] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [quoteNum, setQuoteNum] = useState("....");
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [prendaId, setPrendaId] = useState("");
  const [colorRows, setColorRows] = useState([]);
  const [variantQuantities, setVariantQuantities] = useState({});
  const [customColor, setCustomColor] = useState("");
  const [notas, setNotas] = useState("");
  const [selectedPos, setSelectedPos] = useState([]);
  const [deliveryPref, setDeliveryPref] = useState("whatsapp");

  useEffect(() => { const init = async () => { const remoteCfg = await loadConfigRemote(); if (remoteCfg) setCfg(remoteCfg); const num = await getNextNumero(); setQuoteNum(num); setLoading(false); }; init(); }, []);

  useEffect(() => {
    if (!cfg) return;
    const title = cfg.seoTitle || `${cfg.businessName || "DTF"} — Cotizador`;
    document.title = title;
    const ogTitle = document.querySelector('meta[property="og:title"]'); if (ogTitle) ogTitle.setAttribute("content", title);
    const twTitle = document.querySelector('meta[name="twitter:title"]'); if (twTitle) twTitle.setAttribute("content", title);
    if (cfg.seoDesc) { const desc = document.querySelector('meta[name="description"]'); if (desc) desc.setAttribute("content", cfg.seoDesc); const ogDesc = document.querySelector('meta[property="og:description"]'); if (ogDesc) ogDesc.setAttribute("content", cfg.seoDesc); }
  }, [cfg]);

  const prendas = cfg?.prendas ?? [];
  const businessName = cfg?.businessName ?? "ARTAMPA";
  const whatsappBiz = cfg?.whatsappBiz ?? "";
  const validezDias = cfg?.validezDias ?? 15;
  const prenda = prendas.find(p => p.id === prendaId);
  const availableTallas = prenda?.tallas ?? TALLAS_DEFAULT;
  const baseColors = useMemo(() => uniqueValues(prenda?.colores ?? []), [prenda]);
  const matrixColors = useMemo(() => (colorRows.length > 0 ? colorRows : baseColors), [baseColors, colorRows]);
  const variantsByColor = useMemo(() => matrixColors.map(color => { const items = availableTallas.map(talla => { const qty = Number(variantQuantities[buildVariantKey(color, talla)]) || 0; return qty > 0 ? { talla, qty } : null; }).filter(Boolean); return { color, items, total: items.reduce((sum, item) => sum + item.qty, 0) }; }).filter(group => group.total > 0), [availableTallas, matrixColors, variantQuantities]);
  const selectedVariants = useMemo(() => variantsByColor.flatMap(group => group.items.map(item => ({ color: group.color, talla: item.talla, qty: item.qty }))), [variantsByColor]);
  const totalQty = selectedVariants.reduce((sum, item) => sum + item.qty, 0);
  const colorResumen = formatVariantSummary(variantsByColor);
  const tallaTotals = useMemo(() => availableTallas.reduce((acc, talla) => { acc[talla] = matrixColors.reduce((sum, color) => sum + (Number(variantQuantities[buildVariantKey(color, talla)]) || 0), 0); return acc; }, {}), [availableTallas, matrixColors, variantQuantities]);
  const activeColorCount = variantsByColor.length;

  const resetVariantSelection = useCallback(() => { setColorRows([]); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleSelectPrenda = useCallback((nextPrenda) => { setPrendaId(nextPrenda.id); setColorRows(uniqueValues(nextPrenda.colores ?? [])); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleVariantQtyChange = useCallback((color, talla, rawValue) => { const nextQty = Math.max(0, Math.min(999, Number.parseInt(rawValue, 10) || 0)); setVariantQuantities(prev => { const next = { ...prev }; const key = buildVariantKey(color, talla); if (nextQty === 0) delete next[key]; else next[key] = nextQty; return next; }); }, []);
  const handleAddCustomColor = useCallback(() => { const nextColor = customColor.trim(); if (!nextColor) return; const exists = matrixColors.some(color => color.toLowerCase() === nextColor.toLowerCase()); if (!exists) setColorRows(prev => [...prev, nextColor]); setCustomColor(""); }, [customColor, matrixColors]);
  const handleRemoveColorRow = useCallback((colorToRemove) => { setColorRows(prev => prev.filter(color => color !== colorToRemove)); }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const groupId = `${prendaId || "prenda"}-${quoteNum}`;
      const lines = variantsByColor.map(group => ({ qty: group.total, prendaLabel: prenda?.name ?? "Prenda", color: group.color, cfgLabel: selectedPos.join(" + "), tallasSummary: group.items.map(item => `${item.talla}:${item.qty}`).join(", "), groupId, groupLabel: prenda?.name ?? "Prenda", variants: group.items.map(item => ({ sku: buildVariantSku({ prendaLabel: prenda?.name ?? "Prenda", color: group.color, talla: item.talla }), color: group.color, talla: item.talla, qty: item.qty })), sellPrice: 0, lineTotal: 0 }));
      const deliveryLabel = deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Descarga";
      await createCotizacion({ numero: quoteNum, cliente: nombre.trim(), email: email.trim(), telefono: whatsapp.trim(), total: 0, estado: "Pendiente", notas: `Pedido web | ${prenda?.name ?? "?"} | Variantes: ${colorResumen} | Enviar por: ${deliveryLabel}${notas ? " | Nota: " + notas : ""}`, lines });
      if (whatsappBiz) { const msg = encodeURIComponent(`🔔 *Nueva solicitud de cotización DTF*\n\n📋 Solicitud #${quoteNum}\n👤 *${nombre}*\n📱 ${whatsapp || "No indicado"}\n👕 ${prenda?.name ?? "?"}\n🎽 Variantes: ${colorResumen}\n🎨 Posiciones: ${selectedPos.join(", ")}\n📦 Total prendas: ${totalQty}\n📩 Enviar cotización por: *${deliveryLabel}*\n${notas ? `📝 Nota: ${notas}\n` : ""}\n_Revisa el panel admin para aprobar y cotizar._`); window.open(`https://wa.me/${whatsappBiz}?text=${msg}`, "_blank"); }
      setSubmitted(true);
    } catch (e) { console.error(e); alert("Error al enviar. Intentá de nuevo."); }
    setSubmitting(false);
  };

  const canStep1 = nombre.trim().length >= 2;
  const canStep2 = prendaId && totalQty > 0;
  const canStep3 = selectedPos.length > 0;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#06080d", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet"/>
      <div style={{ width: 40, height: 40, border: "2px solid rgba(99,225,217,.3)", borderTopColor: "#63E1D9", borderRadius: "50%", animation: "spin .8s linear infinite" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#06080d", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet"/>
      <style>{`@keyframes successPop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}} @keyframes fadeSlide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,rgba(52,211,153,.15),rgba(99,225,217,.1))", border: "1.5px solid rgba(52,211,153,.3)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", animation: "successPop .5s cubic-bezier(.175,.885,.32,1.275) forwards" }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 28, color: "#e8edf5", marginBottom: 10, letterSpacing: "-.02em", animation: "fadeSlide .5s .15s both" }}>Solicitud enviada</h1>
        <p style={{ color: "#7a8ba8", fontSize: 15, lineHeight: 1.7, marginBottom: 28, animation: "fadeSlide .5s .25s both" }}>
          Tu solicitud <b style={{ color: "#63E1D9", fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>#{quoteNum}</b> fue recibida por <b style={{ color: "#e8edf5" }}>{businessName}</b>. {deliveryPref === "whatsapp" ? "Te contactaremos por WhatsApp." : deliveryPref === "email" ? "Te enviaremos la cotización por correo." : "Te notificaremos cuando esté lista para descargar."}
        </p>
        <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 20, padding: "20px 22px", marginBottom: 24, textAlign: "left", backdropFilter: "blur(12px)", animation: "fadeSlide .5s .35s both" }}>
          <div style={{ fontSize: 10, color: "#4a5a72", textTransform: "uppercase", letterSpacing: ".14em", fontWeight: 700, marginBottom: 14 }}>Resumen</div>
          {[["Referencia", `#${quoteNum}`], ["Nombre", nombre], ["Prenda", prenda?.name ?? "?"], ["Variantes", colorResumen || "—"], ["Posiciones", selectedPos.join(", ")], ["Colores", `${activeColorCount}`], ["Total prendas", `${totalQty}`], ["Recibir por", deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Descarga"], ...(notas ? [["Nota", notas]] : [])].map(([k,v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,.04)", fontSize: 13 }}>
              <span style={{ color: "#5a6b84" }}>{k}</span>
              <span style={{ color: "#c8d4e6", fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={() => { setSubmitted(false); setStep(0); setNombre(""); setWhatsapp(""); setEmail(""); setPrendaId(""); resetVariantSelection(); setSelectedPos([]); setNotas(""); setDeliveryPref("whatsapp"); }}
          style={{ background: "linear-gradient(135deg,#63E1D9,#4CB8B0)", border: "none", borderRadius: 14, padding: "16px 32px", fontSize: 15, fontWeight: 700, color: "#06080d", cursor: "pointer", width: "100%", fontFamily: "'Outfit'", letterSpacing: "-.01em", animation: "fadeSlide .5s .45s both" }}>Nueva solicitud</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#06080d", color: "#e8edf5", fontFamily: "'Outfit',sans-serif" }} role="document">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        .cinp{width:100%;background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;font-size:15px;color:#e8edf5;font-family:'Outfit';outline:none;transition:all .2s ease;letter-spacing:-.01em}
        .cinp:focus{border-color:#63E1D9;background:rgba(99,225,217,.04);box-shadow:0 0 0 3px rgba(99,225,217,.08)}
        .cinp::placeholder{color:#3a4a62}
        .cbtn{background:linear-gradient(135deg,#63E1D9,#4CB8B0);border:none;border-radius:14px;padding:16px 32px;font-size:15px;font-weight:700;color:#06080d;cursor:pointer;font-family:'Outfit';width:100%;transition:all .2s;letter-spacing:-.01em}
        .cbtn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 32px rgba(99,225,217,.2)}
        .cbtn:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
        .cbtn-out{background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.08);border-radius:14px;padding:15px 22px;font-size:14px;font-weight:600;color:#7a8ba8;cursor:pointer;font-family:'Outfit';white-space:nowrap;transition:all .2s}
        .cbtn-out:hover{border-color:rgba(255,255,255,.15);color:#c8d4e6;background:rgba(255,255,255,.06)}
        .glass{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:22px;padding:28px;margin-bottom:18px;backdrop-filter:blur(12px);transition:border-color .2s}
        .chip{display:inline-flex;align-items:center;padding:10px 20px;border-radius:28px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid;transition:all .25s;user-select:none;letter-spacing:-.01em}
        .chip.on{background:rgba(99,225,217,.12);border-color:rgba(99,225,217,.4);color:#63E1D9;box-shadow:0 0 20px rgba(99,225,217,.08)}
        .chip.off{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.08);color:#5a6b84}
        .chip.off:hover{border-color:rgba(255,255,255,.15);color:#7a8ba8}
        .lbl{font-size:10px;font-weight:700;color:#4a5a72;margin-bottom:10px;text-transform:uppercase;letter-spacing:.14em}
        .matrix-wrap{overflow:auto;border:1px solid rgba(255,255,255,.06);border-radius:18px;background:rgba(0,0,0,.2)}
        .matrix-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0}
        .matrix-table th,.matrix-table td{padding:12px 10px;border-right:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04);text-align:center}
        .matrix-table thead th{position:sticky;top:0;background:rgba(15,20,30,.95);z-index:2;backdrop-filter:blur(8px)}
        .matrix-table th:first-child,.matrix-table td:first-child{position:sticky;left:0;text-align:left;background:rgba(10,14,22,.95);z-index:1}
        .matrix-table thead th:first-child{z-index:3}
        .matrix-table th{font-size:10px;font-weight:700;color:#4a5a72;text-transform:uppercase;letter-spacing:.12em}
        .matrix-table td{font-size:13px}
        .matrix-table tr:last-child td,.matrix-table tr:last-child th{border-bottom:none}
        .matrix-table th:last-child,.matrix-table td:last-child{border-right:none}
        .matrix-cell-input{width:62px;background:rgba(255,255,255,.03);border:1.5px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 6px;text-align:center;font-size:16px;font-weight:700;font-family:'JetBrains Mono';color:#e8edf5;outline:none;transition:all .2s}
        .matrix-cell-input:focus{border-color:#63E1D9;box-shadow:0 0 0 3px rgba(99,225,217,.1);background:rgba(99,225,217,.05)}
        .matrix-total-cell{background:rgba(99,225,217,.06);font-family:'JetBrains Mono';font-weight:700;color:#63E1D9}
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp .45s cubic-bezier(.4,0,.2,1) forwards}
        .stagger-1{animation-delay:.05s;opacity:0}.stagger-2{animation-delay:.1s;opacity:0}.stagger-3{animation-delay:.15s;opacity:0}
        @media(max-width:480px){.glass{padding:20px;border-radius:18px}.matrix-cell-input{width:54px;padding:9px 4px;font-size:15px}}
      `}</style>

      {/* Ambient background */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle,rgba(99,225,217,.04) 0%,transparent 70%)", filter: "blur(80px)" }}/>
        <div style={{ position: "absolute", bottom: "-10%", left: "-10%", width: "40vw", height: "40vw", borderRadius: "50%", background: "radial-gradient(circle,rgba(76,184,176,.03) 0%,transparent 70%)", filter: "blur(60px)" }}/>
      </div>

      <header style={{ background: "rgba(6,8,13,.85)", backdropFilter: "blur(24px) saturate(1.5)", borderBottom: "1px solid rgba(255,255,255,.06)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 20px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-.03em", color: "#e8edf5", margin: 0 }}>{businessName}</h1>
            <p style={{ fontSize: 10, color: "#4a5a72", letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 600, margin: 0 }}>{cfg?.seoSlogan || "Estampado DTF personalizado"}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", boxShadow: "0 0 8px rgba(52,211,153,.4)" }}/>
            <span style={{ fontSize: 11, color: "#4a5a72", fontWeight: 600 }}>En línea</span>
          </div>
        </div>
      </header>

      {/* Steps */}
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px 0", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
          {STEPS.map((s,i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: i<STEPS.length-1 ? 1 : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, transition: "all .35s cubic-bezier(.4,0,.2,1)",
                  background: i<step ? "linear-gradient(135deg,#63E1D9,#4CB8B0)" : i===step ? "rgba(99,225,217,.1)" : "rgba(255,255,255,.04)",
                  border: `1.5px solid ${i<=step ? "rgba(99,225,217,.5)" : "rgba(255,255,255,.08)"}`,
                  color: i<step ? "#06080d" : i===step ? "#63E1D9" : "#3a4a62",
                  boxShadow: i===step ? "0 0 16px rgba(99,225,217,.12)" : "none" }}>
                  {i<step ? "✓" : i+1}
                </div>
                <span style={{ fontSize: 12, fontWeight: i===step?700:500, color: i===step?"#e8edf5":"#3a4a62", whiteSpace: "nowrap", transition: "color .3s", display: window.innerWidth < 420 ? (i===step ? "block" : "none") : "block" }}>{s}</span>
              </div>
              {i<STEPS.length-1 && <div style={{ flex: 1, height: 1, marginLeft: 10, marginRight: 10, position: "relative", overflow: "hidden" }}><div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.06)" }}/><div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: i<step?"100%":"0%", background: "linear-gradient(90deg,#63E1D9,#4CB8B0)", transition: "width .5s cubic-bezier(.4,0,.2,1)" }}/></div>}
            </div>
          ))}
        </div>
      </div>

      <div id="main-content" style={{ maxWidth: 600, margin: "0 auto", padding: "0 20px 120px", position: "relative", zIndex: 1 }}>

        {step===0 && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.04em", lineHeight: 1.15, marginBottom: 12, background: "linear-gradient(135deg,#e8edf5 30%,#63E1D9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Personalizá tus prendas</h2>
              <p style={{ fontSize: 15, color: "#5a6b84", lineHeight: 1.7, maxWidth: 420, margin: "0 auto" }}>Completá el formulario y recibí una cotización personalizada por WhatsApp. <span style={{ color: "#7a8ba8", fontWeight: 600 }}>Sin costo, sin compromiso.</span></p>
            </div>
            <div className="glass fade-up stagger-1">
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div><div className="lbl">Nombre completo</div><input className="cinp" placeholder="Ej: María García" aria-label="Tu nombre" value={nombre} onChange={e=>setNombre(e.target.value)} autoFocus/></div>
                <div><div className="lbl">WhatsApp</div><PhoneInput value={whatsapp} onChange={setWhatsapp} placeholder="tu número" style={{ height: 48 }} /><div style={{ fontSize: 11, color: "#3a4a62", marginTop: 6 }}>Para enviarte la cotización</div></div>
                <div><div className="lbl">Correo electrónico <span style={{ color: "#3a4a62", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>— opcional</span></div><input className="cinp" placeholder="tu@correo.com" value={email} aria-label="Correo" onChange={e=>setEmail(e.target.value)} type="email"/></div>
              </div>
            </div>
            <div className="fade-up stagger-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 22 }}>
              {[["💧","Resistente","+50 lavados"],["🎨","Colores HD","Sin límites"],["⚡","Entrega rápida","24–48h"],["👕","Universal","Cualquier tela"]].map(([icon,title,desc]) => (
                <div key={title} style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 16, padding: "16px 14px" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.01em", marginBottom: 2 }}>{title}</div>
                  <div style={{ fontSize: 11, color: "#4a5a72", fontWeight: 500 }}>{desc}</div>
                </div>
              ))}
            </div>
            <button className="cbtn fade-up stagger-3" disabled={!canStep1 || !whatsapp} onClick={()=>setStep(1)}>Continuar</button>
            {(!nombre.trim() || !whatsapp) && <div style={{ fontSize: 11, color: "#3a4a62", textAlign: "center", marginTop: 10 }}>Nombre y WhatsApp son requeridos</div>}
          </div>
        )}

        {step===1 && (
          <div className="fade-up">
            <div className="glass">
              <div className="lbl">Tipo de prenda</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {prendas.map(p=><button key={p.id} className={`chip ${prendaId===p.id?"on":"off"}`} onClick={()=>handleSelectPrenda(p)}>{p.name}</button>)}
                {prendas.length===0 && <div style={{ color: "#3a4a62", fontSize: 13 }}>Cargando…</div>}
              </div>
            </div>
            {prenda && (
              <div className="glass fade-up">
                <div className="lbl">Tallas y colores</div>
                <p style={{ fontSize: 13, color: "#5a6b84", lineHeight: 1.6, marginBottom: 18 }}>Escribí cantidades en cada cruce de color y talla.</p>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <input className="cinp" placeholder="Agregar otro color" value={customColor} onChange={e=>setCustomColor(e.target.value)} onKeyDown={e=>{ if (e.key === "Enter") { e.preventDefault(); handleAddCustomColor(); } }} style={{ flex: "1 1 200px" }}/>
                  <button className="cbtn-out" onClick={handleAddCustomColor}>+ Color</button>
                </div>
                {matrixColors.length === 0 ? (
                  <div style={{ background: "rgba(251,191,36,.04)", border: "1px solid rgba(251,191,36,.12)", borderRadius: 14, padding: 16, fontSize: 13, color: "#FBBF24" }}>Sin colores. Agregá uno manualmente.</div>
                ) : (
                  <div className="matrix-wrap">
                    <table className="matrix-table" aria-label="Tallas y colores">
                      <thead><tr><th>Color</th>{availableTallas.map(t=><th key={t}>{t}</th>)}<th>Total</th></tr></thead>
                      <tbody>
                        {matrixColors.map(color => {
                          const rowTotal = availableTallas.reduce((sum, t) => sum + (Number(variantQuantities[buildVariantKey(color, t)]) || 0), 0);
                          const isBase = baseColors.some(item => item.toLowerCase() === color.toLowerCase());
                          return (
                            <tr key={color}>
                              <td><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 110 }}><span style={{ fontWeight: 700, color: rowTotal > 0 ? "#63E1D9" : "#c8d4e6" }}>{color}</span>{!isBase && <button type="button" onClick={() => handleRemoveColorRow(color)} style={{ border: "none", background: "transparent", color: "#3a4a62", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>}</div></td>
                              {availableTallas.map(t => { const qty = Number(variantQuantities[buildVariantKey(color, t)]) || 0; return (
                                <td key={`${color}-${t}`}><input type="number" min={0} max={999} value={qty || ""} placeholder="0" className="matrix-cell-input" aria-label={`${color} ${t}`} style={{ borderColor: qty > 0 ? "rgba(99,225,217,.35)" : "rgba(255,255,255,.08)", background: qty > 0 ? "rgba(99,225,217,.06)" : "rgba(255,255,255,.03)" }} onChange={e => handleVariantQtyChange(color, t, e.target.value)}/></td>
                              ); })}
                              <td className="matrix-total-cell">{rowTotal}</td>
                            </tr>
                          );
                        })}
                        <tr><td style={{ fontWeight: 700, color: "#4a5a72", textTransform: "uppercase", letterSpacing: ".1em", fontSize: 10 }}>Total</td>{availableTallas.map(t=><td key={`t-${t}`} className="matrix-total-cell">{tallaTotals[t] || 0}</td>)}<td className="matrix-total-cell"><AnimatedNumber value={totalQty}/></td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
                  <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.05)" }}><div style={{ fontSize: 10, color: "#3a4a62", textTransform: "uppercase", letterSpacing: ".14em", fontWeight: 700, marginBottom: 6 }}>Colores</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26, color: "#c8d4e6" }}><AnimatedNumber value={activeColorCount}/></div></div>
                  <div style={{ padding: 16, borderRadius: 16, background: "rgba(99,225,217,.04)", border: "1px solid rgba(99,225,217,.1)" }}><div style={{ fontSize: 10, color: "#4a5a72", textTransform: "uppercase", letterSpacing: ".14em", fontWeight: 700, marginBottom: 6 }}>Prendas</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26, color: "#63E1D9" }}><AnimatedNumber value={totalQty}/></div></div>
                </div>
                {colorResumen && <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(99,225,217,.03)", border: "1px solid rgba(99,225,217,.08)", borderRadius: 14, fontSize: 12, color: "#5a6b84", lineHeight: 1.6 }}><span style={{ color: "#7a8ba8", fontWeight: 600 }}>Resumen:</span> {colorResumen}</div>}
              </div>
            )}
            {totalQty > 0 && <div className="glass fade-up"><div className="lbl">Notas <span style={{ color: "#3a4a62", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>— opcional</span></div><textarea className="cinp" placeholder="Ej: Tengo el arte listo, necesito entrega urgente…" value={notas} onChange={e=>setNotas(e.target.value)} rows={3} style={{ resize: "vertical", minHeight: 80 }}/></div>}
            <div style={{ display: "flex", gap: 10 }}><button className="cbtn-out" onClick={()=>setStep(0)}>← Atrás</button><button className="cbtn" disabled={!canStep2} onClick={()=>setStep(2)} style={{ flex: 1 }}>Elegir posiciones</button></div>
          </div>
        )}

        {step===2 && (
          <div className="fade-up">
            <div className="glass">
              <div style={{ textAlign: "center", marginBottom: 20 }}><h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 6 }}>¿Dónde va el estampado?</h3><p style={{ fontSize: 13, color: "#5a6b84" }}>Tocá las zonas o seleccioná de la lista</p></div>
              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
                {["front","back"].map(side=><button key={side} onClick={()=>setShirtSide(side)} style={{ padding: "8px 22px", borderRadius: 28, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", transition: "all .25s", background: shirtSide===side ? "rgba(99,225,217,.1)" : "rgba(255,255,255,.03)", borderColor: shirtSide===side ? "rgba(99,225,217,.3)" : "rgba(255,255,255,.08)", color: shirtSide===side ? "#63E1D9" : "#4a5a72" }}>{side==="front"?"Frente":"Espalda"}</button>)}
              </div>
              <ShirtDiagram side={shirtSide} selected={selectedPos} onToggle={key=>setSelectedPos(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key])}/>
            </div>
            <div className="glass">
              <div className="lbl">Posiciones disponibles</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {PLACEMENTS_INFO.map(p=>{
                  const isOn = selectedPos.includes(p.key); const showInfo = showInfoPos===p.key;
                  return (
                    <div key={p.key}>
                      <div onClick={()=>setSelectedPos(prev=>prev.includes(p.key)?prev.filter(k=>k!==p.key):[...prev,p.key])} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: isOn?"rgba(99,225,217,.04)":"rgba(255,255,255,.02)", border: `1.5px solid ${isOn?"rgba(99,225,217,.25)":"rgba(255,255,255,.06)"}`, borderRadius: 14, cursor: "pointer", transition: "all .2s" }}>
                        <div style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .25s", background: isOn ? "linear-gradient(135deg,#63E1D9,#4CB8B0)" : "rgba(255,255,255,.04)", border: `1.5px solid ${isOn?"transparent":"rgba(255,255,255,.1)"}` }}>
                          {isOn && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.8 3L10 3" stroke="#06080d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 14, color: isOn?"#63E1D9":"#c8d4e6", letterSpacing: "-.01em" }}>{p.label}</div><div style={{ fontSize: 11, color: "#3a4a62", marginTop: 2, fontFamily: "'JetBrains Mono'", fontWeight: 500 }}>{p.maxW}″ × {p.maxH}″ · {inToCm(p.maxW)} × {inToCm(p.maxH)} cm</div></div>
                        <button onClick={e=>{e.stopPropagation();setShowInfoPos(showInfo?null:p.key)}} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 8, cursor: "pointer", color: "#4a5a72", fontSize: 14, padding: "4px 8px", lineHeight: 1 }}>ⓘ</button>
                      </div>
                      {showInfo && <div style={{ background: "rgba(99,225,217,.03)", border: "1px solid rgba(99,225,217,.08)", borderRadius: "0 0 14px 14px", padding: "12px 16px", fontSize: 12, color: "#5a6b84", marginTop: -4, lineHeight: 1.6 }}>{p.desc}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background: "rgba(251,191,36,.03)", border: "1px solid rgba(251,191,36,.1)", borderRadius: 20, padding: 22, marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#FBBF24", marginBottom: 12 }}>Archivo de diseño</div>
              {[["✅","PNG sin fondo (300+ DPI)"],["✅","Vector AI, PDF o SVG"],["⚠️","JPG alta res (+1500px)"],["❌","Word, PowerPoint, Facebook"]].map(([icon,t])=><div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 13, color: "#7a8ba8" }}><span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span><span>{t}</span></div>)}
              <div style={{ fontSize: 11, color: "#3a4a62", marginTop: 10, lineHeight: 1.5 }}>Sin arte? Podemos diseñarlo — indicalo en las notas.</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}><button className="cbtn-out" onClick={()=>setStep(1)}>← Atrás</button><button className="cbtn" disabled={!canStep3} onClick={()=>setStep(3)} style={{ flex: 1 }}>Revisar solicitud</button></div>
          </div>
        )}

        {step===3 && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: 24 }}><h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 6 }}>Revisá tu solicitud</h3><p style={{ fontSize: 13, color: "#5a6b84" }}>Confirmá los datos antes de enviar</p></div>
            <div className="glass">
              {[["Nombre", nombre], ["WhatsApp", whatsapp || "—"], ["Correo", email || "—"], ["Prenda", prenda?.name ?? "?"], ["Variantes", colorResumen || "—"], ["Colores", `${activeColorCount}`], ["Total", `${totalQty} prendas`], ["Posiciones", selectedPos.join(", ")], ...(notas ? [["Notas", notas]] : [])].map(([k,v])=>(
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,.04)", gap: 14 }}><span style={{ fontSize: 13, color: "#4a5a72", flexShrink: 0 }}>{k}</span><span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", wordBreak: "break-word", maxWidth: "65%", color: "#c8d4e6" }}>{v}</span></div>
              ))}
            </div>
            <div className="glass">
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, letterSpacing: "-.01em" }}>¿Cómo querés recibir la cotización?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["whatsapp", "📱", "WhatsApp", "Te la enviamos directo a tu chat"],
                  ["email", "📧", "Correo electrónico", email ? `A ${email}` : "Ingresá tu correo en el paso 1"],
                  ["download", "📄", "Solo descargar", "La podrás ver cuando esté lista"],
                ].map(([val, icon, label, desc]) => (
                  <div key={val} onClick={() => (val !== "email" || email) && setDeliveryPref(val)}
                    style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                      background: deliveryPref === val ? "rgba(99,225,217,.06)" : "rgba(255,255,255,.02)",
                      border: `1.5px solid ${deliveryPref === val ? "rgba(99,225,217,.3)" : "rgba(255,255,255,.06)"}`,
                      borderRadius: 14, cursor: val === "email" && !email ? "not-allowed" : "pointer",
                      transition: "all .2s", opacity: val === "email" && !email ? .4 : 1 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .25s",
                      background: deliveryPref === val ? "linear-gradient(135deg,#63E1D9,#4CB8B0)" : "rgba(255,255,255,.04)",
                      border: `1.5px solid ${deliveryPref === val ? "transparent" : "rgba(255,255,255,.1)"}` }}>
                      {deliveryPref === val && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.8 3L10 3" stroke="#06080d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: deliveryPref === val ? "#63E1D9" : "#c8d4e6" }}>{icon} {label}</div>
                      <div style={{ fontSize: 11, color: "#3a4a62", marginTop: 2 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "rgba(99,225,217,.03)", border: "1px solid rgba(99,225,217,.08)", borderRadius: 20, padding: 18, marginBottom: 20, textAlign: "center" }}>
              <p style={{ fontSize: 13, color: "#5a6b84", lineHeight: 1.6 }}>Revisaremos tu solicitud y te enviaremos la cotización exacta{deliveryPref === "whatsapp" ? " por WhatsApp" : deliveryPref === "email" ? " por correo" : ""}.</p>
              <p style={{ fontSize: 11, color: "#3a4a62", marginTop: 8 }}>Tiempo de respuesta: el mismo día hábil</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}><button className="cbtn-out" onClick={()=>setStep(2)}>← Atrás</button><button className="cbtn" disabled={submitting} onClick={handleSubmit} style={{ flex: 1 }}>{submitting ? "Enviando…" : "Enviar solicitud"}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
