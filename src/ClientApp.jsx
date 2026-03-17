import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PhoneInput from "./PhoneInput.jsx";
import { loadConfigRemote, createCotizacion, getNextNumero } from "./supabase.js";

const PLACEMENTS_INFO = [
  { key: "Frente",     label: "Frente",         maxW: 10,  maxH: 12,  desc: "Área principal. Ideal para logos grandes y diseños completos.", svgX: 38, svgY: 30 },
  { key: "Espalda",    label: "Espalda",         maxW: 10,  maxH: 14,  desc: "Zona amplia para diseños grandes o textos.", svgX: 38, svgY: 30 },
  { key: "Pecho Izq",  label: "Pecho Izquierdo", maxW: 3.5, maxH: 3.5, desc: "Perfecto para logos pequeños o iniciales.", svgX: 30, svgY: 37 },
  { key: "Pecho Der",  label: "Pecho Derecho",   maxW: 3.5, maxH: 3.5, desc: "Complemento al pecho izquierdo.", svgX: 52, svgY: 37 },
  { key: "Manga Izq",  label: "Manga Izquierda", maxW: 3.5, maxH: 12,  desc: "Diseño vertical en manga. Popular en uniformes.", svgX: 14, svgY: 34 },
  { key: "Manga Der",  label: "Manga Derecha",   maxW: 3.5, maxH: 12,  desc: "Complemento a manga izquierda.", svgX: 68, svgY: 34 },
  { key: "Cuello",     label: "Cuello / Nuca",   maxW: 3.5, maxH: 2,   desc: "Zona para marca o etiqueta.", svgX: 38, svgY: 13 },
  { key: "Bolsillo",   label: "Bolsillo",         maxW: 3,   maxH: 3,   desc: "Solo si la prenda tiene bolsillo.", svgX: 30, svgY: 44 },
];
const TALLAS_DEFAULT = ["XS","S","M","L","XL","XXL","XXXL"];
const SIZE_GUIDE = [
  { talla: "XS", pecho: "82–86", cintura: "64–68", largo: "66" },
  { talla: "S",  pecho: "87–92", cintura: "69–74", largo: "68" },
  { talla: "M",  pecho: "93–98", cintura: "75–80", largo: "71" },
  { talla: "L",  pecho: "99–106", cintura: "81–88", largo: "74" },
  { talla: "XL", pecho: "107–114", cintura: "89–96", largo: "76" },
  { talla: "XXL", pecho: "115–122", cintura: "97–104", largo: "78" },
  { talla: "XXXL", pecho: "123–130", cintura: "105–112", largo: "80" },
];
const inToCm = in_ => (in_ * 2.54).toFixed(1);
const buildVariantKey = (color, talla) => JSON.stringify([color, talla]);
const uniqueValues = (items = []) => [...new Set(items.filter(Boolean))];
const skuPart = (v, fb = "NA") => { const n = String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase(); return n || fb; };
const buildVariantSku = ({ prendaLabel, color, talla }) => [skuPart(prendaLabel, "PRENDA"), skuPart(color, "SIN-COLOR"), skuPart(talla, "STD")].join("-");
const formatVariantSummary = (groups) => groups.map(g => `${g.color}: ${g.items.map(i => `${i.talla}:${i.qty}`).join(", ")}`).join(" · ");

