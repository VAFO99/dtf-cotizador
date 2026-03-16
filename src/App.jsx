import { useState, useMemo, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "dtf_config_v1";

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); return true; }
  catch { return false; }
}

const uid = () => Math.random().toString(36).slice(2, 8);

const INIT_PRENDAS = [
  { id: uid(), name: "Camisa", cost: 60 },
  { id: uid(), name: "Hoodie", cost: 180 },
];

// Polyamida: estándar industria DTF = 120 g/m² = 0.0774 g/in²
// Fórmula: ancho_in × alto_in × 0.0774
const calcPoli = (w, h) => parseFloat((w * h * 0.0774).toFixed(2));

const INIT_PLACEMENTS = [
  { id: uid(), label: "Front",    w: 10,  h: 12,  color: "#C45C3B" },
  { id: uid(), label: "Back",     w: 10,  h: 14,  color: "#3B7CC4" },
  { id: uid(), label: "LC",       w: 3.5, h: 3.5, color: "#8B6B3E" },
  { id: uid(), label: "RC",       w: 3.5, h: 3.5, color: "#A68B4E" },
  { id: uid(), label: "Manga L",  w: 3.5, h: 12,  color: "#6B8B3E" },
  { id: uid(), label: "Manga R",  w: 3.5, h: 12,  color: "#5B7B2E" },
  { id: uid(), label: "Nape",     w: 3.5, h: 2,   color: "#7B5EA7" },
  { id: uid(), label: "Bolsillo", w: 3,   h: 3,   color: "#5E9EA7" },
  { id: uid(), label: "Front OS", w: 12,  h: 16,  color: "#D46A4B" },
  { id: uid(), label: "Back OS",  w: 14,  h: 18,  color: "#4B8AD4" },
];

const INIT_SHEETS = [
  { id: uid(), name: "A4", w: 8.21, h: 11.69, price: 45 },
  { id: uid(), name: "A3", w: 11.69, h: 16.54, price: 95 },
  { id: uid(), name: "TAB", w: 11, h: 17, price: 100 },
  { id: uid(), name: "A3+", w: 12.95, h: 19.02, price: 110 },
  { id: uid(), name: '12.7×39"', w: 12.7, h: 39, price: 200 },
  { id: uid(), name: '23×24"', w: 23, h: 24, price: 215 },
  { id: uid(), name: '23×39"', w: 23, h: 39, price: 345 },
  { id: uid(), name: '23×100"', w: 23, h: 100, price: 860 },
];

const INIT_DESIGN = [
  { id: "d0", label: "No necesita", price: 0, desc: "" },
  { id: uid(), label: "Texto simple", price: 50, desc: "Nombre, frase, fecha" },
  { id: uid(), label: "Logo sencillo", price: 100, desc: "1-2 colores, formas simples" },
  { id: uid(), label: "Tipografía/efectos", price: 150, desc: "Texto estilizado con sombras, outlines" },
  { id: uid(), label: "Foto-composición", price: 150, desc: "Collage, montaje fotográfico" },
  { id: uid(), label: "Ilustración custom", price: 300, desc: "Arte original desde cero" },
  { id: uid(), label: "Adaptación", price: 75, desc: "Adaptar arte existente a DTF" },
  { id: uid(), label: "Front+Back conjunto", price: 200, desc: "Diseño coordinado frente y espalda" },
  { id: uid(), label: "Paquete completo", price: 350, desc: "F+B+LC+más, branding completo" },
  { id: uid(), label: "Vectorización", price: 100, desc: "Convertir imagen a vector limpio" },
];

const INIT_FIX = [
  { id: "f0", label: "Listo para DTF", price: 0, desc: "Vector o PNG 300DPI con transparencia" },
  { id: uid(), label: "Ajuste menor", price: 25, desc: "Sin fondo, Word/JPG, tamaño incorrecto — 1 problema" },
  { id: uid(), label: "Ajuste estándar", price: 50, desc: "Baja res, bordes sucios, colores mal — 2+ problemas" },
  { id: uid(), label: "Muchos problemas", price: 75, desc: "Imagen destruida, combo de 3+ issues" },
];

const INIT_VOL = [
  { id: uid(), minQty: 1, maxQty: 3, label: "Normal", desc: "Todo se cobra normal", discPct: 0, designDisc: 0, fixFree: false },
  { id: uid(), minQty: 4, maxQty: 9, label: "4-9", desc: "Corrección GRATIS", discPct: 0, designDisc: 0, fixFree: true },
  { id: uid(), minQty: 10, maxQty: 19, label: "10-19", desc: "Corrección gratis + Diseño 50% + 5% descuento", discPct: 5, designDisc: 50, fixFree: true },
  { id: uid(), minQty: 20, maxQty: 9999, label: "20+", desc: "Todo INCLUIDO + 10% descuento", discPct: 10, designDisc: 100, fixFree: true },
];

const GAP = 0.25;
const EDGE = 0.15; // margin from sheet edge

// ── SHELF PACKING ──
function shelfPack(pieces, sw, sh) {
  // Reduce usable area by edge margins
  const uw = sw - EDGE * 2, uh = sh - EDGE * 2;
  if (!pieces.length) return { fits: false, placed: [] };
  const sorted = [...pieces].sort((a, b) => b.h - a.h || b.w - a.w);
  const shelves = []; let curY = 0; const placed = [];
  for (const p of sorted) {
    let did = false;
    for (const s of shelves) {
      if (s.x + p.w + GAP <= uw + 0.01 && p.h <= s.h + 0.01) {
        placed.push({ ...p, x: s.x + EDGE, y: s.y + EDGE }); s.x += p.w + GAP; did = true; break;
      }
    }
    if (!did) {
      const ny = curY + (shelves.length ? GAP : 0);
      if (ny + p.h > uh + 0.01 || p.w > uw + 0.01) continue;
      placed.push({ ...p, x: EDGE, y: ny + EDGE });
      shelves.push({ y: ny, h: p.h, x: p.w + GAP }); curY = ny + p.h;
    }
  }
  return { fits: placed.length === pieces.length, placed, usedH: curY + EDGE * 2 };
}

