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
  const primary = "#0066cc";
  const primaryHover = "#005bb5";
  const bg = "#fbfbfd";
  const textMain = "#1d1d1f";
  const textGray = "#86868b";
  const appleGray = "#f5f5f7";
  const borderLight = "#e2e8f0";

  const btnStyle = {
    background: primary, border: "none", borderRadius: 50,
    padding: "16px 40px", fontSize: 16, fontWeight: 700,
    color: "#fff", cursor: "pointer", fontFamily: "'Inter','Outfit',sans-serif",
    boxShadow: "0 8px 24px rgba(0,102,204,0.3)", transition: "all 0.2s",
    display: "inline-flex", alignItems: "center", gap: 8,
  };
  const btnSecStyle = {
    background: appleGray, border: "none", borderRadius: 50,
    padding: "16px 40px", fontSize: 16, fontWeight: 700,
    color: textMain, cursor: "pointer", fontFamily: "'Inter','Outfit',sans-serif",
    transition: "all 0.2s", display: "inline-flex", alignItems: "center", gap: 8,
  };

  const specCard = {
    background: bg, border: `1px solid ${borderLight}`,
    borderRadius: 32, padding: 40,
    boxShadow: "0 4px 20px rgba(0,0,0,0.04)", transition: "all 0.3s",
  };

  const stepCircle = (active) => ({
    width: 64, height: 64, borderRadius: "50%", background: "#fff",
    border: `2px solid ${active ? primary : borderLight}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 22, fontWeight: 700, color: active ? primary : textGray,
    margin: "0 auto 24px",
    boxShadow: active ? `0 0 20px rgba(0,102,204,0.15)` : "none",
  });

  return (
    <div style={{ fontFamily: "'Inter','Outfit',sans-serif", background: bg, color: textMain }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
      <style>{`
        .info-reveal { opacity: 0; transform: translateY(40px); transition: all 1s cubic-bezier(0.16,1,0.3,1); }
        .info-reveal.active { opacity: 1; transform: translateY(0); }
        .info-card-hover:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,0.08) !important; }
        .info-btn-primary:hover { background: #005bb5 !important; transform: scale(1.02); }
        .info-btn-sec:hover { background: #e2e8f0 !important; }
        .info-tr:hover td { background: #f8fafc; }
        @keyframes infoFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-16px)} }
        .info-float { animation: infoFloat 6s ease-in-out infinite; }
        .info-gradient-text {
          background: linear-gradient(135deg, #0066cc 0%, #3399ff 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        @media(max-width:768px){
          .info-two-col { grid-template-columns: 1fr !important; }
          .info-four-col { grid-template-columns: 1fr 1fr !important; }
          .info-hero-h { font-size: clamp(38px,8vw,64px) !important; }
          .info-table { font-size: 13px !important; }
        }
      `}</style>

      {/* ── HERO ── */}
      <section style={{ minHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "100px 24px 60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, background: `${primary}08`, borderRadius: "50%", filter: "blur(120px)", zIndex: 0, pointerEvents: "none" }}/>
        <span style={{ position: "relative", zIndex: 1, display: "inline-block", background: "#fff", border: `1px solid ${borderLight}`, borderRadius: 50, padding: "6px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: textGray, marginBottom: 28, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          Tecnología de punta ahora en Honduras
        </span>
        <h1 className="info-hero-h" style={{ position: "relative", zIndex: 1, fontSize: "clamp(40px,6vw,88px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, color: textMain, marginBottom: 8, maxWidth: 960 }}>
          Impresión sin límites.
        </h1>
        <h2 className="info-gradient-text" style={{ position: "relative", zIndex: 1, fontSize: "clamp(32px,5vw,64px)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 28, maxWidth: 800 }}>
          Calidad Pro.
        </h2>
        <p style={{ position: "relative", zIndex: 1, fontSize: 18, color: textGray, lineHeight: 1.7, maxWidth: 640, margin: "0 auto 44px", fontWeight: 500 }}>
          Ya sea para lanzar tu propia marca de ropa o para imprimir ese diseño único que siempre imaginaste. La tecnología DTF opera desde San Pedro Sula para brindarte impresiones de calidad fotográfica, sin mínimos de compra.
        </p>
        <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="info-btn-primary" style={btnStyle} onClick={onCotizar}>
            Configurar pedido
          </button>
          <a href="#descubre-dtf" style={{ ...btnSecStyle, textDecoration: "none" }}>
            Descubrir más ↓
          </a>
        </div>
        <div className="info-float" style={{ position: "relative", zIndex: 1, marginTop: 64, width: "100%", maxWidth: 900 }}>
          <img
            src="https://images.unsplash.com/photo-1604871000636-074fa5117945?q=80&w=2000&auto=format&fit=crop"
            alt="Impresión DTF colores vibrantes"
            style={{ width: "100%", height: 480, objectFit: "cover", borderRadius: 40, border: `1px solid ${borderLight}`, boxShadow: "0 20px 60px rgba(0,102,204,0.12)" }}
          />
        </div>
      </section>

      {/* ── QUÉ ES EL DTF ── */}
      <section id="descubre-dtf" style={{ padding: "120px 24px", background: "#fff" }}>
        <div className="info-two-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div style={{ order: 2 }}>
            <img
              src="https://images.unsplash.com/photo-1557672172-298e090bd0f1?q=80&w=1000&auto=format&fit=crop"
              alt="Colores vibrantes DTF"
              style={{ borderRadius: 40, objectFit: "cover", width: "100%", height: 480, border: `1px solid ${borderLight}`, boxShadow: "0 8px 40px rgba(0,0,0,0.06)" }}
            />
          </div>
          <div style={{ order: 1 }}>
            <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>La revolución de la impresión</p>
            <h2 style={{ fontSize: "clamp(32px,4vw,52px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 24, color: textMain }}>¿Qué es el DTF?</h2>
            <p style={{ fontSize: 18, color: textGray, lineHeight: 1.8, marginBottom: 20, fontWeight: 500 }}>
              Imagina poder imprimir cualquier fotografía o diseño digital, con todos sus colores, y transferirlo a una prenda con un resultado de calidad comercial.
            </p>
            <p style={{ fontSize: 16, color: "#64748b", lineHeight: 1.8 }}>
              A diferencia de la serigrafía (que cobra por color) o la sublimación (que solo funciona en poliéster blanco), el <strong style={{ color: textMain }}>Direct To Film</strong> rompe las reglas. Imprimimos sobre <strong style={{ color: textMain }}>cualquier tipo de tela y cualquier color de fondo</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* ── ANATOMÍA ── */}
      <section style={{ padding: "120px 24px", background: bg, borderTop: `1px solid ${borderLight}` }}>
        <div className="info-two-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div>
            <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Ingeniería en capas</p>
            <h2 style={{ fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 24, color: textMain }}>Anatomía de una impresión indestructible.</h2>
            <p style={{ fontSize: 18, color: textGray, lineHeight: 1.8, marginBottom: 40, fontWeight: 500 }}>
              Cada transfer DTF es un sándwich de tecnología con capas microscópicas que garantizan colores reales y resistencia a docenas de lavadas.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {[
                { n: "1", bg: "#dbeafe", c: primary, title: "Tintas CMYK de Alta Densidad", desc: "Imprimimos los colores sobre el Film PET para lograr degradados perfectos y calidad fotográfica real." },
                { n: "2", bg: "#f1f5f9", c: "#475569", title: "Máscara de Tinta Blanca (White)", desc: "Una capa sólida de blanco garantiza que tu diseño mantenga su vitalidad incluso en camisetas negras." },
                { n: "3", bg: "#fef3c7", c: "#d97706", title: "Polvo Adhesivo de Poliamida", desc: "Se hornea sobre la tinta húmeda. Fusiona el diseño permanentemente con las fibras de tu prenda." },
              ].map(({ n, bg: nbg, c, title, desc }) => (
                <div key={n} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: nbg, color: c, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{n}</div>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 700, color: textMain, marginBottom: 4 }}>{title}</h4>
                    <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: 40, background: appleGray, transform: "rotate(6deg)", border: `1px solid ${borderLight}` }}/>
            <div style={{ position: "absolute", inset: 0, borderRadius: 40, background: `linear-gradient(135deg,${primary}18,transparent)`, transform: "rotate(-3deg)", border: `1px solid ${primary}30` }}/>
            <div style={{ position: "relative", borderRadius: 40, background: "#fff", border: `1px solid ${borderLight}`, boxShadow: "0 20px 60px rgba(0,0,0,0.08)", overflow: "hidden", aspectRatio: "1/1" }}>
              <img
                src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop"
                alt="Detalle de capas impresas"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)" }}/>
              <div style={{ position: "absolute", bottom: 32, left: 32, color: "#fff" }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#60a5fa", marginBottom: 6 }}>Resultado Final</p>
                <p style={{ fontSize: 22, fontWeight: 800 }}>Acabado Premium</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMPARATIVA ── */}
      <section style={{ padding: "120px 24px", background: appleGray, borderTop: `1px solid ${borderLight}`, borderBottom: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 16, color: textMain }}>Por qué DTF es el nuevo estándar.</h2>
            <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 560, margin: "0 auto" }}>La mejor decisión tecnológica, ya sea que necesites una sola prenda o producir cientos para tu empresa.</p>
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 16 }}>
            <div style={{ minWidth: 700, background: "#fff", borderRadius: 32, border: `1px solid ${borderLight}`, boxShadow: "0 8px 40px rgba(0,0,0,0.06)", padding: "40px 48px" }}>
              <table className="info-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ paddingBottom: 24, textAlign: "left", fontSize: 12, fontWeight: 700, color: textGray, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1px solid ${borderLight}`, width: "28%" }}>Característica</th>
                    <th style={{ paddingBottom: 24, textAlign: "left", fontSize: 18, fontWeight: 900, color: primary, borderBottom: `1px solid ${borderLight}`, width: "24%" }}>DTF (Nosotros)</th>
                    <th style={{ paddingBottom: 24, textAlign: "left", fontSize: 16, fontWeight: 700, color: "#94a3b8", borderBottom: `1px solid ${borderLight}`, width: "24%" }}>Serigrafía</th>
                    <th style={{ paddingBottom: 24, textAlign: "left", fontSize: 16, fontWeight: 700, color: "#94a3b8", borderBottom: `1px solid ${borderLight}`, width: "24%" }}>Sublimación</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Colores", <span style={{fontWeight:700,color:textMain}}>Sin límites / Fotográfico</span>, <span style={{fontSize:14,color:"#64748b"}}>Limitado (por color)</span>, <span style={{fontSize:14,color:"#64748b"}}>Sin límites</span>],
                    ["Telas", <span style={{fontWeight:700,color:textMain}}>Algodón, Poly, Mezclas, Cuero</span>, <span style={{fontSize:14,color:"#64748b"}}>Mayoría de telas</span>, <span style={{fontSize:14,color:"#e11d48"}}>Solo Poliéster</span>],
                    ["Prendas oscuras", <span style={{fontWeight:700,color:textMain}}>✓ Excelente</span>, <span style={{fontSize:14,color:"#64748b"}}>✓ Bueno</span>, <span style={{fontSize:14,color:"#e11d48"}}>✗ No funciona</span>],
                    ["Entrega", <span style={{fontWeight:700,color:textMain}}>24–48h Nacional</span>, <span style={{fontSize:14,color:"#64748b"}}>Sujeto a taller</span>, <span style={{fontSize:14,color:"#64748b"}}>Sujeto a taller</span>],
                    ["Pedido mínimo", <span style={{fontWeight:700,color:textMain}}>✓ Desde 1 unidad</span>, <span style={{fontSize:14,color:"#e11d48"}}>✗ Alto (50+ unid.)</span>, <span style={{fontSize:14,color:"#64748b"}}>✓ Desde 1 unidad</span>],
                  ].map(([feat, dtf, seri, sub], i) => (
                    <tr className="info-tr" key={i}>
                      <td style={{ padding: "20px 0", borderBottom: i < 4 ? `1px solid ${borderLight}` : "none", fontWeight: 700, color: textMain, fontSize: 14 }}>{feat}</td>
                      <td style={{ padding: "20px 0", borderBottom: i < 4 ? `1px solid ${borderLight}` : "none" }}>{dtf}</td>
                      <td style={{ padding: "20px 0", borderBottom: i < 4 ? `1px solid ${borderLight}` : "none" }}>{seri}</td>
                      <td style={{ padding: "20px 0", borderBottom: i < 4 ? `1px solid ${borderLight}` : "none" }}>{sub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── TECH SPECS ── */}
      <section style={{ padding: "120px 24px", background: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <h2 style={{ fontSize: "clamp(28px,4vw,56px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>Especificaciones de grado industrial.</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 560, margin: "0 auto" }}>Tecnología de punta operada por expertos locales. Resultados internacionales accesibles para todos.</p>
        </div>
        <div className="info-two-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {[
            { icon: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={primary} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10z"/></svg>, title: "Gama Infinita", desc: "Impresión CMYK + Blanco puro. Degradados perfectos, tonos neón vibrantes y sombras fotorrealistas sin costo extra por color." },
            { icon: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={primary} strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>, title: "Flexibilidad Extrema", desc: "Tinta elástica que se mueve con la tela. No se agrieta ni se cuartea. Soporta más de 50 lavadas industriales manteniendo su vitalidad." },
            { icon: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={primary} strokeWidth="1.5"><path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/></svg>, title: "Cualquier Superficie", desc: "Algodón, poliéster, nylon, cuero, mezclilla o mezclas. Funciona sobre fondos oscuros o claros con la misma opacidad y brillo." },
          ].map(({ icon, title, desc }) => (
            <div className="info-card-hover" key={title} style={{ ...specCard }}>
              <div style={{ marginBottom: 24 }}>{icon}</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: textMain, marginBottom: 12 }}>{title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: 15 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── EL PROCESO ── */}
      <section style={{ padding: "120px 24px", background: "#fff", borderTop: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 80 }}>
            <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", color: textMain }}>El Proceso {businessName || "Kromavida"}.</h2>
          </div>
          <div className="info-four-col" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 40 }}>
            {[
              { n: 1, title: "Diseño", desc: "Envías tu arte digital en alta resolución (PNG sin fondo, 300 dpi mínimo).", active: true },
              { n: 2, title: "Impresión PET", desc: "Imprimimos sobre el film con tintas CMYK + capa blanca pura.", active: false },
              { n: 3, title: "Curado", desc: "Aplicamos polvo adhesivo y horneamos para sellar los pigmentos definitivamente.", active: false },
              { n: 4, title: "Logística", desc: "Retiro en nuestra planta en SPS, o despachos seguros a los 18 departamentos del país.", active: false },
            ].map(({ n, title, desc, active }) => (
              <div key={n} style={{ textAlign: "center" }}>
                <div style={stepCircle(active)}>{n}</div>
                <h4 style={{ fontSize: 18, fontWeight: 800, color: textMain, marginBottom: 10 }}>{title}</h4>
                <p style={{ fontSize: 13, color: textGray, lineHeight: 1.7 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ padding: "100px 24px", background: bg, borderTop: `1px solid ${borderLight}`, textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px,4vw,52px)", fontWeight: 900, letterSpacing: "-0.03em", color: textMain, marginBottom: 20 }}>
          ¿Listo para crear algo increíble?
        </h2>
        <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 520, margin: "0 auto 40px" }}>
          Sin compromisos. Configura tu pedido y recibe una cotización detallada en menos de 24 horas.
        </p>
        <button className="info-btn-primary" style={{ ...btnStyle, padding: "18px 56px", fontSize: 18 }} onClick={onCotizar}>
          Configurar pedido
        </button>
      </section>
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

  useEffect(() => {
    const init = async () => {
      // First try to load from Supabase
      let r = await loadConfigRemote();
      // If no remote config, try to load from localStorage (same as Admin)
      if (!r) {
        try {
          const raw = localStorage.getItem("dtf_config_v3");
          if (raw) r = JSON.parse(raw);
        } catch { /* ignore */ }
      }
      if (r) setCfg(r);
      const n = await getNextNumero();
      setQuoteNum(n);
      setLoading(false);
    };
    init();
  }, []);
  useEffect(() => { if (!cfg) return; const t = cfg.seoTitle || `${cfg.businessName || "DTF"} — Cotizador`; document.title = t; const og = document.querySelector('meta[property="og:title"]'); if (og) og.setAttribute("content", t); if (cfg.seoDesc) { const d = document.querySelector('meta[name="description"]'); if (d) d.setAttribute("content", cfg.seoDesc); } }, [cfg]);

  // Set up storage event listener for real-time sync with Admin app in the same browser
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "dtf_config_v3" && e.newValue) {
        try {
          const newCfg = JSON.parse(e.newValue);
          setCfg(newCfg);
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

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

  const unitSystem = cfg?.unitSystem ?? "in";
  const C = { // card
    bg: "#fff", br: 20, p: "28px 24px", mb: 16, bs: "0 4px 20px rgba(0,0,0,.03)"
  };
  const card = { background: C.bg, borderRadius: C.br, padding: C.p, marginBottom: C.mb, boxShadow: C.bs, border: "1px solid #E8E8ED" };
  const lbl = { fontSize: 12, fontWeight: 600, color: "#4B5563", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" };
  const btn = { background: "#007AFF", border: "none", borderRadius: 14, padding: "16px 32px", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer", width: "100%", fontFamily: "'Outfit'" };
  const btnOut = { background: "transparent", border: "1.5px solid #D2D2D7", borderRadius: 14, padding: "15px 22px", fontSize: 14, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "'Outfit'" };
  const chip = (on) => ({ display: "inline-flex", alignItems: "center", padding: "10px 20px", borderRadius: 28, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1.5px solid", transition: "all .2s", userSelect: "none", background: on ? "#E5F0FF" : "#fff", borderColor: on ? "#007AFF" : "#E8E8ED", color: on ? "#007AFF" : "#4B5563" });
  const radio = (on) => ({ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: on ? "#E5F0FF" : "#F9FAFC", border: `1.5px solid ${on ? "#007AFF" : "#E8E8ED"}`, borderRadius: 14, cursor: "pointer", marginBottom: 8, transition: "all .2s" });
  const dot = (on) => ({ width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "#007AFF" : "#D2D2D7"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#F9FAFC", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit'" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} :root{--accent:#007AFF;--accent-dim:#E5F0FF;--bg:#F9FAFC;--bg2:#fff;--bg3:#F5F5F7;--border:#E8E8ED;--border2:#E8E8ED;--text:#111827;--text2:#4B5563;--text3:#9CA3AF} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both} .cinp{width:100%;background:#F9FAFC;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#111827;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#007AFF;background:#fff} .cinp::placeholder{color:#9CA3AF} .matrix-wrap{overflow:auto;border-radius:16px;background:#fff;border:1px solid #E8E8ED} .matrix-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0} .matrix-table th,.matrix-table td{padding:12px 10px;border-right:1px solid #F5F5F7;border-bottom:1px solid #F5F5F7;text-align:center} .matrix-table thead th{position:sticky;top:0;background:#F9FAFC;z-index:2} .matrix-table th:first-child,.matrix-table td:first-child{position:sticky;left:0;text-align:left;background:#fff;z-index:1} .matrix-table thead th:first-child{z-index:3;background:#F9FAFC} .matrix-table th{font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em} .mci{width:60px;background:#F9FAFC;border:1.5px solid #E8E8ED;border-radius:10px;padding:10px 6px;text-align:center;font-size:16px;font-weight:700;font-family:'JetBrains Mono';color:#111827;outline:none;transition:all .2s} .mci:focus{border-color:#007AFF;background:#fff} .mtc{background:#E5F0FF;font-family:'JetBrains Mono';font-weight:700;color:#007AFF}`}</style>
      <div style={{ width: 36, height: 36, border: "2.5px solid #D2D2D7", borderTopColor: "#111827", borderRadius: "50%", animation: "spin .7s linear infinite" }}/>
    </div>
  );

  const headerNav = (
    <header style={{ background: "rgba(245,245,247,.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid #E8E8ED", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 clamp(20px, 4vw, 40px)", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} onClick={() => { setPage("info"); setSubmitted(false); }}>
          <div style={{ background: "#007AFF", width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-.02em", margin: 0 }}>{businessName === "DTF" ? "Kromavida" : businessName}</h1>
            <p style={{ fontSize: 10, color: "#86868B", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600, margin: 0 }}>{cfg?.seoSlogan || "Estampado DTF"}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["info", "Info"], ["cotizar", "Cotizar"]].map(([k, l]) => (
            <button key={k} onClick={() => { setPage(k); if (k === "cotizar") setSubmitted(false); }}
              style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid", transition: "all .2s",
                background: page === k ? "#111827" : "transparent", borderColor: page === k ? "#111827" : "#D2D2D7", color: page === k ? "#fff" : "#4B5563" }}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </header>
  );

  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#F9FAFC", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      {headerNav}
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
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
    <div style={{ minHeight: "100vh", background: "#F9FAFC", color: "#111827", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`:root{--accent:#007AFF;--accent-dim:#E5F0FF;--bg:#F9FAFC;--bg2:#fff;--bg3:#F5F5F7;--border:#E8E8ED;--border2:#E8E8ED;--text:#111827;--text2:#4B5563;--text3:#9CA3AF} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both} .cinp{width:100%;background:#F9FAFC;border:1px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#111827;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#007AFF;background:#fff;box-shadow: 0 0 0 3px rgba(0,122,255,0.1)} .cinp::placeholder{color:#9CA3AF} .matrix-wrap{overflow:auto;border-radius:16px;background:#fff;border:1px solid #E8E8ED} .matrix-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0} .matrix-table th,.matrix-table td{padding:12px 10px;border-right:1px solid #F5F5F7;border-bottom:1px solid #F5F5F7;text-align:center} .matrix-table thead th{position:sticky;top:0;background:#F9FAFC;z-index:2} .matrix-table th:first-child,.matrix-table td:first-child{position:sticky;left:0;text-align:left;background:#fff;z-index:1} .matrix-table thead th:first-child{z-index:3;background:#F9FAFC} .matrix-table th{font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.08em} .matrix-table tr:last-child td{border-bottom:none} .matrix-table th:last-child,.matrix-table td:last-child{border-right:none} .mci{width:60px;background:#F9FAFC;border:1px solid #E8E8ED;border-radius:10px;padding:10px 6px;text-align:center;font-size:16px;font-weight:700;font-family:'JetBrains Mono';color:#111827;outline:none;transition:all .2s} .mci:focus{border-color:#007AFF;background:#fff;box-shadow: 0 0 0 3px rgba(0,122,255,0.1)} .mtc{background:#E5F0FF;font-family:'JetBrains Mono';font-weight:700;color:#007AFF} .layout-grid { display: grid; grid-template-columns: 1fr 340px; gap: 40px; alignItems: start; } .sidebar-sticky { position: sticky; top: 100px; display: flex; flexDirection: column; gap: 24px; } @media(max-width:960px){ .layout-grid { grid-template-columns: 1fr; } .sidebar-sticky { position: static; } } @media(max-width:480px){.mci{width:52px;font-size:14px}}`}</style>

      {headerNav}

      {page === "info" && <InfoPage businessName={businessName} onCotizar={() => setPage("cotizar")} />}

      {page === "cotizar" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px clamp(20px, 4vw, 40px)" }}>
          <div className="layout-grid">
            <div style={{ maxWidth: 680, width: "100%", margin: "0 auto" }}>

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
                      {/* Suggestion Chips */}
                      {cfg?.coloresCfg?.filter(c => !matrixColors.includes(c)).map(c => (
                        <button key={c} onClick={() => setColorRows(prev => [...prev, c])}
                          style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#F9FAFC", border: "1px solid #E8E8ED", color: "#4B5563", cursor: "pointer", transition: "all 0.2s" }}>
                          + {c}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                      <input className="cinp" placeholder="Agregar otro color..." value={customColor} onChange={e=>setCustomColor(e.target.value)} onKeyDown={e=>{ if (e.key==="Enter") { e.preventDefault(); handleAddCustomColor(); }}} style={{ flex: "1 1 180px" }}/>
                      <button style={btnOut} onClick={handleAddCustomColor}>Añadir</button>
                    </div>
                    {matrixColors.length === 0 ? (
                      <div style={{ background: "#FFF8E1", borderRadius: 12, padding: 16, fontSize: 13, color: "#F57F17" }}>Sin colores. Agregá uno.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {matrixColors.map(color => {
                          const rt = availableTallas.reduce((s,t) => s + (Number(variantQuantities[buildVariantKey(color, t)]) || 0), 0);
                          const isBase = baseColors.some(x => x.toLowerCase() === color.toLowerCase());
                          return (
                            <div key={color} style={{ background: "#fff", border: "1px solid #E8E8ED", borderRadius: 16, padding: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, borderBottom: "1px solid #F5F5F7", paddingBottom: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: color.toLowerCase() === "blanco" ? "#fff" : color.toLowerCase() === "negro" ? "#000" : "#ccc", border: "1px solid #D2D2D7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: color.toLowerCase() === "blanco" ? "#000" : "#fff" }}>
                                    {color[0].toUpperCase()}
                                  </div>
                                  <span style={{ fontWeight: 700, fontSize: 16, color: "#111827" }}>{color}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: rt > 0 ? "#007AFF" : "#9CA3AF" }}>{rt} u</span>
                                  {!isBase && <button onClick={()=>setColorRows(p=>p.filter(x=>x!==color))} style={{ background: "rgba(248,113,113,.1)", color: "#F87171", border: "none", width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>×</button>}
                                </div>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
                                {availableTallas.map(t => {
                                  const q = Number(variantQuantities[buildVariantKey(color, t)]) || 0;
                                  return (
                                    <div key={`${color}-${t}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "#4B5563" }}>Talla {t}</div>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: q > 0 ? "#E5F0FF" : "#F9FAFC", border: `1px solid ${q > 0 ? "#007AFF" : "#E8E8ED"}`, borderRadius: 10, overflow: "hidden", height: 44 }}>
                                        <button onClick={() => handleVariantQtyChange(color, t, Math.max(0, q - 1))} style={{ border: "none", background: "transparent", width: 44, height: "100%", cursor: "pointer", color: q > 0 ? "#007AFF" : "#9CA3AF", fontSize: 20, fontWeight: 500 }}>-</button>
                                        <input type="number" min={0} max={999} value={q||""} placeholder="0" style={{ width: "100%", height: "100%", textAlign: "center", border: "none", background: "transparent", fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 16, color: "#111827", outline: "none" }} onChange={e=>handleVariantQtyChange(color, t, e.target.value)}/>
                                        <button onClick={() => handleVariantQtyChange(color, t, q + 1)} style={{ border: "none", background: "transparent", width: 44, height: "100%", cursor: "pointer", color: q > 0 ? "#007AFF" : "#9CA3AF", fontSize: 20, fontWeight: 500 }}>+</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                      <div style={{ padding: 16, borderRadius: 16, background: "#F9FAFC" }}><div style={{ fontSize: 10, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>Colores</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26 }}>{activeColorCount}</div></div>
                      <div style={{ padding: 16, borderRadius: 16, background: "#E5F0FF" }}><div style={{ fontSize: 10, color: "#007AFF", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginBottom: 4 }}>Prendas</div><div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 26, color: "#007AFF" }}>{totalQty}</div></div>
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
                            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14, color: on?"#0071E3":"#1D1D1F" }}>{p.label}</div><div style={{ fontSize: 11, color: "#AEAEB2", fontFamily: "'JetBrains Mono'", marginTop: 1 }}>{p.maxW}{unitSystem==="cm"?"cm":"″"} × {p.maxH}{unitSystem==="cm"?"cm":"″"}</div></div>
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
                <div style={{ textAlign: "center", marginBottom: 20 }}><h3 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: "#111827" }}>Revisá tu solicitud</h3></div>
                <div style={card}>
                  {[["Nombre",nombre],["WhatsApp",whatsapp||"—"],["Prenda",prenda?.name??"?"],["Prendas provistas por",quienLabel],["Variantes",colorResumen||"—"],["Posiciones",selectedPos.join(", ")],["Total",`${totalQty} prendas`],...(notas?[["Notas",notas]]:[])].map(([k,v])=>(
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid #F9FAFC", gap: 12 }}><span style={{ fontSize: 13, color: "#4B5563" }}>{k}</span><span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", maxWidth: "60%", wordBreak: "break-word", color: "#111827" }}>{v}</span></div>
                  ))}
                </div>
                <div style={card}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#111827" }}>¿Cómo querés recibir la cotización?</div>
                  {[["whatsapp","📱","WhatsApp","Directo a tu chat"],["email","📧","Correo",email?`A ${email}`:"Ingresá tu correo"],["download","📄","Descargar","Te notificaremos"]].map(([val,ic,lb,desc])=>(
                    <div key={val} onClick={()=>(val!=="email"||email)&&setDeliveryPref(val)} style={{ ...radio(deliveryPref===val), opacity: val==="email"&&!email?0.4:1, cursor: val==="email"&&!email?"not-allowed":"pointer" }}>
                      <div style={dot(deliveryPref===val)}>{deliveryPref===val && <div style={{ width: 10, height: 10, borderRadius: 5, background: "#007AFF" }}/>}</div>
                      <div><div style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{ic} {lb}</div><div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{desc}</div></div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}><button style={btnOut} onClick={()=>setStep(2)}>← Atrás</button><button style={{ ...btn, flex: 1 }} disabled={submitting} onClick={handleSubmit}>{submitting?"Enviando…":"Enviar solicitud"}</button></div>
              </div>
            )}
          </div>
          </div>
          <div className="sidebar-sticky">
            {/* Resumen Sidebar */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#111827" }}>Solicitud de Presupuesto</h3>
                <div style={{ display: "flex", gap: 4 }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{ height: 4, width: 16, borderRadius: 2, background: i <= step ? "#007AFF" : "#E8E8ED" }} />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid #F9FAFC", paddingBottom: 8 }}>
                  <span style={{ color: "#4B5563" }}>Prenda</span>
                  <span style={{ fontWeight: 600, color: "#111827", fontStyle: "italic" }}>{prenda?.name || "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid #F9FAFC", paddingBottom: 8 }}>
                  <span style={{ color: "#4B5563" }}>Impresión</span>
                  <span style={{ fontWeight: 600, color: "#111827", fontStyle: "italic" }}>{selectedPos.length ? selectedPos.join(", ") : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid #F9FAFC", paddingBottom: 8 }}>
                  <span style={{ color: "#4B5563" }}>Cantidad</span>
                  <span style={{ fontWeight: 600, color: "#111827", fontStyle: "italic" }}>{totalQty > 0 ? `${totalQty} unidades` : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid #F9FAFC", paddingBottom: 8 }}>
                  <span style={{ color: "#4B5563" }}>Ubicación</span>
                  <span style={{ fontWeight: 600, color: "#111827", fontStyle: "italic" }}>San Pedro Sula</span>
                </div>
              </div>
              <div style={{ marginTop: 24, background: "#E5F0FF", color: "#007AFF", fontSize: 12, fontWeight: 600, padding: "12px", borderRadius: 12, textAlign: "center" }}>
                Cotización sujeta a revisión técnica
              </div>
            </div>

            {/* Help Widget */}
            <div style={{ background: "#111827", borderRadius: 20, padding: 24, color: "#fff", position: "relative", overflow: "hidden" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#007AFF", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              </div>
              <h4 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>¿Necesitas ayuda?</h4>
              <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.5, marginBottom: 20 }}>Nuestro equipo técnico está listo para asesorarte en tu proyecto de impresión.</p>
              {whatsappBiz && (
                <a href={`https://wa.me/${whatsappBiz}?text=Hola, necesito ayuda con una cotización.`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#007AFF", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                  Chatear en WhatsApp ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
