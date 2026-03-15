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

const INIT_PLACEMENTS = [
  { id: uid(), label: "Front", w: 10, h: 12, poli: 10, color: "#C45C3B" },
  { id: uid(), label: "Back", w: 10, h: 14, poli: 12, color: "#3B7CC4" },
  { id: uid(), label: "LC", w: 3.5, h: 3.5, poli: 5, color: "#8B6B3E" },
  { id: uid(), label: "RC", w: 3.5, h: 3.5, poli: 5, color: "#A68B4E" },
  { id: uid(), label: "Manga L", w: 3.5, h: 12, poli: 4, color: "#6B8B3E" },
  { id: uid(), label: "Manga R", w: 3.5, h: 12, poli: 4, color: "#5B7B2E" },
  { id: uid(), label: "Nape", w: 3.5, h: 2, poli: 2, color: "#7B5EA7" },
  { id: uid(), label: "Bolsillo", w: 3, h: 3, poli: 3, color: "#5E9EA7" },
  { id: uid(), label: "Front OS", w: 12, h: 16, poli: 12, color: "#D46A4B" },
  { id: uid(), label: "Back OS", w: 14, h: 18, poli: 15, color: "#4B8AD4" },
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
  const [energyCost, setEnergyCost] = useState(saved?.energyCost ?? 0.01);

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
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
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
        if (pl) { pieces.push({ w: pl.w, h: pl.h, label: pl.label, color: pl.color, _idx: pidx++ }); poli += pl.poli; }
      });
      line.customs.forEach(c => {
        if (c.w && c.h) { const cw = Number(c.w), ch = Number(c.h); pieces.push({ w: cw, h: ch, label: c.label || "Custom", color: c.color || "#9B6B8B", _idx: pidx++ }); poli += Math.max(Math.round((cw * ch) / 12), 3); }
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
    const splitIsCheaper = split.totalCost < nesting.totalCost;
    const bestNesting = splitIsCheaper ? split : nesting;
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

    return { lp, nesting: bestNesting, nestingAll: nesting, nestingSplit: split, splitIsCheaper, totalQty, dtfCost, designFee, fixFee, designCharged, fixCharged, volPct, disc, sub, total, cost, profit, rm, tier, dType, fType, totalPoli, totalPoliCost, totalEnergyCost };
  }, [lines, designWho, designId, fixId, margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliRate, energyCost]);

  // ── RENDER ──
  return (
    <div style={{ background: "#F6F1EB", color: "#2C2420", fontFamily: "'Libre Franklin',sans-serif", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}input,select{font-family:inherit}
        input[type=number]{-moz-appearance:textfield}input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none}
        ::selection{background:#C45C3B;color:white}
        .S{background:white;border-radius:12px;border:1px solid #E8E0D6;margin-bottom:14px;overflow:hidden}
        .SH{padding:10px 14px;border-bottom:1px solid #E8E0D6;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .SB{padding:14px}
        .I{background:#FAF7F4;border:1.5px solid #E0D8CE;border-radius:7px;padding:5px 9px;font-size:13px;color:#2C2420;width:100%;transition:border-color .2s}
        .I:focus{outline:none;border-color:#C45C3B}.Is{font-size:11px;padding:4px 7px}
        .SL{appearance:none;background:#FAF7F4 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%23999' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 7px center;background-size:10px;border:1.5px solid #E0D8CE;border-radius:7px;padding:5px 24px 5px 9px;font-size:13px;color:#2C2420;width:100%;cursor:pointer}
        .SL:focus{outline:none;border-color:#C45C3B}.SLs{font-size:11px;padding:4px 22px 4px 6px}
        .BA{width:100%;padding:8px;border-radius:7px;border:1.5px dashed #D4CBC0;background:transparent;color:#A09080;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s}
        .BA:hover{border-color:#C45C3B;color:#C45C3B}
        .T{display:inline-block;padding:3px 8px;border-radius:5px;font-size:10px;font-weight:600}
        .L{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#8C7E70;font-weight:600;margin-bottom:3px}
        .R{display:flex;gap:6px;align-items:center}
        .G2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .G3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
        .tb{padding:6px 16px;border:none;background:transparent;font-size:12px;font-weight:600;color:#A09080;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
        .tb.a{color:#C45C3B;border-bottom-color:#C45C3B}.tb:hover{color:#2C2420}
        .DB{width:20px;height:20px;border-radius:5px;border:none;background:transparent;color:#C4A08B;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .DB:hover{background:#F0D0C0;color:#C45C3B}
        .PC{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;border:1.5px solid transparent;transition:all .12s;user-select:none}
        .PC.off{background:#F5F0EB;color:#A09080;border-color:#E0D8CE}.PC.off:hover{border-color:#C4A08B}
        .PC.on{color:white}
        .ct{padding:5px 12px;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;transition:all .15s}
        @keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fi .25s ease-out}
      `}</style>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "10px 10px 80px" }}>
        <div style={{ textAlign: "center", padding: "16px 0 10px" }}>
          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 26, fontWeight: 800, color: "#C45C3B", letterSpacing: -1 }}>{businessName}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#A09080", marginLeft: 8 }}>DTF Cotizador</span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", borderBottom: "1px solid #E0D8CE", marginBottom: 14 }}>
          <button className={`tb ${tab === "cotizar" ? "a" : ""}`} onClick={() => setTab("cotizar")}>Cotizar</button>
          <button className={`tb ${tab === "config" ? "a" : ""}`} onClick={() => setTab("config")}>⚙ Configuración</button>
        </div>

        {/* ═══ CONFIG ═══ */}
        {tab === "config" && (
          <div className="fi">
            {/* SAVE BAR */}
            <div style={{
              position: "sticky", top: 0, zIndex: 50, marginBottom: 12,
              background: saveStatus === "dirty" ? "#FFF8F0" : saveStatus === "saved" ? "#F0FAF0" : "#FAF7F4",
              border: `1.5px solid ${saveStatus === "dirty" ? "#F0C080" : saveStatus === "saved" ? "#80C880" : "#E0D8CE"}`,
              borderRadius: 10, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
              transition: "all .3s"
            }}>
              <span style={{ fontSize: 12, color: saveStatus === "dirty" ? "#C47A30" : saveStatus === "saved" ? "#2A7A2A" : "#A09080", fontWeight: 600 }}>
                {saveStatus === "dirty" ? "⚠ Cambios sin guardar" : saveStatus === "saved" ? "✅ Guardado — cambios aplicados" : "Configuración"}
              </span>
              <button onClick={handleSave} style={{
                padding: "5px 18px", borderRadius: 7, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer",
                background: saveStatus === "saved" ? "#4A9A4A" : saveStatus === "dirty" ? "#C45C3B" : "#8C7E70",
                color: "white", transition: "all .3s"
              }}>
                {saveStatus === "saved" ? "✓ Guardado" : "Guardar"}
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              {[["negocio","Mi Negocio"],["prendas","Prendas"],["placements","Placements"],["sheets","Hojas DTF"],["poli","Poliamida"],["design","Diseño"],["fix","Corrección"],["vol","Volumen"]].map(([k,v])=>(
                <button key={k} className="ct" onClick={() => setCfgTab(k)}
                  style={{ background: cfgTab === k ? "#2C2420" : "#F0EBE4", color: cfgTab === k ? "#F6F1EB" : "#8C7E70" }}>{v}</button>
              ))}
            </div>

            {/* NEGOCIO */}
            {cfgTab === "negocio" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Mi Negocio</b></div>
                <div className="SB">
                  <div className="L">Nombre del negocio</div>
                  <input className="I" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ marginBottom: 10, fontWeight: 700 }} />
                  <div className="L">Costo energía por prensado (L/prenda)</div>
                  <div className="R"><span style={{ color: "#A09080", fontSize: 11 }}>L</span>
                    <input type="number" className="I" value={energyCost} onChange={e => setEnergyCost(Number(e.target.value) || 0)} step={0.01} style={{ width: 100 }} /></div>
                  <div style={{ fontSize: 10, color: "#A09080", fontStyle: "italic", marginTop: 4 }}>Estos costos son internos, el cliente no los ve.</div>
                </div>
              </div>
            )}

            {/* PRENDAS */}
            {cfgTab === "prendas" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Costos de Prendas</b></div>
                <div className="SB">
                  {prendas.map(p => (
                    <div key={p.id} className="R" style={{ marginBottom: 4 }}>
                      <input className="I Is" value={p.name} onChange={e => upd(setPrendas)(p.id, "name", e.target.value)} style={{ flex: 1 }} />
                      <span style={{ color: "#A09080", fontSize: 11 }}>L</span>
                      <input type="number" className="I Is" value={p.cost} onChange={e => upd(setPrendas)(p.id, "cost", e.target.value)} style={{ width: 70 }} />
                      <button className="DB" onClick={() => del(setPrendas)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 6 }} onClick={add(setPrendas, { name: "Nueva", cost: 0 })}>+ Agregar prenda</button>
                </div>
              </div>
            )}

            {/* PLACEMENTS */}
            {cfgTab === "placements" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Placements</b></div>
                <div className="SB">
                  <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 48px 48px 48px 20px", gap: 4, fontSize: 8, fontWeight: 700, color: "#A09080", marginBottom: 4, letterSpacing: ".05em" }}>
                    <span>COLOR</span><span>NOMBRE</span><span>W″</span><span>H″</span><span>POLI</span><span></span>
                  </div>
                  {placements.map(p => (
                    <div key={p.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr 48px 48px 48px 20px", gap: 4, marginBottom: 3, alignItems: "center" }}>
                      <input type="color" value={p.color} onChange={e => upd(setPlacements)(p.id, "color", e.target.value)}
                        style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
                      <input className="I Is" value={p.label} onChange={e => upd(setPlacements)(p.id, "label", e.target.value)} />
                      <input type="number" className="I Is" value={p.w} onChange={e => upd(setPlacements)(p.id, "w", e.target.value)} step={0.5} style={{ textAlign: "center" }} />
                      <input type="number" className="I Is" value={p.h} onChange={e => upd(setPlacements)(p.id, "h", e.target.value)} step={0.5} style={{ textAlign: "center" }} />
                      <input type="number" className="I Is" value={p.poli} onChange={e => upd(setPlacements)(p.id, "poli", e.target.value)} style={{ textAlign: "center" }} />
                      <button className="DB" onClick={() => del(setPlacements)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 6 }} onClick={add(setPlacements, { label: "Nuevo", w: 5, h: 5, poli: 5, color: "#888888" })}>+ Agregar placement</button>
                </div>
              </div>
            )}

            {/* SHEETS */}
            {cfgTab === "sheets" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Hojas DTF</b></div>
                <div className="SB">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 66px 20px", gap: 4, fontSize: 8, fontWeight: 700, color: "#A09080", marginBottom: 4, letterSpacing: ".05em" }}>
                    <span>NOMBRE</span><span>W″</span><span>H″</span><span>PRECIO</span><span></span>
                  </div>
                  {sheets.map(s => (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 56px 56px 66px 20px", gap: 4, marginBottom: 3 }}>
                      <input className="I Is" value={s.name} onChange={e => upd(setSheets)(s.id, "name", e.target.value)} />
                      <input type="number" className="I Is" value={s.w} onChange={e => upd(setSheets)(s.id, "w", e.target.value)} step={0.01} style={{ textAlign: "center" }} />
                      <input type="number" className="I Is" value={s.h} onChange={e => upd(setSheets)(s.id, "h", e.target.value)} step={0.01} style={{ textAlign: "center" }} />
                      <div className="R"><span style={{ color: "#A09080", fontSize: 10 }}>L</span>
                        <input type="number" className="I Is" value={s.price} onChange={e => upd(setSheets)(s.id, "price", e.target.value)} /></div>
                      <button className="DB" onClick={() => del(setSheets)(s.id)}>×</button>
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 6 }} onClick={add(setSheets, { name: "Nueva", w: 10, h: 10, price: 0 })}>+ Agregar hoja</button>
                </div>
              </div>
            )}

            {/* POLIAMIDA */}
            {cfgTab === "poli" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Poliamida</b></div>
                <div className="SB G2">
                  <div><div className="L">Precio bolsa (L)</div><input type="number" className="I" value={poliBolsa} onChange={e => setPoliBolsa(Number(e.target.value))} /></div>
                  <div><div className="L">Gramos / bolsa</div><input type="number" className="I" value={poliGramos} onChange={e => setPoliGramos(Number(e.target.value))} /></div>
                  <div style={{ gridColumn: "1/-1" }}><span className="T" style={{ background: "#F0E8DC", color: "#8C7E70" }}>= L{poliRate.toFixed(3)}/gramo</span></div>
                </div>
              </div>
            )}

            {/* DESIGN */}
            {cfgTab === "design" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Tarifas de Diseño</b></div>
                <div className="SB">
                  {designTypes.map(d => d.id !== "d0" && (
                    <div key={d.id} style={{ marginBottom: 6, padding: "6px 0", borderBottom: "1px solid #F0EBE4" }}>
                      <div className="R">
                        <input className="I Is" value={d.label} onChange={e => upd(setDesignTypes)(d.id, "label", e.target.value)} style={{ flex: 1 }} placeholder="Nombre" />
                        <span style={{ color: "#A09080", fontSize: 10 }}>L</span>
                        <input type="number" className="I Is" value={d.price} onChange={e => upd(setDesignTypes)(d.id, "price", e.target.value)} style={{ width: 60 }} />
                        <button className="DB" onClick={() => del(setDesignTypes)(d.id)}>×</button>
                      </div>
                      <input className="I Is" value={d.desc} onChange={e => upd(setDesignTypes)(d.id, "desc", e.target.value)} placeholder="Descripción breve..." style={{ marginTop: 3, color: "#8C7E70", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 6 }} onClick={add(setDesignTypes, { label: "Nuevo servicio", price: 0, desc: "" })}>+ Agregar servicio</button>
                </div>
              </div>
            )}

            {/* FIX */}
            {cfgTab === "fix" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Tarifas de Corrección</b></div>
                <div className="SB">
                  <div style={{ marginBottom: 6, padding: "4px 0", borderBottom: "1px solid #F0EBE4", color: "#8C7E70", fontSize: 11 }}>
                    <b>Listo para DTF</b> — {fixTypes.find(f => f.id === "f0")?.desc}
                  </div>
                  {fixTypes.map(f => f.id !== "f0" && (
                    <div key={f.id} style={{ marginBottom: 6, padding: "6px 0", borderBottom: "1px solid #F0EBE4" }}>
                      <div className="R">
                        <input className="I Is" value={f.label} onChange={e => upd(setFixTypes)(f.id, "label", e.target.value)} style={{ flex: 1 }} />
                        <span style={{ color: "#A09080", fontSize: 10 }}>L</span>
                        <input type="number" className="I Is" value={f.price} onChange={e => upd(setFixTypes)(f.id, "price", e.target.value)} style={{ width: 60 }} />
                        <button className="DB" onClick={() => del(setFixTypes)(f.id)}>×</button>
                      </div>
                      <input className="I Is" value={f.desc} onChange={e => upd(setFixTypes)(f.id, "desc", e.target.value)} placeholder="Descripción..." style={{ marginTop: 3, color: "#8C7E70", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="BA" style={{ marginTop: 6 }} onClick={add(setFixTypes, { label: "Nuevo nivel", price: 0, desc: "" })}>+ Agregar nivel</button>
                </div>
              </div>
            )}

            {/* VOLUME */}
            {cfgTab === "vol" && (
              <div className="S"><div className="SH"><b style={{ fontSize: 13 }}>Descuentos por Volumen</b></div>
                <div className="SB">
                  {volTiers.map(t => (
                    <div key={t.id} style={{ marginBottom: 8, padding: 8, background: "#FAF7F4", borderRadius: 8, border: "1px solid #E8E0D6" }}>
                      <div className="R" style={{ marginBottom: 4 }}>
                        <div className="L" style={{ margin: 0 }}>Desde</div>
                        <input type="number" className="I Is" value={t.minQty} onChange={e => upd(setVolTiers)(t.id, "minQty", e.target.value)} style={{ width: 50, textAlign: "center" }} />
                        <div className="L" style={{ margin: 0 }}>hasta</div>
                        <input type="number" className="I Is" value={t.maxQty} onChange={e => upd(setVolTiers)(t.id, "maxQty", e.target.value)} style={{ width: 50, textAlign: "center" }} />
                        <div className="L" style={{ margin: 0 }}>u</div>
                        <button className="DB" style={{ marginLeft: "auto" }} onClick={() => del(setVolTiers)(t.id)}>×</button>
                      </div>
                      <input className="I Is" value={t.desc} onChange={e => upd(setVolTiers)(t.id, "desc", e.target.value)} placeholder="Descripción" style={{ marginBottom: 4 }} />
                      <div className="R">
                        <div className="L" style={{ margin: 0 }}>Desc %</div>
                        <input type="number" className="I Is" value={t.discPct} onChange={e => upd(setVolTiers)(t.id, "discPct", e.target.value)} style={{ width: 45, textAlign: "center" }} />
                        <div className="L" style={{ margin: 0 }}>Diseño desc %</div>
                        <input type="number" className="I Is" value={t.designDisc} onChange={e => upd(setVolTiers)(t.id, "designDisc", e.target.value)} style={{ width: 45, textAlign: "center" }} />
                        <label className="R" style={{ gap: 3, cursor: "pointer" }}>
                          <input type="checkbox" checked={t.fixFree} onChange={e => setVolTiers(p => p.map(x => x.id === t.id ? { ...x, fixFree: e.target.checked } : x))} />
                          <span style={{ fontSize: 10, color: "#8C7E70" }}>Corrección gratis</span>
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
          <div className="fi">
            {/* ① CONFIG */}
            <div className="S">
              <div className="SH"><Num n={1} /><b style={{ fontSize: 13 }}>Pedido</b></div>
              <div className="SB">
                <div className="G2" style={{ marginBottom: 8 }}>
                  <div><div className="L">¿Quién diseña?</div>
                    <select className="SL" value={designWho} onChange={e => { setDesignWho(e.target.value); if (e.target.value === "Cliente trae arte") setDesignId("d0"); }}>
                      <option>Cliente trae arte</option><option>Nosotros diseñamos</option></select></div>
                  <div><div className="L">Tipo de diseño</div>
                    <select className="SL" value={designId} onChange={e => setDesignId(e.target.value)}
                      disabled={designWho === "Cliente trae arte"} style={designWho === "Cliente trae arte" ? { opacity: .4 } : {}}>
                      {designTypes.map(d => <option key={d.id} value={d.id}>{d.label}{d.price ? ` (L${d.price})` : ""}</option>)}</select>
                    {designWho !== "Cliente trae arte" && designTypes.find(d => d.id === designId)?.desc && (
                      <div style={{ fontSize: 10, color: "#A09080", fontStyle: "italic", marginTop: 2 }}>{designTypes.find(d => d.id === designId).desc}</div>
                    )}
                  </div>
                  <div><div className="L">Corrección de archivo</div>
                    <select className="SL" value={fixId} onChange={e => setFixId(e.target.value)}
                      disabled={designWho === "Nosotros diseñamos"} style={designWho === "Nosotros diseñamos" ? { opacity: .4 } : {}}>
                      {fixTypes.map(f => <option key={f.id} value={f.id}>{f.label}{f.price ? ` (L${f.price})` : ""}</option>)}</select>
                    {fixTypes.find(f => f.id === fixId)?.desc && (
                      <div style={{ fontSize: 10, color: "#A09080", fontStyle: "italic", marginTop: 2 }}>{fixTypes.find(f => f.id === fixId).desc}</div>
                    )}
                  </div>
                  <div><div className="L">Margen ganancia %</div>
                    <div className="R"><input type="number" className="I" style={{ textAlign: "center", fontWeight: 700, fontFamily: "'JetBrains Mono'" }}
                      value={margin} onChange={e => setMargin(Number(e.target.value) || 0)} /><span style={{ color: "#A09080", fontSize: 12, flexShrink: 0 }}>%</span></div></div>
                </div>
                {designWho === "Nosotros diseñamos" && <span className="T" style={{ background: "#D8EAF8", color: "#3A6A9A" }}>Corrección = L0 automático</span>}
              </div>
            </div>

            {/* ② LÍNEAS */}
            <div className="S">
              <div className="SH">
                <Num n={2} /><b style={{ fontSize: 13 }}>Líneas</b>
                {calc && <span className="T" style={{ marginLeft: "auto", background: "#F0E8DC", color: "#8C7E70" }}>{calc.totalQty}u — {calc.tier.desc}</span>}
              </div>
              <div className="SB">
                {lines.map((line, i) => (
                  <div key={line.id} style={{ background: "#FAF7F4", border: "1px solid #E8E0D6", borderRadius: 9, padding: 10, marginBottom: 7 }}>
                    <div className="R" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#C4A08B", width: 18, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                      <input type="number" min={0} className="I Is" style={{ width: 48, textAlign: "center", fontWeight: 700, flexShrink: 0 }}
                        placeholder="0" value={line.qty} onChange={e => updLine(i, "qty", e.target.value)} />
                      <select className="SL SLs" value={line.prendaId} onChange={e => updLine(i, "prendaId", e.target.value)} style={{ flex: 1 }}>
                        <option value="">— Prenda —</option>
                        {prendas.map(p => <option key={p.id} value={p.id}>{p.name} (L{p.cost})</option>)}
                        <option value="__otro">Otro</option>
                      </select>
                      <select className="SL SLs" value={line.quien} onChange={e => updLine(i, "quien", e.target.value)} style={{ width: 66, flexShrink: 0 }}>
                        <option>Yo</option><option>Cliente</option></select>
                      <button className="DB" onClick={() => setLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}>×</button>
                    </div>

                    {line.prendaId === "__otro" && (
                      <div className="R" style={{ marginBottom: 6, marginLeft: 22 }}>
                        <input className="I Is" placeholder="Nombre (Gorra, Tote...)" style={{ flex: 1 }}
                          value={line.otroName} onChange={e => updLine(i, "otroName", e.target.value)} />
                        <span style={{ color: "#A09080", fontSize: 10 }}>L</span>
                        <input type="number" className="I Is" placeholder="Costo" style={{ width: 60 }}
                          value={line.otroCost} onChange={e => updLine(i, "otroCost", e.target.value)} />
                      </div>
                    )}

                    <div style={{ marginLeft: 22 }}>
                      <div className="L">Placements</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {placements.map(pl => {
                          const on = line.placementIds.includes(pl.id);
                          return (
                            <div key={pl.id} className={`PC ${on ? "on" : "off"}`}
                              style={on ? { background: pl.color, borderColor: pl.color } : {}}
                              onClick={() => togglePl(i, pl.id)}>
                              <span style={{ fontSize: 8, opacity: .7 }}>{pl.w}×{pl.h}</span> {pl.label}
                            </div>
                          );
                        })}
                      </div>
                      {line.customs.map((c, ci) => (
                        <div key={ci} className="R" style={{ marginTop: 4 }}>
                          <input className="I Is" placeholder="Nombre" style={{ width: 80 }} value={c.label} onChange={e => updCustom(i, ci, "label", e.target.value)} />
                          <input type="number" step={0.5} className="I Is" placeholder='W"' style={{ width: 48, textAlign: "center" }} value={c.w} onChange={e => updCustom(i, ci, "w", e.target.value)} />
                          <span style={{ color: "#C4A08B", fontWeight: 700, fontSize: 11 }}>×</span>
                          <input type="number" step={0.5} className="I Is" placeholder='H"' style={{ width: 48, textAlign: "center" }} value={c.h} onChange={e => updCustom(i, ci, "h", e.target.value)} />
                          <button className="DB" onClick={() => delCustom(i, ci)}>×</button>
                        </div>
                      ))}
                      <button onClick={() => addCustom(i)} style={{ marginTop: 4, background: "transparent", border: "1px dashed #D4CBC0", borderRadius: 5, padding: "2px 8px", fontSize: 10, color: "#A09080", cursor: "pointer", fontWeight: 600 }}>+ Custom</button>
                    </div>
                  </div>
                ))}
                <button className="BA" onClick={() => setLines(p => [...p, emptyLine()])}>+ Agregar línea</button>
              </div>
            </div>

            {calc && (
              <>
                {/* ③ NESTING */}
                <div className="S fi">
                  <div className="SH" style={{ background: "#2C2420", borderColor: "#2C2420" }}>
                    <Num n={3} /><span style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Hojas DTF</span>
                    <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 14, fontWeight: 700, color: "#C45C3B" }}>
                      {calc.nesting.results.length} hoja{calc.nesting.results.length !== 1 ? "s" : ""} — L{calc.dtfCost}
                    </span>
                  </div>
                  <div style={{ padding: 14, background: "#1E1A16" }}>
                    {/* Comparison banner */}
                    {calc.nestingAll.totalCost !== calc.nestingSplit.totalCost && (
                      <div style={{ marginBottom: 14, padding: 10, borderRadius: 8, border: "1px solid #4A4035", background: "#2A2520" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#A09080", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Comparación de opciones</div>
                        <div className="R" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                          <span style={{ fontSize: 12, color: calc.splitIsCheaper ? "#8C7E70" : "#4ACA6A" }}>
                            {calc.splitIsCheaper ? "" : "✅ "} Todo junto ({calc.nestingAll.results.length} hoja{calc.nestingAll.results.length !== 1 ? "s" : ""}: {calc.nestingAll.results.map(r => r.sheet.name).join(" + ")})
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 700, color: calc.splitIsCheaper ? "#8C7E70" : "#4ACA6A" }}>L{calc.nestingAll.totalCost}</span>
                        </div>
                        <div className="R" style={{ justifyContent: "space-between", padding: "4px 0" }}>
                          <span style={{ fontSize: 12, color: calc.splitIsCheaper ? "#4ACA6A" : "#8C7E70" }}>
                            {calc.splitIsCheaper ? "✅ " : ""} Separadas ({calc.nestingSplit.results.length} hoja{calc.nestingSplit.results.length !== 1 ? "s" : ""}: {calc.nestingSplit.results.map(r => r.sheet.name).join(" + ")})
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 700, color: calc.splitIsCheaper ? "#4ACA6A" : "#8C7E70" }}>L{calc.nestingSplit.totalCost}</span>
                        </div>
                        {calc.splitIsCheaper && (
                          <div style={{ fontSize: 10, color: "#4ACA6A", marginTop: 4, fontWeight: 600 }}>
                            💡 Hojas separadas ahorra L{calc.nestingAll.totalCost - calc.nestingSplit.totalCost}
                          </div>
                        )}
                      </div>
                    )}
                    {calc.nesting.results.map((res, ri) => {
                      const { sheet, placed } = res;
                      const maxH = placed.length ? Math.max(...placed.map(p => p.y + p.h)) : sheet.h;
                      const dH = Math.min(maxH + 2, sheet.h);
                      const svW = 340, sc = svW / sheet.w, svH = dH * sc, pd = 22;
                      return (
                        <div key={ri} style={{ marginBottom: ri < calc.nesting.results.length - 1 ? 18 : 0 }}>
                          <div className="R" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ color: "#E8DDD0", fontSize: 14, fontWeight: 700 }}>{sheet.name}
                              <span style={{ color: "#8C7E70", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{sheet.w}″ × {sheet.h}″</span></span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "#C45C3B", fontSize: 16, fontWeight: 700 }}>L{sheet.price}</span>
                          </div>
                          <svg width="100%" viewBox={`${-pd} ${-pd} ${svW + pd * 2} ${svH + pd * 2}`} style={{ display: "block", maxWidth: svW + pd * 2 }}>
                            <defs>
                              <pattern id={`g${ri}`} width={sc} height={sc} patternUnits="userSpaceOnUse"><rect width={sc} height={sc} fill="none" stroke="#2A2520" strokeWidth=".3" /></pattern>
                              <pattern id="ht" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.1)" strokeWidth="1" /></pattern>
                              <filter id="sh"><feDropShadow dx="1" dy="1" stdDeviation="1.5" floodOpacity=".25" /></filter>
                            </defs>
                            <rect x={0} y={0} width={svW} height={svH} rx={4} fill="#242018" stroke="#4A4035" strokeWidth={1.5} />
                            <rect x={0} y={0} width={svW} height={svH} rx={4} fill={`url(#g${ri})`} />
                            {placed.map((p, pi) => {
                              const px = p.x * sc + 1, py = p.y * sc + 1, pw = p.w * sc - 2, ph = p.h * sc - 2;
                              const sl = pw > 26 && ph > 14, sd = pw > 18 && ph > 10;
                              return (
                                <g key={pi} filter="url(#sh)">
                                  <rect x={px} y={py} width={pw} height={ph} rx={3} fill={p.color || "#888"} fillOpacity={.88} />
                                  <rect x={px} y={py} width={pw} height={ph} rx={3} fill="url(#ht)" />
                                  <rect x={px} y={py} width={pw} height={ph} rx={3} fill="none" stroke="rgba(255,255,255,.2)" strokeWidth={1} />
                                  {sl && <text x={px + pw / 2} y={py + ph / 2 - (sd ? 4 : 0)} textAnchor="middle" dominantBaseline="central"
                                    fill="white" fontSize={Math.min(11, pw / 5)} fontWeight="700" style={{ fontFamily: "'Libre Franklin'" }}>{p.label}</text>}
                                  {sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 9} textAnchor="middle"
                                    fill="rgba(255,255,255,.5)" fontSize={Math.min(8, pw / 7)} style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}″</text>}
                                  {!sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 3} textAnchor="middle"
                                    fill="white" fontSize={6} fontWeight="600" style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}</text>}
                                </g>
                              );
                            })}
                            <line x1={0} y1={-8} x2={svW} y2={-8} stroke="#6A6055" strokeWidth={.6} />
                            <line x1={0} y1={-12} x2={0} y2={-4} stroke="#6A6055" strokeWidth={.6} />
                            <line x1={svW} y1={-12} x2={svW} y2={-4} stroke="#6A6055" strokeWidth={.6} />
                            <text x={svW / 2} y={-13} textAnchor="middle" fill="#8C7E70" fontSize={8} style={{ fontFamily: "'JetBrains Mono'" }}>{sheet.w}″</text>
                            <line x1={-8} y1={0} x2={-8} y2={svH} stroke="#6A6055" strokeWidth={.6} />
                            <line x1={-12} y1={0} x2={-4} y2={0} stroke="#6A6055" strokeWidth={.6} />
                            <line x1={-12} y1={svH} x2={-4} y2={svH} stroke="#6A6055" strokeWidth={.6} />
                            <text x={-12} y={svH / 2} textAnchor="middle" fill="#8C7E70" fontSize={8}
                              transform={`rotate(-90,-12,${svH / 2})`} style={{ fontFamily: "'JetBrains Mono'" }}>{dH.toFixed(1)}″</text>
                          </svg>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                            {[...new Map(placed.map(p => [p.label, p.color])).entries()].map(([l, c]) => (
                              <div key={l} className="R" style={{ gap: 4 }}>
                                <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
                                <span style={{ fontSize: 10, color: "#A09080" }}>{l}</span>
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
                  <div className="SH"><Num n={4} /><b style={{ fontSize: 13 }}>Desglose</b></div>
                  <div className="SB">
                    {calc.lp.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F0EBE4", fontSize: 12 }}>
                        <div><b>{l.qty}×</b> {l.prendaLabel} <span style={{ color: "#A09080", fontSize: 10 }}>({l.cfgLabel})</span>
                          {l.quien === "Cliente" && <span className="T" style={{ background: "#FFF3E0", color: "#C47A3B", marginLeft: 4, fontSize: 8 }}>cliente pone</span>}</div>
                        <div style={{ whiteSpace: "nowrap" }}><span style={{ color: "#A09080", fontSize: 10 }}>L{l.sellPrice}/u = </span><b>L{l.lineTotal}</b></div>
                      </div>
                    ))}
                    <div style={{ marginTop: 6, marginBottom: 2 }}>
                      <div className="L" style={{ marginBottom: 6 }}>Mis costos (no visible al cliente)</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 10, color: "#A09080", borderBottom: "1px solid #F0EBE4" }}>
                      <span>Prendas en blanco</span><span>L{Math.round(calc.lp.reduce((s, l) => s + l.prendaCost * l.qty, 0))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 10, color: "#A09080", borderBottom: "1px solid #F0EBE4" }}>
                      <span>Hojas DTF: {calc.nesting.results.map(r => r.sheet.name).join(" + ")}</span><span>L{calc.dtfCost}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 10, color: "#A09080", borderBottom: "1px solid #F0EBE4" }}>
                      <span>Poliamida: {calc.totalPoli}g × L{poliRate.toFixed(2)}/g</span><span>L{calc.totalPoliCost.toFixed(2)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 10, color: "#A09080", borderBottom: "1px solid #F0EBE4" }}>
                      <span>Energía: {calc.totalQty} prenda{calc.totalQty !== 1 ? "s" : ""} × L{energyCost}</span><span>L{calc.totalEnergyCost.toFixed(2)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 11, fontWeight: 600, color: "#8C7E70", borderBottom: "1px solid #E0D8CE" }}>
                      <span>Total mi costo</span><span>L{Math.round(calc.cost)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0 3px", fontSize: 13, fontWeight: 700 }}>
                      <span>Subtotal</span><span>L{calc.sub}</span></div>
                    {calc.disc > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12, color: "#4A7A4A" }}>
                      <span>Desc. {calc.volPct}%</span><b>-L{calc.disc}</b></div>}
                    {calc.designFee > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                      <span>Diseño: {calc.dType?.label}{calc.designCharged === 0 ? " ✅" : calc.designCharged < calc.designFee ? " (50%)" : ""}</span>
                      <b style={{ color: calc.designCharged === 0 ? "#4A7A4A" : undefined }}>{calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}</b></div>}
                    {calc.fixFee > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                      <span>Corrección{calc.fixCharged === 0 ? " ✅" : ""}</span>
                      <b style={{ color: calc.fixCharged === 0 ? "#4A7A4A" : undefined }}>{calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}</b></div>}

                    <div style={{ textAlign: "center", padding: 18, background: "linear-gradient(135deg,#2C2420,#3D322C)", borderRadius: 10, color: "white", marginTop: 12 }}>
                      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".15em", color: "#A09080" }}>Cobrar al cliente</div>
                      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 36, fontWeight: 800, marginTop: 4 }}>L{calc.total.toLocaleString()}</div>
                    </div>
                    <div className="G3" style={{ marginTop: 10 }}>
                      <SB label="Mi costo" val={`L${Math.round(calc.cost)}`} />
                      <SB label="Ganancia" val={`L${Math.round(calc.profit)}`} g />
                      <SB label="Margen" val={`${calc.rm.toFixed(1)}%`} g={calc.rm >= 30} b={calc.rm < 30} />
                    </div>
                  </div>
                </div>

                {/* ⑤ RESUMEN */}
                <div className="S fi">
                  <div className="SH"><Num n={5} /><b style={{ fontSize: 13 }}>Resumen WhatsApp</b>
                    <button onClick={() => { const e = document.getElementById("rt"); if (e) navigator.clipboard.writeText(e.innerText).catch(() => {}); }}
                      style={{ marginLeft: "auto", background: "#FAF7F4", border: "1px solid #E0D8CE", borderRadius: 5, padding: "3px 12px", fontSize: 10, fontWeight: 600, color: "#C45C3B", cursor: "pointer" }}>Copiar</button>
                  </div>
                  <div className="SB">
                    <div id="rt" style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, lineHeight: 1.7, color: "#4A4035", background: "#FAF7F4", borderRadius: 7, padding: 12, border: "1px solid #E8E0D6", userSelect: "all" }}>
                      <div style={{ fontWeight: 700, color: "#C45C3B", marginBottom: 3 }}>COTIZACIÓN {businessName} DTF</div>
                      {calc.lp.map((l, i) => <div key={i}>{l.qty}× {l.prendaLabel} ({l.cfgLabel}){l.quien === "Cliente" ? " — cliente pone" : ""} — L{l.sellPrice}/u</div>)}
                      {calc.disc > 0 && <div style={{ color: "#4A7A4A" }}>Desc. {calc.volPct}%: -L{calc.disc}</div>}
                      {calc.designFee > 0 && <div>Diseño: {calc.designCharged === 0 ? "Incluido ✅" : `L${calc.designCharged}`}</div>}
                      {calc.fixFee > 0 && <div>Corrección: {calc.fixCharged === 0 ? "Incluida ✅" : `L${calc.fixCharged}`}</div>}
                      <div style={{ fontWeight: 700, color: "#C45C3B", fontSize: 14, marginTop: 5 }}>TOTAL: L{calc.total.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </>
            )}
            {!calc && <div style={{ textAlign: "center", padding: "50px 20px", color: "#C4B8A8" }}><div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>Agregá líneas con cantidad y placements</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Num({ n }) {
  return <span style={{ background: "#C45C3B", color: "white", width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{n}</span>;
}

function SB({ label, val, g, b }) {
  const bg = g ? "#F0F7F0" : b ? "#FFF0F0" : "#FAF7F4";
  const bc = g ? "#D0E8D0" : b ? "#F0D0D0" : "#E8E0D6";
  const c = g ? "#2A5A2A" : b ? "#AA3A3A" : "#2C2420";
  return (
    <div style={{ background: bg, borderRadius: 7, padding: "6px 8px", textAlign: "center", border: `1px solid ${bc}` }}>
      <div style={{ fontSize: 8, color: g ? "#4A7A4A" : b ? "#AA3A3A" : "#A09080", textTransform: "uppercase", letterSpacing: ".07em" }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 14, fontWeight: 700, color: c, marginTop: 1 }}>{val}</div>
    </div>
  );
}