function findBestSheets(allPieces, sheets) {
  if (!allPieces.length) return { results: [], totalCost: 0 };
  let rem = [...allPieces]; const results = []; let safe = 20;
  while (rem.length > 0 && safe-- > 0) {
    let best = null, bestP = [], bestC = Infinity;
    for (const sh of sheets) {
      const pk = shelfPack(rem, sh.w, sh.h);
      if (!pk.placed.length) continue;
      if (pk.fits && sh.price < bestC) { best = sh; bestP = pk.placed; bestC = sh.price; break; }
      if (!best || pk.placed.length > bestP.length || (pk.placed.length === bestP.length && sh.price < bestC))
        { best = sh; bestP = pk.placed; bestC = sh.price; }
    }
    if (!best || !bestP.length) break;
    results.push({ sheet: best, placed: bestP });
    const used = new Set(bestP.map(p => p._idx));
    rem = rem.filter(p => !used.has(p._idx));
  }
  return { results, totalCost: results.reduce((s, r) => s + r.sheet.price, 0) };
}

// Try each piece on its own cheapest sheet
function findSplitSheets(allPieces, sheets) {
  if (!allPieces.length) return { results: [], totalCost: 0 };
  const results = [];
  for (const piece of allPieces) {
    let best = null, bestP = null;
    for (const sh of sheets) {
      const pk = shelfPack([piece], sh.w, sh.h);
      if (pk.fits && (!best || sh.price < best.price)) { best = sh; bestP = pk.placed; }
    }
    if (best && bestP) {
      const existing = results.find(r => r.sheet.name === best.name);
      if (existing) {
        // Try to add to existing sheet of same type
        const tryPack = shelfPack([...existing.placed.map(p => ({...p})), piece], best.w, best.h);
        if (tryPack.fits) { existing.placed = tryPack.placed; continue; }
      }
      results.push({ sheet: best, placed: bestP });
    }
  }
  return { results, totalCost: results.reduce((s, r) => s + r.sheet.price, 0) };
}

const emptyLine = () => ({ id: uid(), qty: "", prendaId: "", quien: "Yo", placementIds: [], customs: [], otroName: "", otroCost: "" });

