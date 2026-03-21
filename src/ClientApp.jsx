import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PhoneInput from "./PhoneInput.jsx";
import { loadConfigRemote, createCotizacion, getNextNumero } from "./supabase.js";
import { 
  Shirt, 
  CheckCircle2,
  Aperture,
  Maximize,
  Scissors,
  Lightbulb,
  ThermometerSun,
  Sparkles,
  FileImage,
  Blend,
  Search,
  RefreshCcw,
  Snowflake,
  Ban,
  MessageCircle,
  Instagram,
  Facebook,
  Mail,
  MapPin,
  Phone,
  Clock,
  Truck,
  Rocket,
  Briefcase,
  Gift
} from 'lucide-react';

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

// ── INFO PAGE ──
function InfoPage({ businessName, onCotizar, placements, unitSystem }) {
  const [openFaq, setOpenFaq] = useState(null);

  const primary = "#0066cc";
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
  const specCardClass = "info-card-hover info-spec-card";
  const stepCircle = (active) => ({
    width: 64, height: 64, borderRadius: "50%", background: "#fff",
    border: `2px solid ${active ? primary : borderLight}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 22, fontWeight: 700, color: active ? primary : textGray,
    margin: "0 auto 24px",
    boxShadow: active ? `0 0 20px rgba(0,102,204,0.15)` : "none",
  });

  const faqs = [
    { q: "¿Cuánto tiempo tardan en entregar?", a: "Normalmente entregamos en 2 a 3 días hábiles tras confirmar tu diseño y pedido. Si necesitas algo urgente, ¡escríbenos y vemos cómo ayudarte!" },
    { q: "¿Hacen envíos a otras ciudades?", a: "¡Sí! Hacemos envíos a todo Honduras mediante paquetería segura. Si estás en San Pedro Sula, también puedes pasar a recogerlo a nuestro taller." },
    { q: "¿Puedo llevar mi propia ropa para que la estampen?", a: "Por supuesto. Si ya tienes tus prendas, solo asegúrate de que estén nuevas o limpias. Nosotros te vendemos y aplicamos el diseño." },
  ];

  return (
    <div style={{ fontFamily: "'Inter','Outfit',sans-serif", background: bg, color: textMain }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
      <style>{`
        /* ── SHARED ── */
        .info-card-hover { transition: transform 0.3s, box-shadow 0.3s; }
        .info-card-hover:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0,0,0,0.1) !important; }
        .info-btn-primary:hover { filter: brightness(0.88); transform: scale(1.02); }
        .info-btn-sec:hover { background: #e2e8f0 !important; }
        @keyframes infoFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        .info-float { animation: infoFloat 7s ease-in-out infinite; }
        .info-gradient-text {
          background: linear-gradient(135deg, #0066cc 0%, #3399ff 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        /* ── DESKTOP (>1024px): full layout ── */
        .info-two-col   { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
        .info-three-col { display: grid; grid-template-columns: repeat(3,1fr); gap: 24px; }
        .info-four-col  { display: grid; grid-template-columns: repeat(4,1fr); gap: 32px; }
        .info-hero-img  { height: 480px; }
        .info-nav-links { display: flex; }
        
        /* ── TABLET (601–1024px) ── */
        @media(max-width:1024px) and (min-width:601px) {
          .info-two-col   { gap: 40px; }
          .info-three-col { grid-template-columns: 1fr 1fr; }
          .info-four-col  { grid-template-columns: 1fr 1fr; gap: 20px; }
          .info-hero-img  { height: 360px !important; }
          .info-section   { padding: 72px 20px !important; }
          .info-h2        { font-size: clamp(24px,4vw,40px) !important; }
          .info-nav-links { gap: 2px !important; }
          .info-nav-links button { padding: 6px 10px !important; font-size: 11px !important; }
        }

        /* ── MOBILE (≤600px) ── */
        @media(max-width:600px) {
          .info-two-col   { grid-template-columns: 1fr !important; gap: 32px !important; }
          .info-three-col { grid-template-columns: 1fr !important; }
          .info-four-col  { grid-template-columns: 1fr 1fr !important; gap: 16px !important; }
          .info-hero-img  { height: 240px !important; border-radius: 20px !important; }
          .info-section   { padding: 60px 16px !important; }
          .info-hero-sec  { padding: 80px 16px 48px !important; min-height: auto !important; }
          .info-h2        { font-size: clamp(22px,6vw,36px) !important; }
          .info-spec-card { padding: 24px !important; border-radius: 20px !important; }
          .info-nav-full  { display: none !important; }
          .info-nav-cta   { display: flex !important; }
          .info-float     { animation: none !important; }
          .info-step-grid { grid-template-columns: 1fr 1fr !important; gap: 24px !important; }
          .info-footer-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
          .info-img-grid  { grid-template-columns: 1fr !important; gap: 12px !important; }
          .info-img-grid img:last-child { margin-top: 0 !important; }
          .info-placement-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* HERO */}
      <section id="inicio" className="info-hero-sec" style={{ minHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "100px 24px 60px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 800, height: 800, background: `${primary}08`, borderRadius: "50%", filter: "blur(120px)", zIndex: 0, pointerEvents: "none" }}/>
        <span style={{ position: "relative", zIndex: 1, display: "inline-block", background: "#fff", border: `1px solid ${borderLight}`, borderRadius: 50, padding: "6px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: textGray, marginBottom: 28, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          Personalización Textil de Alta Calidad
        </span>
        <h1 style={{ position: "relative", zIndex: 1, fontSize: "clamp(40px,6vw,88px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, color: textMain, marginBottom: 8, maxWidth: 960, margin: "0 auto 8px" }}>
          Ropa única, a tu manera.
        </h1>
        <h2 className="info-gradient-text" style={{ position: "relative", zIndex: 1, fontSize: "clamp(28px,4vw,56px)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 28, maxWidth: 800, margin: "0 auto 20px" }}>
          A todo color y sin que se borre.
        </h2>
        <p style={{ position: "relative", zIndex: 1, fontSize: 18, color: textGray, lineHeight: 1.7, maxWidth: 640, margin: "0 auto 44px", fontWeight: 500 }}>
          Ya sea para empezar tu propia marca o hacer un regalo especial. Estampamos tus ideas con calidad fotográfica, colores súper vivos y sin pedirte cantidades mínimas.
        </p>
        <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginBottom: 64 }}>
          <button className="info-btn-primary" style={btnStyle} onClick={onCotizar}>Cotizar mi idea</button>
          <a href="#ubicaciones" style={{ ...btnSecStyle, textDecoration: "none" }}>Saber más ↓</a>
        </div>
        <div className="info-float" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 900 }}>
          <img
            src="https://images.unsplash.com/photo-1571945153237-4929e783af4a?q=80&w=2000&auto=format&fit=crop"
            alt="Impresión DTF colores vibrantes"
            className="info-hero-img" style={{ width: "100%", height: 480, objectFit: "cover", borderRadius: 40, border: `1px solid ${borderLight}`, boxShadow: "0 20px 60px rgba(0,102,204,0.12)" }}
          />
        </div>
      </section>

      {/* CASOS DE USO */}
      <section style={{ padding: "100px 24px", background: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Hecho a tu medida</p>
          <h2 style={{ fontSize: "clamp(28px,4vw,56px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>¿Para qué lo vas a usar?</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 650, margin: "0 auto" }}>Nuestra tecnología se adapta perfectamente a tu proyecto, sin importar el tamaño o la ocasión.</p>
        </div>
        <div className="info-three-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {[
            { icon: <Rocket width="32" height="32" color={primary} strokeWidth={1.5} />, title: "Tu Marca de Ropa", desc: "Calidad premium para tus futuras colecciones. Dale a tus clientes prendas que no se despintan ni se cuartean con el tiempo." },
            { icon: <Briefcase width="32" height="32" color={primary} strokeWidth={1.5} />, title: "Uniformes de Empresa", desc: "Logos nítidos, colores corporativos exactos y una resistencia increíble para aguantar el trabajo diario de tu equipo." },
            { icon: <Gift width="32" height="32" color={primary} strokeWidth={1.5} />, title: "Regalos y Eventos", desc: "Imprime desde una sola pieza para cumpleaños, viajes familiares, bodas o cualquier detalle especial y único." },
          ].map(({ icon, title, desc }) => (
            <div className={specCardClass} key={title} style={{ ...specCard, background: appleGray, textAlign: "center" }}>
              <div style={{ width: 64, height: 64, background: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>{icon}</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: textMain, marginBottom: 12 }}>{title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: 15 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* UBICACIONES */}
      <section id="ubicaciones" style={{ padding: "100px 24px", background: appleGray, borderTop: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Opciones Ilimitadas</p>
          <h2 style={{ fontSize: "clamp(28px,4vw,56px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>¿Dónde podemos estampar?</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 650, margin: "0 auto" }}>Conoce las ubicaciones y tamaños estándar que manejamos en nuestro taller.</p>
        </div>
        <div className="info-placement-grid" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          {(placements || []).map((p, i) => (
            <div className="info-card-hover" key={i} style={{ background: "#fff", border: `1px solid ${borderLight}`, borderRadius: 24, padding: 32, display: "flex", flexDirection: "column", transition: "all 0.3s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, background: "rgba(0,102,204,0.08)", color: primary, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <CheckCircle2 strokeWidth={2.5} size={24} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: textMain, margin: 0 }}>{p.label || p.name || p.key}</h3>
              </div>
              <p style={{ color: "#64748b", lineHeight: 1.6, fontSize: 15, margin: "0 0 20px 0", flex: 1 }}>{p.desc || "Ubicación ideal para destacar tu marca o diseño."}</p>
              {(p.maxW || p.maxH || p.w || p.h) && (
                <div style={{ background: appleGray, padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, color: textMain, display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start" }}>
                  <Scissors size={14} color={primary} />
                  Máx: {p.maxW || p.w || "?"}×{p.maxH || p.h || "?"} {unitSystem || "in"}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 48 }}>
          <button className="info-btn-primary" style={btnStyle} onClick={onCotizar}>Ir al cotizador ahora</button>
        </div>
      </section>

      {/* QUÉ ES DTF */}
      <section style={{ padding: "120px 24px", background: bg, borderTop: `1px solid ${borderLight}` }}>
        <div className="info-two-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }}>
          <div className="info-img-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <img src="https://images.unsplash.com/photo-1576566588028-4147f3842f27?q=80&w=600&auto=format&fit=crop" alt="Camiseta" style={{ borderRadius: 24, objectFit: "cover", width: "100%", height: 260, border: `1px solid ${borderLight}` }} />
            <img src="https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=600&auto=format&fit=crop" alt="Hoodie" style={{ borderRadius: 24, objectFit: "cover", width: "100%", height: 260, border: `1px solid ${borderLight}`, marginTop: 40 }} />
          </div>
          <div>
            <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>La forma moderna de estampar</p>
            <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 24, color: textMain }}>¿Por qué nuestra tecnología es mejor?</h2>
            <p style={{ fontSize: 18, color: textGray, lineHeight: 1.8, marginBottom: 16, fontWeight: 500 }}>
              Imagina poder imprimir cualquier foto o logo, con todos sus colores, y ponerlo en tu ropa favorita sin que se vea como un parche duro de plástico.
            </p>
            <p style={{ fontSize: 16, color: "#64748b", lineHeight: 1.8 }}>
              A diferencia de la serigrafía o el vinil, imprimimos tu imagen a todo color mediante <strong style={{ color: textMain }}>tecnología DTF</strong> y la fijamos sobre cualquier tela, incluso ropa negra o de algodón puro.
            </p>
          </div>
        </div>
      </section>

      {/* PROCESO */}
      <section id="como-funciona" style={{ padding: "120px 24px", background: appleGray, borderTop: `1px solid ${borderLight}`, borderBottom: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 80 }}>
            <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Es súper sencillo</p>
            <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", color: textMain }}>Los 4 pasos de tu pedido</h2>
          </div>
          <div className="info-four-col info-step-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 40 }}>
            {[
              { icon: <Lightbulb strokeWidth={2} />, title: "1. Cotiza", desc: "Usa nuestra calculadora para elegir la ropa y decirnos qué necesitas.", active: true },
              { icon: <MessageCircle strokeWidth={2} />, title: "2. Envía tu Idea", desc: "Nos mandas tu foto o diseño por WhatsApp para revisar la calidad.", active: false },
              { icon: <ThermometerSun strokeWidth={2} />, title: "3. Estampado", desc: "Imprimimos tu diseño y lo planchamos sobre tu ropa para que se funda.", active: false },
              { icon: <Sparkles strokeWidth={2} />, title: "4. ¡A estrenar!", desc: "Pasas a traer tu pedido o te lo mandamos a tu casa.", active: false },
            ].map(({ icon, title, desc, active }) => (
              <div key={title} style={{ textAlign: "center" }}>
                <div style={stepCircle(active)}>
                  <span style={{ color: active ? primary : textGray, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
                </div>
                <h4 style={{ fontSize: 18, fontWeight: 800, color: textMain, marginBottom: 10 }}>{title}</h4>
                <p style={{ fontSize: 14, color: textGray, lineHeight: 1.7 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GUÍA DE ARCHIVOS */}
      <section style={{ padding: "100px 24px", background: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Antes de enviarnos tu imagen</p>
          <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>¿Cómo enviar tu diseño?</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 650, margin: "0 auto" }}>Para que tu estampado salga nítido, colorido y perfecto, necesitamos que tu archivo cumpla estos 3 requisitos:</p>
        </div>
        <div className="info-three-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {[
            { icon: <FileImage width="40" height="40" color={primary} strokeWidth={1.5} />, title: "Formato PNG", desc: "Es el mejor formato de imagen para impresión. También aceptamos archivos editables de Illustrator (.AI) o PDF." },
            { icon: <Blend width="40" height="40" color={primary} strokeWidth={1.5} />, title: "Fondo Transparente", desc: "¡Muy importante! Asegúrate de que tu imagen no tenga un cuadro blanco de fondo, a menos que quieras que el cuadro blanco se imprima." },
            { icon: <Search width="40" height="40" color={primary} strokeWidth={1.5} />, title: "Buena Resolución", desc: "Si acercas (haces zoom) a tu imagen y se ve borrosa o pixelada, así mismo saldrá en la camisa. Envía imágenes grandes y nítidas." },
          ].map(({ icon, title, desc }) => (
            <div className={specCardClass} key={title} style={{ ...specCard }}>
              <div style={{ marginBottom: 24 }}>{icon}</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: textMain, marginBottom: 12 }}>{title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: 15 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TECH SPECS */}
      <section style={{ padding: "100px 24px", background: appleGray, borderTop: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>Resultados de primera.</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 560, margin: "0 auto" }}>Nos encargamos de toda la parte técnica para entregarte un producto que te va a encantar.</p>
        </div>
        <div className="info-three-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {[
            { icon: <Aperture width="40" height="40" color={primary} strokeWidth={1.5} />, title: "Sin límite de colores", desc: "Puedes poner fotos, sombras y colores vibrantes sin que te cobremos extra por cada color nuevo en tu diseño." },
            { icon: <Maximize width="40" height="40" color={primary} strokeWidth={1.5} />, title: "Súper elástico", desc: "El diseño se estira con la ropa. No se parte, no se pela y aguanta docenas de lavadas luciendo como nuevo." },
            { icon: <Scissors width="40" height="40" color={primary} strokeWidth={1.5} />, title: "En cualquier tela", desc: "Funciona perfecto en algodón, poliéster, mezclilla o cuero. No importa si tu ropa es clara u oscura." },
          ].map(({ icon, title, desc }) => (
            <div className={specCardClass} key={title} style={{ ...specCard, background: "#fff" }}>
              <div style={{ marginBottom: 24 }}>{icon}</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: textMain, marginBottom: 12 }}>{title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: 15 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CUIDADOS */}
      <section id="cuidados" style={{ padding: "100px 24px", background: bg, borderTop: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center", marginBottom: 64 }}>
          <p style={{ color: primary, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontSize: 12, marginBottom: 16 }}>Instrucciones de lavado</p>
          <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 20, color: textMain }}>¿Cómo cuidar tu prenda?</h2>
          <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 600, margin: "0 auto" }}>Si sigues estas simples reglas de oro, tu diseño lucirá como nuevo por muchísimo tiempo.</p>
        </div>
        <div className="info-four-col" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 24 }}>
          {[
            { icon: <RefreshCcw width="32" height="32" color={primary} strokeWidth={2} />, title: "Lavar al revés", desc: "Dale la vuelta a tu camisa antes de meterla a la lavadora para proteger el dibujo." },
            { icon: <Snowflake width="32" height="32" color={primary} strokeWidth={2} />, title: "Agua Fría", desc: "Usa agua fría o tibia. El agua muy caliente puede aflojar el estampado." },
            { icon: <Ban width="32" height="32" color={primary} strokeWidth={2} />, title: "Cero Cloro", desc: "Evita blanqueadores y químicos agresivos que se comen el color de las tintas." },
            { icon: <ThermometerSun width="32" height="32" color={primary} strokeWidth={2} />, title: "No planchar directo", desc: "Nunca pases la plancha caliente directo sobre el logo. Plánchala siempre al revés." },
          ].map(({ icon, title, desc }) => (
            <div className="info-card-hover" key={title} style={{ background: "#fff", border: `1px solid ${borderLight}`, borderRadius: 24, padding: 32, textAlign: "center", transition: "all 0.3s" }}>
              <div style={{ width: 64, height: 64, background: appleGray, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>{icon}</div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: textMain, marginBottom: 12 }}>{title}</h3>
              <p style={{ color: "#64748b", lineHeight: 1.6, fontSize: 14 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "100px 24px", background: "#fff", borderTop: `1px solid ${borderLight}` }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 50 }}>
            <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: "-0.03em", color: textMain }}>Preguntas Frecuentes</h2>
          </div>
          {faqs.map((faq, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${borderLight}`, padding: "24px 0", cursor: "pointer" }} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: textMain, paddingRight: 20 }}>{faq.q}</h4>
                <span style={{ fontSize: 24, fontWeight: 400, color: primary, transition: "transform 0.3s", transform: openFaq === i ? "rotate(45deg)" : "rotate(0)", display: "inline-block" }}>+</span>
              </div>
              {openFaq === i && <p style={{ fontSize: 16, color: textGray, marginTop: 16, lineHeight: 1.7 }}>{faq.a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section style={{ padding: "100px 24px", background: appleGray, borderTop: `1px solid ${borderLight}`, textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px,4vw,52px)", fontWeight: 900, letterSpacing: "-0.03em", color: textMain, marginBottom: 20 }}>¿Listo para crear algo increíble?</h2>
        <p style={{ fontSize: 18, color: textGray, fontWeight: 500, maxWidth: 520, margin: "0 auto 40px" }}>Es rápido y sin compromiso. Usa nuestro cotizador y te daremos el precio exacto por WhatsApp.</p>
        <button className="info-btn-primary" style={{ ...btnStyle, padding: "18px 56px", fontSize: 18 }} onClick={onCotizar}>Cotizar mi idea</button>
      </section>

      {/* FOOTER */}
      <footer style={{ background: "#1d1d1f", color: "#f5f5f7", padding: "80px 24px 40px" }}>
        <div className="info-footer-grid" style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 50, borderBottom: "1px solid #333", paddingBottom: 50, marginBottom: 30 }}>
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 16 }}>{businessName === "DTF" ? "Kromavida" : businessName}</h3>
            <p style={{ fontSize: 14, color: "#9ca3af", lineHeight: 1.7, marginBottom: 24 }}>Especialistas en personalización textil y tecnología de impresión DTF de alta calidad.</p>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="#" style={{ color: "#fff", opacity: 0.7 }}><Instagram strokeWidth={1.5} size={24} /></a>
              <a href="#" style={{ color: "#fff", opacity: 0.7 }}><Facebook strokeWidth={1.5} size={24} /></a>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>Ubicación y Horario</h4>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, color: "#9ca3af", fontSize: 14 }}>
              {[
                [<MapPin size={16} color="#0066cc"/>, "San Pedro Sula, Honduras"],
                [<Clock size={16} color="#0066cc"/>, "L-V: 9:00 AM - 5:00 PM"],
                [<Clock size={16} color="#0066cc"/>, "Sábados: 9:00 AM - 12:00 PM"],
                [<Truck size={16} color="#0066cc"/>, "Envíos a todo el país"],
              ].map(([icon, text], i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>{icon}{text}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 20 }}>Contacto Directo</h4>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, color: "#9ca3af", fontSize: 14 }}>
              <li style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><Phone size={16} color="#0066cc"/> +504 0000-0000</li>
              <li style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}><Mail size={16} color="#0066cc"/> contacto@dtfstudio.com</li>
              <li><button onClick={onCotizar} style={{ background: "transparent", border: "none", color: "#0066cc", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 600 }}>Ir al Cotizador →</button></li>
            </ul>
          </div>
        </div>
        <div style={{ textAlign: "center", color: "#6b7280", fontSize: 13 }}>
          © {new Date().getFullYear()} {businessName === "DTF" ? "Kromavida" : businessName}. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
}

export default function ClientApp() {
  const [page, setPage] = useState("info");
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shirtSide, setShirtSide] = useState("front");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [quoteNum, setQuoteNum] = useState("....");
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [prendaId, setPrendaId] = useState("");
  const [quien, setQuien] = useState("nosotros");
  const [colorRows, setColorRows] = useState([]);
  const [variantQuantities, setVariantQuantities] = useState({});
  const [customColor, setCustomColor] = useState("");
  const [notas, setNotas] = useState("");
  const [selectedPos, setSelectedPos] = useState([]);
  const [deliveryPref, setDeliveryPref] = useState("whatsapp");

  useEffect(() => {
    const init = async () => {
      let r = await loadConfigRemote();
      if (!r) {
        try { const raw = localStorage.getItem("dtf_config_v3"); if (raw) r = JSON.parse(raw); } catch { }
      }
      if (r) setCfg(r);
      const n = await getNextNumero();
      setQuoteNum(n);
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const t = cfg.seoTitle || `${cfg.businessName || "DTF"} — Cotizador`;
    document.title = t;
    const og = document.querySelector('meta[property="og:title"]');
    if (og) og.setAttribute("content", t);
    if (cfg.seoDesc) { const d = document.querySelector('meta[name="description"]'); if (d) d.setAttribute("content", cfg.seoDesc); }
  }, [cfg]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "dtf_config_v3" && e.newValue) {
        try { setCfg(JSON.parse(e.newValue)); } catch { }
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const prendas = cfg?.prendas ?? [];
  const businessName = cfg?.businessName ?? "DTF";
  const whatsappBiz = cfg?.whatsappBiz ?? "";
  const placements = cfg?.placements ?? PLACEMENTS_INFO;
  const unitSystem = cfg?.unitSystem ?? "in";
  const validezDias = cfg?.validezDias ?? 15;
  const prenda = prendas.find(p => p.id === prendaId);
  const availableTallas = prenda?.tallas ?? TALLAS_DEFAULT;
  const baseColors = useMemo(() => uniqueValues(prenda?.colores ?? []), [prenda]);
  const matrixColors = useMemo(() => colorRows.length > 0 ? colorRows : baseColors, [baseColors, colorRows]);
  const variantsByColor = useMemo(() => matrixColors.map(color => { const items = availableTallas.map(t => { const q = Number(variantQuantities[buildVariantKey(color, t)]) || 0; return q > 0 ? { talla: t, qty: q } : null; }).filter(Boolean); return { color, items, total: items.reduce((s, i) => s + i.qty, 0) }; }).filter(g => g.total > 0), [availableTallas, matrixColors, variantQuantities]);
  const totalQty = useMemo(() => variantsByColor.reduce((s, g) => s + g.total, 0), [variantsByColor]);
  const colorResumen = formatVariantSummary(variantsByColor);
  const activeColorCount = variantsByColor.length;

  const resetAll = useCallback(() => { setColorRows([]); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleSelectPrenda = useCallback((p) => { setPrendaId(p.id); setColorRows(uniqueValues(p.colores ?? [])); setVariantQuantities({}); setCustomColor(""); }, []);
  const handleVariantQtyChange = useCallback((c, t, raw) => { const q = Math.max(0, Math.min(999, parseInt(raw, 10) || 0)); setVariantQuantities(prev => { const n = { ...prev }; const k = buildVariantKey(c, t); if (q === 0) delete n[k]; else n[k] = q; return n; }); }, []);
  const handleAddCustomColor = useCallback(() => { const c = customColor.trim(); if (!c) return; if (!matrixColors.some(x => x.toLowerCase() === c.toLowerCase())) setColorRows(prev => [...prev, c]); setCustomColor(""); }, [customColor, matrixColors]);

  const quienLabel = quien === "nosotros" ? "Nosotros la ponemos" : "Cliente provee / Solo impresión";

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const gid = `${prendaId || "prenda"}-${quoteNum}`;
      const lines = variantsByColor.map(g => ({ qty: g.total, prendaLabel: prenda?.name ?? "Prenda", color: g.color, cfgLabel: selectedPos.join(" + "), tallasSummary: g.items.map(i => `${i.talla}:${i.qty}`).join(", "), groupId: gid, groupLabel: prenda?.name ?? "Prenda", quien, variants: g.items.map(i => ({ sku: buildVariantSku({ prendaLabel: prenda?.name ?? "Prenda", color: g.color, talla: i.talla }), color: g.color, talla: i.talla, qty: i.qty })), sellPrice: 0, lineTotal: 0 }));
      const deliveryLabel = deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Descarga";
      await createCotizacion({ numero: quoteNum, cliente: nombre.trim(), email: email.trim(), telefono: whatsapp.trim(), total: 0, estado: "Pendiente", notas: `Pedido web | ${prenda?.name ?? "?"} | Prendas: ${quienLabel} | Variantes: ${colorResumen} | Enviar por: ${deliveryLabel}${notas ? " | Nota: " + notas : ""}`, lines });
      if (whatsappBiz) window.open(`https://wa.me/${whatsappBiz}?text=${encodeURIComponent(`🔔 *Nueva solicitud #${quoteNum}*\n👤 ${nombre}\n👕 ${prenda?.name ?? "?"} (${quienLabel})\n📦 ${totalQty} prendas\n🎨 ${selectedPos.join(", ")}\n📩 Por: *${deliveryLabel}*${notas ? `\n📝 ${notas}` : ""}`)}`, "_blank");
      setSubmitted(true);
    } catch (e) { console.error(e); alert("Error al enviar."); }
    setSubmitting(false);
  };

  const canStep1 = nombre.trim().length >= 2 && whatsapp;
  const canStep2 = prendaId && totalQty > 0;
  const canStep3 = selectedPos.length > 0;

  const C = { bg: "#fff", br: 20, p: "28px 24px", mb: 16, bs: "0 4px 20px rgba(0,0,0,.03)" };
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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both} .cinp{width:100%;background:#F9FAFC;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#111827;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#007AFF;background:#fff;box-shadow: 0 0 0 3px rgba(0,122,255,0.1)} .cinp::placeholder{color:#9CA3AF} .layout-grid{display:grid;grid-template-columns:1fr 340px;gap:40px;align-items:start} @media(max-width:960px){.layout-grid{grid-template-columns:1fr}.sidebar-sticky{position:static!important}} @media(max-width:480px){.mci{width:52px;font-size:14px}}`}</style>
      <div style={{ width: 36, height: 36, border: "2.5px solid #D2D2D7", borderTopColor: "#111827", borderRadius: "50%", animation: "spin .7s linear infinite" }}/>
    </div>
  );

  const handleNavClick = (id) => {
    if (id === "cotizar") { setPage("cotizar"); setSubmitted(false); }
    else {
      setPage("info");
      setTimeout(() => {
        if (id === "inicio") window.scrollTo({ top: 0, behavior: "smooth" });
        else document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const headerNav = (
    <header style={{ background: "rgba(255,255,255,.9)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 clamp(16px,3vw,32px)", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }} onClick={() => handleNavClick("inicio")}>
          <div style={{ background: "#007AFF", padding: 6, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shirt color="#fff" size={18} strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-0.02em", color: "#1d1d1f", fontFamily: "'Inter','Outfit',sans-serif", lineHeight: 1.1 }}>{businessName === "DTF" ? "Kromavida" : businessName}</div>
            <div style={{ fontSize: 10, color: "#86868B", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600 }}>{cfg?.seoSlogan || "Estampado DTF"}</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[["inicio","Inicio"],["ubicaciones","Ubicaciones"],["como-funciona","Cómo funciona"],["cuidados","Cuidados"],["cotizar","Cotizar"]].map(([id, label]) => {
            const isActive = page === "cotizar" ? id === "cotizar" : (page === "info" && id === "inicio");
            return (
              <button key={id} onClick={() => handleNavClick(id)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "1.5px solid transparent", transition: "all .2s", background: isActive ? "#1d1d1f" : "transparent", borderColor: isActive ? "#1d1d1f" : "transparent", color: isActive ? "#fff" : "#4B5563", fontFamily: "'Inter','Outfit',sans-serif" }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "#f5f5f7"; e.currentTarget.style.borderColor = "#e2e8f0"; }}}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}}>
                {label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );

  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#F9FAFC", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`.cinp{width:100%;background:#F9FAFC;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#111827;font-family:'Outfit';outline:none;transition:border .2s} .cinp:focus{border-color:#007AFF;background:#fff} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}} .fade-up{animation:fadeUp .4s ease both}`}</style>
      {headerNav}
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 20px", textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#E8F5E9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <CheckCircle2 width="32" height="32" color="#2E7D32" strokeWidth={2.5} />
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 10 }}>¡Cotización enviada!</h2>
        <p style={{ color: "#6E6E73", fontSize: 15, lineHeight: 1.7, marginBottom: 28 }}>
          Tu número de gestión es <b style={{ color: "#1D1D1F", fontFamily: "'JetBrains Mono'" }}>#{quoteNum}</b>.
        </p>
        <div style={{ ...card, textAlign: "left", padding: "20px 22px" }}>
          {[["Prenda elegida", prenda?.name ?? "?"], ["La ropa la pone", quienLabel], ["Colores y cantidad", colorResumen || "—"], ["Total", `${totalQty} piezas`], ["Comunicación por", deliveryPref === "whatsapp" ? "WhatsApp" : deliveryPref === "email" ? "Correo" : "Llamada"]].map(([k,v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F5F5F7", fontSize: 13 }}>
              <span style={{ color: "#86868B" }}>{k}</span><span style={{ fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{v}</span>
            </div>
          ))}
        </div>
        <button onClick={() => { setSubmitted(false); setStep(0); setPage("cotizar"); setNombre(""); setWhatsapp(""); setEmail(""); setPrendaId(""); resetAll(); setSelectedPos([]); setNotas(""); setQuien("nosotros"); setDeliveryPref("whatsapp"); }} style={btn}>Hacer otra cotización</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFC", color: "#111827", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp .4s ease both}
        .cinp{width:100%;background:#F9FAFC;border:1.5px solid #E8E8ED;border-radius:12px;padding:13px 16px;font-size:15px;color:#111827;font-family:'Outfit';outline:none;transition:border .2s}
        .cinp:focus{border-color:#007AFF;background:#fff;box-shadow:0 0 0 3px rgba(0,122,255,0.1)}
        .cinp::placeholder{color:#9CA3AF}
        /* Layout */
        .layout-grid{display:grid;grid-template-columns:1fr 320px;gap:32px;align-items:start}
        .sidebar-sticky{position:sticky;top:88px;display:flex;flex-direction:column;gap:20px}
        /* Tablet (601–960px): collapse sidebar */
        @media(max-width:960px){
          .layout-grid{grid-template-columns:1fr}
          .sidebar-sticky{position:static!important}
        }
        /* Mobile (≤600px): tighter padding */
        @media(max-width:600px){
          .layout-grid{gap:16px}
          .cinp{padding:11px 14px;font-size:14px}
        }
        @media(max-width:480px){.mci{width:48px;font-size:13px;padding:8px 4px}}
      `}</style>

      {headerNav}
      {page === "info" && <InfoPage businessName={businessName} onCotizar={() => setPage("cotizar")} placements={placements} unitSystem={unitSystem} />}

      {page === "cotizar" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px clamp(16px,3vw,32px)" }}>
          <div className="layout-grid">
            <div style={{ maxWidth: 680, width: "100%", margin: "0 auto" }}>
              <div style={{ paddingBottom: 100 }}>

                {/* STEP 0 */}
                {step === 0 && (
                  <div className="fade-up">
                    <div style={{ textAlign: "center", marginBottom: 24 }}>
                      <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", marginBottom: 8 }}>Empecemos con tu cotización</h2>
                      <p style={{ fontSize: 14, color: "#6E6E73" }}>Es rápido y te mandaremos el precio por WhatsApp.</p>
                    </div>
                    <div style={card}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div><div style={lbl}>Tu Nombre</div><input className="cinp" placeholder="Ej: María García" value={nombre} onChange={e=>setNombre(e.target.value)} autoFocus/></div>
                        <div><div style={lbl}>Número de WhatsApp</div><PhoneInput value={whatsapp} onChange={setWhatsapp} placeholder="Escribe tu número" style={{ height: 48 }} /></div>
                        <div><div style={lbl}>Correo electrónico <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#AEAEB2" }}>— opcional</span></div><input className="cinp" placeholder="correo@ejemplo.com" value={email} onChange={e=>setEmail(e.target.value)} type="email"/></div>
                      </div>
                    </div>
                    <button style={{ ...btn, opacity: canStep1?1:.35 }} disabled={!canStep1} onClick={()=>setStep(1)}>Siguiente paso</button>
                  </div>
                )}

                {/* STEP 1 */}
                {step === 1 && (
                  <div className="fade-up">
                    <div style={card}>
                      <div style={lbl}>1. ¿Qué tipo de ropa estás buscando?</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {prendas.map(p=><button key={p.id} style={chip(prendaId===p.id)} onClick={()=>handleSelectPrenda(p)}>{p.name}</button>)}
                      </div>
                    </div>
                    {prendaId && (
                      <div style={card} className="fade-up">
                        <div style={lbl}>2. ¿Quién pone la ropa?</div>
                        {[["nosotros","👕 Nosotros la ponemos (Recomendado)","Te damos la prenda nuevecita, ya estampada y lista para usar."],["cliente","📦 Yo traigo la ropa / Solo impresión","Nos traes tu ropa para estampar, o te vendemos el papel impreso."]].map(([val,lb,desc])=>(
                          <div key={val} onClick={()=>setQuien(val)} style={radio(quien===val)}>
                            <div style={dot(quien===val)}>{quien===val&&<div style={{ width:10,height:10,borderRadius:5,background:"#0071E3" }}/>}</div>
                            <div><div style={{ fontWeight:600,fontSize:13 }}>{lb}</div><div style={{ fontSize:11,color:"#AEAEB2",marginTop:1 }}>{desc}</div></div>
                          </div>
                        ))}
                      </div>
                    )}
                    {prenda && (
                      <div style={card} className="fade-up">
                        <div style={lbl}>3. Elige los colores y cuántas necesitas</div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                          {(prenda?.colores?.length ? prenda.colores : cfg?.coloresCfg ?? []).filter(c => !matrixColors.includes(c)).map(c => (
                            <button key={c} onClick={() => setColorRows(prev => [...prev, c])} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#F9FAFC", border: "1px solid #E8E8ED", color: "#4B5563", cursor: "pointer" }}>+ {c}</button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                          <input className="cinp" placeholder="Si quieres otro color, escríbelo aquí..." value={customColor} onChange={e=>setCustomColor(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();handleAddCustomColor();}}} style={{ flex:"1 1 180px" }}/>
                          <button style={btnOut} onClick={handleAddCustomColor}>Añadir Color</button>
                        </div>
                        {matrixColors.length === 0 ? (
                          <div style={{ background:"#FFF8E1",borderRadius:12,padding:16,fontSize:13,color:"#F57F17" }}>No has seleccionado ningún color. Añade uno arriba.</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            {matrixColors.map(color => {
                              const rt = availableTallas.reduce((s,t)=>s+(Number(variantQuantities[buildVariantKey(color,t)])||0),0);
                              const isBase = baseColors.some(x=>x.toLowerCase()===color.toLowerCase());
                              return (
                                <div key={color} style={{ background:"#fff",border:"1px solid #E8E8ED",borderRadius:16,padding:16 }}>
                                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,borderBottom:"1px solid #F5F5F7",paddingBottom:12 }}>
                                    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                                      <div style={{ width:24,height:24,borderRadius:"50%",background:"#ccc",border:"1px solid #D2D2D7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff" }}>{color[0].toUpperCase()}</div>
                                      <span style={{ fontWeight:700,fontSize:16 }}>{color}</span>
                                    </div>
                                    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                                      <span style={{ fontSize:14,fontWeight:700,color:rt>0?"#007AFF":"#9CA3AF" }}>{rt} piezas</span>
                                      {!isBase && <button onClick={()=>setColorRows(p=>p.filter(x=>x!==color))} style={{ background:"rgba(248,113,113,.1)",color:"#F87171",border:"none",width:28,height:28,borderRadius:8,cursor:"pointer",fontWeight:700 }}>×</button>}
                                    </div>
                                  </div>
                                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12 }}>
                                    {availableTallas.map(t=>{
                                      const q=Number(variantQuantities[buildVariantKey(color,t)])||0;
                                      return(
                                        <div key={`${color}-${t}`} style={{ display:"flex",flexDirection:"column",gap:6 }}>
                                          <div style={{ fontSize:12,fontWeight:600,color:"#4B5563" }}>Talla {t}</div>
                                          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",background:q>0?"#E5F0FF":"#F9FAFC",border:`1px solid ${q>0?"#007AFF":"#E8E8ED"}`,borderRadius:10,overflow:"hidden",height:44 }}>
                                            <button onClick={()=>handleVariantQtyChange(color,t,Math.max(0,q-1))} style={{ border:"none",background:"transparent",width:44,height:"100%",cursor:"pointer",color:q>0?"#007AFF":"#9CA3AF",fontSize:20,fontWeight:500 }}>-</button>
                                            <input type="number" min={0} max={999} value={q||""} placeholder="0" style={{ width:"100%",height:"100%",textAlign:"center",border:"none",background:"transparent",fontFamily:"'JetBrains Mono'",fontWeight:700,fontSize:16,outline:"none" }} onChange={e=>handleVariantQtyChange(color,t,e.target.value)}/>
                                            <button onClick={()=>handleVariantQtyChange(color,t,q+1)} style={{ border:"none",background:"transparent",width:44,height:"100%",cursor:"pointer",color:q>0?"#007AFF":"#9CA3AF",fontSize:20,fontWeight:500 }}>+</button>
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
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:16 }}>
                          <div style={{ padding:16,borderRadius:16,background:"#F9FAFC" }}><div style={{ fontSize:10,color:"#9CA3AF",textTransform:"uppercase",letterSpacing:".08em",fontWeight:700,marginBottom:4 }}>Colores</div><div style={{ fontFamily:"'JetBrains Mono'",fontWeight:800,fontSize:26 }}>{activeColorCount}</div></div>
                          <div style={{ padding:16,borderRadius:16,background:"#E5F0FF" }}><div style={{ fontSize:10,color:"#007AFF",textTransform:"uppercase",letterSpacing:".08em",fontWeight:700,marginBottom:4 }}>Total prendas</div><div style={{ fontFamily:"'JetBrains Mono'",fontWeight:800,fontSize:26,color:"#007AFF" }}>{totalQty}</div></div>
                        </div>
                      </div>
                    )}
                    {totalQty > 0 && <div style={card} className="fade-up"><div style={lbl}>¿Algún detalle extra? <span style={{ fontWeight:400,textTransform:"none",letterSpacing:0,color:"#AEAEB2" }}>— opcional</span></div><textarea className="cinp" placeholder="Ej: Ya tengo lista la imagen en mi celular..." value={notas} onChange={e=>setNotas(e.target.value)} rows={3} style={{ resize:"vertical",minHeight:80 }}/></div>}
                    <div style={{ display:"flex",gap:10 }}><button style={btnOut} onClick={()=>setStep(0)}>← Atrás</button><button style={{ ...btn,flex:1,opacity:canStep2?1:.35 }} disabled={!canStep2} onClick={()=>setStep(2)}>Siguiente paso</button></div>
                  </div>
                )}

                {/* STEP 2 */}
                {step === 2 && (
                  <div className="fade-up">
                    <div style={card}>
                      <div style={{ textAlign:"center",marginBottom:16 }}><h3 style={{ fontSize:20,fontWeight:800,letterSpacing:"-.02em",marginBottom:4 }}>¿En qué parte de la ropa irá tu diseño?</h3></div>
                      <div style={{ display:"flex",justifyContent:"center",gap:6,marginBottom:14 }}>
                        {["front","back"].map(s=><button key={s} onClick={()=>setShirtSide(s)} style={{ padding:"8px 20px",borderRadius:24,fontSize:12,fontWeight:700,cursor:"pointer",border:"1.5px solid",background:shirtSide===s?"#1D1D1F":"#fff",borderColor:shirtSide===s?"#1D1D1F":"#D2D2D7",color:shirtSide===s?"#fff":"#6E6E73",transition:"all .2s" }}>{s==="front"?"Ver de Frente":"Ver la Espalda"}</button>)}
                      </div>
                      <ShirtDiagram side={shirtSide} selected={selectedPos} onToggle={k=>setSelectedPos(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k])}/>
                    </div>
                    <div style={card}>
                      <div style={lbl}>Haz clic en los lugares donde quieres estampar:</div>
                      <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                        {placements.map(p=>{
                          const on=selectedPos.includes(p.key);
                          return(
                            <div key={p.key} onClick={()=>setSelectedPos(prev=>prev.includes(p.key)?prev.filter(k=>k!==p.key):[...prev,p.key])} style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:on?"#F0F7FF":"#FAFAFA",border:`1.5px solid ${on?"#0071E3":"#E8E8ED"}`,borderRadius:14,cursor:"pointer",transition:"all .2s" }}>
                              <div style={{ width:24,height:24,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:on?"#0071E3":"#F5F5F7",border:`1.5px solid ${on?"#0071E3":"#D2D2D7"}` }}>
                                {on&&<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.8 3L10 3" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </div>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:700,fontSize:15,color:on?"#0071E3":"#1D1D1F" }}>{p.label||p.name||p.key}</div>
                                <div style={{ fontSize:12,color:"#86868B",marginTop:2 }}>{p.desc||"Ubicación ideal para tu diseño"}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:10 }}><button style={btnOut} onClick={()=>setStep(1)}>← Atrás</button><button style={{ ...btn,flex:1,opacity:canStep3?1:.35 }} disabled={!canStep3} onClick={()=>setStep(3)}>Ir al Resumen final</button></div>
                  </div>
                )}

                {/* STEP 3 */}
                {step === 3 && (
                  <div className="fade-up">
                    <div style={{ textAlign:"center",marginBottom:20 }}><h3 style={{ fontSize:22,fontWeight:800,letterSpacing:"-.02em" }}>Casi listo. Revisa tu pedido:</h3></div>
                    <div style={card}>
                      {[["Tu Nombre",nombre],["Tu WhatsApp",whatsapp||"—"],["Prenda Elegida",prenda?.name??"?"],["La ropa la pone",quienLabel],["Colores y Cantidades",colorResumen||"—"],["Áreas a estampar",selectedPos.join(", ")],["Total",`${totalQty} piezas`],...(notas?[["Notas",notas]]:[])].map(([k,v])=>(
                        <div key={k} style={{ display:"flex",justifyContent:"space-between",padding:"11px 0",borderBottom:"1px solid #F9FAFC",gap:12 }}><span style={{ fontSize:13,color:"#4B5563" }}>{k}</span><span style={{ fontSize:13,fontWeight:600,textAlign:"right",maxWidth:"60%",wordBreak:"break-word" }}>{v}</span></div>
                      ))}
                    </div>
                    <div style={card}>
                      <div style={{ fontSize:14,fontWeight:700,marginBottom:14 }}>¿Por dónde prefieres que te contactemos?</div>
                      {[["whatsapp","📱","WhatsApp","Directo y rápido a tu chat"],["email","📧","Correo",email?`A ${email}`:"(Ingresa tu correo en el Paso 1)"],["download","📞","Llamada","Te marcamos a tu número"]].map(([val,ic,lb,desc])=>(
                        <div key={val} onClick={()=>(val!=="email"||email)&&setDeliveryPref(val)} style={{ ...radio(deliveryPref===val),opacity:val==="email"&&!email?0.4:1,cursor:val==="email"&&!email?"not-allowed":"pointer" }}>
                          <div style={dot(deliveryPref===val)}>{deliveryPref===val&&<div style={{ width:10,height:10,borderRadius:5,background:"#007AFF" }}/>}</div>
                          <div><div style={{ fontWeight:600,fontSize:13 }}>{ic} {lb}</div><div style={{ fontSize:11,color:"#9CA3AF",marginTop:1 }}>{desc}</div></div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"flex",gap:10 }}><button style={btnOut} onClick={()=>setStep(2)}>← Atrás</button><button style={{ ...btn,flex:1 }} disabled={submitting} onClick={handleSubmit}>{submitting?"Enviando…":"¡Todo listo! Enviar"}</button></div>
                  </div>
                )}
              </div>
            </div>

            {/* SIDEBAR */}
            <div className="sidebar-sticky">
              <div style={card}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
                  <h3 style={{ fontSize:16,fontWeight:700,margin:0 }}>Tu Pedido Actual</h3>
                  <div style={{ display:"flex",gap:4 }}>
                    {[0,1,2,3].map(i=><div key={i} style={{ height:4,width:16,borderRadius:2,background:i<=step?"#007AFF":"#E8E8ED" }}/>)}
                  </div>
                </div>
                <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                  {[["Prenda",prenda?.name||"—"],["Ubicaciones",selectedPos.length?selectedPos.join(", "):"—"],["Total",totalQty>0?`${totalQty} piezas`:"—"],["Ciudad","San Pedro Sula"]].map(([k,v])=>(
                    <div key={k} style={{ display:"flex",justifyContent:"space-between",fontSize:13,borderBottom:"1px solid #F9FAFC",paddingBottom:8 }}>
                      <span style={{ color:"#4B5563" }}>{k}</span><span style={{ fontWeight:600,fontStyle:"italic",maxWidth:"55%",textAlign:"right" }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:20,background:"#E5F0FF",color:"#007AFF",fontSize:12,fontWeight:600,padding:12,borderRadius:12,textAlign:"center" }}>
                  Revisaremos tu diseño y te daremos el precio exacto sin compromiso.
                </div>
              </div>
              <div style={{ background:"#111827",borderRadius:20,padding:24,color:"#fff" }}>
                <div style={{ width:40,height:40,borderRadius:10,background:"#007AFF",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16 }}>
                  <MessageCircle width="20" height="20" color="#fff" strokeWidth={2.5} />
                </div>
                <h4 style={{ fontSize:18,fontWeight:700,marginBottom:8 }}>¿No sabes qué elegir?</h4>
                <p style={{ fontSize:13,color:"#9CA3AF",lineHeight:1.5,marginBottom:20 }}>Si tienes una idea pero no sabes cómo llenar esto, escríbenos y te ayudamos.</p>
                {whatsappBiz && (
                  <a href={`https://wa.me/${whatsappBiz}?text=Hola, necesito ayuda con una cotización.`} target="_blank" rel="noopener noreferrer" style={{ display:"inline-flex",alignItems:"center",gap:6,color:"#007AFF",fontSize:14,fontWeight:600,textDecoration:"none" }}>
                    Escríbenos por WhatsApp ↗
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