function ShirtDiagram({ side, selected, onToggle }) {
  const zones = side === "back" ? [PLACEMENTS_INFO[1]] : PLACEMENTS_INFO.filter(p => p.key !== "Espalda");
  return (
    <svg viewBox="0 0 100 120" style={{ width: "100%", maxWidth: 240, display: "block", margin: "0 auto" }}>
      <path d="M20 18 L8 46 L22 48 L22 112 L78 112 L78 48 L92 46 L80 18 L64 8 Q58 4 50 7 Q42 4 36 8 Z" fill="#F5F5F7" stroke="#D2D2D7" strokeWidth="1" />
      <path d="M20 18 L8 46 L22 48 L22 36 Z" fill="#ECECF0" stroke="#D2D2D7" strokeWidth=".8" />
      <path d="M80 18 L92 46 L78 48 L78 36 Z" fill="#ECECF0" stroke="#D2D2D7" strokeWidth=".8" />
      <path d="M36 8 Q50 15 64 8" fill="none" stroke="#D2D2D7" strokeWidth="1" />
      {zones.map(p => {
        const isOn = selected.includes(p.key);
        const s = 2.1, w = Math.min(p.maxW * s, 24), h = Math.min(p.maxH * s, 30);
        return (
          <g key={p.key} style={{ cursor: "pointer" }} onClick={() => onToggle(p.key)}>
            <rect x={p.svgX - w/2} y={p.svgY - h/2} width={w} height={h} rx={2}
              fill={isOn ? "rgba(0,113,227,.12)" : "rgba(0,113,227,.03)"} stroke={isOn ? "#0071E3" : "#D2D2D7"} strokeWidth={isOn ? 1.4 : .7} strokeDasharray={isOn ? "none" : "3,2"} />
            <text x={p.svgX} y={p.svgY + 1.5} textAnchor="middle" fontSize={2.8} fill={isOn ? "#0071E3" : "#86868B"} fontFamily="'Outfit'" fontWeight={isOn ? "700" : "500"}>
              {p.key.replace("Manga ","").replace("Pecho ","")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const STEPS = ["Tus datos", "Prenda y variantes", "Posiciones", "Confirmar"];

// ── INFO PAGE ──
function InfoPage({ businessName, onCotizar }) {
  const [infoTab, setInfoTab] = useState("dtf");
  const Section = ({ title, children }) => (
    <div style={{ background: "#fff", borderRadius: 20, padding: "28px 24px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      {title && <h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 16 }}>{title}</h3>}
      {children}
    </div>
  );
  const Row = ({ label, value, accent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F5F5F7", fontSize: 13 }}>
      <span style={{ color: "#86868B" }}>{label}</span>
      <span style={{ fontWeight: 600, color: accent || "#1D1D1F" }}>{value}</span>
    </div>
  );

  return (
    <div className="fade-up">
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "48px 20px 36px" }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.05em", lineHeight: 1.05, marginBottom: 14 }}>
          Estampado DTF{"\n"}de alta calidad.
        </h1>
        <p style={{ fontSize: 17, color: "#6E6E73", lineHeight: 1.6, maxWidth: 400, margin: "0 auto 24px" }}>
          Personalizá cualquier prenda con tecnología Direct-to-Film. Colores vibrantes, durabilidad profesional.
        </p>
        <button onClick={onCotizar} style={{ background: "#0071E3", border: "none", borderRadius: 28, padding: "14px 36px", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "'Outfit'" }}>
          Solicitar cotización
        </button>
      </div>

      {/* Feature strips */}
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 24 }}>
          {[
            ["💧", "+50 lavados", "Resistente al uso diario y lavados industriales"],
            ["🎨", "Colores ilimitados", "CMYK completo, degradados, fotos y más"],
            ["⚡", "24–48 horas", "Entrega rápida en días hábiles"],
            ["👕", "Cualquier tela", "Algodón, poliéster, mezclas, nylon"],
            ["📏", "Cualquier tamaño", "Desde pecho izquierdo hasta espalda completa"],
            ["🔥", "155°C × 15s", "Prensado profesional con calidad garantizada"],
          ].map(([ic, t, d]) => (
            <div key={t} style={{ background: "#fff", borderRadius: 16, padding: "18px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{ic}</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t}</div>
              <div style={{ fontSize: 12, color: "#86868B", lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>

        {/* Info tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
          {[["dtf", "¿Qué es DTF?"], ["vs", "DTF vs Otros"], ["sizes", "Guía de tallas"], ["files", "Archivos"]].map(([k, l]) => (
            <button key={k} onClick={() => setInfoTab(k)}
              style={{ padding: "8px 18px", borderRadius: 24, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", whiteSpace: "nowrap", transition: "all .2s",
                background: infoTab === k ? "#1D1D1F" : "#fff", borderColor: infoTab === k ? "#1D1D1F" : "#D2D2D7", color: infoTab === k ? "#fff" : "#6E6E73" }}>
              {l}
            </button>
          ))}
        </div>

        {/* DTF explained */}
        {infoTab === "dtf" && (
          <Section title="¿Qué es el estampado DTF?">
            <p style={{ fontSize: 14, color: "#6E6E73", lineHeight: 1.8, marginBottom: 16 }}>
              <b style={{ color: "#1D1D1F" }}>Direct-to-Film (DTF)</b> es la tecnología de estampado más versátil disponible. Tu diseño se imprime en una película especial con tinta CMYK + blanco, se le aplica un adhesivo en polvo, y se transfiere a la prenda con calor y presión.
            </p>
            <p style={{ fontSize: 14, color: "#6E6E73", lineHeight: 1.8, marginBottom: 16 }}>
              El resultado es un estampado con colores vibrantes, tacto suave, y una durabilidad superior a +50 lavados. Funciona en <b style={{ color: "#1D1D1F" }}>cualquier tipo de tela</b>: algodón, poliéster, mezclas, nylon, denim, y más.
            </p>
            <div style={{ background: "#F0F7FF", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#0071E3", fontWeight: 600 }}>
              Ideal para: uniformes, merchandising, equipos deportivos, eventos, marcas propias, regalos personalizados.
            </div>
          </Section>
        )}

        {/* DTF vs Others */}
        {infoTab === "vs" && (
          <Section title="DTF vs otros métodos">
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                ["", "DTF", "Sublimación", "Serigrafía"],
                ["Telas", "Todas", "Solo poliéster", "Todas"],
                ["Colores", "Ilimitados", "Ilimitados", "1–6 colores"],
                ["Mínimo", "1 unidad", "1 unidad", "12+ unidades"],
                ["Durabilidad", "+50 lavados", "+50 lavados", "+100 lavados"],
                ["Fotos/degradados", "✅ Sí", "✅ Sí", "❌ No"],
                ["Telas oscuras", "✅ Sí", "❌ No", "✅ Sí"],
                ["Costo por unidad", "Medio", "Bajo", "Bajo (en volumen)"],
                ["Setup", "Sin setup", "Sin setup", "Requiere marcos"],
              ].map((row, ri) => (
                <div key={ri} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 0, fontSize: ri === 0 ? 10 : 12, fontWeight: ri === 0 ? 700 : 400,
                  color: ri === 0 ? "#86868B" : "#1D1D1F", textTransform: ri === 0 ? "uppercase" : "none", letterSpacing: ri === 0 ? ".06em" : 0,
                  borderBottom: "1px solid #F5F5F7", padding: ri === 0 ? "0 0 8px" : "10px 0" }}>
                  {row.map((cell, ci) => (
                    <span key={ci} style={{ fontWeight: ci === 0 ? 600 : 400, color: ci === 0 ? "#86868B" : undefined, fontSize: ci === 0 && ri > 0 ? 11 : undefined }}>
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, background: "#F0F7FF", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#1D1D1F", lineHeight: 1.6 }}>
              <b>¿Cuándo elegir DTF?</b> Cuando necesitás colores vibrantes en cualquier tela, cantidades pequeñas, o diseños con fotos/degradados en telas oscuras.
            </div>
          </Section>
        )}

        {/* Size guide */}
        {infoTab === "sizes" && (
          <Section title="Guía de tallas estándar">
            <p style={{ fontSize: 13, color: "#86868B", marginBottom: 14 }}>Medidas aproximadas en centímetros. Pueden variar según el fabricante de la prenda.</p>
            <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid #E8E8ED" }}>
              <table style={{ width: "100%", minWidth: 400, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Talla", "Pecho (cm)", "Cintura (cm)", "Largo (cm)"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", fontSize: 10, fontWeight: 700, color: "#86868B", textTransform: "uppercase", letterSpacing: ".06em", textAlign: "left", background: "#FAFAFA", borderBottom: "1px solid #E8E8ED" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SIZE_GUIDE.map(s => (
                    <tr key={s.talla}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: 13, borderBottom: "1px solid #F5F5F7" }}>{s.talla}</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#6E6E73", borderBottom: "1px solid #F5F5F7" }}>{s.pecho}</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#6E6E73", borderBottom: "1px solid #F5F5F7" }}>{s.cintura}</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#6E6E73", borderBottom: "1px solid #F5F5F7" }}>{s.largo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PLACEMENTS_INFO.slice(0, 4).map(p => (
                <div key={p.key} style={{ background: "#F5F5F7", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: "#86868B", fontFamily: "'JetBrains Mono'" }}>Máx: {p.maxW}″ × {p.maxH}″</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* File guide */}
        {infoTab === "files" && (
          <Section title="Archivos de diseño">
            <p style={{ fontSize: 14, color: "#6E6E73", lineHeight: 1.7, marginBottom: 16 }}>
              Para obtener la mejor calidad de estampado, tu archivo debe cumplir ciertos requisitos.
            </p>
            {[
              ["✅", "PNG sin fondo (transparente)", "Resolución mínima 300 DPI. Este es el formato ideal.", "#E8F5E9", "#2E7D32"],
              ["✅", "Vector (AI, PDF, SVG, EPS)", "Escala sin perder calidad. Perfecto para logos.", "#E8F5E9", "#2E7D32"],
              ["⚠️", "JPG de alta resolución", "Mínimo 1500px de ancho. Puede funcionar dependiendo del diseño.", "#FFF8E1", "#F57F17"],
              ["❌", "Word, PowerPoint, capturas de pantalla", "No son aptos para impresión. Requieren rediseño adicional.", "#FFEBEE", "#C62828"],
            ].map(([ic, t, d, bg, col]) => (
              <div key={t} style={{ background: bg, borderRadius: 12, padding: "14px 16px", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: col, marginBottom: 4 }}>{ic} {t}</div>
                <div style={{ fontSize: 12, color: "#6E6E73", lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 13, color: "#86868B", lineHeight: 1.6 }}>
              Si no tenés el arte listo, ofrecemos servicio de diseño por un costo adicional. Indicalo al solicitar tu cotización.
            </div>
          </Section>
        )}

        {/* CTA */}
        <div style={{ textAlign: "center", padding: "24px 0 48px" }}>
          <p style={{ fontSize: 14, color: "#86868B", marginBottom: 16 }}>¿Listo para personalizar tus prendas?</p>
          <button onClick={onCotizar} style={{ background: "#1D1D1F", border: "none", borderRadius: 28, padding: "16px 40px", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "'Outfit'" }}>
            Cotizar ahora
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientApp() {
  const [page, setPage] = useState("info");
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
  const [quien, setQuien] = useState("nosotros"); // nosotros | cliente
  const [colorRows, setColorRows] = useState([]);
  const [variantQuantities, setVariantQuantities] = useState({});
  const [customColor, setCustomColor] = useState("");
  const [notas, setNotas] = useState("");
  const [selectedPos, setSelectedPos] = useState([]);
  const [deliveryPref, setDeliveryPref] = useState("whatsapp");

  useEffect(() => { const init = async () => { const r = await loadConfigRemote(); if (r) setCfg(r); const n = await getNextNumero(); setQuoteNum(n); setLoading(false); }; init(); }, []);
  useEffect(() => { if (!cfg) return; const t = cfg.seoTitle || `${cfg.businessName || "DTF"} — Cotizador`; document.title = t; const og = document.querySelector('meta[property="og:title"]'); if (og) og.setAttribute("content", t); if (cfg.seoDesc) { const d = document.querySelector('meta[name="description"]'); if (d) d.setAttribute("content", cfg.seoDesc); } }, [cfg]);

  const prendas = cfg?.prendas ?? [];
  const businessName = cfg?.businessName ?? "DTF";
  const whatsappBiz = cfg?.whatsappBiz ?? "";
  const validezDias = cfg?.validezDias ?? 15;
  const prenda = prendas.find(p => p.id === prendaId);
  const availableTallas = prenda?.tallas ?? TALLAS_DEFAULT;
  const baseColors = useMemo(() => uniqueValues(prenda?.colores ?? []), [prenda]);
  const matrixColors = useMemo(() => colorRows.length > 0 ? colorRows : baseColors, [baseColors, colorRows]);
  const variantsByColor = useMemo(() => matrixColors.map(color => { const items = availableTallas.map(t => { const q = Number(variantQuantities[buildVariantKey(color, t)]) || 0; return q > 0 ? { talla: t, qty: q } : null; }).filter(Boolean); return { color, items, total: items.reduce((s, i) => s + i.qty, 0) }; }).filter(g => g.total > 0), [availableTallas, matrixColors, variantQuantities]);
  const totalQty = useMemo(() => variantsByColor.reduce((s, g) => s + g.total, 0), [variantsByColor]);
  const colorResumen = formatVariantSummary(variantsByColor);
  const tallaTotals = useMemo(() => availableTallas.reduce((a, t) => { a[t] = matrixColors.reduce((s, c) => s + (Number(variantQuantities[buildVariantKey(c, t)]) || 0), 0); return a; }, {}), [availableTallas, matrixColors, variantQuantities]);
  const activeColorCount = variantsByColor.length;

  const resetAll = useCallback(() => { setColorRows([]); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleSelectPrenda = useCallback((p) => { setPrendaId(p.id); setColorRows(uniqueValues(p.colores ?? [])); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleVariantQtyChange = useCallback((c, t, raw) => { const q = Math.max(0, Math.min(999, parseInt(raw, 10) || 0)); setVariantQuantities(prev => { const n = { ...prev }; const k = buildVariantKey(c, t); if (q === 0) delete n[k]; else n[k] = q; return n; }); }, []);
  const handleAddCustomColor = useCallback(() => { const c = customColor.trim(); if (!c) return; if (!matrixColors.some(x => x.toLowerCase() === c.toLowerCase())) setColorRows(prev => [...prev, c]); setCustomColor(""); }, [customColor, matrixColors]);

  const quienLabel = quien === "nosotros" ? "Nosotros proveemos" : "Cliente provee";

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const gid = `${prendaId || "prenda"}-${quoteNum}`;
      const lines = variantsByColor.map(g => ({ qty: g.total, prendaLabel: prenda?.name ?? "Prenda", color: g.color, cfgLabel: selectedPos.join(" + "), tallasSummary: g.items.map(i => `${i.talla}:${i.qty}`).join(", "), groupId: gid, groupLabel: prenda?.name ?? "Prenda", quien, variants: g.items.map(i => ({ sku: buildVariantSku({ prendaLabel: prenda?.name ?? "Prenda", color: g.color, talla: i.talla }), color: g.color, talla: i.talla, qty: i.qty })), sellPrice: 0, lineTotal: 0 }));
      const deliveryLabel = deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Descarga";
      await createCotizacion({ numero: quoteNum, cliente: nombre.trim(), email: email.trim(), telefono: whatsapp.trim(), total: 0, estado: "Pendiente", notas: `Pedido web | ${prenda?.name ?? "?"} | Prendas: ${quienLabel} | Variantes: ${colorResumen} | Enviar por: ${deliveryLabel}${notas ? " | Nota: " + notas : ""}`, lines });
      if (whatsappBiz) { window.open(`https://wa.me/${whatsappBiz}?text=${encodeURIComponent(`🔔 *Nueva solicitud #${quoteNum}*\n👤 ${nombre}\n👕 ${prenda?.name ?? "?"} (${quienLabel})\n📦 ${totalQty} prendas\n🎨 ${selectedPos.join(", ")}\n📩 Enviar por: *${deliveryLabel}*${notas ? `\n📝 ${notas}` : ""}`)}`, "_blank"); }
      setSubmitted(true);
    } catch (e) { console.error(e); alert("Error al enviar."); }
    setSubmitting(false);
  };

  const canStep1 = nombre.trim().length >= 2 && whatsapp;
  const canStep2 = prendaId && totalQty > 0;
  const canStep3 = selectedPos.length > 0;

  const C = { // card
    bg: "#fff", br: 20, p: "28px 24px", mb: 16, bs: "0 1px 4px rgba(0,0,0,.04)"
  };
  const card = { background: C.bg, borderRadius: C.br, padding: C.p, marginBottom: C.mb, boxShadow: C.bs };
  const lbl = { fontSize: 11, fontWeight: 600, color: "#86868B", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" };
  const btn = { background: "#1D1D1F", border: "none", borderRadius: 14, padding: "16px 32px", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer", width: "100%", fontFamily: "'Outfit'" };
  const btnOut = { background: "transparent", border: "1.5px solid #D2D2D7", borderRadius: 14, padding: "15px 22px", fontSize: 14, fontWeight: 600, color: "#6E6E73", cursor: "pointer", fontFamily: "'Outfit'" };
  const chip = (on) => ({ display: "inline-flex", alignItems: "center", padding: "10px 20px", borderRadius: 28, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1.5px solid", transition: "all .2s", userSelect: "none", background: on ? "#1D1D1F" : "#fff", borderColor: on ? "#1D1D1F" : "#D2D2D7", color: on ? "#fff" : "#6E6E73" });
  const radio = (on) => ({ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: on ? "#F0F7FF" : "#FAFAFA", border: `1.5px solid ${on ? "#0071E3" : "#E8E8ED"}`, borderRadius: 14, cursor: "pointer", marginBottom: 8, transition: "all .2s" });
  const dot = (on) => ({ width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "#0071E3" : "#D2D2D7"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F5F5F7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit'" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both} .cinp{width:100%;background:#F5F5F7;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#1D1D1F;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#0071E3;background:#fff} .cinp::placeholder{color:#AEAEB2} .matrix-wrap{overflow:auto;border-radius:16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.04)} .matrix-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0} .matrix-table th,.matrix-table td{padding:12px 10px;border-right:1px solid #F5F5F7;border-bottom:1px solid #F5F5F7;text-align:center} .matrix-table thead th{position:sticky;top:0;background:#FAFAFA;z-index:2} .matrix-table th:first-child,.matrix-table td:first-child{position:sticky;left:0;text-align:left;background:#fff;z-index:1} .matrix-table thead th:first-child{z-index:3;background:#FAFAFA} .matrix-table th{font-size:10px;font-weight:700;color:#86868B;text-transform:uppercase;letter-spacing:.08em} .mci{width:60px;background:#F5F5F7;border:1.5px solid #E8E8ED;border-radius:10px;padding:10px 6px;text-align:center;font-size:16px;font-weight:700;font-family:'JetBrains Mono';color:#1D1D1F;outline:none;transition:all .2s} .mci:focus{border-color:#0071E3;background:#fff} .mtc{background:#F0F7FF;font-family:'JetBrains Mono';font-weight:700;color:#0071E3}`}</style>
      <div style={{ width: 36, height: 36, border: "2.5px solid #D2D2D7", borderTopColor: "#1D1D1F", borderRadius: "50%", animation: "spin .7s linear infinite" }}/>
    </div>
  );

  const headerNav = (
    <header style={{ background: "rgba(245,245,247,.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid #E8E8ED", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ cursor: "pointer" }} onClick={() => { setPage("info"); setSubmitted(false); }}>
          <h1 style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.02em", margin: 0 }}>{businessName}</h1>
          <p style={{ fontSize: 10, color: "#86868B", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600, margin: 0 }}>{cfg?.seoSlogan || "Estampado DTF"}</p>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["info", "Info"], ["cotizar", "Cotizar"]].map(([k, l]) => (
            <button key={k} onClick={() => { setPage(k); if (k === "cotizar") setSubmitted(false); }}
              style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", transition: "all .2s",
                background: page === k ? "#1D1D1F" : "transparent", borderColor: page === k ? "#1D1D1F" : "#D2D2D7", color: page === k ? "#fff" : "#6E6E73" }}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </header>
  );

  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#F5F5F7", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      {headerNav}
      <div style={{ maxWidth: 400, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#E8F5E9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 10 }}>Solicitud enviada</h2>
        <p style={{ color: "#6E6E73", fontSize: 15, lineHeight: 1.7, marginBottom: 28 }}>
          Tu solicitud <b style={{ color: "#1D1D1F", fontFamily: "'JetBrains Mono'" }}>#{quoteNum}</b> fue recibida.
        </p>
        <div style={{ ...card, textAlign: "left", padding: "20px 22px" }}>
          {[["Prenda", prenda?.name ?? "?"], ["Prendas provistas por", quienLabel], ["Variantes", colorResumen || "—"], ["Total", `${totalQty} prendas`], ["Recibir por", deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Descarga"]].map(([k,v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F5F5F7", fontSize: 13 }}>
              <span style={{ color: "#86868B" }}>{k}</span><span style={{ fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={() => { setSubmitted(false); setStep(0); setPage("cotizar"); setNombre(""); setWhatsapp(""); setEmail(""); setPrendaId(""); resetAll(); setSelectedPos([]); setNotas(""); setQuien("nosotros"); setDeliveryPref("whatsapp"); }} style={btn}>Nueva solicitud</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F7", color: "#1D1D1F", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both} .cinp{width:100%;background:#F5F5F7;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#1D1D1F;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#0071E3;background:#fff} .cinp::placeholder{color:#AEAEB2} .matrix-wrap{overflow:auto;border-radius:16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.04)} .matrix-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0} .matrix-table th,.matrix-table td{padding:12px 10px;border-right:1px solid #F5F5F7;border-bottom:1px solid #F5F5F7;text-align:center} .matrix-table thead th{position:sticky;top:0;background:#FAFAFA;z-index:2} .matrix-table th:first-child,.matrix-table td:first-child{position:sticky;left:0;text-align:left;background:#fff;z-index:1} .matrix-table thead th:first-child{z-index:3;background:#FAFAFA} .matrix-table th{font-size:10px;font-weight:700;color:#86868B;text-transform:uppercase;letter-spacing:.08em} .matrix-table tr:last-child td{border-bottom:none} .matrix-table th:last-child,.matrix-table td:last-child{border-right:none} .mci{width:60px;background:#F5F5F7;border:1.5px solid #E8E8ED;border-radius:10px;padding:10px 6px;text-align:center;font-size:16px;font-weight:700;font-family:'JetBrains Mono';color:#1D1D1F;outline:none;transition:all .2s} .mci:focus{border-color:#0071E3;background:#fff} .mtc{background:#F0F7FF;font-family:'JetBrains Mono';font-weight:700;color:#0071E3} @media(max-width:480px){.mci{width:52px;font-size:14px}}`}</style>

      {headerNav}

      {page === "info" && <InfoPage businessName={businessName} onCotizar={() => setPage("cotizar")} />}

      {page === "cotizar" && (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 20px" }}>
          {/* Steps */}
          <div style={{ padding: "20px 0 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
              {STEPS.map((s,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", flex: i<3 ? 1 : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, transition: "all .3s",
                      background: i<step ? "#1D1D1F" : i===step ? "#F0F7FF" : "#F5F5F7",
                      border: `1.5px solid ${i<step ? "#1D1D1F" : i===step ? "#0071E3" : "#D2D2D7"}`,
                      color: i<step ? "#fff" : i===step ? "#0071E3" : "#AEAEB2" }}>
                      {i<step ? "✓" : i+1}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: i===step?700:500, color: i===step?"#1D1D1F":"#AEAEB2", whiteSpace: "nowrap", display: window.innerWidth < 420 ? (i===step ? "block" : "none") : "block" }}>{s}</span>
                  </div>
                  {i<3 && <div style={{ flex: 1, height: 1, margin: "0 10px", background: i<step?"#1D1D1F":"#E8E8ED", transition: "background .4s" }}/>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ paddingBottom: 100 }}>
            {/* Step 0 */}
            {step===0 && (
              <div className="fade-up">
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 8 }}>Solicitá tu cotización</h2>
                  <p style={{ fontSize: 14, color: "#6E6E73" }}>Sin compromiso. Te respondemos el mismo día hábil.</p>
                </div>
                <div style={card}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div><div style={lbl}>Nombre completo</div><input className="cinp" placeholder="Ej: María García" value={nombre} onChange={e=>setNombre(e.target.value)} autoFocus/></div>
                    <div><div style={lbl}>WhatsApp</div><PhoneInput value={whatsapp} onChange={setWhatsapp} placeholder="tu número" style={{ height: 48 }} /></div>
                    <div><div style={lbl}>Correo <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#AEAEB2" }}>— opcional</span></div><input className="cinp" placeholder="tu@correo.com" value={email} onChange={e=>setEmail(e.target.value)} type="email"/></div>
                  </div>
                </div>
                <button style={{ ...btn, opacity: canStep1?1:.35, cursor: canStep1?"pointer":"not-allowed" }} disabled={!canStep1} onClick={()=>setStep(1)}>Continuar</button>
              </div>
            )}

            {/* Step 1 */}
            {step===1 && (
              <div className="fade-up">
                <div style={card}>
                  <div style={lbl}>Tipo de prenda</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {prendas.map(p=><button key={p.id} style={chip(prendaId===p.id)} onClick={()=>handleSelectPrenda(p)}>{p.name}</button>)}
                  </div>
                </div>

                {/* Quién provee la prenda */}
                {prendaId && (
                  <div style={card} className="fade-up">
                    <div style={lbl}>¿Quién provee las prendas?</div>
                    {[
                      ["nosotros", "👕 Nosotros las proveemos", "Incluimos las prendas en blanco en la cotización"],
                      ["cliente", "📦 Yo las traigo", "Solo cotizo el estampado DTF"],
                    ].map(([val, lb, desc]) => (
                      <div key={val} onClick={() => setQuien(val)} style={radio(quien === val)}>
                        <div style={dot(quien === val)}>
                          {quien === val && <div style={{ width: 10, height: 10, borderRadius: 5, background: "#0071E3" }}/>}
                        </div>
                        <div><div style={{ fontWeight: 600, fontSize: 13 }}>{lb}</div><div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 1 }}>{desc}</div></div>
                      </div>
                    ))}
                  </div>
                )}

                {prenda && (
                  <div style={card} className="fade-up">
                    <div style={lbl}>Tallas y colores</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      <input className="cinp" placeholder="Agregar color" value={customColor} onChange={e=>setCustomColor(e.target.value)} onKeyDown={e=>{ if (e.key==="Enter") { e.preventDefault(); handleAddCustomColor(); }}} style={{ flex: "1 1 180px" }}/>
                      <button style={btnOut} onClick={handleAddCustomColor}>+ Color</button>
                    </div>
                    {matrixColors.length === 0 ? (
                      <div style={{ background: "#FFF8E1", borderRadius: 12, padding: 16, fontSize: 13, color: "#F57F17" }}>Sin colores. Agregá uno.</div>
                    ) : (
                      <div className="matrix-wrap">
                        <table className="matrix-table">
                          <thead><tr><th>Color</th>{availableTallas.map(t=><th key={t}>{t}</th>)}<th>Total</th></tr></thead>
                          <tbody>
                            {matrixColors.map(color => {
                              const rt = availableTallas.reduce((s,t) => s + (Number(variantQuantities[buildVariantKey(color, t)]) || 0), 0);
                              const isBase = baseColors.some(x => x.toLowerCase() === color.toLowerCase());
                              return (
                                <tr key={color}>
                                  <td><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 100 }}><span style={{ fontWeight: 600, color: rt > 0 ? "#0071E3" : "#1D1D1F" }}>{color}</span>{!isBase && <button onClick={()=>setColorRows(p=>p.filter(x=>x!==color))} style={{ border: "none", background: "transparent", color: "#AEAEB2", cursor: "pointer", fontSize: 16 }}>×</button>}</div></td>
                                  {availableTallas.map(t => { const q = Number(variantQuantities[buildVariantKey(color, t)]) || 0; return (
                                    <td key={`${color}-${t}`}><input type="number" min={0} max={999} value={q||""} placeholder="0" className="mci" style={{ borderColor: q > 0 ? "#0071E3" : "#E8E8ED", background: q > 0 ? "#F0F7FF" : "#F5F5F7" }} onChange={e=>handleVariantQtyChange(color, t, e.target.value)}/></td>
                                  );})}
                                  <td className="mtc">{rt}</td>
                                </tr>
                              );
                            })}
                            <tr><td style={{ fontWeight: 700, color: "#86868B", textTransform: "uppercase", fontSize: 10 }}>Total</td>{availableTallas.map(t=><td key={`t-${t}`} className="mtc">{tallaTotals[t]||0}</td>)}<td className="mtc" style={{ fontSize: 18 }}>{totalQty}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                      <div style={{ padding: 16, borderRadius: 16, background: "#F5F5F7" }}><div style={{ fontSize: 10, color: "#86868B", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>Colores</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26 }}>{activeColorCount}</div></div>
                      <div style={{ padding: 16, borderRadius: 16, background: "#F0F7FF" }}><div style={{ fontSize: 10, color: "#0071E3", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>Prendas</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26, color: "#0071E3" }}>{totalQty}</div></div>
                    </div>
                  </div>
                )}
                {totalQty > 0 && <div style={card} className="fade-up"><div style={lbl}>Notas <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#AEAEB2" }}>— opcional</span></div><textarea className="cinp" placeholder="Ej: Tengo el arte listo…" value={notas} onChange={e=>setNotas(e.target.value)} rows={3} style={{ resize: "vertical", minHeight: 80 }}/></div>}
                <div style={{ display: "flex", gap: 10 }}><button style={btnOut} onClick={()=>setStep(0)}>← Atrás</button><button style={{ ...btn, flex: 1, opacity: canStep2?1:.35 }} disabled={!canStep2} onClick={()=>setStep(2)}>Posiciones</button></div>
              </div>
            )}

            {/* Step 2 */}
            {step===2 && (
              <div className="fade-up">
                <div style={card}>
                  <div style={{ textAlign: "center", marginBottom: 16 }}><h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 4 }}>¿Dónde va el estampado?</h3></div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
                    {["front","back"].map(s=><button key={s} onClick={()=>setShirtSide(s)} style={{ padding: "8px 20px", borderRadius: 24, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", background: shirtSide===s?"#1D1D1F":"#fff", borderColor: shirtSide===s?"#1D1D1F":"#D2D2D7", color: shirtSide===s?"#fff":"#6E6E73", transition: "all .2s" }}>{s==="front"?"Frente":"Espalda"}</button>)}
                  </div>
                  <ShirtDiagram side={shirtSide} selected={selectedPos} onToggle={k=>setSelectedPos(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k])}/>
                </div>
                <div style={card}>
                  <div style={lbl}>Posiciones</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {PLACEMENTS_INFO.map(p=>{
                      const on = selectedPos.includes(p.key), show = showInfoPos===p.key;
                      return (
                        <div key={p.key}>
                          <div onClick={()=>setSelectedPos(prev=>prev.includes(p.key)?prev.filter(k=>k!==p.key):[...prev,p.key])} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: on?"#F0F7FF":"#FAFAFA", border: `1.5px solid ${on?"#0071E3":"#E8E8ED"}`, borderRadius: 14, cursor: "pointer", transition: "all .2s" }}>
                            <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: on?"#0071E3":"#F5F5F7", border: `1.5px solid ${on?"#0071E3":"#D2D2D7"}` }}>
                              {on && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.8 3L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14, color: on?"#0071E3":"#1D1D1F" }}>{p.label}</div><div style={{ fontSize: 11, color: "#AEAEB2", fontFamily: "'JetBrains Mono'", marginTop: 1 }}>{p.maxW}″ × {p.maxH}″</div></div>
                            <button onClick={e=>{e.stopPropagation();setShowInfoPos(show?null:p.key)}} style={{ background: "#F5F5F7", border: "none", borderRadius: 6, cursor: "pointer", color: "#86868B", fontSize: 13, padding: "3px 7px" }}>ⓘ</button>
                          </div>
                          {show && <div style={{ background: "#F0F7FF", borderRadius: "0 0 12px 12px", padding: "10px 14px", fontSize: 12, color: "#6E6E73", marginTop: -3 }}>{p.desc}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}><button style={btnOut} onClick={()=>setStep(1)}>← Atrás</button><button style={{ ...btn, flex: 1, opacity: canStep3?1:.35 }} disabled={!canStep3} onClick={()=>setStep(3)}>Revisar</button></div>
              </div>
            )}

            {/* Step 3 */}
            {step===3 && (
              <div className="fade-up">
                <div style={{ textAlign: "center", marginBottom: 20 }}><h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>Revisá tu solicitud</h3></div>
                <div style={card}>
                  {[["Nombre",nombre],["WhatsApp",whatsapp||"—"],["Prenda",prenda?.name??"?"],["Prendas provistas por",quienLabel],["Variantes",colorResumen||"—"],["Posiciones",selectedPos.join(", ")],["Total",`${totalQty} prendas`],...(notas?[["Notas",notas]]:[])].map(([k,v])=>(
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #F5F5F7", gap: 12 }}><span style={{ fontSize: 13, color: "#86868B" }}>{k}</span><span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{v}</span></div>
                  ))}
                </div>
                <div style={card}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>¿Cómo querés recibir la cotización?</div>
                  {[["whatsapp","📱","WhatsApp","Directo a tu chat"],["email","📧","Correo",email?`A ${email}`:"Ingresá tu correo"],["download","📄","Descargar","Te notificaremos"]].map(([val,ic,lb,desc])=>(
                    <div key={val} onClick={()=>(val!=="email"||email)&&setDeliveryPref(val)} style={{ ...radio(deliveryPref===val), opacity: val==="email"&&!email?.4:1, cursor: val==="email"&&!email?"not-allowed":"pointer" }}>
                      <div style={dot(deliveryPref===val)}>{deliveryPref===val && <div style={{ width: 10, height: 10, borderRadius: 5, background: "#0071E3" }}/>}</div>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{ic} {lb}</div><div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 1 }}>{desc}</div></div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}><button style={btnOut} onClick={()=>setStep(2)}>← Atrás</button><button style={{ ...btn, flex: 1 }} disabled={submitting} onClick={handleSubmit}>{submitting?"Enviando…":"Enviar solicitud"}</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