export default function App() {
  const saved = loadConfig();

  const [lines, setLines] = useState([{ ...emptyLine(), qty: 1 }]);
  const [designWho, setDesignWho] = useState("Cliente trae arte");
  const [designId, setDesignId] = useState("d0");
  const [fixId, setFixId] = useState("f0");
  const [margin, setMargin] = useState(saved?.margin ?? 80);
  const [tab, setTab] = useState("cotizar");
  const [cfgTab, setCfgTab] = useState("negocio");

  const [prendas, setPrendas] = useState(saved?.prendas ?? INIT_PRENDAS);
  const [placements, setPlacements] = useState(saved?.placements ?? INIT_PLACEMENTS);
  const [sheets, setSheets] = useState(saved?.sheets ?? INIT_SHEETS);
  const [designTypes, setDesignTypes] = useState(saved?.designTypes ?? INIT_DESIGN);
  const [fixTypes, setFixTypes] = useState(saved?.fixTypes ?? INIT_FIX);
  const [volTiers, setVolTiers] = useState(saved?.volTiers ?? INIT_VOL);
  const [poliBolsa, setPoliBolsa] = useState(saved?.poliBolsa ?? 900);
  const [poliGramos, setPoliGramos] = useState(saved?.poliGramos ?? 907);
  const [businessName, setBusinessName] = useState(saved?.businessName ?? "ARTAMPA");
  const [energyCost, setEnergyCost] = useState(saved?.energyCost ?? 0.20);

  // Save state
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | dirty | saved
  const [savedSnapshot, setSavedSnapshot] = useState(saved);
  const isFirstRender = useRef(true);

  const currentConfig = useMemo(() => ({
    margin, prendas, placements, sheets, designTypes, fixTypes, volTiers,
    poliBolsa, poliGramos, businessName, energyCost
  }), [margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliBolsa, poliGramos, businessName, energyCost]);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setSaveStatus("dirty");
  }, [currentConfig]);

  const handleSave = useCallback(() => {
    const ok = saveConfig(currentConfig);
    if (ok) {
      setSavedSnapshot(currentConfig);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  }, [currentConfig]);

  // Auto-save 1.5s after any config change
  const autoSaveTimer = useRef(null);
  useEffect(() => {
    if (isFirstRender.current) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveConfig(currentConfig);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1800);
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [currentConfig]);

  const poliRate = poliBolsa / poliGramos;

  // Generic updaters
  const upd = (setter) => (id, f, v) => setter(p => p.map(x => x.id === id ? { ...x, [f]: f === "label" || f === "name" || f === "desc" || f === "color" ? v : Number(v) || 0 } : x));
  const add = (setter, template) => () => setter(p => [...p, { ...template, id: uid() }]);
  const del = (setter) => (id) => setter(p => p.filter(x => x.id !== id));

  const updLine = useCallback((i, f, v) => setLines(p => p.map((l, j) => j === i ? { ...l, [f]: v } : l)), []);
  const togglePl = useCallback((li, pid) => {
    setLines(p => p.map((l, j) => j !== li ? l : { ...l, placementIds: l.placementIds.includes(pid) ? l.placementIds.filter(x => x !== pid) : [...l.placementIds, pid] }));
  }, []);
  const addCustom = useCallback((li) => setLines(p => p.map((l, j) => j === li ? { ...l, customs: [...l.customs, { w: "", h: "", label: "Custom", color: "#9B6B8B" }] } : l)), []);
  const updCustom = useCallback((li, ci, f, v) => setLines(p => p.map((l, j) => j !== li ? l : { ...l, customs: l.customs.map((c, k) => k === ci ? { ...c, [f]: v } : c) })), []);
  const delCustom = useCallback((li, ci) => setLines(p => p.map((l, j) => j !== li ? l : { ...l, customs: l.customs.filter((_, k) => k !== ci) })), []);

  const calc = useMemo(() => {
    const active = lines.filter(l => l.qty && Number(l.qty) > 0 && (l.placementIds.length > 0 || l.customs.some(c => c.w && c.h)));
    if (!active.length) return null;
    const totalQty = active.reduce((s, l) => s + Number(l.qty), 0);
    let pidx = 0; const allPieces = [];

    const lineDetails = active.map((line, li) => {
      const qty = Number(line.qty);
      const pieces = []; let poli = 0;
      line.placementIds.forEach(pid => {
        const pl = placements.find(p => p.id === pid);
        if (pl) { pieces.push({ w: pl.w, h: pl.h, label: pl.label, color: pl.color, _idx: pidx++ }); poli += calcPoli(pl.w, pl.h); }
      });
      line.customs.forEach(c => {
        if (c.w && c.h) { const cw = Number(c.w), ch = Number(c.h); pieces.push({ w: cw, h: ch, label: c.label || "Custom", color: c.color || "#9B6B8B", _idx: pidx++ }); poli += calcPoli(cw, ch); }
      });
      pieces.forEach(p => allPieces.push(p));

      const pr = prendas.find(p => p.id === line.prendaId);
      const prendaCost = line.quien === "Cliente" ? 0 : (pr ? pr.cost : Number(line.otroCost) || 0);
      const prendaLabel = pr ? pr.name : (line.otroName || "Otro");
      const cfgLabel = [...line.placementIds.map(pid => placements.find(p => p.id === pid)?.label || "?"),
        ...line.customs.filter(c => c.w && c.h).map(c => `${c.label} ${c.w}×${c.h}`)].join(" + ");
      return { ...line, qty, pieces, poli, poliCost: poli * poliRate, prendaCost, prendaLabel, cfgLabel };
    });

    const nesting = findBestSheets(allPieces, sheets);
    const split = findSplitSheets(allPieces, sheets);
    const bestNesting = split.totalCost < nesting.totalCost ? split : nesting;
    const dtfCost = bestNesting.totalCost;
    const dtfPU = totalQty > 0 ? dtfCost / totalQty : 0;

    const dType = designTypes.find(d => d.id === designId);
    const designFee = designWho === "Cliente trae arte" ? 0 : (dType?.price || 0);
    const fType = fixTypes.find(f => f.id === fixId);
    const fixFee = designWho === "Nosotros diseñamos" ? 0 : (fType?.price || 0);

    const tier = volTiers.sort((a, b) => b.minQty - a.minQty).find(t => totalQty >= t.minQty) || volTiers[0];
    const designCharged = tier.designDisc >= 100 ? 0 : Math.round(designFee * (1 - tier.designDisc / 100));
    const fixCharged = tier.fixFree ? 0 : fixFee;
    const volPct = tier.discPct || 0;

    const lp = lineDetails.map(ld => {
      const uc = ld.prendaCost + ld.poliCost + dtfPU + energyCost;
      const sp = Math.ceil((uc * (1 + margin / 100)) / 10) * 10;
      return { ...ld, unitCost: uc, sellPrice: sp, lineTotal: sp * ld.qty, costTotal: uc * ld.qty };
    });

    const sub = lp.reduce((s, l) => s + l.lineTotal, 0);
    const disc = Math.round(sub * volPct / 100);
    const total = sub - disc + designCharged + fixCharged;
    const cost = lp.reduce((s, l) => s + l.costTotal, 0);
    const profit = total - cost;
    const rm = total > 0 ? (profit / total) * 100 : 0;

    const totalPoli = lineDetails.reduce((s, l) => s + l.poli, 0);
    const totalPoliCost = lineDetails.reduce((s, l) => s + l.poliCost, 0);
    const totalEnergyCost = totalQty * energyCost;

    return { lp, nesting: bestNesting, totalQty, dtfCost, designFee, fixFee, designCharged, fixCharged, volPct, disc, sub, total, cost, profit, rm, tier, dType, fType, totalPoli, totalPoliCost, totalEnergyCost };
  }, [lines, designWho, designId, fixId, margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliRate, energyCost]);

  // ── RENDER ──
  return (
    <div style={{ background: "#080C09", color: "#E8F0E2", fontFamily: "'DM Sans',sans-serif", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet" />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        input,select{font-family:inherit}
        input[type=number]{-moz-appearance:textfield}
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        ::selection{background:#A8D530;color:#080C09}
        scrollbar-width:thin;scrollbar-color:#1C2C1E #080C09;

        /* Responsive grid */
        @media(max-width:780px){
          .cotizar-grid{grid-template-columns:1fr !important}
        }

        /* Cards */
        .S{background:#0D1410;border-radius:14px;border:1px solid #162416;margin-bottom:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.4)}
        .SH{padding:12px 16px;border-bottom:1px solid #162416;display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#101A12}
        .SB{padding:16px}

        /* Inputs */
        .I{background:#070E09;border:1.5px solid #1C2C1E;border-radius:8px;padding:7px 10px;font-size:13px;color:#E8F0E2;width:100%;transition:border-color .2s,box-shadow .2s}
        .I:focus{outline:none;border-color:#A8D530;box-shadow:0 0 0 3px rgba(212,115,42,.15)}
        .Is{font-size:11px;padding:5px 8px}
        .SL{appearance:none;background:#070E09 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%234A6840' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 8px center;background-size:10px;border:1.5px solid #1C2C1E;border-radius:8px;padding:7px 26px 7px 10px;font-size:13px;color:#E8F0E2;width:100%;cursor:pointer;transition:border-color .2s}
        .SL:focus{outline:none;border-color:#A8D530}
        .SLs{font-size:11px;padding:5px 22px 5px 8px}

        /* Buttons */
        .BA{width:100%;padding:9px;border-radius:8px;border:1.5px dashed #1C2C1E;background:transparent;color:#4A6045;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s}
        .BA:hover{border-color:#A8D530;color:#A8D530}
        .DB{width:22px;height:22px;border-radius:6px;border:none;background:transparent;color:#324835;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
        .DB:hover{background:#2E1E14;color:#A8D530}

        /* Labels */
        .T{display:inline-block;padding:3px 8px;border-radius:5px;font-size:10px;font-weight:600}
        .L{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#4A6045;font-weight:600;margin-bottom:4px}

        /* Layout helpers */
        .R{display:flex;gap:6px;align-items:center}
        .G2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .G3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}

        /* Tabs */
        .tb{padding:8px 20px;border:none;background:transparent;font-size:13px;font-weight:600;color:#4A6045;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;font-family:inherit}
        .tb.a{color:#A8D530;border-bottom-color:#A8D530}
        .tb:hover:not(.a){color:#88C060}

        /* Config pills */
        .ct{padding:6px 14px;border:1.5px solid #162416;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit}
        .ct:hover{border-color:#A8D530;color:#A8D530}

        /* Placement chips */
        .PC{display:inline-flex;align-items:center;gap:3px;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;border:1.5px solid #162416;transition:all .12s;user-select:none;color:#607858}
        .PC:hover{border-color:#2A4030}
        .PC.on{color:white;border-color:transparent}

        /* Line items */
        .line-card{background:#080D09;border:1px solid #162416;border-radius:10px;padding:12px;margin-bottom:8px;transition:border-color .15s}
        .line-card:hover{border-color:#1E3020}

        /* Animations */
        @keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .fi{animation:fi .3s ease-out}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .pulse{animation:pulse 1.5s infinite}
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{ background: "#070E09", borderBottom: "1px solid #162416", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(8px)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "'Outfit'", fontSize: 22, fontWeight: 900, color: "#A8D530", letterSpacing: "-0.5px" }}>{businessName}</span>
            <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: 500, color: "#324835", letterSpacing: ".1em", textTransform: "uppercase" }}>DTF · Cotizador</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {saveStatus === "saved" && (
              <span className="fi" style={{ fontSize: 10, color: "#4CAF78", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="#4CAF78" strokeWidth="1.5"/><path d="M3.5 6l1.8 1.8L8.5 4.5" stroke="#4CAF78" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
                Auto-guardado
              </span>
            )}
            {saveStatus === "dirty" && (
              <span style={{ fontSize: 10, color: "#A8D530", fontWeight: 600 }} className="pulse">● Guardando...</span>
            )}
          </div>
        </div>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 20px", display: "flex", borderTop: "1px solid #162416" }}>
          <button className={`tb ${tab === "cotizar" ? "a" : ""}`} onClick={() => setTab("cotizar")}>Cotizar</button>
          <button className={`tb ${tab === "config" ? "a" : ""}`} onClick={() => setTab("config")}>Configuración</button>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px 80px" }}>

        {/* ═══ CONFIG ═══ */}
        {tab === "config" && (
          <div className="fi" style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {[["negocio","Mi Negocio"],["prendas","Prendas"],["placements","Placements"],["sheets","Hojas DTF"],["poli","Poliamida"],["design","Diseño"],["fix","Corrección"],["vol","Volumen"]].map(([k,v])=>(
                <button key={k} className="ct" onClick={() => setCfgTab(k)}
                  style={{ background: cfgTab === k ? "#A8D530" : "transparent", color: cfgTab === k ? "#080C09" : "#607858", borderColor: cfgTab === k ? "#A8D530" : "#162416", fontFamily: "inherit" }}>{v}</button>
              ))}
            </div>

            {cfgTab === "negocio" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Mi Negocio</span></div>
                <div className="SB">
                  <div className="L">Nombre del negocio</div>
                  <input className="I" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ marginBottom: 14, fontFamily: "'Outfit'", fontWeight: 700, fontSize: 16 }} />
                  <div className="L">Costo energía por prensado (L/prenda)</div>
                  <div className="R" style={{ marginBottom: 6 }}>
                    <span style={{ color: "#4A6045", fontSize: 12, fontFamily: "'JetBrains Mono'" }}>L</span>
                    <input type="number" className="I" value={energyCost} onChange={e => setEnergyCost(Number(e.target.value) || 0)} step={0.01} style={{ width: 100, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#324835", fontStyle: "italic", background: "#070E09", borderRadius: 6, padding: "6px 10px", border: "1px solid #162416" }}>
                    ENEE L4.62/kWh (2026) · Prensa 1800W×20s + Impresora + Secador ≈ L0.15–0.25/prenda
                  </div>
                </div>
              </div>
            )}

            {cfgTab === "prendas" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Costos de Prendas</span></div>
                <div className="SB">
                  {prendas.map(p => (
                    <div key={p.id} className="R" style={{ marginBottom: 6 }}>
                      <input className="I Is" value={p.name} onChange={e => upd(setPrendas)(p.id, "name", e.target.value)} style={{ flex: 1 }} />
                      <span style={{ color: "#4A6045", fontSize: 11, fontFamily: "'JetBrains Mono'" }}>L</span>
                      <input type="number" className="I Is" value={p.cost} onChange={e => upd(setPrendas)(p.id, "cost", e.target.value)} style={{ width: 80, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <button className="DB" onClick={() => del(setPrendas)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 8 }} onClick={add(setPrendas, { name: "Nueva prenda", cost: 0 })}>+ Agregar prenda</button>
                </div>
              </div>
            )}

            {cfgTab === "placements" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Placements</span></div>
                <div className="SB">
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 52px 52px 20px", gap: 6, fontSize: 9, fontWeight: 700, color: "#324835", marginBottom: 8, letterSpacing: ".08em", textTransform: "uppercase" }}>
                    <span>Color</span><span>Nombre</span><span>W″</span><span>H″</span><span></span>
                  </div>
                  {placements.map(p => (
                    <div key={p.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr 52px 52px 20px", gap: 6, marginBottom: 5, alignItems: "center" }}>
                      <input type="color" value={p.color} onChange={e => upd(setPlacements)(p.id, "color", e.target.value)}
                        style={{ width: 26, height: 26, border: "2px solid #162416", background: "none", cursor: "pointer", padding: 0, borderRadius: 6 }} />
                      <input className="I Is" value={p.label} onChange={e => upd(setPlacements)(p.id, "label", e.target.value)} />
                      <input type="number" className="I Is" value={p.w} onChange={e => upd(setPlacements)(p.id, "w", e.target.value)} step={0.5} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="I Is" value={p.h} onChange={e => upd(setPlacements)(p.id, "h", e.target.value)} step={0.5} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <button className="DB" onClick={() => del(setPlacements)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 8 }} onClick={add(setPlacements, { label: "Nuevo", w: 5, h: 5, color: "#888888" })}>+ Agregar placement</button>
                </div>
              </div>
            )}

            {cfgTab === "sheets" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Hojas DTF</span></div>
                <div className="SB">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 80px 20px", gap: 6, fontSize: 9, fontWeight: 700, color: "#324835", marginBottom: 8, letterSpacing: ".08em", textTransform: "uppercase" }}>
                    <span>Nombre</span><span>W″</span><span>H″</span><span>Precio L</span><span></span>
                  </div>
                  {sheets.map(s => (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 80px 20px", gap: 6, marginBottom: 5 }}>
                      <input className="I Is" value={s.name} onChange={e => upd(setSheets)(s.id, "name", e.target.value)} />
                      <input type="number" className="I Is" value={s.w} onChange={e => upd(setSheets)(s.id, "w", e.target.value)} step={0.01} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="I Is" value={s.h} onChange={e => upd(setSheets)(s.id, "h", e.target.value)} step={0.01} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="I Is" value={s.price} onChange={e => upd(setSheets)(s.id, "price", e.target.value)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <button className="DB" onClick={() => del(setSheets)(s.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 8 }} onClick={add(setSheets, { name: "Nueva", w: 10, h: 10, price: 0 })}>+ Agregar hoja</button>
                </div>
              </div>
            )}

            {cfgTab === "poli" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Poliamida</span></div>
                <div className="SB G2">
                  <div>
                    <div className="L">Precio bolsa (L)</div>
                    <input type="number" className="I" value={poliBolsa} onChange={e => setPoliBolsa(Number(e.target.value))} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                  </div>
                  <div>
                    <div className="L">Gramos / bolsa</div>
                    <input type="number" className="I" value={poliGramos} onChange={e => setPoliGramos(Number(e.target.value))} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                  </div>
                  <div style={{ gridColumn: "1/-1", background: "#070E09", borderRadius: 8, padding: "10px 14px", border: "1px solid #162416" }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 700, color: "#A8D530" }}>L{poliRate.toFixed(4)}</span>
                    <span style={{ fontSize: 11, color: "#4A6045", marginLeft: 6 }}>por gramo · 120 g/m² estándar DTF</span>
                  </div>
                </div>
              </div>
            )}

            {cfgTab === "design" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Tarifas de Diseño</span></div>
                <div className="SB">
                  {designTypes.map(d => d.id !== "d0" && (
                    <div key={d.id} style={{ marginBottom: 8, padding: "10px 12px", background: "#070E09", borderRadius: 8, border: "1px solid #162416" }}>
                      <div className="R" style={{ marginBottom: 5 }}>
                        <input className="I Is" value={d.label} onChange={e => upd(setDesignTypes)(d.id, "label", e.target.value)} style={{ flex: 1, fontWeight: 600 }} placeholder="Nombre" />
                        <span style={{ color: "#4A6045", fontSize: 10, fontFamily: "'JetBrains Mono'" }}>L</span>
                        <input type="number" className="I Is" value={d.price} onChange={e => upd(setDesignTypes)(d.id, "price", e.target.value)} style={{ width: 70, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <button className="DB" onClick={() => del(setDesignTypes)(d.id)}>×</button>
                      </div>
                      <input className="I Is" value={d.desc} onChange={e => upd(setDesignTypes)(d.id, "desc", e.target.value)} placeholder="Descripción breve..." style={{ color: "#4A6045", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 4 }} onClick={add(setDesignTypes, { label: "Nuevo servicio", price: 0, desc: "" })}>+ Agregar servicio</button>
                </div>
              </div>
            )}

            {cfgTab === "fix" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Tarifas de Corrección</span></div>
                <div className="SB">
                  <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: "#070E09", border: "1px solid #162416", fontSize: 11, color: "#4A6045" }}>
                    <b style={{ color: "#607858" }}>Listo para DTF</b> — {fixTypes.find(f => f.id === "f0")?.desc}
                  </div>
                  {fixTypes.map(f => f.id !== "f0" && (
                    <div key={f.id} style={{ marginBottom: 8, padding: "10px 12px", background: "#070E09", borderRadius: 8, border: "1px solid #162416" }}>
                      <div className="R" style={{ marginBottom: 5 }}>
                        <input className="I Is" value={f.label} onChange={e => upd(setFixTypes)(f.id, "label", e.target.value)} style={{ flex: 1, fontWeight: 600 }} />
                        <span style={{ color: "#4A6045", fontSize: 10, fontFamily: "'JetBrains Mono'" }}>L</span>
                        <input type="number" className="I Is" value={f.price} onChange={e => upd(setFixTypes)(f.id, "price", e.target.value)} style={{ width: 70, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <button className="DB" onClick={() => del(setFixTypes)(f.id)}>×</button>
                      </div>
                      <input className="I Is" value={f.desc} onChange={e => upd(setFixTypes)(f.id, "desc", e.target.value)} placeholder="Descripción..." style={{ color: "#4A6045", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 4 }} onClick={add(setFixTypes, { label: "Nuevo nivel", price: 0, desc: "" })}>+ Agregar nivel</button>
                </div>
              </div>
            )}

            {cfgTab === "vol" && (
              <div className="S fi">
                <div className="SH"><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Descuentos por Volumen</span></div>
                <div className="SB">
                  {volTiers.map(t => (
                    <div key={t.id} style={{ marginBottom: 10, padding: 12, background: "#070E09", borderRadius: 10, border: "1px solid #162416" }}>
                      <div className="R" style={{ marginBottom: 8 }}>
                        <div className="L" style={{ margin: 0 }}>Desde</div>
                        <input type="number" className="I Is" value={t.minQty} onChange={e => upd(setVolTiers)(t.id, "minQty", e.target.value)} style={{ width: 52, textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <div className="L" style={{ margin: 0 }}>hasta</div>
                        <input type="number" className="I Is" value={t.maxQty} onChange={e => upd(setVolTiers)(t.id, "maxQty", e.target.value)} style={{ width: 52, textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <span style={{ fontSize: 10, color: "#324835" }}>u</span>
                        <button className="DB" style={{ marginLeft: "auto" }} onClick={() => del(setVolTiers)(t.id)}>×</button>
                      </div>
                      <input className="I Is" value={t.desc} onChange={e => upd(setVolTiers)(t.id, "desc", e.target.value)} placeholder="Descripción del tier" style={{ marginBottom: 8 }} />
                      <div className="R" style={{ flexWrap: "wrap", gap: 10 }}>
                        <div><div className="L">Desc %</div>
                          <input type="number" className="I Is" value={t.discPct} onChange={e => upd(setVolTiers)(t.id, "discPct", e.target.value)} style={{ width: 52, textAlign: "center", fontFamily: "'JetBrains Mono'" }} /></div>
                        <div><div className="L">Diseño desc %</div>
                          <input type="number" className="I Is" value={t.designDisc} onChange={e => upd(setVolTiers)(t.id, "designDisc", e.target.value)} style={{ width: 52, textAlign: "center", fontFamily: "'JetBrains Mono'" }} /></div>
                        <label className="R" style={{ gap: 5, cursor: "pointer", alignSelf: "flex-end", paddingBottom: 2 }}>
                          <input type="checkbox" checked={t.fixFree} onChange={e => setVolTiers(p => p.map(x => x.id === t.id ? { ...x, fixFree: e.target.checked } : x))} />
                          <span style={{ fontSize: 11, color: "#607858" }}>Corrección gratis</span>
                        </label>
                      </div>
                    </div>
                  ))}
                  <button className="BA" onClick={add(setVolTiers, { minQty: 0, maxQty: 0, label: "Nuevo", desc: "", discPct: 0, designDisc: 0, fixFree: false })}>+ Agregar tier</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ COTIZAR ═══ */}
        {tab === "cotizar" && (
          <div className="fi cotizar-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, alignItems: "start" }}>
            {/* ── COLUMNA IZQUIERDA: inputs ── */}
            <div>
            {/* ① PEDIDO */}
            <div className="S">
              <div className="SH">
                <Num n={1} />
                <span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Pedido</span>
              </div>
              <div className="SB">
                <div className="G2" style={{ marginBottom: 10 }}>
                  <div>
                    <div className="L">¿Quién diseña?</div>
                    <select className="SL" value={designWho} onChange={e => { setDesignWho(e.target.value); if (e.target.value === "Cliente trae arte") setDesignId("d0"); }}>
                      <option>Cliente trae arte</option><option>Nosotros diseñamos</option>
                    </select>
                  </div>
                  <div>
                    <div className="L">Tipo de diseño</div>
                    <select className="SL" value={designId} onChange={e => setDesignId(e.target.value)}
                      disabled={designWho === "Cliente trae arte"} style={designWho === "Cliente trae arte" ? { opacity: .35 } : {}}>
                      {designTypes.map(d => <option key={d.id} value={d.id}>{d.label}{d.price ? ` (L${d.price})` : ""}</option>)}
                    </select>
                    {designWho !== "Cliente trae arte" && designTypes.find(d => d.id === designId)?.desc && (
                      <div style={{ fontSize: 10, color: "#4A6045", fontStyle: "italic", marginTop: 3 }}>{designTypes.find(d => d.id === designId).desc}</div>
                    )}
                  </div>
                  <div>
                    <div className="L">Corrección de archivo</div>
                    <select className="SL" value={fixId} onChange={e => setFixId(e.target.value)}
                      disabled={designWho === "Nosotros diseñamos"} style={designWho === "Nosotros diseñamos" ? { opacity: .35 } : {}}>
                      {fixTypes.map(f => <option key={f.id} value={f.id}>{f.label}{f.price ? ` (L${f.price})` : ""}</option>)}
                    </select>
                    {fixTypes.find(f => f.id === fixId)?.desc && (
                      <div style={{ fontSize: 10, color: "#4A6045", fontStyle: "italic", marginTop: 3 }}>{fixTypes.find(f => f.id === fixId).desc}</div>
                    )}
                  </div>
                  <div>
                    <div className="L">Margen ganancia</div>
                    <div className="R">
                      <input type="number" className="I" style={{ textAlign: "center", fontWeight: 800, fontFamily: "'JetBrains Mono'", fontSize: 16, color: "#A8D530" }}
                        value={margin} onChange={e => setMargin(Number(e.target.value) || 0)} />
                      <span style={{ color: "#4A6045", fontSize: 13, flexShrink: 0, fontFamily: "'JetBrains Mono'" }}>%</span>
                    </div>
                  </div>
                </div>
                {designWho === "Nosotros diseñamos" && (
                  <span className="T" style={{ background: "#0E2218", color: "#7ABD8A", border: "1px solid #0E2A18" }}>Corrección = L0 automático</span>
                )}
              </div>
            </div>

            {/* ② LÍNEAS */}
            <div className="S">
              <div className="SH">
                <Num n={2} />
                <span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Líneas</span>
                {calc && (
                  <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 12, color: "#A8D530", fontWeight: 700 }}>
                    {calc.totalQty}u · {calc.tier.desc}
                  </span>
                )}
              </div>
              <div className="SB">
                {lines.map((line, i) => (
                  <div key={line.id} className="line-card">
                    <div className="R" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#324835", width: 18, textAlign: "center", flexShrink: 0, fontFamily: "'JetBrains Mono'" }}>{i + 1}</span>
                      <input type="number" min={0} className="I Is" style={{ width: 52, textAlign: "center", fontWeight: 800, flexShrink: 0, fontFamily: "'JetBrains Mono'", color: "#A8D530", fontSize: 14 }}
                        placeholder="0" value={line.qty} onChange={e => updLine(i, "qty", e.target.value)} />
                      <select className="SL SLs" value={line.prendaId} onChange={e => updLine(i, "prendaId", e.target.value)} style={{ flex: 1 }}>
                        <option value="">— Prenda —</option>
                        {prendas.map(p => <option key={p.id} value={p.id}>{p.name} (L{p.cost})</option>)}
                        <option value="__otro">Otro</option>
                      </select>
                      <select className="SL SLs" value={line.quien} onChange={e => updLine(i, "quien", e.target.value)} style={{ width: 70, flexShrink: 0 }}>
                        <option>Yo</option><option>Cliente</option>
                      </select>
                      <button className="DB" onClick={() => setLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}>×</button>
                    </div>

                    {line.prendaId === "__otro" && (
                      <div className="R" style={{ marginBottom: 8, marginLeft: 24 }}>
                        <input className="I Is" placeholder="Nombre (Gorra, Tote...)" style={{ flex: 1 }}
                          value={line.otroName} onChange={e => updLine(i, "otroName", e.target.value)} />
                        <span style={{ color: "#4A6045", fontSize: 10, fontFamily: "'JetBrains Mono'" }}>L</span>
                        <input type="number" className="I Is" placeholder="Costo" style={{ width: 70, fontFamily: "'JetBrains Mono'" }}
                          value={line.otroCost} onChange={e => updLine(i, "otroCost", e.target.value)} />
                      </div>
                    )}

                    <div style={{ marginLeft: 24 }}>
                      <div className="L">Placements</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {placements.map(pl => {
                          const on = line.placementIds.includes(pl.id);
                          return (
                            <div key={pl.id} className={`PC ${on ? "on" : ""}`}
                              style={on ? { background: pl.color, borderColor: pl.color } : {}}
                              onClick={() => togglePl(i, pl.id)}>
                              <span style={{ fontSize: 8, opacity: .65 }}>{pl.w}×{pl.h}</span> {pl.label}
                            </div>
                          );
                        })}
                      </div>
                      {line.customs.map((c, ci) => (
                        <div key={ci} className="R" style={{ marginTop: 6 }}>
                          <input className="I Is" placeholder="Nombre" style={{ width: 84 }} value={c.label} onChange={e => updCustom(i, ci, "label", e.target.value)} />
                          <input type="number" step={0.5} className="I Is" placeholder='W"' style={{ width: 50, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.w} onChange={e => updCustom(i, ci, "w", e.target.value)} />
                          <span style={{ color: "#324835", fontWeight: 700, fontSize: 11 }}>×</span>
                          <input type="number" step={0.5} className="I Is" placeholder='H"' style={{ width: 50, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.h} onChange={e => updCustom(i, ci, "h", e.target.value)} />
                          <button className="DB" onClick={() => delCustom(i, ci)}>×</button>
                        </div>
                      ))}
                      <button onClick={() => addCustom(i)} style={{ marginTop: 6, background: "transparent", border: "1px dashed #1C2C1E", borderRadius: 6, padding: "3px 10px", fontSize: 10, color: "#4A6045", cursor: "pointer", fontWeight: 600, transition: "all .15s" }}>+ Custom</button>
                    </div>
                  </div>
                ))}
                <button className="BA" onClick={() => setLines(p => [...p, emptyLine()])}>+ Agregar línea</button>
              </div>
            </div>
            </div>{/* end col-left */}

            {/* ── COLUMNA DERECHA: resultados ── */}
            <div>
            {calc && (
              <>
                {/* ③ HOJAS DTF */}
                <div className="S fi">
                  <div className="SH" style={{ background: "#0C1A0E", borderColor: "#1C3A1E" }}>
                    <Num n={3} />
                    <span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Hojas DTF</span>
                    <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 800, color: "#A8D530" }}>L{calc.dtfCost}</span>
                  </div>
                  <div style={{ padding: 16, background: "#060C07" }}>
                    {/* Resumen */}
                    {(() => {
                      const counts = {};
                      calc.nesting.results.forEach(r => { counts[r.sheet.name] = (counts[r.sheet.name] || 0) + 1; });
                      return (
                        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: "#0A180C", border: "1px solid #1C3A1E", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: "#5A8040", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700 }}>Necesitas:</span>
                          {Object.entries(counts).map(([name, qty]) => (
                            <span key={name} style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 800, color: "#C0F060", background: "#102410", borderRadius: 7, padding: "4px 12px", border: "1px solid #1C3A1C" }}>
                              {qty > 1 ? `${qty}×` : ""}{name}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    {calc.nesting.results.map((res, ri) => {
                      const { sheet, placed } = res;
                      const maxH = placed.length ? Math.max(...placed.map(p => p.y + p.h)) : sheet.h;
                      const dH = Math.min(maxH + 2, sheet.h);
                      const svW = 340, sc = svW / sheet.w, svH = dH * sc, pd = 24;
                      return (
                        <div key={ri} style={{ marginBottom: ri < calc.nesting.results.length - 1 ? 20 : 0 }}>
                          <div className="R" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ color: "#D8EDD0", fontSize: 14, fontWeight: 700, fontFamily: "'Outfit'" }}>{sheet.name}
                              <span style={{ color: "#4A6045", fontWeight: 400, fontSize: 11, marginLeft: 8, fontFamily: "'JetBrains Mono'" }}>{sheet.w}″ × {sheet.h}″</span></span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#A8D530", fontSize: 18, fontWeight: 800 }}>L{sheet.price}</span>
                          </div>
                          <svg width="100%" viewBox={`${-pd} ${-pd} ${svW + pd * 2} ${svH + pd * 2}`} style={{ display: "block", maxWidth: svW + pd * 2 }}>
                            <defs>
                              <pattern id={`g${ri}`} width={sc} height={sc} patternUnits="userSpaceOnUse"><rect width={sc} height={sc} fill="none" stroke="#1A1408" strokeWidth=".4" /></pattern>
                              <pattern id="ht" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.06)" strokeWidth="1" /></pattern>
                              <filter id="sh"><feDropShadow dx="1" dy="2" stdDeviation="2" floodOpacity=".35" /></filter>
                            </defs>
                            <rect x={0} y={0} width={svW} height={svH} rx={5} fill="#0A100C" stroke="#1C3A1E" strokeWidth={1.5} />
                            <rect x={0} y={0} width={svW} height={svH} rx={5} fill={`url(#g${ri})`} />
                            {placed.map((p, pi) => {
                              const px = p.x * sc + 1, py = p.y * sc + 1, pw = p.w * sc - 2, ph = p.h * sc - 2;
                              const sl = pw > 26 && ph > 14, sd = pw > 18 && ph > 10;
                              return (
                                <g key={pi} filter="url(#sh)">
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill={p.color || "#888"} fillOpacity={.9} />
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill="url(#ht)" />
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={1} />
                                  {sl && <text x={px + pw / 2} y={py + ph / 2 - (sd ? 5 : 0)} textAnchor="middle" dominantBaseline="central"
                                    fill="white" fontSize={Math.min(11, pw / 5)} fontWeight="700" style={{ fontFamily: "'DM Sans'" }}>{p.label}</text>}
                                  {sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 10} textAnchor="middle"
                                    fill="rgba(255,255,255,.45)" fontSize={Math.min(8, pw / 7)} style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}″</text>}
                                  {!sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 3} textAnchor="middle"
                                    fill="white" fontSize={6} fontWeight="700" style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}</text>}
                                </g>
                              );
                            })}
                            <line x1={0} y1={-9} x2={svW} y2={-9} stroke="#3A5A3A" strokeWidth={.6} />
                            <line x1={0} y1={-13} x2={0} y2={-5} stroke="#3A5A3A" strokeWidth={.6} />
                            <line x1={svW} y1={-13} x2={svW} y2={-5} stroke="#3A5A3A" strokeWidth={.6} />
                            <text x={svW / 2} y={-14} textAnchor="middle" fill="#5A8040" fontSize={8} style={{ fontFamily: "'JetBrains Mono'" }}>{sheet.w}″</text>
                            <line x1={-9} y1={0} x2={-9} y2={svH} stroke="#3A5A3A" strokeWidth={.6} />
                            <line x1={-13} y1={0} x2={-5} y2={0} stroke="#3A5A3A" strokeWidth={.6} />
                            <line x1={-13} y1={svH} x2={-5} y2={svH} stroke="#3A5A3A" strokeWidth={.6} />
                            <text x={-13} y={svH / 2} textAnchor="middle" fill="#5A8040" fontSize={8}
                              transform={`rotate(-90,-13,${svH / 2})`} style={{ fontFamily: "'JetBrains Mono'" }}>{dH.toFixed(1)}″</text>
                          </svg>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                            {[...new Map(placed.map(p => [p.label, p.color])).entries()].map(([l, c]) => (
                              <div key={l} className="R" style={{ gap: 5 }}>
                                <div style={{ width: 10, height: 10, borderRadius: 3, background: c, flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: "#607858" }}>{l}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ④ DESGLOSE */}
                <div className="S fi">
                  <div className="SH"><Num n={4} /><span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Desglose</span></div>
                  <div className="SB">
                    {calc.lp.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid #101A12", fontSize: 13 }}>
                        <div>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "#A8D530" }}>{l.qty}×</span>
                          <span style={{ marginLeft: 6, fontWeight: 600, color: "#D8EDD0" }}>{l.prendaLabel}</span>
                          <span style={{ color: "#324835", fontSize: 10, marginLeft: 6 }}>({l.cfgLabel})</span>
                          {l.quien === "Cliente" && <span className="T" style={{ background: "#102410", color: "#D4902A", marginLeft: 6, fontSize: 9 }}>cliente pone</span>}
                        </div>
                        <div style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          <span style={{ color: "#324835", fontSize: 10, fontFamily: "'JetBrains Mono'" }}>L{l.sellPrice}/u = </span>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "#D8EDD0" }}>L{l.lineTotal}</span>
                        </div>
                      </div>
                    ))}

                    {/* Costos internos */}
                    <div style={{ marginTop: 14, marginBottom: 6 }}>
                      <div className="L">Mis costos internos</div>
                    </div>
                    {[
                      ["Prendas en blanco", `L${Math.round(calc.lp.reduce((s, l) => s + l.prendaCost * l.qty, 0))}`],
                      [`Hojas DTF: ${calc.nesting.results.map(r => r.sheet.name).join(" + ")}`, `L${calc.dtfCost}`],
                      [`Poliamida: ${calc.totalPoli.toFixed(1)}g × L${poliRate.toFixed(3)}/g`, `L${calc.totalPoliCost.toFixed(2)}`],
                      [`Energía: ${calc.totalQty}u × L${energyCost}`, `L${calc.totalEnergyCost.toFixed(2)}`],
                    ].map(([label, val]) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 11, color: "#4A6045", borderBottom: "1px solid #0D1410" }}>
                        <span>{label}</span><span style={{ fontFamily: "'JetBrains Mono'" }}>{val}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 12, fontWeight: 700, color: "#607858", borderBottom: "1px solid #162416", marginBottom: 10 }}>
                      <span>Total mi costo</span>
                      <span style={{ fontFamily: "'JetBrains Mono'" }}>L{Math.round(calc.cost)}</span>
                    </div>

                    {/* Subtotal + ajustes */}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>
                      <span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono'" }}>L{calc.sub}</span>
                    </div>
                    {calc.disc > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: "#4CAF78" }}>
                        <span>Descuento {calc.volPct}%</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>-L{calc.disc}</span>
                      </div>
                    )}
                    {calc.designFee > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: calc.designCharged === 0 ? "#4CAF78" : "#D8EDD0" }}>
                        <span>Diseño: {calc.dType?.label}{calc.designCharged === 0 ? " ✓" : calc.designCharged < calc.designFee ? " (50%)" : ""}</span>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}</span>
                      </div>
                    )}
                    {calc.fixFee > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: calc.fixCharged === 0 ? "#4CAF78" : "#D8EDD0" }}>
                        <span>Corrección{calc.fixCharged === 0 ? " ✓" : ""}</span>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}</span>
                      </div>
                    )}

                    {/* Total */}
                    <div style={{ marginTop: 16, borderRadius: 12, overflow: "hidden", border: "1px solid #1C3A1E" }}>
                      <div style={{ background: "linear-gradient(135deg, #2A1A08, #0C1A0E)", padding: "20px 20px 14px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".18em", color: "#5A8040", marginBottom: 4 }}>Cobrar al cliente</div>
                        <div style={{ fontFamily: "'Outfit'", fontSize: 44, fontWeight: 900, color: "#A8D530", letterSpacing: "-1px", lineHeight: 1 }}>L{calc.total.toLocaleString()}</div>
                      </div>
                      <div className="G3" style={{ borderTop: "1px solid #1C3A1E" }}>
                        <SB label="Mi costo" val={`L${Math.round(calc.cost)}`} />
                        <SB label="Ganancia" val={`L${Math.round(calc.profit)}`} g />
                        <SB label="Margen" val={`${calc.rm.toFixed(1)}%`} g={calc.rm >= 30} b={calc.rm < 30} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ⑤ RESUMEN WHATSAPP */}
                <div className="S fi">
                  <div className="SH">
                    <Num n={5} />
                    <span style={{ fontFamily: "'Outfit'", fontSize: 14, fontWeight: 700, color: "#D8EDD0" }}>Resumen WhatsApp</span>
                    <button onClick={() => { const e = document.getElementById("rt"); if (e) navigator.clipboard.writeText(e.innerText).catch(() => {}); }}
                      style={{ marginLeft: "auto", background: "#101A12", border: "1px solid #3A2E20", borderRadius: 7, padding: "5px 14px", fontSize: 11, fontWeight: 700, color: "#A8D530", cursor: "pointer", transition: "all .15s" }}>
                      Copiar
                    </button>
                  </div>
                  <div className="SB">
                    <div id="rt" style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, lineHeight: 1.8, color: "#B8D0B4", background: "#060C07", borderRadius: 9, padding: 14, border: "1px solid #162416", userSelect: "all" }}>
                      <div style={{ fontWeight: 800, color: "#A8D530", marginBottom: 4 }}>COTIZACIÓN {businessName} DTF</div>
                      {calc.lp.map((l, i) => <div key={i}>{l.qty}× {l.prendaLabel} ({l.cfgLabel}){l.quien === "Cliente" ? " — cliente pone" : ""} — L{l.sellPrice}/u</div>)}
                      {calc.disc > 0 && <div style={{ color: "#4CAF78" }}>Desc. {calc.volPct}%: -L{calc.disc}</div>}
                      {calc.designFee > 0 && <div>Diseño: {calc.designCharged === 0 ? "Incluido ✓" : `L${calc.designCharged}`}</div>}
                      {calc.fixFee > 0 && <div>Corrección: {calc.fixCharged === 0 ? "Incluida ✓" : `L${calc.fixCharged}`}</div>}
                      <div style={{ fontWeight: 800, color: "#A8D530", fontSize: 14, marginTop: 6 }}>TOTAL: L{calc.total.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </>
            )}
            {!calc && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#1C2C1E" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🖨</div>
                <div style={{ fontFamily: "'Outfit'", fontSize: 15, fontWeight: 600, color: "#1E3020" }}>Agregá líneas para ver resultados</div>
                <div style={{ fontSize: 12, color: "#162416", marginTop: 4 }}>cantidad + placements → cálculo automático</div>
              </div>
            )}
            </div>{/* end col-right */}
          </div>
        )}
      </div>
    </div>
  );
}

function Num({ n }) {
  return (
    <span style={{ background: "#A8D530", color: "#080C09", width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, fontFamily: "'Outfit'" }}>{n}</span>
  );
}

function SB({ label, val, g, b }) {
  const bg = g ? "#0E1E12" : b ? "#1E0E0E" : "#070E09";
  const bc = g ? "#1E3A22" : b ? "#3A1E1E" : "#162416";
  const c = g ? "#4CAF78" : b ? "#E05040" : "#B8D0B4";
  const lc = g ? "#2A6A3A" : b ? "#6A2A2A" : "#324835";
  return (
    <div style={{ background: bg, padding: "10px 8px", textAlign: "center", border: `1px solid ${bc}` }}>
      <div style={{ fontSize: 8, color: lc, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 15, fontWeight: 800, color: c, marginTop: 2 }}>{val}</div>
    </div>
  );
}

