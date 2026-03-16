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
const EDGE = 0.15;

// ── SHELF PACKING ──
function shelfPack(pieces, sw, sh) {
  const uw = sw - EDGE * 2, uh = sh - EDGE * 2;
  if (!pieces.length) return { fits: false, placed: [] };
  const sorted = [...pieces].sort((a, b) => b.h - a.h || b.w - a.w);
  const shelves = []; let curY = 0; const placed = [];
  for (const p of sorted) {
    let did = false;
    for (const s of shelves) {
      if (s.x + p.w <= uw + 0.01 && p.h <= s.h + 0.01) {
        placed.push({ ...p, x: s.x + EDGE, y: s.y + EDGE });
        s.x += p.w + GAP; did = true; break;
      }
    }
    if (!did) {
      const ny = curY + (shelves.length ? GAP : 0);
      if (ny + p.h > uh + 0.01 || p.w > uw + 0.01) continue;
      placed.push({ ...p, x: EDGE, y: ny + EDGE });
      shelves.push({ y: ny, h: p.h, x: p.w + GAP });
      curY = ny + p.h;
    }
  }
  return { fits: placed.length === pieces.length, placed };
}

// Greedy: pack remaining pieces onto cheapest-possible sheets
function findBestSheets(allPieces, sheets) {
  if (!allPieces.length) return { results: [], totalCost: 0 };
  // Sort sheets by price ascending so we always try cheapest first
  const sortedSheets = [...sheets].sort((a, b) => a.price - b.price);
  let rem = [...allPieces];
  const results = [];
  let safe = 60; // enough iterations for large orders
  while (rem.length > 0 && safe-- > 0) {
    let bestSheet = null, bestPlaced = [], bestRemaining = rem.length;
    // Try each sheet: pick the cheapest that fits the most pieces
    for (const sh of sortedSheets) {
      const pk = shelfPack(rem, sh.w, sh.h);
      if (!pk.placed.length) continue;
      const remaining = rem.length - pk.placed.length;
      // Prefer: fits everything → cheapest wins; else → most pieces placed
      if (pk.fits) {
        // This sheet fits all remaining — cheapest (first in sorted list) wins
        bestSheet = sh; bestPlaced = pk.placed; bestRemaining = 0;
        break; // sortedSheets is price-sorted, so first fit is cheapest
      }
      if (pk.placed.length > bestPlaced.length ||
          (pk.placed.length === bestPlaced.length && sh.price < (bestSheet?.price ?? Infinity))) {
        bestSheet = sh; bestPlaced = pk.placed; bestRemaining = remaining;
      }
    }
    if (!bestSheet || !bestPlaced.length) break;
    results.push({ sheet: bestSheet, placed: bestPlaced });
    const usedIdx = new Set(bestPlaced.map(p => p._idx));
    rem = rem.filter(p => !usedIdx.has(p._idx));
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

    const lineDetails = active.map((line) => {
      const qty = Number(line.qty);
      const piecesPerUnit = []; let poli = 0;
      line.placementIds.forEach(pid => {
        const pl = placements.find(p => p.id === pid);
        if (pl) { piecesPerUnit.push({ w: pl.w, h: pl.h, label: pl.label, color: pl.color }); poli += calcPoli(pl.w, pl.h); }
      });
      line.customs.forEach(c => {
        if (c.w && c.h) {
          const cw = Number(c.w), ch = Number(c.h);
          piecesPerUnit.push({ w: cw, h: ch, label: c.label || "Custom", color: c.color || "#22D3EE" });
          poli += calcPoli(cw, ch);
        }
      });
      // *** KEY FIX: repeat each piece qty times ***
      for (let u = 0; u < qty; u++) {
        piecesPerUnit.forEach(p => allPieces.push({ ...p, _idx: pidx++ }));
      }

      const pr = prendas.find(p => p.id === line.prendaId);
      const prendaCost = line.quien === "Cliente" ? 0 : (pr ? pr.cost : Number(line.otroCost) || 0);
      const prendaLabel = pr ? pr.name : (line.otroName || "Otro");
      const cfgLabel = [...line.placementIds.map(pid => placements.find(p => p.id === pid)?.label || "?"),
        ...line.customs.filter(c => c.w && c.h).map(c => `${c.label} ${c.w}×${c.h}`)].join(" + ");
      return { ...line, qty, pieces: piecesPerUnit, poli, poliCost: poli * poliRate, prendaCost, prendaLabel, cfgLabel };
    });

    const nesting = findBestSheets(allPieces, sheets);
    const dtfCost = nesting.totalCost;
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

    return { lp, nesting, totalQty, dtfCost, designFee, fixFee, designCharged, fixCharged, volPct, disc, sub, total, cost, profit, rm, tier, dType, fType, totalPoli, totalPoliCost, totalEnergyCost };
  }, [lines, designWho, designId, fixId, margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliRate, energyCost]);


  // ── RENDER ──
  return (
    <div style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "'Sora',sans-serif", minHeight: "100dvh", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        :root {
          --bg: #080A10;
          --bg2: #0D1018;
          --bg3: #131720;
          --border: #1E2535;
          --border2: #252D3F;
          --accent: #22D3EE;
          --accent-dim: rgba(34,211,238,.12);
          --accent-glow: rgba(34,211,238,.25);
          --text: #E2E8F4;
          --text2: #94A3B8;
          --text3: #4A5568;
          --green: #34D399;
          --red: #F87171;
          --warn: #FBBF24;
          --radius: 14px;
          --radius-sm: 8px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; font-size: 16px; }
        body { background: var(--bg); overscroll-behavior-y: none; }
        input, select, button { font-family: inherit; }
        input[type=number] { -moz-appearance: textfield; }
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button { -webkit-appearance: none; }
        ::selection { background: var(--accent); color: var(--bg); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }

        /* ── CARDS ── */
        .card {
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          margin-bottom: 12px;
          overflow: hidden;
          transition: border-color .2s;
        }
        .card-head {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          background: var(--bg3);
        }
        .card-body { padding: 16px; }

        /* ── INPUTS ── */
        .inp {
          background: var(--bg);
          border: 1.5px solid var(--border2);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          font-size: 14px;
          color: var(--text);
          width: 100%;
          transition: border-color .2s, box-shadow .2s;
          -webkit-appearance: none;
          min-height: 44px;
        }
        .inp:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-dim);
        }
        .inp-sm { font-size: 12px; padding: 8px 10px; min-height: 38px; }
        .sel {
          appearance: none;
          -webkit-appearance: none;
          background: var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center;
          background-size: 10px;
          border: 1.5px solid var(--border2);
          border-radius: var(--radius-sm);
          padding: 10px 32px 10px 12px;
          font-size: 14px;
          color: var(--text);
          width: 100%;
          cursor: pointer;
          min-height: 44px;
          transition: border-color .2s;
        }
        .sel:focus { outline: none; border-color: var(--accent); }
        .sel-sm { font-size: 12px; padding: 8px 28px 8px 10px; min-height: 38px; }

        /* ── BUTTONS ── */
        .btn-add {
          width: 100%;
          padding: 11px;
          border-radius: var(--radius-sm);
          border: 1.5px dashed var(--border2);
          background: transparent;
          color: var(--text3);
          font-size: 13px;
          cursor: pointer;
          font-weight: 600;
          transition: all .2s;
          min-height: 44px;
        }
        .btn-add:hover { border-color: var(--accent); color: var(--accent); }
        .btn-del {
          width: 36px; height: 36px; min-width: 36px;
          border-radius: 8px; border: none;
          background: transparent; color: var(--text3);
          cursor: pointer; font-size: 16px;
          display: flex; align-items: center; justify-content: center;
          transition: all .15s; flex-shrink: 0;
        }
        .btn-del:hover { background: rgba(248,113,113,.1); color: var(--red); }
        .btn-save {
          padding: 10px 22px;
          border-radius: var(--radius-sm);
          border: none;
          font-weight: 700; font-size: 13px;
          cursor: pointer;
          min-height: 44px;
          transition: all .25s;
        }

        /* ── TABS ── */
        .tab-btn {
          padding: 12px 20px;
          border: none; background: transparent;
          font-size: 14px; font-weight: 600;
          color: var(--text3); cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all .2s; white-space: nowrap;
          min-height: 44px;
        }
        .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab-btn:hover:not(.active) { color: var(--text2); }

        /* ── PILLS ── */
        .pill {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
        }
        .cfg-pill {
          padding: 8px 16px; min-height: 36px;
          border: 1.5px solid var(--border);
          border-radius: 20px;
          font-size: 12px; font-weight: 600;
          cursor: pointer;
          transition: all .15s;
          background: transparent;
          color: var(--text2);
          white-space: nowrap;
        }
        .cfg-pill.active {
          background: var(--accent);
          color: var(--bg);
          border-color: var(--accent);
        }
        .cfg-pill:hover:not(.active) { border-color: var(--accent); color: var(--accent); }

        /* ── PLACEMENT CHIPS ── */
        .pl-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 11px;
          border-radius: 8px; border: 1.5px solid var(--border2);
          font-size: 11px; font-weight: 600;
          cursor: pointer;
          transition: all .15s;
          user-select: none;
          color: var(--text2);
          min-height: 34px;
          -webkit-tap-highlight-color: transparent;
        }
        .pl-chip:hover { border-color: var(--text2); }
        .pl-chip.on { color: #fff; border-color: transparent; }

        /* ── LINE CARD ── */
        .line-card {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 14px;
          margin-bottom: 10px;
          transition: border-color .2s;
        }
        .line-card:hover { border-color: var(--border2); }

        /* ── LABEL ── */
        .lbl {
          font-size: 10px; text-transform: uppercase;
          letter-spacing: .1em; color: var(--text3);
          font-weight: 700; margin-bottom: 5px;
        }

        /* ── LAYOUT ── */
        .row { display: flex; gap: 8px; align-items: center; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

        /* ── ANIMATIONS ── */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp .3s ease-out both; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.4} }
        .blink { animation: blink 1.4s infinite; }

        /* ── MOBILE NAV BAR ── */
        .mobile-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: rgba(13,16,24,.92);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-top: 1px solid var(--border);
          z-index: 200;
          padding: 0;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .mobile-nav-inner {
          display: flex;
          height: 58px;
        }
        .mobile-nav-btn {
          flex: 1; border: none; background: transparent;
          color: var(--text3); cursor: pointer;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 3px;
          font-size: 10px; font-weight: 700;
          letter-spacing: .05em; text-transform: uppercase;
          transition: color .15s;
          -webkit-tap-highlight-color: transparent;
        }
        .mobile-nav-btn.active { color: var(--accent); }
        .mobile-nav-btn svg { width: 22px; height: 22px; }

        /* ── RESPONSIVE ── */
        @media (max-width: 599px) {
          .mobile-nav { display: block; }
          .desktop-tabs { display: none !important; }
          .page-pad { padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important; }
          .grid2 { grid-template-columns: 1fr; gap: 10px; }
          .cfg-pills-scroll { overflow-x: auto; flex-wrap: nowrap !important; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
          .cfg-pills-scroll::-webkit-scrollbar { display: none; }
          .card-body { padding: 12px; }
          .card-head { padding: 11px 12px; }
          .hero-total { font-size: 42px !important; }
        }
        @media (min-width: 600px) and (max-width: 959px) {
          .mobile-nav { display: none !important; }
          .desktop-tabs { display: flex !important; }
          .grid2 { grid-template-columns: 1fr 1fr; }
        }
        @media (min-width: 960px) {
          .mobile-nav { display: none !important; }
          .desktop-tabs { display: flex !important; }
          .grid2 { grid-template-columns: 1fr 1fr; }
          .card { margin-bottom: 14px; }
        }
      `}</style>

      {/* ── TOPBAR ── */}
      <header style={{
        background: "rgba(13,16,24,.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "var(--accent-dim)", border: "1px solid var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="var(--accent)" strokeWidth="1.4"/>
                  <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="var(--accent)" strokeWidth="1.4"/>
                  <path d="M4 8h8M6 11h4" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-.3px", lineHeight: 1.1 }}>{businessName}</div>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'JetBrains Mono'", letterSpacing: ".06em" }}>DTF · COTIZADOR</div>
              </div>
            </div>
            {/* Save indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {saveStatus === "saved" && (
                <span className="fade-up" style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="var(--green)" strokeWidth="1.4"/><path d="M3.5 6l1.8 1.8L8.5 4" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Guardado
                </span>
              )}
              {saveStatus === "dirty" && (
                <span className="blink" style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>● guardando…</span>
              )}
            </div>
          </div>
          {/* Desktop tabs */}
          <div className="desktop-tabs" style={{ display: "flex", borderTop: "1px solid var(--border)", overflowX: "auto" }}>
            <button className={`tab-btn ${tab === "cotizar" ? "active" : ""}`} onClick={() => setTab("cotizar")}>
              Cotizar
            </button>
            <button className={`tab-btn ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
              Configuración
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "16px 16px 80px" }} className="page-pad">

        {/* ══ CONFIG ══ */}
        {tab === "config" && (
          <div className="fade-up">
            {/* Save bar */}
            <div style={{
              marginBottom: 14,
              background: "var(--bg2)",
              border: `1.5px solid ${saveStatus === "dirty" ? "var(--warn)" : saveStatus === "saved" ? "var(--green)" : "var(--border)"}`,
              borderRadius: 12, padding: "10px 16px",
              transition: "border-color .3s",
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: saveStatus === "dirty" ? "var(--warn)" : saveStatus === "saved" ? "var(--green)" : "var(--text2)" }}>
                  {saveStatus === "dirty" ? "⚠ Cambios sin guardar" : saveStatus === "saved" ? "✓ Guardado exitosamente" : "Configuración del negocio"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>Los cambios se auto-guardan. Este botón fuerza el guardado.</div>
              </div>
              <button className="btn-save" onClick={handleSave} style={{
                background: saveStatus === "saved" ? "var(--green)" : saveStatus === "dirty" ? "var(--accent)" : "var(--border2)",
                color: saveStatus === "idle" ? "var(--text2)" : "var(--bg)",
                flexShrink: 0,
              }}>
                {saveStatus === "saved" ? "✓ Listo" : "Guardar"}
              </button>
            </div>

            {/* Config tab pills */}
            <div className="cfg-pills-scroll" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {[["negocio","Mi Negocio"],["prendas","Prendas"],["placements","Placements"],["sheets","Hojas DTF"],["poli","Poliamida"],["design","Diseño"],["fix","Corrección"],["vol","Volumen"]].map(([k,v]) => (
                <button key={k} className={`cfg-pill ${cfgTab === k ? "active" : ""}`} onClick={() => setCfgTab(k)}>{v}</button>
              ))}
            </div>

            {/* NEGOCIO */}
            {cfgTab === "negocio" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Mi Negocio</span></div>
                <div className="card-body">
                  <div style={{ marginBottom: 14 }}>
                    <div className="lbl">Nombre del negocio</div>
                    <input className="inp" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ fontWeight: 700, fontSize: 16 }} />
                  </div>
                  <div>
                    <div className="lbl">Costo energía por prensado (L/prenda)</div>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ color: "var(--text3)", fontFamily: "'JetBrains Mono'", fontSize: 13 }}>L</span>
                      <input type="number" className="inp" value={energyCost} onChange={e => setEnergyCost(Number(e.target.value) || 0)} step={0.01} style={{ maxWidth: 120, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)", background: "var(--bg)", borderRadius: 8, padding: "8px 12px", border: "1px solid var(--border)", fontFamily: "'JetBrains Mono'" }}>
                      ENEE L4.62/kWh (2026) · Prensa 1800W×20s ≈ L0.15–0.25/prenda
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PRENDAS */}
            {cfgTab === "prendas" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Costos de Prendas</span></div>
                <div className="card-body">
                  {prendas.map(p => (
                    <div key={p.id} className="row" style={{ marginBottom: 8 }}>
                      <input className="inp inp-sm" value={p.name} onChange={e => upd(setPrendas)(p.id, "name", e.target.value)} style={{ flex: 1 }} />
                      <span style={{ color: "var(--text3)", fontSize: 12, fontFamily: "'JetBrains Mono'" }}>L</span>
                      <input type="number" className="inp inp-sm" value={p.cost} onChange={e => upd(setPrendas)(p.id, "cost", e.target.value)} style={{ width: 84, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <button className="btn-del" onClick={() => del(setPrendas)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="btn-add" style={{ marginTop: 4 }} onClick={add(setPrendas, { name: "Nueva prenda", cost: 0 })}>+ Agregar prenda</button>
                </div>
              </div>
            )}

            {/* PLACEMENTS */}
            {cfgTab === "placements" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Placements</span></div>
                <div className="card-body">
                  <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 56px 56px 36px", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>
                    <span></span><span>Nombre</span><span>W″</span><span>H″</span><span></span>
                  </div>
                  {placements.map(p => (
                    <div key={p.id} style={{ display: "grid", gridTemplateColumns: "32px 1fr 56px 56px 36px", gap: 6, marginBottom: 6, alignItems: "center" }}>
                      <input type="color" value={p.color} onChange={e => upd(setPlacements)(p.id, "color", e.target.value)}
                        style={{ width: 30, height: 30, border: "2px solid var(--border2)", background: "none", cursor: "pointer", padding: 0, borderRadius: 7 }} />
                      <input className="inp inp-sm" value={p.label} onChange={e => upd(setPlacements)(p.id, "label", e.target.value)} />
                      <input type="number" className="inp inp-sm" value={p.w} onChange={e => upd(setPlacements)(p.id, "w", e.target.value)} step={0.5} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="inp inp-sm" value={p.h} onChange={e => upd(setPlacements)(p.id, "h", e.target.value)} step={0.5} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <button className="btn-del" onClick={() => del(setPlacements)(p.id)}>×</button>
                    </div>
                  ))}
                  <button className="btn-add" style={{ marginTop: 4 }} onClick={add(setPlacements, { label: "Nuevo", w: 5, h: 5, color: "#22D3EE" })}>+ Agregar placement</button>
                </div>
              </div>
            )}

            {/* SHEETS */}
            {cfgTab === "sheets" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Hojas DTF</span></div>
                <div className="card-body">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 76px 36px", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>
                    <span>Nombre</span><span>W″</span><span>H″</span><span>Precio L</span><span></span>
                  </div>
                  {sheets.map(s => (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 76px 36px", gap: 6, marginBottom: 6 }}>
                      <input className="inp inp-sm" value={s.name} onChange={e => upd(setSheets)(s.id, "name", e.target.value)} />
                      <input type="number" className="inp inp-sm" value={s.w} onChange={e => upd(setSheets)(s.id, "w", e.target.value)} step={0.01} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="inp inp-sm" value={s.h} onChange={e => upd(setSheets)(s.id, "h", e.target.value)} step={0.01} style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                      <input type="number" className="inp inp-sm" value={s.price} onChange={e => upd(setSheets)(s.id, "price", e.target.value)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <button className="btn-del" onClick={() => del(setSheets)(s.id)}>×</button>
                    </div>
                  ))}
                  <button className="btn-add" style={{ marginTop: 4 }} onClick={add(setSheets, { name: "Nueva", w: 10, h: 10, price: 0 })}>+ Agregar hoja</button>
                </div>
              </div>
            )}

            {/* POLI */}
            {cfgTab === "poli" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Poliamida / Hot Melt</span></div>
                <div className="card-body">
                  <div className="grid2" style={{ marginBottom: 12 }}>
                    <div>
                      <div className="lbl">Precio bolsa (L)</div>
                      <input type="number" className="inp" value={poliBolsa} onChange={e => setPoliBolsa(Number(e.target.value))} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                    </div>
                    <div>
                      <div className="lbl">Gramos / bolsa</div>
                      <input type="number" className="inp" value={poliGramos} onChange={e => setPoliGramos(Number(e.target.value))} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                    </div>
                  </div>
                  <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono'", fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>L{poliRate.toFixed(4)}</span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>por gramo · estándar 120 g/m²</span>
                  </div>
                </div>
              </div>
            )}

            {/* DESIGN */}
            {cfgTab === "design" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Tarifas de Diseño</span></div>
                <div className="card-body">
                  {designTypes.map(d => d.id !== "d0" && (
                    <div key={d.id} style={{ marginBottom: 10, padding: "12px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <input className="inp inp-sm" value={d.label} onChange={e => upd(setDesignTypes)(d.id, "label", e.target.value)} style={{ flex: 1, fontWeight: 600 }} placeholder="Nombre" />
                        <span style={{ color: "var(--text3)", fontFamily: "'JetBrains Mono'", fontSize: 12 }}>L</span>
                        <input type="number" className="inp inp-sm" value={d.price} onChange={e => upd(setDesignTypes)(d.id, "price", e.target.value)} style={{ width: 80, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <button className="btn-del" onClick={() => del(setDesignTypes)(d.id)}>×</button>
                      </div>
                      <input className="inp inp-sm" value={d.desc} onChange={e => upd(setDesignTypes)(d.id, "desc", e.target.value)} placeholder="Descripción…" style={{ color: "var(--text2)", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="btn-add" onClick={add(setDesignTypes, { label: "Nuevo servicio", price: 0, desc: "" })}>+ Agregar servicio</button>
                </div>
              </div>
            )}

            {/* FIX */}
            {cfgTab === "fix" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Tarifas de Corrección</span></div>
                <div className="card-body">
                  <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 12, color: "var(--text2)" }}>
                    <b>Listo para DTF</b> — {fixTypes.find(f => f.id === "f0")?.desc}
                  </div>
                  {fixTypes.map(f => f.id !== "f0" && (
                    <div key={f.id} style={{ marginBottom: 10, padding: "12px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <input className="inp inp-sm" value={f.label} onChange={e => upd(setFixTypes)(f.id, "label", e.target.value)} style={{ flex: 1, fontWeight: 600 }} />
                        <span style={{ color: "var(--text3)", fontFamily: "'JetBrains Mono'", fontSize: 12 }}>L</span>
                        <input type="number" className="inp inp-sm" value={f.price} onChange={e => upd(setFixTypes)(f.id, "price", e.target.value)} style={{ width: 80, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <button className="btn-del" onClick={() => del(setFixTypes)(f.id)}>×</button>
                      </div>
                      <input className="inp inp-sm" value={f.desc} onChange={e => upd(setFixTypes)(f.id, "desc", e.target.value)} placeholder="Descripción…" style={{ color: "var(--text2)", fontStyle: "italic" }} />
                    </div>
                  ))}
                  <button className="btn-add" onClick={add(setFixTypes, { label: "Nuevo nivel", price: 0, desc: "" })}>+ Agregar nivel</button>
                </div>
              </div>
            )}

            {/* VOLUMEN */}
            {cfgTab === "vol" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Descuentos por Volumen</span></div>
                <div className="card-body">
                  {volTiers.map(t => (
                    <div key={t.id} style={{ marginBottom: 10, padding: 14, background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                        <span className="lbl" style={{ margin: 0 }}>Desde</span>
                        <input type="number" className="inp inp-sm" value={t.minQty} onChange={e => upd(setVolTiers)(t.id, "minQty", e.target.value)} style={{ width: 56, textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <span className="lbl" style={{ margin: 0 }}>hasta</span>
                        <input type="number" className="inp inp-sm" value={t.maxQty} onChange={e => upd(setVolTiers)(t.id, "maxQty", e.target.value)} style={{ width: 56, textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        <span style={{ fontSize: 11, color: "var(--text3)" }}>u</span>
                        <button className="btn-del" style={{ marginLeft: "auto" }} onClick={() => del(setVolTiers)(t.id)}>×</button>
                      </div>
                      <input className="inp inp-sm" value={t.desc} onChange={e => upd(setVolTiers)(t.id, "desc", e.target.value)} placeholder="Descripción" style={{ marginBottom: 10 }} />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div><div className="lbl">Desc %</div>
                          <input type="number" className="inp inp-sm" value={t.discPct} onChange={e => upd(setVolTiers)(t.id, "discPct", e.target.value)} style={{ width: 60, textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <div><div className="lbl">Diseño desc %</div>
                          <input type="number" className="inp inp-sm" value={t.designDisc} onChange={e => upd(setVolTiers)(t.id, "designDisc", e.target.value)} style={{ width: 60, textAlign: "center", fontFamily: "'JetBrains Mono'" }} />
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", paddingBottom: 6 }}>
                          <input type="checkbox" checked={t.fixFree} onChange={e => setVolTiers(p => p.map(x => x.id === t.id ? { ...x, fixFree: e.target.checked } : x))} style={{ width: 16, height: 16 }} />
                          <span style={{ fontSize: 12, color: "var(--text2)" }}>Corrección gratis</span>
                        </label>
                      </div>
                    </div>
                  ))}
                  <button className="btn-add" onClick={add(setVolTiers, { minQty: 0, maxQty: 0, label: "Nuevo", desc: "", discPct: 0, designDisc: 0, fixFree: false })}>+ Agregar tier</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ COTIZAR ══ */}
        {tab === "cotizar" && (
          <div className="fade-up">

            {/* ① PEDIDO */}
            <div className="card">
              <div className="card-head">
                <StepBadge n={1} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Pedido</span>
              </div>
              <div className="card-body">
                <div className="grid2" style={{ marginBottom: 12 }}>
                  <div>
                    <div className="lbl">¿Quién diseña?</div>
                    <select className="sel" value={designWho} onChange={e => { setDesignWho(e.target.value); if (e.target.value === "Cliente trae arte") setDesignId("d0"); }}>
                      <option>Cliente trae arte</option>
                      <option>Nosotros diseñamos</option>
                    </select>
                  </div>
                  <div>
                    <div className="lbl">Tipo de diseño</div>
                    <select className="sel" value={designId} onChange={e => setDesignId(e.target.value)}
                      disabled={designWho === "Cliente trae arte"} style={{ opacity: designWho === "Cliente trae arte" ? .35 : 1 }}>
                      {designTypes.map(d => <option key={d.id} value={d.id}>{d.label}{d.price ? ` (L${d.price})` : ""}</option>)}
                    </select>
                    {designWho !== "Cliente trae arte" && designTypes.find(d => d.id === designId)?.desc && (
                      <div style={{ fontSize: 11, color: "var(--text3)", fontStyle: "italic", marginTop: 4 }}>{designTypes.find(d => d.id === designId).desc}</div>
                    )}
                  </div>
                  <div>
                    <div className="lbl">Corrección de archivo</div>
                    <select className="sel" value={fixId} onChange={e => setFixId(e.target.value)}
                      disabled={designWho === "Nosotros diseñamos"} style={{ opacity: designWho === "Nosotros diseñamos" ? .35 : 1 }}>
                      {fixTypes.map(f => <option key={f.id} value={f.id}>{f.label}{f.price ? ` (L${f.price})` : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="lbl">Margen de ganancia</div>
                    <div className="row" style={{ gap: 6 }}>
                      <input type="number" className="inp" value={margin} onChange={e => setMargin(Number(e.target.value) || 0)}
                        style={{ textAlign: "center", fontWeight: 800, fontFamily: "'JetBrains Mono'", fontSize: 18, color: "var(--accent)" }} />
                      <span style={{ fontSize: 14, color: "var(--text3)", fontFamily: "'JetBrains Mono'" }}>%</span>
                    </div>
                  </div>
                </div>
                {designWho === "Nosotros diseñamos" && (
                  <span className="pill" style={{ background: "rgba(34,211,238,.1)", color: "var(--accent)", border: "1px solid rgba(34,211,238,.2)" }}>Corrección = L0 automático</span>
                )}
              </div>
            </div>

            {/* ② LÍNEAS */}
            <div className="card">
              <div className="card-head">
                <StepBadge n={2} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>Líneas</span>
                {calc && (
                  <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
                    {calc.totalQty}u · {calc.tier.label}
                  </span>
                )}
              </div>
              <div className="card-body">
                {lines.map((line, i) => (
                  <div key={line.id} className="line-card">
                    <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)", width: 18, textAlign: "center", flexShrink: 0, fontFamily: "'JetBrains Mono'" }}>{i + 1}</span>
                      <input type="number" min={0} className="inp inp-sm" style={{ width: 60, textAlign: "center", fontWeight: 800, flexShrink: 0, fontFamily: "'JetBrains Mono'", fontSize: 16, color: "var(--accent)" }}
                        placeholder="0" value={line.qty} onChange={e => updLine(i, "qty", e.target.value)} />
                      <select className="sel sel-sm" value={line.prendaId} onChange={e => updLine(i, "prendaId", e.target.value)} style={{ flex: 1, minWidth: 120 }}>
                        <option value="">— Prenda —</option>
                        {prendas.map(p => <option key={p.id} value={p.id}>{p.name} (L{p.cost})</option>)}
                        <option value="__otro">Otro</option>
                      </select>
                      <select className="sel sel-sm" value={line.quien} onChange={e => updLine(i, "quien", e.target.value)} style={{ width: 76, flexShrink: 0 }}>
                        <option>Yo</option><option>Cliente</option>
                      </select>
                      <button className="btn-del" onClick={() => setLines(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)}>×</button>
                    </div>
                    {line.prendaId === "__otro" && (
                      <div className="row" style={{ marginBottom: 10, marginLeft: 24, gap: 6, flexWrap: "wrap" }}>
                        <input className="inp inp-sm" placeholder="Nombre (Gorra, Tote…)" style={{ flex: 1, minWidth: 120 }}
                          value={line.otroName} onChange={e => updLine(i, "otroName", e.target.value)} />
                        <span style={{ color: "var(--text3)", fontSize: 12, fontFamily: "'JetBrains Mono'" }}>L</span>
                        <input type="number" className="inp inp-sm" placeholder="Costo" style={{ width: 80, fontFamily: "'JetBrains Mono'" }}
                          value={line.otroCost} onChange={e => updLine(i, "otroCost", e.target.value)} />
                      </div>
                    )}
                    <div style={{ marginLeft: 24 }}>
                      <div className="lbl">Placements</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {placements.map(pl => {
                          const on = line.placementIds.includes(pl.id);
                          return (
                            <button key={pl.id} className={`pl-chip ${on ? "on" : ""}`}
                              style={on ? { background: pl.color, borderColor: pl.color } : {}}
                              onClick={() => togglePl(i, pl.id)}>
                              <span style={{ fontSize: 9, opacity: .65, fontFamily: "'JetBrains Mono'" }}>{pl.w}×{pl.h}</span> {pl.label}
                            </button>
                          );
                        })}
                      </div>
                      {line.customs.map((c, ci) => (
                        <div key={ci} className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                          <input className="inp inp-sm" placeholder="Nombre" style={{ width: 90, minWidth: 70 }} value={c.label} onChange={e => updCustom(i, ci, "label", e.target.value)} />
                          <input type="number" step={0.5} className="inp inp-sm" placeholder='W"' style={{ width: 58, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.w} onChange={e => updCustom(i, ci, "w", e.target.value)} />
                          <span style={{ color: "var(--text3)", fontWeight: 700 }}>×</span>
                          <input type="number" step={0.5} className="inp inp-sm" placeholder='H"' style={{ width: 58, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.h} onChange={e => updCustom(i, ci, "h", e.target.value)} />
                          <button className="btn-del" onClick={() => delCustom(i, ci)}>×</button>
                        </div>
                      ))}
                      <button onClick={() => addCustom(i)} style={{ marginTop: 8, background: "transparent", border: "1px dashed var(--border2)", borderRadius: 8, padding: "6px 12px", fontSize: 11, color: "var(--text3)", cursor: "pointer", fontWeight: 600, minHeight: 34, transition: "all .15s" }}>+ Custom</button>
                    </div>
                  </div>
                ))}
                <button className="btn-add" onClick={() => setLines(p => [...p, emptyLine()])}>+ Agregar línea</button>
              </div>
            </div>

            {calc && (
              <>
                {/* ③ HOJAS DTF */}
                <div className="card fade-up">
                  <div className="card-head" style={{ background: "rgba(34,211,238,.05)", borderColor: "rgba(34,211,238,.2)" }}>
                    <StepBadge n={3} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Hojas DTF</span>
                    <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 800, color: "var(--accent)" }}>L{calc.dtfCost}</span>
                  </div>
                  <div style={{ padding: 16, background: "var(--bg)" }}>
                    {/* Resumen */}
                    {(() => {
                      const counts = {};
                      calc.nesting.results.forEach(r => { counts[r.sheet.name] = (counts[r.sheet.name] || 0) + 1; });
                      return (
                        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700 }}>Necesitas:</span>
                          {Object.entries(counts).map(([name, qty]) => (
                            <span key={name} style={{ fontFamily: "'JetBrains Mono'", fontSize: 13, fontWeight: 800, color: "var(--accent)", background: "var(--accent-dim)", borderRadius: 7, padding: "4px 12px", border: "1px solid rgba(34,211,238,.2)" }}>
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
                          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{sheet.name}
                              <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 11, marginLeft: 8, fontFamily: "'JetBrains Mono'" }}>{sheet.w}″ × {sheet.h}″</span></span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "var(--accent)", fontSize: 18, fontWeight: 800 }}>L{sheet.price}</span>
                          </div>
                          <svg width="100%" viewBox={`${-pd} ${-pd} ${svW + pd * 2} ${svH + pd * 2}`} style={{ display: "block", borderRadius: 8, overflow: "visible" }}>
                            <defs>
                              <pattern id={`g${ri}`} width={sc} height={sc} patternUnits="userSpaceOnUse"><rect width={sc} height={sc} fill="none" stroke="rgba(30,37,53,.8)" strokeWidth=".5" /></pattern>
                              <pattern id={`ht${ri}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.04)" strokeWidth="1" /></pattern>
                              <filter id={`sh${ri}`}><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity=".4" /></filter>
                            </defs>
                            <rect x={0} y={0} width={svW} height={svH} rx={6} fill="#0D1018" stroke="var(--border2)" strokeWidth={1.5} />
                            <rect x={0} y={0} width={svW} height={svH} rx={6} fill={`url(#g${ri})`} />
                            {placed.map((p, pi) => {
                              const px = p.x * sc + 1, py = p.y * sc + 1, pw = p.w * sc - 2, ph = p.h * sc - 2;
                              const sl = pw > 28 && ph > 14, sd = pw > 20 && ph > 10;
                              return (
                                <g key={pi} filter={`url(#sh${ri})`}>
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill={p.color || "#888"} fillOpacity={.88} />
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill={`url(#ht${ri})`} />
                                  <rect x={px} y={py} width={pw} height={ph} rx={4} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={1} />
                                  {sl && <text x={px + pw / 2} y={py + ph / 2 - (sd ? 5 : 0)} textAnchor="middle" dominantBaseline="central"
                                    fill="white" fontSize={Math.min(11, pw / 5)} fontWeight="700" style={{ fontFamily: "'Sora'" }}>{p.label}</text>}
                                  {sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 10} textAnchor="middle"
                                    fill="rgba(255,255,255,.4)" fontSize={Math.min(8, pw / 7)} style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}″</text>}
                                </g>
                              );
                            })}
                            <line x1={0} y1={-10} x2={svW} y2={-10} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={0} y1={-14} x2={0} y2={-6} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={svW} y1={-14} x2={svW} y2={-6} stroke="var(--border2)" strokeWidth={.6} />
                            <text x={svW / 2} y={-15} textAnchor="middle" fill="var(--text3)" fontSize={8} style={{ fontFamily: "'JetBrains Mono'" }}>{sheet.w}″</text>
                            <line x1={-10} y1={0} x2={-10} y2={svH} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={-14} y1={0} x2={-6} y2={0} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={-14} y1={svH} x2={-6} y2={svH} stroke="var(--border2)" strokeWidth={.6} />
                            <text x={-14} y={svH / 2} textAnchor="middle" fill="var(--text3)" fontSize={8}
                              transform={`rotate(-90,-14,${svH / 2})`} style={{ fontFamily: "'JetBrains Mono'" }}>{dH.toFixed(1)}″</text>
                          </svg>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                            {[...new Map(placed.map(p => [p.label, p.color])).entries()].map(([l, c]) => (
                              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{ width: 10, height: 10, borderRadius: 3, background: c, flexShrink: 0 }} />
                                <span style={{ fontSize: 11, color: "var(--text2)" }}>{l}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ④ DESGLOSE */}
                <div className="card fade-up">
                  <div className="card-head"><StepBadge n={4} /><span style={{ fontWeight: 700, fontSize: 14 }}>Desglose</span></div>
                  <div className="card-body">
                    {calc.lp.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "var(--accent)", fontSize: 14 }}>{l.qty}×</span>
                          <span style={{ marginLeft: 6, fontWeight: 600 }}>{l.prendaLabel}</span>
                          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{l.cfgLabel}
                            {l.quien === "Cliente" && <span className="pill" style={{ background: "rgba(251,191,36,.1)", color: "var(--warn)", marginLeft: 6 }}>cliente pone</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'JetBrains Mono'" }}>L{l.sellPrice}/u</div>
                          <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 14 }}>L{l.lineTotal}</div>
                        </div>
                      </div>
                    ))}

                    {/* Costos internos */}
                    <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div className="lbl" style={{ marginBottom: 10 }}>Mis costos internos</div>
                      {[
                        ["Prendas en blanco", `L${Math.round(calc.lp.reduce((s, l) => s + l.prendaCost * l.qty, 0))}`],
                        [`Hojas DTF: ${calc.nesting.results.map(r => r.sheet.name).join(" + ")}`, `L${calc.dtfCost}`],
                        [`Poliamida: ${calc.totalPoli.toFixed(1)}g`, `L${calc.totalPoliCost.toFixed(2)}`],
                        [`Energía: ${calc.totalQty}u × L${energyCost}`, `L${calc.totalEnergyCost.toFixed(2)}`],
                      ].map(([label, val]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, color: "var(--text2)", borderBottom: "1px solid var(--border)" }}>
                          <span>{label}</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 600 }}>{val}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 2px", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        <span>Total mi costo</span><span style={{ fontFamily: "'JetBrains Mono'" }}>L{Math.round(calc.cost)}</span>
                      </div>
                    </div>

                    {/* Ajustes */}
                    <div style={{ margin: "14px 0 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 15, fontWeight: 700 }}>
                        <span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono'" }}>L{calc.sub}</span>
                      </div>
                      {calc.disc > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "var(--green)" }}>
                        <span>Descuento {calc.volPct}%</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>-L{calc.disc}</span>
                      </div>}
                      {calc.designFee > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: calc.designCharged === 0 ? "var(--green)" : "var(--text)" }}>
                        <span>Diseño: {calc.dType?.label}{calc.designCharged === 0 ? " ✓" : calc.designCharged < calc.designFee ? " (50%)" : ""}</span>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}</span>
                      </div>}
                      {calc.fixFee > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: calc.fixCharged === 0 ? "var(--green)" : "var(--text)" }}>
                        <span>Corrección{calc.fixCharged === 0 ? " ✓" : ""}</span>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}</span>
                      </div>}
                    </div>

                    {/* Total box */}
                    <div style={{ marginTop: 16, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(34,211,238,.25)" }}>
                      <div style={{ background: "linear-gradient(135deg, rgba(34,211,238,.08), rgba(34,211,238,.03))", padding: "22px 20px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".18em", color: "var(--text3)", marginBottom: 6 }}>Cobrar al cliente</div>
                        <div style={{ fontFamily: "'Sora'", fontSize: 48, fontWeight: 800, color: "var(--accent)", letterSpacing: "-2px", lineHeight: 1 }}>L{calc.total.toLocaleString()}</div>
                      </div>
                      <div className="grid3" style={{ borderTop: "1px solid rgba(34,211,238,.15)" }}>
                        <StatBox label="Mi costo" val={`L${Math.round(calc.cost)}`} />
                        <StatBox label="Ganancia" val={`L${Math.round(calc.profit)}`} color="var(--green)" />
                        <StatBox label="Margen" val={`${calc.rm.toFixed(1)}%`} color={calc.rm >= 30 ? "var(--green)" : "var(--red)"} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ⑤ WHATSAPP */}
                <div className="card fade-up">
                  <div className="card-head">
                    <StepBadge n={5} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Resumen WhatsApp</span>
                    <button onClick={() => { const e = document.getElementById("rt"); if (e) navigator.clipboard.writeText(e.innerText).catch(() => {}); }}
                      style={{ marginLeft: "auto", background: "var(--accent-dim)", border: "1px solid rgba(34,211,238,.3)", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "var(--accent)", cursor: "pointer", minHeight: 36, transition: "all .15s" }}>
                      Copiar
                    </button>
                  </div>
                  <div className="card-body">
                    <div id="rt" style={{ fontFamily: "'JetBrains Mono'", fontSize: 12, lineHeight: 1.8, color: "var(--text2)", background: "var(--bg)", borderRadius: 10, padding: 14, border: "1px solid var(--border)", userSelect: "all" }}>
                      <div style={{ fontWeight: 800, color: "var(--accent)", marginBottom: 4 }}>COTIZACIÓN {businessName} DTF</div>
                      {calc.lp.map((l, i) => <div key={i}>{l.qty}× {l.prendaLabel} ({l.cfgLabel}){l.quien === "Cliente" ? " — cliente pone" : ""} — L{l.sellPrice}/u</div>)}
                      {calc.disc > 0 && <div style={{ color: "var(--green)" }}>Desc. {calc.volPct}%: -L{calc.disc}</div>}
                      {calc.designFee > 0 && <div>Diseño: {calc.designCharged === 0 ? "Incluido ✓" : `L${calc.designCharged}`}</div>}
                      {calc.fixFee > 0 && <div>Corrección: {calc.fixCharged === 0 ? "Incluida ✓" : `L${calc.fixCharged}`}</div>}
                      <div style={{ fontWeight: 800, color: "var(--accent)", fontSize: 15, marginTop: 6 }}>TOTAL: L{calc.total.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </>
            )}
            {!calc && (
              <div style={{ textAlign: "center", padding: "70px 20px", color: "var(--border2)" }}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ margin: "0 auto 14px", display: "block", opacity: .4 }}>
                  <rect x="6" y="12" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2"/>
                  <path d="M6 20h36M16 12V8a2 2 0 012-2h12a2 2 0 012 2v4" stroke="currentColor" strokeWidth="2"/>
                  <path d="M14 30h20M18 36h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text3)", marginBottom: 6 }}>Agregá líneas para cotizar</div>
                <div style={{ fontSize: 13, color: "var(--border2)" }}>Seleccioná prenda + placements para calcular hojas DTF y precio</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          <button className={`mobile-nav-btn ${tab === "cotizar" ? "active" : ""}`} onClick={() => setTab("cotizar")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>
            </svg>
            Cotizar
          </button>
          <button className={`mobile-nav-btn ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
            Config
          </button>
        </div>
      </nav>
    </div>
  );
}

function StepBadge({ n }) {
  return (
    <span style={{
      background: "var(--accent)", color: "var(--bg)",
      width: 24, height: 24, borderRadius: "50%",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 800, flexShrink: 0, fontFamily: "'Sora'"
    }}>{n}</span>
  );
}

function StatBox({ label, val, color }) {
  return (
    <div style={{ padding: "12px 8px", textAlign: "center", borderRight: "1px solid rgba(34,211,238,.1)" }}>
      <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 700, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 15, fontWeight: 800, color: color || "var(--text)" }}>{val}</div>
    </div>
  );
}
