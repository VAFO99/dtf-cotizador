import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { loadPedidos, savePedidos, nextQuoteNum, ESTADOS, ESTADO_COLOR } from "./store.js";
import { findBestSheets } from "./nesting.js";
import {
  loadConfigRemote, saveConfigRemote,
  loadCotizaciones, createCotizacion, updateCotizacionEstado, deleteCotizacion,
  getNextNumero, checkConnection,
} from "./supabase.js";

const STORAGE_KEY = "dtf_config_v3"; // bumped: per-prenda tallas+colores, TCambio, margenMin, darkMode

// Mapa de migración de nombres en inglés → español
const PLACEMENT_ES = {
  "Front": "Frente", "Back": "Espalda",
  "LC": "Pecho Izq", "RC": "Pecho Der",
  "Manga L": "Manga Izq", "Manga R": "Manga Der",
  "Nape": "Cuello", "Bolsillo": "Bolsillo",
  "Front OS": "Frente OS", "Back OS": "Espalda OS",
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    // Migrar nombres en inglés a español si vienen de v1
    if (cfg.placements) {
      cfg.placements = cfg.placements.map(p => ({
        ...p,
        label: PLACEMENT_ES[p.label] ?? p.label,
      }));
    }
    return cfg;
  } catch { return null; }
}

function saveConfig(cfg) {
  try {
    const json = JSON.stringify(cfg);
    // FIX 12: check if data is too large before saving (localStorage limit ~5MB)
    if (json.length > 4_500_000) {
      // Logo is likely bloated — save without logo as fallback
      const stripped = { ...cfg, logoB64: null };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      return "no_logo";
    }
    localStorage.setItem(STORAGE_KEY, json);
    return true;
  } catch (err) {
    console.error("saveConfig failed:", err);
    return false;
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const INIT_PRENDAS = [
  { id: uid(), name: "Camisa",  cost: 60,  tallas: ["XS","S","M","L","XL","XXL","XXXL"], colores: ["Blanco","Negro","Gris","Azul marino"] },
  { id: uid(), name: "Hoodie",  cost: 180, tallas: ["S","M","L","XL","XXL"],             colores: ["Blanco","Negro","Gris","Café"] },
];

// Polyamida: estándar industria DTF = 120 g/m² = 0.0774 g/in²
// Fórmula: ancho_in × alto_in × 0.0774
const calcPoli = (w, h) => parseFloat((w * h * 0.0774).toFixed(2));

const INIT_PLACEMENTS = [
  { id: uid(), label: "Frente",       w: 10,  h: 12,  color: "#C45C3B" },
  { id: uid(), label: "Espalda",      w: 10,  h: 14,  color: "#3B7CC4" },
  { id: uid(), label: "Pecho Izq",    w: 3.5, h: 3.5, color: "#8B6B3E" },
  { id: uid(), label: "Pecho Der",    w: 3.5, h: 3.5, color: "#A68B4E" },
  { id: uid(), label: "Manga Izq",    w: 3.5, h: 12,  color: "#6B8B3E" },
  { id: uid(), label: "Manga Der",    w: 3.5, h: 12,  color: "#5B7B2E" },
  { id: uid(), label: "Cuello",       w: 3.5, h: 2,   color: "#7B5EA7" },
  { id: uid(), label: "Bolsillo",     w: 3,   h: 3,   color: "#5E9EA7" },
  { id: uid(), label: "Frente OS",    w: 12,  h: 16,  color: "#D46A4B" },
  { id: uid(), label: "Espalda OS",   w: 14,  h: 18,  color: "#4B8AD4" },
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


const TALLAS_DEFAULT = ["XS","S","M","L","XL","XXL","XXXL"];
const emptyLine = () => ({
  id: uid(), qty: "", prendaId: "", quien: "Yo",
  placementIds: [], customs: [], otroName: "", otroCost: "",
  color: "",
  tallas: [], // [{ talla: "S", qty: 1 }]
  showTallas: false,
});

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
  const [prensaWatts, setPrensaWatts]   = useState(saved?.prensaWatts   ?? 1800);
  const [prensaSeg, setPrensaSeg]       = useState(saved?.prensaSeg     ?? 20);
  const [tarifaKwh, setTarifaKwh]       = useState(saved?.tarifaKwh     ?? 4.62);
  // energyCost calculado: (W/1000) * (s/3600) * L/kWh
  const energyCost = parseFloat(((prensaWatts / 1000) * (prensaSeg / 3600) * tarifaKwh).toFixed(4));
  const [tallasCfg, setTallasCfg] = useState(saved?.tallasCfg ?? ["XS","S","M","L","XL","XXL","XXXL"]);
  const [logoB64, setLogoB64] = useState(saved?.logoB64 ?? null);
  const [validezDias, setValidezDias] = useState(saved?.validezDias ?? 15);
  const [coloresCfg, setColoresCfg] = useState(saved?.coloresCfg ?? ["Blanco","Negro","Gris","Rojo","Azul marino","Azul cielo","Verde","Amarillo","Naranja","Rosado","Morado","Café"]);
  const [newTalla, setNewTalla] = useState("");
  const [newColor, setNewColor] = useState("");
  // NEW features
  const [darkMode, setDarkMode]       = useState(saved?.darkMode ?? true);
  const [tipoCambio, setTipoCambio]   = useState(saved?.tipoCambio ?? 25.5);
  const [mostrarUSD, setMostrarUSD]   = useState(saved?.mostrarUSD ?? false);
  const [margenMin, setMargenMin]     = useState(saved?.margenMin ?? 30);
  const [pedidos, setPedidos]         = useState(() => loadPedidos());
  const [agruparPorColor, setAgruparPorColor] = useState(saved?.agruparPorColor ?? false);
  const [pedidoTab, setPedidoTab]     = useState("cotizar"); // cotizar | pedidos
  const [syncStatus, setSyncStatus]   = useState("idle"); // idle | syncing | online | offline
  const [supabaseReady, setSupabaseReady] = useState(false);

  // Save state
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | dirty | saved
  const [savedSnapshot, setSavedSnapshot] = useState(saved);
  const isFirstRender = useRef(true);

  const currentConfig = useMemo(() => ({
    margin, prendas, placements, sheets, designTypes, fixTypes, volTiers,
    poliBolsa, poliGramos, businessName, prensaWatts, prensaSeg, tarifaKwh, tallasCfg, coloresCfg, logoB64, validezDias,
    darkMode, tipoCambio, mostrarUSD, margenMin, agruparPorColor
  }), [margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliBolsa, poliGramos, businessName, prensaWatts, prensaSeg, tarifaKwh, tallasCfg, coloresCfg, logoB64, validezDias, darkMode, tipoCambio, mostrarUSD, margenMin, agruparPorColor]);

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

  // ── Supabase init: load remote data on first mount ──
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setSyncStatus("syncing");
      // Check connection
      const online = await checkConnection();
      if (cancelled) return;
      if (!online) { setSyncStatus("offline"); return; }

      // Load remote config (overrides localStorage if newer)
      const remoteCfg = await loadConfigRemote();
      if (!cancelled && remoteCfg) {
        if (remoteCfg.prendas)      setPrendas(remoteCfg.prendas);
        if (remoteCfg.placements)   setPlacements(remoteCfg.placements);
        if (remoteCfg.sheets)       setSheets(remoteCfg.sheets);
        if (remoteCfg.designTypes)  setDesignTypes(remoteCfg.designTypes);
        if (remoteCfg.fixTypes)     setFixTypes(remoteCfg.fixTypes);
        if (remoteCfg.volTiers)     setVolTiers(remoteCfg.volTiers);
        if (remoteCfg.poliBolsa)    setPoliBolsa(remoteCfg.poliBolsa);
        if (remoteCfg.poliGramos)   setPoliGramos(remoteCfg.poliGramos);
        if (remoteCfg.businessName) setBusinessName(remoteCfg.businessName);
        if (remoteCfg.margin)       setMargin(remoteCfg.margin);
        if (remoteCfg.tallasCfg)    setTallasCfg(remoteCfg.tallasCfg);
        if (remoteCfg.coloresCfg)   setColoresCfg(remoteCfg.coloresCfg);
        if (remoteCfg.validezDias)  setValidezDias(remoteCfg.validezDias);
        if (remoteCfg.margenMin !== undefined) setMargenMin(remoteCfg.margenMin);
        if (remoteCfg.tipoCambio)   setTipoCambio(remoteCfg.tipoCambio);
        if (remoteCfg.mostrarUSD !== undefined) setMostrarUSD(remoteCfg.mostrarUSD);
        if (remoteCfg.darkMode !== undefined) setDarkMode(remoteCfg.darkMode);
        if (remoteCfg.prensaWatts)  setPrensaWatts(remoteCfg.prensaWatts);
        if (remoteCfg.prensaSeg)    setPrensaSeg(remoteCfg.prensaSeg);
        if (remoteCfg.tarifaKwh)    setTarifaKwh(remoteCfg.tarifaKwh);
      }

      // Load remote cotizaciones
      const remoteCots = await loadCotizaciones();
      if (!cancelled && remoteCots !== null) {
        // Map Supabase rows to app format
        const mapped = remoteCots.map(row => ({
          id: row.id,
          num: row.numero,
          cliente: row.cliente,
          email: row.email,
          telefono: row.telefono,
          fecha: row.created_at,
          total: row.total,
          estado: row.estado,
          notas: row.notas,
          lines: row.lines,
        }));
        setPedidos(mapped);
        savePedidos(mapped); // update localStorage too
      }

      if (!cancelled) { setSyncStatus("online"); setSupabaseReady(true); }
    };
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // Auto-save 1.5s after any config change
  const autoSaveTimer = useRef(null);
  useEffect(() => {
    if (isFirstRender.current) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const result = saveConfig(currentConfig);
      if (result === false) {
        setSaveStatus("error");
      } else if (result === "no_logo") {
        setSaveStatus("no_logo");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1800);
      }
      // Also save to Supabase (async, non-blocking)
      if (supabaseReady) saveConfigRemote(currentConfig);
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [currentConfig]);

  // Persist pedidos whenever they change
  useEffect(() => { savePedidos(pedidos); }, [pedidos]);

  // Export config as JSON
  const exportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentConfig, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `dtf-config-${new Date().toISOString().slice(0,10)}.json`; a.click();
  }, [currentConfig]);

  // Import config from JSON
  const importConfig = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const cfg = JSON.parse(e.target.result);
        if (cfg.prendas) setPrendas(cfg.prendas);
        if (cfg.placements) setPlacements(cfg.placements);
        if (cfg.sheets) setSheets(cfg.sheets);
        if (cfg.designTypes) setDesignTypes(cfg.designTypes);
        if (cfg.fixTypes) setFixTypes(cfg.fixTypes);
        if (cfg.volTiers) setVolTiers(cfg.volTiers);
        if (cfg.poliBolsa) setPoliBolsa(cfg.poliBolsa);
        if (cfg.poliGramos) setPoliGramos(cfg.poliGramos);
        if (cfg.businessName) setBusinessName(cfg.businessName);
        if (cfg.prensaWatts  !== undefined) setPrensaWatts(cfg.prensaWatts);
        if (cfg.prensaSeg    !== undefined) setPrensaSeg(cfg.prensaSeg);
        if (cfg.tarifaKwh    !== undefined) setTarifaKwh(cfg.tarifaKwh);
        if (cfg.tallasCfg) setTallasCfg(cfg.tallasCfg);
        if (cfg.coloresCfg) setColoresCfg(cfg.coloresCfg);
        if (cfg.logoB64) setLogoB64(cfg.logoB64);
        if (cfg.validezDias) setValidezDias(cfg.validezDias);
        if (cfg.margin) setMargin(cfg.margin);
        if (cfg.tipoCambio) setTipoCambio(cfg.tipoCambio);
        if (cfg.mostrarUSD !== undefined) setMostrarUSD(cfg.mostrarUSD);
        if (cfg.margenMin !== undefined) setMargenMin(cfg.margenMin);
        if (cfg.agruparPorColor !== undefined) setAgruparPorColor(cfg.agruparPorColor);
        alert("✅ Configuración importada correctamente");
      } catch { alert("❌ Archivo inválido"); }
    };
    reader.readAsText(file);
  }, []);

  // Save cotización as pedido — with Supabase sync
  const savePedido = useCallback(async (calc, clientName, invoiceNum, email = "", telefono = "", notas = "") => {
    if (!calc) return false;
    const exists = loadPedidos().some(p => p.num === invoiceNum);
    if (exists) return "duplicate";

    const lines = calc.lp.map(l => ({
      qty: l.qty, prendaLabel: l.prendaLabel, color: l.color,
      cfgLabel: l.cfgLabel, tallasSummary: l.tallasSummary,
      sellPrice: l.sellPrice, lineTotal: l.lineTotal,
    }));

    // Save to Supabase if online
    let id = uid();
    if (supabaseReady) {
      const row = await createCotizacion({
        numero: invoiceNum,
        cliente: clientName || "Sin nombre",
        email, telefono, notas,
        total: calc.total,
        estado: "Cotizado",
        lines,
      });
      if (row) id = row.id;
    }

    const nuevo = {
      id, num: invoiceNum,
      cliente: clientName || "Sin nombre",
      email, telefono, notas,
      fecha: new Date().toISOString(),
      total: calc.total, estado: "Cotizado", lines,
    };
    setPedidos(prev => [nuevo, ...prev]);
    return "ok";
  }, [supabaseReady]);

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
        piecesPerUnit.forEach(p => allPieces.push({ ...p, _idx: pidx++, prendaColor: line.color || "", prendaLabel: pr?.name || line.otroName || "Otro" }));
      }

      const pr = prendas.find(p => p.id === line.prendaId);
      const prendaCost = line.quien === "Cliente" ? 0 : (pr ? pr.cost : Number(line.otroCost) || 0);
      const prendaLabel = pr ? pr.name : (line.otroName || "Otro");
      // FIX 9: flag when "Otro" has no cost and client isn't bringing it
      const sinCosto = line.quien !== "Cliente" && line.prendaId === "__otro" && !Number(line.otroCost);
      const cfgLabel = [...line.placementIds.map(pid => placements.find(p => p.id === pid)?.label || "?"),
        ...line.customs.filter(c => c.w && c.h).map(c => `${c.label} ${c.w}×${c.h}`)].join(" + ");
      const tallasSummary = line.tallas?.length > 0
        ? line.tallas.filter(x=>x.qty>0).map(x=>`${x.talla}:${x.qty}`).join(" ")
        : null;
      return { ...line, qty, pieces: piecesPerUnit, poli, poliCost: poli * poliRate, prendaCost, prendaLabel, cfgLabel, tallasSummary, sinCosto };
    });

    // FIX 13: Group by color — run nesting separately per color+prenda group
    let nesting;
    if (agruparPorColor) {
      // Group allPieces by (prendaLabel + color) combination
      const groups = {};
      allPieces.forEach(p => {
        const key = (p.prendaColor || "sin-color") + "|" + (p.prendaLabel || "?");
        if (!groups[key]) groups[key] = { key, pieces: [] };
        groups[key].pieces.push(p);
      });
      const allResults = [];
      let totalCostG = 0;
      Object.values(groups).forEach(g => {
        const r = findBestSheets(g.pieces, sheets);
        allResults.push(...r.results.map(sh => ({ ...sh, groupKey: g.key })));
        totalCostG += r.totalCost;
      });
      nesting = { results: allResults, totalCost: totalCostG };
    } else {
      nesting = findBestSheets(allPieces, sheets);
    }
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
      // FIX 4: Si cliente pone prenda, base de precio = solo costos DTF (sin prenda)
      // El margen aplica sobre lo que YO cobro, no sobre costo de prenda del cliente
      const myBase = ld.poliCost + dtfPU + energyCost; // costos DTF propios
      const spBase = ld.quien === "Cliente"
        ? Math.ceil((myBase * (1 + margin / 100)) / 10) * 10
        : Math.ceil((uc     * (1 + margin / 100)) / 10) * 10;
      return { ...ld, unitCost: uc, sellPrice: spBase, lineTotal: spBase * ld.qty, costTotal: uc * ld.qty };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, designWho, designId, fixId, margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliRate, energyCost]);
  // Note: energyCost is derived from prensaWatts/prensaSeg/tarifaKwh which ARE in currentConfig


  // ── RENDER ──
  return (
    <div className={darkMode ? "dark-theme" : "light-theme"} style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "'Sora',sans-serif", minHeight: "100dvh", minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        :root {
          --accent: #22D3EE;
          --accent-dim: rgba(34,211,238,.12);
          --accent-glow: rgba(34,211,238,.25);
          --green: #34D399;
          --red: #F87171;
          --warn: #FBBF24;
          --radius: 14px;
          --radius-sm: 8px;
        }
        .dark-theme {
          --bg: #080A10; --bg2: #0D1018; --bg3: #131720;
          --border: #1E2535; --border2: #252D3F;
          --text: #E2E8F4; --text2: #94A3B8; --text3: #4A5568;
          --shadow: rgba(0,0,0,.5);
        }
        .light-theme {
          --bg: #F8FAFC; --bg2: #FFFFFF; --bg3: #F1F5F9;
          --border: #E2E8F0; --border2: #CBD5E1;
          --text: #0F172A; --text2: #475569; --text3: #94A3B8;
          --shadow: rgba(0,0,0,.08);
        }
        .light-theme .card { box-shadow: 0 1px 8px var(--shadow); }
        .light-theme .line-card { background: #F8FAFC; }
        .light-theme header { background: rgba(255,255,255,.92); }
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
              {saveStatus === "no_logo" && (
                <span className="fade-up" style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  ⚠ Logo no guardado (imagen muy grande)
                </span>
              )}
              {saveStatus === "error" && (
                <span className="fade-up" style={{ fontSize: 11, color: "var(--red)", fontWeight: 600 }}>
                  ✗ Error al guardar
                </span>
              )}
              {saveStatus === "dirty" && (
                <span className="blink" style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>● guardando…</span>
              )}
            </div>
          </div>
          {/* Desktop tabs */}
          <div className="desktop-tabs" style={{ display: "flex", borderTop: "1px solid var(--border)", overflowX: "auto" }}>
            <button className={`tab-btn ${tab === "cotizar" ? "active" : ""}`} onClick={() => setTab("cotizar")}>Cotizar</button>
            <button className={`tab-btn ${tab === "pedidos" ? "active" : ""}`} onClick={() => setTab("pedidos")}>
              Pedidos {pedidos.filter(p => p.estado !== "Entregado").length > 0 && (
                <span style={{ marginLeft: 6, background: "var(--accent)", color: "var(--bg)", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>
                  {pedidos.filter(p => p.estado !== "Entregado").length}
                </span>
              )}
            </button>
            <button className={`tab-btn ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>Configuración</button>
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
              {[["negocio","Mi Negocio"],["prendas","Prendas"],["placements","Posiciones"],["tallas","Tallas"],["colores","Colores"],["sheets","Hojas DTF"],["poli","Poliamida"],["design","Diseño"],["fix","Corrección"],["vol","Volumen"]].map(([k,v]) => (
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
                    <div className="lbl">Energía — cálculo automático</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>Potencia prensa (W)</div>
                        <input type="number" className="inp inp-sm" value={prensaWatts} onChange={e => setPrensaWatts(Number(e.target.value) || 1800)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>Tiempo prensado (s)</div>
                        <input type="number" className="inp inp-sm" value={prensaSeg} onChange={e => setPrensaSeg(Number(e.target.value) || 20)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--text3)", marginBottom: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>Tarifa ENEE (L/kWh)</div>
                        <input type="number" className="inp inp-sm" value={tarifaKwh} step={0.01} onChange={e => setTarifaKwh(Number(e.target.value) || 4.62)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      </div>
                    </div>
                    <div style={{ background: "var(--accent-dim)", border: "1px solid rgba(34,211,238,.2)", borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 16, color: "var(--accent)" }}>L{energyCost}</span>
                      <span style={{ fontSize: 11, color: "var(--text2)" }}>por prensada · ({prensaWatts}W × {prensaSeg}s ÷ 3,600 × L{tarifaKwh}/kWh)</span>
                    </div>
                  </div>

                  {/* Validez cotización */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">Días de validez de cotización</div>
                    <div className="row" style={{ gap: 8 }}>
                      <input type="number" min={1} max={365} className="inp" value={validezDias}
                        onChange={e => setValidezDias(Number(e.target.value) || 15)}
                        style={{ maxWidth: 100, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>días · aparece en la factura</span>
                    </div>
                  </div>

                  {/* Margen mínimo */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">Margen mínimo aceptable (%)</div>
                    <div className="row" style={{ gap: 8 }}>
                      <input type="number" min={0} max={100} className="inp" value={margenMin}
                        onChange={e => setMargenMin(Number(e.target.value) || 0)}
                        style={{ maxWidth: 100, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>% · alerta roja cuando el margen sea menor</span>
                    </div>
                  </div>

                  {/* Tipo de cambio */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">Tipo de cambio (L por $1 USD)</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <input type="number" min={1} step={0.1} className="inp" value={tipoCambio}
                        onChange={e => setTipoCambio(Number(e.target.value) || 25.5)}
                        style={{ maxWidth: 110, fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "var(--text2)" }}>
                        <input type="checkbox" checked={mostrarUSD} onChange={e => setMostrarUSD(e.target.checked)} style={{ width: 16, height: 16 }} />
                        Mostrar total en USD
                      </label>
                    </div>
                    {mostrarUSD && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, fontFamily: "'JetBrains Mono'" }}>
                      Ejemplo: L1,000 = ${(1000/tipoCambio).toFixed(2)} USD
                    </div>}
                  </div>

                  {/* Exportar / Importar config */}
                  <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                    <div className="lbl">Respaldo de configuración</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={exportConfig}
                        style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        Exportar config
                      </button>
                      <label style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                        Importar config
                        <input type="file" accept=".json" style={{ display: "none" }}
                          onChange={e => { if (e.target.files?.[0]) importConfig(e.target.files[0]); }} />
                      </label>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>El exportado incluye prendas, posiciones, hojas, tarifas, logo y todas las configuraciones.</div>
                  </div>

                  {/* Logo */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">Logo del negocio</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>PNG, JPG o SVG · Se muestra en la factura. Recomendado: fondo transparente.</div>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      {logoB64 && (
                        <div style={{ position: "relative" }}>
                          <img src={logoB64} alt="Logo" style={{ height: 72, maxWidth: 200, objectFit: "contain", background: "white", borderRadius: 8, padding: 8, border: "1px solid var(--border)" }} />
                          <button onClick={() => setLogoB64(null)}
                            style={{ position: "absolute", top: -8, right: -8, width: 22, height: 22, borderRadius: "50%", background: "var(--red)", border: "none", color: "white", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>×</button>
                        </div>
                      )}
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--accent-dim)", border: "1.5px dashed rgba(34,211,238,.4)", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                        {logoB64 ? "Cambiar logo" : "Subir logo"}
                        <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" style={{ display: "none" }}
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = ev => setLogoB64(ev.target.result);
                            reader.readAsDataURL(file);
                          }} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PRENDAS */}
            {cfgTab === "prendas" && (
              <div className="fade-up">
                {prendas.map(p => (
                  <div key={p.id} className="card" style={{ marginBottom: 10 }}>
                    <div className="card-head">
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name || "Nueva prenda"}</span>
                      <button className="btn-del" style={{ marginLeft: "auto" }} onClick={() => del(setPrendas)(p.id)}>×</button>
                    </div>
                    <div className="card-body">
                      <div className="grid2" style={{ marginBottom: 12 }}>
                        <div>
                          <div className="lbl">Nombre</div>
                          <input className="inp inp-sm" value={p.name} onChange={e => upd(setPrendas)(p.id, "name", e.target.value)} />
                        </div>
                        <div>
                          <div className="lbl">Costo (L)</div>
                          <input type="number" className="inp inp-sm" value={p.cost} onChange={e => upd(setPrendas)(p.id, "cost", e.target.value)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
                        </div>
                      </div>
                      {/* Tallas por prenda */}
                      <div style={{ marginBottom: 10 }}>
                        <div className="lbl">Tallas disponibles para esta prenda</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                          {(p.tallas || tallasCfg).map(t => (
                            <div key={t} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--bg)", border: "1.5px solid var(--accent)", borderRadius: 7, padding: "3px 8px" }}>
                              <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 12, color: "var(--accent)" }}>{t}</span>
                              <button onClick={() => setPrendas(prev => prev.map(x => x.id === p.id ? { ...x, tallas: (x.tallas || tallasCfg).filter(tl => tl !== t) } : x))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 12, lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
                            </div>
                          ))}
                          <select className="sel sel-sm" style={{ width: "auto", minWidth: 100 }}
                            onChange={e => {
                              const t = e.target.value; if (!t) return;
                              setPrendas(prev => prev.map(x => x.id === p.id ? { ...x, tallas: [...new Set([...(x.tallas || tallasCfg), t])] } : x));
                              e.target.value = "";
                            }}>
                            <option value="">+ Talla</option>
                            {tallasCfg.filter(t => !(p.tallas || tallasCfg).includes(t)).map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Colores por prenda */}
                      <div>
                        <div className="lbl">Colores disponibles para esta prenda</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                          {(p.colores || coloresCfg).map(c => (
                            <div key={c} style={{ display: "flex", alignItems: "center", gap: 3, background: "var(--bg)", border: "1.5px solid var(--border2)", borderRadius: 7, padding: "3px 10px" }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c}</span>
                              <button onClick={() => setPrendas(prev => prev.map(x => x.id === p.id ? { ...x, colores: (x.colores || coloresCfg).filter(cl => cl !== c) } : x))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 12, lineHeight: 1, padding: "0 0 0 2px" }}>×</button>
                            </div>
                          ))}
                          <select className="sel sel-sm" style={{ width: "auto", minWidth: 120 }}
                            onChange={e => {
                              const c = e.target.value; if (!c) return;
                              setPrendas(prev => prev.map(x => x.id === p.id ? { ...x, colores: [...new Set([...(x.colores || coloresCfg), c])] } : x));
                              e.target.value = "";
                            }}>
                            <option value="">+ Color</option>
                            {coloresCfg.filter(c => !(p.colores || coloresCfg).includes(c)).map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button className="btn-add" onClick={add(setPrendas, { name: "Nueva prenda", cost: 0, tallas: [...tallasCfg], colores: [...coloresCfg] })}>+ Agregar prenda</button>
              </div>
            )}

            {/* PLACEMENTS */}
            {cfgTab === "placements" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Posiciones de Estampado</span></div>
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
                  <button className="btn-add" style={{ marginTop: 4 }} onClick={add(setPlacements, { label: "Nuevo", w: 5, h: 5, color: "#22D3EE" })}>+ Agregar posición</button>
                </div>
              </div>
            )}

            {/* TALLAS */}
            {cfgTab === "tallas" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Tallas disponibles</span></div>
                <div className="card-body">
                  <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                    Define las tallas que aparecen al cotizar. Arrastrá para reordenar o eliminá las que no usás.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {tallasCfg.map((t, i) => (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", border: "1.5px solid var(--border2)", borderRadius: 8, padding: "6px 10px" }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{t}</span>
                        <button onClick={() => setTallasCfg(p => p.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: "0 0 0 4px", lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="inp inp-sm" placeholder="Nueva talla (ej. 4T, 6T, One Size…)" value={newTalla}
                      onChange={e => setNewTalla(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && newTalla.trim() && !tallasCfg.includes(newTalla.trim())) { setTallasCfg(p => [...p, newTalla.trim()]); setNewTalla(""); }}}
                      style={{ flex: 1 }} />
                    <button onClick={() => { if (newTalla.trim() && !tallasCfg.includes(newTalla.trim())) { setTallasCfg(p => [...p, newTalla.trim()]); setNewTalla(""); }}}
                      style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "var(--bg)", cursor: "pointer", minHeight: 38 }}>
                      + Agregar
                    </button>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button onClick={() => setTallasCfg(["XS","S","M","L","XL","XXL","XXXL"])}
                      style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "var(--text3)", cursor: "pointer" }}>
                      ↺ Restaurar defaults
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* COLORES */}
            {cfgTab === "colores" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Colores de prenda frecuentes</span></div>
                <div className="card-body">
                  <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                    Estos colores aparecen como sugerencias al cotizar. El campo de color también acepta cualquier texto libre.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    {coloresCfg.map((c, i) => (
                      <div key={c} style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", border: "1.5px solid var(--border2)", borderRadius: 8, padding: "6px 12px" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c}</span>
                        <button onClick={() => setColoresCfg(p => p.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: "0 0 0 4px", lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="inp inp-sm" placeholder="Nuevo color (ej. Verde militar, Tie dye…)" value={newColor}
                      onChange={e => setNewColor(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && newColor.trim() && !coloresCfg.includes(newColor.trim())) { setColoresCfg(p => [...p, newColor.trim()]); setNewColor(""); }}}
                      style={{ flex: 1 }} />
                    <button onClick={() => { if (newColor.trim() && !coloresCfg.includes(newColor.trim())) { setColoresCfg(p => [...p, newColor.trim()]); setNewColor(""); }}}
                      style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: "var(--bg)", cursor: "pointer", minHeight: 38 }}>
                      + Agregar
                    </button>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button onClick={() => setColoresCfg(["Blanco","Negro","Gris","Rojo","Azul marino","Azul cielo","Verde","Amarillo","Naranja","Rosado","Morado","Café"])}
                      style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "var(--text3)", cursor: "pointer" }}>
                      ↺ Restaurar defaults
                    </button>
                  </div>
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

        {/* ══ PEDIDOS ══ */}
        {tab === "pedidos" && (
          <div className="fade-up">
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Pedidos activos</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Todos", ...ESTADOS].map(e => (
                  <button key={e} onClick={() => setPedidoTab(e)}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none",
                      background: pedidoTab === e ? "var(--accent)" : "var(--bg3)",
                      color: pedidoTab === e ? "var(--bg)" : "var(--text2)",
                    }}>{e}</button>
                ))}
              </div>
            </div>
            {pedidos.filter(p => pedidoTab === "Todos" || p.estado === pedidoTab).length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Sin pedidos {pedidoTab !== "Todos" ? `en estado "${pedidoTab}"` : "registrados"}</div>
                <div style={{ fontSize: 13, color: "var(--border2)", marginTop: 4 }}>Los pedidos guardados desde la factura aparecerán aquí</div>
              </div>
            ) : (
              pedidos
                .filter(p => pedidoTab === "Todos" || p.estado === pedidoTab)
                .map(p => {
                  const ec = ESTADO_COLOR[p.estado] || ESTADO_COLOR.Cotizado;
                  return (
                    <div key={p.id} className="card" style={{ marginBottom: 10 }}>
                      <div className="card-head" style={{ flexWrap: "wrap", gap: 8 }}>
                        <div>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "var(--accent)", fontSize: 13 }}>#{p.num}</span>
                          <span style={{ marginLeft: 10, fontWeight: 700, fontSize: 14 }}>{p.cliente}</span>
                        </div>
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 14, color: "var(--accent)" }}>L{p.total.toLocaleString()}</span>
                          <select value={p.estado} onChange={async e => {
                            const newEstado = e.target.value;
                            setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, estado: newEstado } : x));
                            if (supabaseReady) await updateCotizacionEstado(p.id, newEstado);
                          }}
                            style={{ background: ec.bg, border: `1px solid ${ec.border}`, color: ec.text, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Sora'" }}>
                            {ESTADOS.map(es => <option key={es}>{es}</option>)}
                          </select>
                          <button onClick={async () => { if (confirm("¿Eliminar este pedido?")) {
                            setPedidos(prev => prev.filter(x => x.id !== p.id));
                            if (supabaseReady) await deleteCotizacion(p.id);
                          } }}
                            className="btn-del" title="Eliminar">×</button>
                        </div>
                      </div>
                      <div className="card-body" style={{ padding: "10px 16px" }}>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8, fontFamily: "'JetBrains Mono'" }}>
                          {new Date(p.fecha).toLocaleDateString("es-HN", { year:"numeric", month:"short", day:"numeric" })}
                        </div>
                        {p.lines.map((l, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                            <span>
                              <b style={{ color: "var(--accent)", fontFamily: "'JetBrains Mono'" }}>{l.qty}×</b>
                              <span style={{ marginLeft: 6 }}>{l.prendaLabel}{l.color ? ` (${l.color})` : ""}</span>
                              <span style={{ color: "var(--text3)", fontSize: 11, marginLeft: 6 }}>{l.cfgLabel}</span>
                              {l.tallasSummary && <span style={{ color: "var(--text3)", fontSize: 10, fontFamily: "'JetBrains Mono'", marginLeft: 6 }}>[{l.tallasSummary}]</span>}
                            </span>
                            <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>L{l.lineTotal ?? (l.qty * l.sellPrice)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
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
                <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, color: agruparPorColor ? "var(--accent)" : "var(--text3)", fontWeight: 600 }} title="Cuando está activo, cada color/prenda ocupa sus propias hojas (no se mezclan en prensado)">
                  <input type="checkbox" checked={agruparPorColor} onChange={e => setAgruparPorColor(e.target.checked)} style={{ width: 14, height: 14 }} />
                  Hojas por color
                </label>
                {calc && (
                  <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
                    {calc.totalQty}u · {calc.tier.label}
                  </span>
                )}
              </div>
              <div className="card-body">
                {lines.map((line, i) => (
                  <div key={line.id} className="line-card">
                    {/* Header de línea: prenda + quien + eliminar */}
                    <div className="row" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", width: 18, textAlign: "center", flexShrink: 0, fontFamily: "'JetBrains Mono'" }}>{i + 1}</span>
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

                    {/* Color con sugerencias per-prenda */}
                    <div style={{ marginLeft: 24, marginBottom: 10 }}>
                      <div className="lbl">Color de prenda</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                        {(prendas.find(p => p.id === line.prendaId)?.colores || coloresCfg).map(c => (
                          <button key={c} onClick={() => updLine(i, "color", c)}
                            style={{
                              padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                              background: line.color === c ? "var(--accent)" : "var(--bg)",
                              color: line.color === c ? "var(--bg)" : "var(--text2)",
                              border: `1.5px solid ${line.color === c ? "var(--accent)" : "var(--border2)"}`,
                              transition: "all .12s",
                            }}>{c}</button>
                        ))}
                      </div>
                      <input className="inp inp-sm" placeholder="O escribe cualquier color…" value={line.color || ""}
                        onChange={e => updLine(i, "color", e.target.value)} style={{ maxWidth: 260 }} />
                    </div>

                    {/* Tallas + cantidad — siempre visible */}
                    <div style={{ marginLeft: 24, marginBottom: 10 }}>
                      <div className="lbl">Cantidad por talla</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                        {(prendas.find(p => p.id === line.prendaId)?.tallas || tallasCfg).map(t => {
                          const entry = (line.tallas || []).find(x => x.talla === t);
                          const val = entry?.qty ?? "";
                          const active = Number(val) > 0;
                          return (
                            <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: active ? "var(--accent)" : "var(--text3)", textTransform: "uppercase" }}>{t}</span>
                              <input
                                type="number" min={0}
                                value={val}
                                placeholder="0"
                                onChange={e => {
                                  const v = e.target.value;
                                  setLines(prev => prev.map((l, j) => {
                                    if (j !== i) return l;
                                    const rest = (l.tallas || []).filter(x => x.talla !== t);
                                    const newEntry = v !== "" && Number(v) > 0 ? [{ talla: t, qty: Number(v) }] : [];
                                    const newTallas = [...rest, ...newEntry].sort((a,b) => TALLAS_DEFAULT.indexOf(a.talla) - TALLAS_DEFAULT.indexOf(b.talla));
                                    const total = newTallas.reduce((s, x) => s + x.qty, 0);
                                    return { ...l, tallas: newTallas, qty: total > 0 ? total : l.qty };
                                  }));
                                }}
                                style={{
                                  width: 44, height: 40, textAlign: "center",
                                  fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 15,
                                  background: active ? "var(--accent-dim)" : "var(--bg)",
                                  border: `2px solid ${active ? "var(--accent)" : "var(--border2)"}`,
                                  borderRadius: 8, padding: "0 2px",
                                  color: active ? "var(--accent)" : "var(--text2)",
                                  outline: "none", transition: "all .15s",
                                }}
                              />
                            </div>
                          );
                        })}
                        {/* Total — FIX 8: clear indicator, auto vs manual */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginLeft: 4, paddingLeft: 12, borderLeft: "1px solid var(--border)" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: "var(--text3)", textTransform: "uppercase" }}>
                            {line.tallas?.some(x=>x.qty>0) ? "Auto ✓" : "Manual"}
                          </span>
                          <input
                            type="number" min={0}
                            value={line.tallas?.some(x=>x.qty>0)
                              ? line.tallas.reduce((s,x)=>s+x.qty,0)
                              : (line.qty || "")}
                            readOnly={line.tallas?.some(x=>x.qty>0)}
                            placeholder="0"
                            onChange={e => { if(!line.tallas?.some(x=>x.qty>0)) updLine(i, "qty", e.target.value); }}
                            style={{
                              width: 52, height: 40, textAlign: "center",
                              fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 16,
                              background: line.tallas?.some(x=>x.qty>0) ? "var(--accent-dim)" : "var(--bg2)",
                              border: `2px solid var(--accent)`,
                              borderRadius: 8, padding: "0 2px",
                              color: "var(--accent)", outline: "none",
                              cursor: line.tallas?.some(x=>x.qty>0) ? "default" : "text",
                            }}
                          />
                          {line.tallas?.some(x=>x.qty>0) && Number(line.qty) > 0 && line.tallas.reduce((s,x)=>s+x.qty,0) !== Number(line.qty) && (
                            <span style={{ fontSize: 9, color: "var(--warn)", fontWeight: 700 }}>≠ {line.qty}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {line.prendaId === "__otro" && (
                      <div style={{ marginBottom: 10, marginLeft: 24 }}>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <input className="inp inp-sm" placeholder="Nombre (Gorra, Tote…)" style={{ flex: 1, minWidth: 120 }}
                            value={line.otroName} onChange={e => updLine(i, "otroName", e.target.value)} />
                          <span style={{ color: "var(--text3)", fontSize: 12, fontFamily: "'JetBrains Mono'" }}>L</span>
                          <input type="number" className="inp inp-sm" placeholder="Costo *" style={{ width: 80, fontFamily: "'JetBrains Mono'", borderColor: (!Number(line.otroCost) && line.quien !== "Cliente") ? "var(--warn)" : undefined }}
                            value={line.otroCost} onChange={e => updLine(i, "otroCost", e.target.value)} />
                        </div>
                        {!Number(line.otroCost) && line.quien !== "Cliente" && (
                          <div style={{ fontSize: 11, color: "var(--warn)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            Ingresá el costo de la prenda para calcular correctamente
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ marginLeft: 24 }}>
                      <div className="lbl">Posiciones</div>
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
                          {l.color && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text3)" }}>· {l.color}</span>}
                          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{l.cfgLabel}
                            {l.quien === "Cliente" && <span className="pill" style={{ background: "rgba(251,191,36,.1)", color: "var(--warn)", marginLeft: 6 }}>cliente pone</span>}
                          </div>
                          {l.tallasSummary && (
                            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'JetBrains Mono'", marginTop: 2 }}>
                              📏 {l.tallasSummary}
                            </div>
                          )}
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

                    {/* Margen alert */}
                    {calc.rm < margenMin && (
                      <div className="fade-up" style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", display: "flex", alignItems: "center", gap: 8 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>Margen {calc.rm.toFixed(1)}% está por debajo del mínimo aceptable ({margenMin}%). Considera subir el precio.</span>
                      </div>
                    )}
                    {/* Total box */}
                    <div style={{ marginTop: 16, borderRadius: 14, overflow: "hidden", border: `1px solid ${calc.rm < margenMin ? "rgba(248,113,113,.4)" : "rgba(34,211,238,.25)"}` }}>
                      <div style={{ background: "linear-gradient(135deg, rgba(34,211,238,.08), rgba(34,211,238,.03))", padding: "22px 20px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".18em", color: "var(--text3)", marginBottom: 6 }}>Cobrar al cliente</div>
                        <div style={{ fontFamily: "'Sora'", fontSize: 48, fontWeight: 800, color: "var(--accent)", letterSpacing: "-2px", lineHeight: 1 }}>L{calc.total.toLocaleString()}</div>
                        {mostrarUSD && tipoCambio > 0 && (
                          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text2)", marginTop: 4, fontFamily: "'JetBrains Mono'" }}>
                            ≈ ${(calc.total / tipoCambio).toFixed(2)} USD
                          </div>
                        )}
                      </div>
                      <div className="grid3" style={{ borderTop: "1px solid rgba(34,211,238,.15)" }}>
                        <StatBox label="Mi costo" val={`L${Math.round(calc.cost)}`} />
                        <StatBox label="Ganancia" val={`L${Math.round(calc.profit)}`} color="var(--green)" />
                        <StatBox label="Margen" val={`${calc.rm.toFixed(1)}%`} color={calc.rm >= margenMin ? "var(--green)" : "var(--red)"} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ⑤ FACTURA */}
                <Factura calc={calc} businessName={businessName} logoB64={logoB64} validezDias={validezDias} onSavePedido={savePedido} />
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
          <button className={`mobile-nav-btn ${tab === "pedidos" ? "active" : ""}`} onClick={() => setTab("pedidos")} style={{ position: "relative" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            Pedidos
            {pedidos.filter(p => p.estado !== "Entregado").length > 0 && (
              <span style={{ position: "absolute", top: 6, right: 10, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }}/>
            )}
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

function Factura({ calc, businessName, logoB64, validezDias = 15, onSavePedido }) {
  const today = new Date();
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // FIX 7: generate invoice number ONCE per mount from Supabase (real auto-increment)
  const invoiceNumRef = useRef(null);
  const [invoiceNum, setInvoiceNum] = useState("....");
  useEffect(() => {
    if (invoiceNumRef.current) return;
    invoiceNumRef.current = true;
    getNextNumero().then(n => setInvoiceNum(n));
  }, []);
  const [notes, setNotes] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const dateStr = today.toLocaleDateString("es-HN", { year: "numeric", month: "long", day: "numeric" });

  // FIX 10: Real PDF via html2canvas + jsPDF (no window.print())
  const handlePrint = async () => {
    setPdfLoading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const { jsPDF } = await import("jspdf");
      const el = document.getElementById("factura-print");
      if (!el) { setPdfLoading(false); return; }

      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: "#ffffff",
        logging: false, letterRendering: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdfW = 210; // A4 mm
      const pdfH = (canvas.height * pdfW) / canvas.width;
      const pdf = new jsPDF({ orientation: pdfH > 297 ? "p" : "p", unit: "mm", format: "a4" });

      let yPos = 0;
      const pageH = 297; // A4 height in mm
      if (pdfH <= pageH) {
        pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      } else {
        // Multi-page: slice image
        let remainH = pdfH;
        while (remainH > 0) {
          const sliceH = Math.min(pageH, remainH);
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = (sliceH / pdfH) * canvas.height;
          const ctx = sliceCanvas.getContext("2d");
          ctx.drawImage(canvas, 0, yPos * canvas.height / pdfH, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
          if (yPos > 0) pdf.addPage();
          pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", 0, 0, pdfW, sliceH);
          yPos += sliceH;
          remainH -= sliceH;
        }
      }
      pdf.save(`Cotizacion-${invoiceNum}-${businessName.replace(/\s+/g,"-")}.pdf`);
    } catch (err) {
      console.error("PDF error:", err);
      alert("Error generando PDF. Intenta de nuevo.");
    }
    setPdfLoading(false);
  };

  const handleEmail = () => {
    const lines = calc.lp.map(l =>
      `${l.qty}× ${l.prendaLabel}${l.color ? ` (${l.color})` : ""}${l.tallasSummary ? ` [${l.tallasSummary}]` : ""} — L${l.sellPrice}/u = L${l.lineTotal}`
    ).join("\n");
    const body = encodeURIComponent(
`Estimado/a ${clientName || "cliente"},

Adjunto la cotización #${invoiceNum} de ${businessName} DTF:

${lines}
${calc.disc > 0 ? `\nDescuento ${calc.volPct}%: -L${calc.disc}` : ""}${calc.designFee > 0 ? `\nDiseño: ${calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}` : ""}${calc.fixFee > 0 ? `\nCorrección: ${calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}` : ""}

TOTAL: L${calc.total.toLocaleString()}

Fecha: ${dateStr}
Cotización válida por ${validezDias} días.

${notes ? `Notas: ${notes}\n` : ""}Gracias por preferirnos.
${businessName}`
    );
    window.location.href = `mailto:${clientEmail}?subject=Cotizaci%C3%B3n%20%23${invoiceNum}%20-%20${encodeURIComponent(businessName)}%20DTF&body=${body}`;
  };

  return (
    <div className="card fade-up">
      <style>{`
        @media print { .no-print { display: none !important; } }
      `}</style>
      <div className="card-head">
        <StepBadge n={5} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Factura / Cotización</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={async () => {
              const result = await onSavePedido(calc, clientName, invoiceNum, clientEmail, clientPhone, notes);
              if (result === "duplicate") {
                if (confirm("Esta cotización ya está guardada. ¿Guardar de todas formas como nueva?")) {
                  onSavePedido(calc, clientName, invoiceNum + "-bis");
                  alert("✅ Pedido guardado");
                }
              } else { alert("✅ Pedido guardado en la lista"); }
            }}
            style={{ background: "rgba(52,211,153,.1)", border: "1px solid rgba(52,211,153,.3)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "var(--green)", cursor: "pointer", minHeight: 36, display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Guardar pedido
          </button>
          <button onClick={handleEmail} style={{ background: "transparent", border: "1px solid var(--border2)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "var(--text2)", cursor: "pointer", minHeight: 36, display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>
            Correo
          </button>
          <button onClick={handlePrint} disabled={pdfLoading} style={{ background: "var(--accent)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "var(--bg)", cursor: pdfLoading ? "wait" : "pointer", minHeight: 36, display: "flex", alignItems: "center", gap: 6, opacity: pdfLoading ? 0.7 : 1 }}>
            {pdfLoading
              ? <span className="blink">Generando…</span>
              : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> PDF</>
            }
          </button>
        </div>
      </div>
      <div className="card-body">
        {/* Datos del cliente */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <div className="lbl">Nombre del cliente</div>
            <input className="inp" placeholder="Juan Pérez / Empresa S.A." value={clientName} onChange={e => setClientName(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Correo electrónico</div>
            <input className="inp inp-sm" type="email" placeholder="cliente@email.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Teléfono</div>
            <input className="inp inp-sm" type="tel" placeholder="+504 9999-9999" value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
          </div>
          <div>
            <div className="lbl">Nº de cotización</div>
            <input className="inp inp-sm" value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }} />
          </div>
          <div>
            <div className="lbl">Fecha</div>
            <div className="inp inp-sm" style={{ color: "var(--text2)", background: "var(--bg3)" }}>{dateStr}</div>
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <div className="lbl">Notas adicionales</div>
            <textarea className="inp inp-sm" rows={2} placeholder="Tiempo de entrega, condiciones de pago, etc…" value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: "vertical", minHeight: 60 }} />
          </div>
        </div>

        {/* Preview de factura */}
        <div id="factura-print" style={{ background: "white", borderRadius: 12, padding: "28px 28px 20px", border: "1px solid var(--border)", color: "#111" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, paddingBottom: 18, borderBottom: "2px solid #111" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {logoB64 && <img src={logoB64} alt="Logo" style={{ height: 56, maxWidth: 120, objectFit: "contain" }} />}
              <div>
                <div style={{ fontFamily: "'Sora'", fontSize: 26, fontWeight: 800, letterSpacing: "-1px", color: "#111" }}>{businessName}</div>
                <div style={{ fontSize: 10, color: "#999", letterSpacing: ".1em", textTransform: "uppercase", marginTop: 2 }}>DTF · Estampado Digital</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#999", textTransform: "uppercase", letterSpacing: ".1em" }}>Cotización</div>
              <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 22, fontWeight: 800, color: "#111" }}>#{invoiceNum}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{dateStr}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>Válida {validezDias} días</div>
            </div>
          </div>

          {/* Cliente */}
          {clientName && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "#999", fontWeight: 700, marginBottom: 6 }}>Cotización para</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>{clientName}</div>
              {clientEmail && <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>{clientEmail}</div>}
              {clientPhone && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{clientPhone}</div>}
            </div>
          )}

          {/* Tabla de líneas */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#999", fontWeight: 700, padding: "8px 10px", textAlign: "left", borderBottom: "2px solid #eee" }}>Descripción</th>
                <th style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#999", fontWeight: 700, padding: "8px 10px", textAlign: "center", borderBottom: "2px solid #eee", width: 60 }}>Cant.</th>
                <th style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#999", fontWeight: 700, padding: "8px 10px", textAlign: "right", borderBottom: "2px solid #eee", width: 90 }}>P/u</th>
                <th style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#999", fontWeight: 700, padding: "8px 10px", textAlign: "right", borderBottom: "2px solid #eee", width: 100 }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {calc.lp.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: "10px", fontSize: 13, borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 600, color: "#111" }}>{l.prendaLabel}{l.color ? <span style={{ fontWeight: 400, color: "#666" }}> — {l.color}</span> : ""}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Pos: {l.cfgLabel}</div>
                    {l.tallasSummary && <div style={{ fontSize: 10, color: "#aaa", fontFamily: "'JetBrains Mono'", marginTop: 2 }}>Tallas: {l.tallasSummary}</div>}
                    {l.quien === "Cliente" && <div style={{ fontSize: 10, color: "#d97706", marginTop: 2 }}>⚠ Cliente provee prenda</div>}
                  </td>
                  <td style={{ padding: "10px", textAlign: "center", fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 14, color: "#111", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>{l.qty}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "'JetBrains Mono'", fontSize: 13, color: "#555", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>L{l.sellPrice}</td>
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "'JetBrains Mono'", fontWeight: 700, fontSize: 14, color: "#111", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>L{l.lineTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totales */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: 300 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: "#555" }}>
                <span>Subtotal</span><span style={{ fontFamily: "'JetBrains Mono'" }}>L{calc.sub}</span>
              </div>
              {calc.disc > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: "#16a34a" }}>
                  <span>Descuento {calc.volPct}%</span><span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>-L{calc.disc}</span>
                </div>
              )}
              {calc.designFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: calc.designCharged === 0 ? "#16a34a" : "#555" }}>
                  <span>Diseño ({calc.dType?.label})</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}</span>
                </div>
              )}
              {calc.fixFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: calc.fixCharged === 0 ? "#16a34a" : "#555" }}>
                  <span>Corrección de arte</span>
                  <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 10px", fontSize: 18, fontWeight: 800, borderTop: "2px solid #111", marginTop: 6, color: "#111" }}>
                <span>TOTAL</span><span style={{ fontFamily: "'JetBrains Mono'" }}>L{calc.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Notas */}
          {notes && (
            <div style={{ marginTop: 20, background: "#f8f8f8", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#555" }}>
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#999" }}>Notas</div>
              {notes}
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: 32, paddingTop: 14, borderTop: "1px solid #eee", fontSize: 11, color: "#aaa", textAlign: "center" }}>
            Cotización generada por {businessName} · {dateStr} · Válida por {validezDias} días
          </div>
        </div>
      </div>
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
