import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { loadPedidos, savePedidos, nextQuoteNum, ESTADOS, ESTADO_COLOR } from "./store.js";
import { findBestSheets } from "./nesting.js";
import {
  buildPackingRequestFromLegacy,
  formatPackingMode,
  legacyNestingFromSolution,
  stablePackingRequestKey,
} from "./packing/contracts.mjs";
import { solvePackingRequest } from "./packing/client.mjs";
import { solvePackingPreview } from "./packing/maxrects.mjs";
import PhoneInput from "./PhoneInput.jsx";
import {
  calculateDocumentAdjustments,
  createDocumentPayload,
  createEmptyCharge,
  DOCUMENT_TYPE_LABEL,
  extractDocumentItems,
  formatMoney,
  getDocumentNextStatuses,
  inferDocumentType,
  normalizeDocumentAdjustments,
  normalizeDocumentStatus,
  readDocumentPayload,
  roundCurrency,
} from "./documents.js";
import {
  loadConfigRemote, saveConfigRemote,
  loadCotizaciones, createCotizacion, updateCotizacion, updateCotizacionEstado, deleteCotizacion,
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
// Fórmula: ancho_in × alto_in × 0.0774 (o cm × cm × 0.012)
const calcPoli = (w, h, unit = "in") => parseFloat((w * h * (unit === "cm" ? 0.012 : 0.0774)).toFixed(2));
const PACKING_TIMEOUT_MS = 4500;
const slugSkuPart = (value, fallback = "NA") => {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return normalized || fallback;
};

function buildVariantSku({ prendaLabel, color, talla }) {
  return [
    slugSkuPart(prendaLabel, "PRENDA"),
    slugSkuPart(color, "SIN-COLOR"),
    slugSkuPart(talla, "STD"),
  ].join("-");
}

function parseTallasSummary(summary = "") {
  return [...summary.matchAll(/([^,: ]+):\s*(\d+)/g)].map(match => ({
    talla: match[1],
    qty: Number(match[2]) || 0,
  })).filter(item => item.qty > 0);
}

function buildLineVariants(line, prendaLabel) {
  if (Array.isArray(line.variants) && line.variants.length > 0) {
    return line.variants
      .map(item => ({
        sku: item.sku || buildVariantSku({ prendaLabel, color: item.color || line.color, talla: item.talla }),
        talla: item.talla || "",
        color: item.color || line.color || "",
        qty: Number(item.qty) || 0,
      }))
      .filter(item => item.qty > 0);
  }

  const tallaEntries = Array.isArray(line.tallas) && line.tallas.length > 0
    ? line.tallas.filter(item => Number(item.qty) > 0).map(item => ({ talla: item.talla, qty: Number(item.qty) || 0 }))
    : parseTallasSummary(line.tallasSummary || "");

  if (tallaEntries.length > 0) {
    return tallaEntries.map(item => ({
      sku: buildVariantSku({ prendaLabel, color: line.color, talla: item.talla }),
      talla: item.talla,
      color: line.color || "",
      qty: item.qty,
    }));
  }

  const qty = Number(line.qty) || 0;
  if (qty <= 0) return [];

  return [{
    sku: buildVariantSku({ prendaLabel, color: line.color, talla: "STD" }),
    talla: "",
    color: line.color || "",
    qty,
  }];
}

function buildQuoteGroups(lines = []) {
  const groups = new Map();

  lines.forEach((line, index) => {
    const parentLabel = line.groupLabel || line.parentLabel || line.prendaLabel || "Prenda";
    const groupId = line.groupId || line.parentGroupId || `${parentLabel}::${line.cfgLabel || ""}::${index}`;
    const variantDetails = buildLineVariants(line, parentLabel);
    const existing = groups.get(groupId) || {
      id: groupId,
      label: parentLabel,
      cfgLabel: line.cfgLabel || "",
      quien: line.quien || null,
      totalQty: 0,
      totalLine: 0,
      items: [],
      variants: [],
    };

    existing.totalQty += Number(line.qty) || 0;
    existing.totalLine += Number(line.lineTotal) || 0;
    existing.items.push(line);
    existing.variants.push(...variantDetails);
    groups.set(groupId, existing);
  });

  return [...groups.values()].map(group => {
    const mergedVariants = new Map();

    group.variants.forEach(variant => {
      const key = `${variant.sku}::${variant.color}::${variant.talla}`;
      const current = mergedVariants.get(key) || { ...variant, qty: 0 };
      current.qty += Number(variant.qty) || 0;
      mergedVariants.set(key, current);
    });

    return {
      ...group,
      variants: [...mergedVariants.values()],
      avgUnitPrice: group.totalQty > 0 ? group.totalLine / group.totalQty : 0,
    };
  });
}

function formatGroupSummaryText(group) {
  return group.variants
    .map(variant => `${variant.qty}× ${variant.color || "Sin color"}${variant.talla ? ` / ${variant.talla}` : ""}`)
    .join(", ");
}

// ── Pure pricing engine — returns full calc-compatible object for Factura ──
function calcPrecioSolicitud({ lines, prendas, placements, sheets, volTiers, poliRate, energyCost, margin, unitSystem = "in" }) {
  if (!lines?.length) return null;
  let pidx = 0;
  const allPieces = [];
  let totalQty = 0;

  const lineDetails = lines.map(line => {
    const qty = Number(line.qty) || 0;
    totalQty += qty;
    const piecesPerUnit = [];
    let poli = 0;

    // Match placements by label from cfgLabel
    const posLabels = (line.cfgLabel || "").split(" + ").filter(Boolean);
    posLabels.forEach(label => {
      const pl = placements.find(p =>
        p.label === label || p.label?.toLowerCase() === label?.toLowerCase()
      );
      if (pl) {
        piecesPerUnit.push({ w: pl.w, h: pl.h, label: pl.label, color: pl.color });
        poli += calcPoli(pl.w, pl.h, unitSystem);
      }
    });

    // Fallback: match by placementIds
    if (!piecesPerUnit.length && line.placementIds?.length) {
      line.placementIds.forEach(pid => {
        const pl = placements.find(p => p.id === pid);
        if (pl) {
          piecesPerUnit.push({ w: pl.w, h: pl.h, label: pl.label, color: pl.color });
          poli += calcPoli(pl.w, pl.h, unitSystem);
        }
      });
    }

    const pr = prendas.find(p => p.id === line.prendaId || p.name === line.prendaLabel);
    const prendaCost = pr ? pr.cost : 0;
    const prendaLabel = pr ? pr.name : (line.prendaLabel || "Prenda");
    const variants = buildLineVariants(line, prendaLabel);
    const groupId = line.groupId || line.parentGroupId || `${prendaLabel}::${line.cfgLabel || ""}`;
    const groupLabel = line.groupLabel || line.parentLabel || prendaLabel;

    for (let u = 0; u < qty; u++) {
      piecesPerUnit.forEach(p => allPieces.push({ ...p, _idx: pidx++ }));
    }

    return {
      qty, prendaCost, poli, poliCost: poli * poliRate,
      prendaLabel, color: line.color || "",
      cfgLabel: posLabels.join(" + ") || line.cfgLabel || "",
      tallasSummary: line.tallasSummary || null,
      groupId,
      groupLabel,
      variants,
      quien: "Yo",
    };
  });

  if (totalQty === 0) return null;

  // Run nesting only if we have pieces
  const nesting = allPieces.length
    ? findBestSheets(allPieces, sheets)
    : { results: [], totalCost: 0 };

  const dtfCost = nesting.totalCost;
  const dtfPU = totalQty > 0 ? dtfCost / totalQty : 0;

  const tier = [...volTiers].sort((a, b) => b.minQty - a.minQty).find(t => totalQty >= t.minQty) || volTiers[0];
  const volPct = tier?.discPct || 0;

  // Build lp — same structure Factura expects
  const lp = lineDetails.map(ld => {
    const uc = ld.prendaCost + ld.poliCost + dtfPU + energyCost;
    const sellPrice = Math.ceil((uc * (1 + margin / 100)) / 10) * 10;
    const lineTotal = sellPrice * ld.qty;
    return {
      ...ld,
      unitCost: uc,
      sellPrice,
      lineTotal,
      costTotal: uc * ld.qty,
    };
  });

  const sub = lp.reduce((s, l) => s + l.lineTotal, 0);
  const disc = Math.round(sub * volPct / 100);
  const total = sub - disc;
  const cost = lp.reduce((s, l) => s + l.costTotal, 0);
  const profit = total - cost;
  const rm = total > 0 ? (profit / total) * 100 : 0;

  const totalPoli = lineDetails.reduce((s, l) => s + l.poli, 0);
  const totalPoliCost = lineDetails.reduce((s, l) => s + l.poliCost, 0);
  const totalEnergyCost = totalQty * energyCost;
  const groups = buildQuoteGroups(lp);

  // Return full calc-compatible object
  return {
    lp, nesting, totalQty, dtfCost,
    groups,
    sub, disc, total, cost, profit, rm,
    volPct, tier,
    totalPoli, totalPoliCost, totalEnergyCost,
    // No design/fix fees for client solicitudes
    designFee: 0, designCharged: 0, fixFee: 0, fixCharged: 0,
    dType: null, fType: null,
    // Helpers for breakdown display
    warmUpTotal: 0,
    desglose: {
      dtfCost: Math.round(dtfCost),
      poliCost: Math.round(totalPoliCost),
      energyCost: parseFloat(totalEnergyCost.toFixed(2)),
    },
  };
}

function buildPackingContext({ lines, placements, prendas, poliRate, sheets, agruparPorColor, unitSystem = "in" }) {
  const active = lines.filter(line =>
    line.qty &&
    Number(line.qty) > 0 &&
    (line.placementIds.length > 0 || line.customs.some(custom => custom.w && custom.h))
  );

  if (!active.length) return null;

  const totalQty = active.reduce((sum, line) => sum + Number(line.qty), 0);
  let pidx = 0;
  const allPieces = [];

  const lineDetails = active.map(line => {
    const qty = Number(line.qty);
    const piecesPerUnit = [];
    let poli = 0;

    line.placementIds.forEach(pid => {
      const placement = placements.find(item => item.id === pid);
      if (!placement) return;
      piecesPerUnit.push({ w: placement.w, h: placement.h, label: placement.label, color: placement.color });
      poli += calcPoli(placement.w, placement.h, unitSystem);
    });

    line.customs.forEach(custom => {
      if (!(custom.w && custom.h)) return;
      const width = Number(custom.w);
      const height = Number(custom.h);
      piecesPerUnit.push({ w: width, h: height, label: custom.label || "Custom", color: custom.color || "#0071E3" });
      poli += calcPoli(width, height, unitSystem);
    });

    const prenda = prendas.find(item => item.id === line.prendaId);

    for (let unit = 0; unit < qty; unit++) {
      piecesPerUnit.forEach(piece => allPieces.push({
        ...piece,
        _idx: pidx++,
        prendaColor: line.color || "",
        prendaLabel: prenda?.name || line.otroName || "Otro",
      }));
    }

    const prendaCost = line.quien === "Cliente" ? 0 : (prenda ? prenda.cost : Number(line.otroCost) || 0);
    const prendaLabel = prenda ? prenda.name : (line.otroName || "Otro");
    const sinCosto = line.quien !== "Cliente" && line.prendaId === "__otro" && !Number(line.otroCost);
    const variants = buildLineVariants(line, prendaLabel);
    const groupId = line.groupId || line.parentGroupId || line.id;
    const groupLabel = line.groupLabel || line.parentLabel || prendaLabel;
    const cfgLabel = [
      ...line.placementIds.map(pid => placements.find(item => item.id === pid)?.label || "?"),
      ...line.customs.filter(custom => custom.w && custom.h).map(custom => `${custom.label} ${custom.w}×${custom.h}`),
    ].join(" + ");
    const tallasSummary = line.tallas?.length > 0
      ? (line.tallas || []).filter(item => item.qty > 0).map(item => `${item.talla}:${item.qty}`).join(" ")
      : null;

    return {
      ...line,
      qty,
      pieces: piecesPerUnit,
      poli,
      poliCost: poli * poliRate,
      prendaCost,
      prendaLabel,
      cfgLabel,
      tallasSummary,
      groupId,
      groupLabel,
      variants,
      sinCosto,
    };
  });

  const packingRequest = buildPackingRequestFromLegacy(allPieces, sheets, {
    separateByGroup: agruparPorColor,
    timeoutMs: PACKING_TIMEOUT_MS,
  });

  return {
    totalQty,
    allPieces,
    lineDetails,
    packingRequest,
    requestKey: stablePackingRequestKey(packingRequest),
  };
}

function buildCalcResult({
  lineDetails,
  totalQty,
  nesting,
  designWho,
  designId,
  fixId,
  designTypes,
  fixTypes,
  volTiers,
  margin,
  energyCost,
  prensaWatts,
  tarifaKwh,
  adjustments,
}) {
  const dtfCost = nesting.totalCost;
  const dtfPU = totalQty > 0 ? dtfCost / totalQty : 0;

  const dType = designTypes.find(item => item.id === designId);
  const designFee = designWho === "Cliente trae arte" ? 0 : (dType?.price || 0);
  const fType = fixTypes.find(item => item.id === fixId);
  const fixFee = designWho === "Nosotros diseñamos" ? 0 : (fType?.price || 0);

  const tier = [...volTiers].sort((a, b) => b.minQty - a.minQty).find(item => totalQty >= item.minQty) || volTiers[0];
  const designCharged = tier.designDisc >= 100 ? 0 : Math.round(designFee * (1 - tier.designDisc / 100));
  const fixCharged = tier.fixFree ? 0 : fixFee;
  const volPct = tier.discPct || 0;

  const lp = lineDetails.map(line => {
    const unitCost = line.prendaCost + line.poliCost + dtfPU + energyCost;
    const myBase = line.poliCost + dtfPU + energyCost;
    const autoSellPrice = line.quien === "Cliente"
      ? Math.ceil((myBase * (1 + margin / 100)) / 10) * 10
      : Math.ceil((unitCost * (1 + margin / 100)) / 10) * 10;
    const manualUnitPrice = line.useManualUnitPrice ? roundCurrency(line.manualUnitPrice) : 0;
    const sellPrice = manualUnitPrice > 0 ? manualUnitPrice : autoSellPrice;
    return {
      ...line,
      unitCost,
      autoSellPrice,
      manualUnitPrice: manualUnitPrice > 0 ? manualUnitPrice : null,
      unitPriceSource: manualUnitPrice > 0 ? "manual" : "auto",
      sellPrice,
      lineTotal: roundCurrency(sellPrice * line.qty),
      costTotal: roundCurrency(unitCost * line.qty),
    };
  });

  const sub = roundCurrency(lp.reduce((sum, line) => sum + line.lineTotal, 0));
  const disc = roundCurrency(sub * volPct / 100);
  const baseAfterAutoDiscount = roundCurrency(sub - disc + designCharged + fixCharged);
  const adjustmentSummary = calculateDocumentAdjustments(baseAfterAutoDiscount, adjustments);
  const total = roundCurrency(baseAfterAutoDiscount - adjustmentSummary.manualDiscount + adjustmentSummary.extraChargesTotal);
  const cost = roundCurrency(lp.reduce((sum, line) => sum + line.costTotal, 0));
  const profit = roundCurrency(total - cost);
  const rm = total > 0 ? (profit / total) * 100 : 0;

  const totalPoli = lineDetails.reduce((sum, line) => sum + line.poli, 0);
  const totalPoliCost = lineDetails.reduce((sum, line) => sum + line.poliCost, 0);
  const totalEnergyCost = totalQty * energyCost;
  const warmUpMinutes = Math.round(((165 - 25) * 3.5 * 900) / (prensaWatts * 60) * 1.4 * 10) / 10;
  const warmUpKwh = (prensaWatts / 1000) * (warmUpMinutes / 60);
  const warmUpTotal = warmUpKwh * tarifaKwh;
  const warmUpPerPrenda = totalQty > 0 ? parseFloat((warmUpTotal / totalQty).toFixed(4)) : 0;
  const groups = buildQuoteGroups(lp);

  return {
    lp,
    groups,
    nesting,
    totalQty,
    dtfCost,
    designFee,
    fixFee,
    designCharged,
    fixCharged,
    volPct,
    disc,
    sub,
    baseAfterAutoDiscount,
    manualDiscount: adjustmentSummary.manualDiscount,
    adjustments: adjustmentSummary.adjustments,
    extraChargesTotal: adjustmentSummary.extraChargesTotal,
    total,
    cost,
    profit,
    rm,
    tier,
    dType,
    fType,
    totalPoli,
    totalPoliCost,
    totalEnergyCost,
    warmUpPerPrenda,
    warmUpMinutes,
    warmUpTotal,
  };
}

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
  useManualUnitPrice: false,
  manualUnitPrice: "",
});

function defaultDocumentMeta(status = "Borrador", docType = "cotizacion") {
  return {
    docType,
    status,
    designWho: "Cliente trae arte",
    designId: "d0",
    fixId: "f0",
    adjustments: normalizeDocumentAdjustments(),
    internalNotes: "",
    sourceQuoteId: null,
    convertedAt: null,
    createdFrom: "admin",
  };
}

function sumTallas(line) {
  return (line.tallas || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

function syncLineQty(line) {
  const tallasTotal = sumTallas(line);
  if (tallasTotal > 0 || line.showTallas) {
    return {
      ...line,
      qty: tallasTotal,
    };
  }
  return {
    ...line,
    qty: Math.max(0, Number(line.qty) || 0),
  };
}

function parseCfgLabelToPlacementIds(cfgLabel, placements) {
  return String(cfgLabel || "")
    .split(" + ")
    .map(label => label.trim())
    .filter(Boolean)
    .map(label => placements.find(item => item.label?.toLowerCase() === label.toLowerCase())?.id)
    .filter(Boolean);
}

function buildEditableTallas(item, prenda, tallasCfg) {
  const variants = buildLineVariants(item, prenda?.name || item.prendaLabel || item.otroName || "Prenda");
  const totals = new Map();
  variants.forEach(variant => {
    const key = variant.talla || "STD";
    totals.set(key, (totals.get(key) || 0) + (Number(variant.qty) || 0));
  });

  const baseSizes = prenda?.tallas?.length ? prenda.tallas : tallasCfg;
  const extraSizes = [...totals.keys()].filter(size => size !== "STD" && !baseSizes.includes(size));
  const ordered = [...baseSizes, ...extraSizes];

  return ordered.map(talla => ({
    talla,
    qty: totals.get(talla) || 0,
  }));
}

function buildEditorLineFromStored(item, { prendas, placements, tallasCfg }) {
  const prenda = prendas.find(entry => entry.id === item.prendaId || entry.name === item.prendaLabel);
  const tallas = buildEditableTallas(item, prenda, tallasCfg);
  const showTallas = tallas.some(entry => entry.qty > 0);
  const placementIds = Array.isArray(item.placementIds) && item.placementIds.length
    ? item.placementIds
    : parseCfgLabelToPlacementIds(item.cfgLabel, placements);
  const customs = Array.isArray(item.customs)
    ? item.customs.map(custom => ({
        label: custom.label || "Custom",
        color: custom.color || "#9B6B8B",
        w: custom.w || "",
        h: custom.h || "",
      }))
    : [];

  return syncLineQty({
    ...emptyLine(),
    id: item.id || uid(),
    qty: Number(item.qty) || 0,
    prendaId: prenda?.id || (item.prendaId === "__otro" ? "__otro" : ""),
    quien: item.quien || "Yo",
    placementIds,
    customs,
    otroName: item.otroName || (!prenda ? item.prendaLabel || "" : ""),
    otroCost: item.otroCost ?? "",
    color: item.color || item.variants?.[0]?.color || "",
    tallas,
    showTallas,
    useManualUnitPrice: Number(item.manualUnitPrice) > 0,
    manualUnitPrice: Number(item.manualUnitPrice) > 0 ? item.manualUnitPrice : "",
  });
}

function normalizeDocumentMeta(meta, row) {
  const status = normalizeDocumentStatus(meta?.status || row.estado || "Borrador");
  const docType = inferDocumentType(meta?.docType, status);
  return {
    ...defaultDocumentMeta(status, docType),
    ...(meta || {}),
    status,
    docType,
    adjustments: normalizeDocumentAdjustments(meta?.adjustments),
  };
}

function hydratePedidoRecord(row, { prendas, placements, tallasCfg }) {
  const payload = readDocumentPayload(row.lines);
  const meta = normalizeDocumentMeta(payload.meta, row);
  const items = extractDocumentItems(row.lines);
  const lines = items;
  const editorLines = items.length > 0
    ? items.map(item => buildEditorLineFromStored(item, { prendas, placements, tallasCfg }))
    : [{ ...emptyLine(), qty: 1 }];

  return {
    id: row.id || uid(),
    num: row.numero || row.num || "",
    cliente: row.cliente || "",
    email: row.email || "",
    telefono: row.telefono || "",
    fecha: row.created_at || row.fecha || new Date().toISOString(),
    total: Number(row.total) || 0,
    estado: meta.status,
    docType: meta.docType,
    notas: row.notas || "",
    lines,
    editorLines,
    meta,
    fromWeb: meta.createdFrom === "web" || row.notas?.includes("Pedido web") || false,
  };
}

function serializeLinesFromCalc(calc) {
  return calc.lp.map(line => ({
    id: line.id,
    qty: line.qty,
    prendaId: line.prendaId,
    prendaLabel: line.prendaLabel,
    quien: line.quien,
    placementIds: line.placementIds,
    customs: line.customs,
    otroName: line.otroName,
    otroCost: line.otroCost,
    color: line.color,
    tallas: line.tallas,
    tallasSummary: line.tallasSummary,
    groupId: line.groupId,
    groupLabel: line.groupLabel,
    variants: line.variants,
    sellPrice: line.sellPrice,
    autoSellPrice: line.autoSellPrice,
    manualUnitPrice: line.manualUnitPrice,
    lineTotal: line.lineTotal,
    unitCost: line.unitCost,
  }));
}

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
  const [prensaWatts, setPrensaWatts]   = useState(saved?.prensaWatts   ?? 1000);
  const [prensaSeg, setPrensaSeg]       = useState(saved?.prensaSeg     ?? 15);
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
  const [darkMode, setDarkMode]       = useState(false); // always light mode
  const [tipoCambio, setTipoCambio]   = useState(saved?.tipoCambio ?? 25.5);
  const [mostrarUSD, setMostrarUSD]   = useState(saved?.mostrarUSD ?? false);
  const [margenMin, setMargenMin]     = useState(saved?.margenMin ?? 30);
  const [unitSystem, setUnitSystem]   = useState(saved?.unitSystem ?? "in");
  const [pedidos, setPedidos] = useState(() => (
    loadPedidos().map(row => hydratePedidoRecord(row, {
      prendas: saved?.prendas ?? INIT_PRENDAS,
      placements: saved?.placements ?? INIT_PLACEMENTS,
      tallasCfg: saved?.tallasCfg ?? TALLAS_DEFAULT,
    }))
  ));
  const [agruparPorColor, setAgruparPorColor] = useState(saved?.agruparPorColor ?? false);
  const [pedidoTab, setPedidoTab]     = useState("Todos");
  const [selectedPedido, setSelectedPedido] = useState(null);
  const [pedidosPage, setPedidosPage]   = useState(0);
  const PEDIDOS_PER_PAGE = 20;
  const [syncStatus, setSyncStatus]   = useState("idle");
  const [supabaseReady, setSupabaseReady] = useState(false);
  // PIN gate
  const [pinUnlocked, setPinUnlocked] = useState(() => sessionStorage.getItem("dtf_pin_ok") === "1");
  const [pinInput, setPinInput]       = useState("");
  const [pinError, setPinError]       = useState(false);
  const [adminPin, setAdminPin]       = useState(saved?.adminPin ?? "1234");
  const [whatsappBiz, setWhatsappBiz] = useState(saved?.whatsappBiz ?? "");
  // SEO fields — editable from Config → Mi Negocio
  const [seoTitle, setSeoTitle]           = useState(saved?.seoTitle       ?? "");
  const [seoDesc, setSeoDesc]             = useState(saved?.seoDesc        ?? "");
  const [seoSlogan, setSeoSlogan]         = useState(saved?.seoSlogan      ?? "");
  const [docTerms, setDocTerms]           = useState(saved?.docTerms       ?? "Tiempo de entrega: 2 a 3 días hábiles.\nSe requiere 50% de anticipo para iniciar el trabajo.");
  const [docShowPrices, setDocShowPrices] = useState(saved?.docShowPrices ?? true);
  // BCH exchange rate (auto-fetched)
  const [bchRate, setBchRate]         = useState(saved?.tipoCambio ?? 25.5);
  const [bchUpdated, setBchUpdated]   = useState(null);

  // Save state
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | dirty | saved
  const [savedSnapshot, setSavedSnapshot] = useState(saved);
  const isFirstRender = useRef(true);
  const isInitializing = useRef(true); // blocks auto-save during Supabase init
  const packingCacheRef = useRef(new Map());
  const [packingState, setPackingState] = useState({
    requestKey: null,
    solution: null,
    loading: false,
    error: null,
  });

  const currentConfig = useMemo(() => ({
    margin, prendas, placements, sheets, designTypes, fixTypes, volTiers,
    poliBolsa, poliGramos, businessName, prensaWatts, prensaSeg, tarifaKwh, tallasCfg, coloresCfg, logoB64, validezDias,
    darkMode, tipoCambio, mostrarUSD, margenMin, agruparPorColor, whatsappBiz, unitSystem,
    seoTitle, seoDesc, seoSlogan, docTerms, docShowPrices
  }), [margin, prendas, placements, sheets, designTypes, fixTypes, volTiers, poliBolsa, poliGramos, businessName, prensaWatts, prensaSeg, tarifaKwh, tallasCfg, coloresCfg, logoB64, validezDias, darkMode, tipoCambio, mostrarUSD, margenMin, agruparPorColor, whatsappBiz, unitSystem, seoTitle, seoDesc, seoSlogan, docTerms, docShowPrices]);

  // Add noindex meta for admin (security — don't let search engines index this)
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => document.head.removeChild(meta);
  }, []);

  // ── Dynamic title: sync browser tab with config ──
  useEffect(() => {
    const title = seoTitle || `${businessName || "DTF"} — Admin`;
    document.title = title;
  }, [seoTitle, businessName]);

  // Track unsaved changes (just the indicator dot, no auto-POST)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (isInitializing.current) return;
    setSaveStatus("dirty");
  }, [currentConfig]);

  // adminPin saved separately, NOT in main config JSON
  const PIN_KEY = "dtf_admin_pin";
  useEffect(() => {
    const savedPin = localStorage.getItem(PIN_KEY);
    if (savedPin) setAdminPin(savedPin);
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    const localOk = saveConfig(currentConfig);
    if (supabaseReady) await saveConfigRemote(currentConfig);
    // Save PIN separately (not in main config)
    localStorage.setItem(PIN_KEY, adminPin);
    if (localOk === false) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("dirty"), 3000);
    } else {
      setSavedSnapshot(currentConfig);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  }, [currentConfig, supabaseReady]);

  // ── Supabase init: load remote data on first mount ──
  useEffect(() => {
    let cancelled = false;
    // Fetch BCH/exchange rate on mount
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json())
      .then(d => {
        if (!cancelled && d?.rates?.HNL) {
          const rate = parseFloat(d.rates.HNL.toFixed(4));
          setBchRate(rate);
          setTipoCambio(rate); // sync to config too
          setBchUpdated(new Date(d.time_last_update_utc).toLocaleDateString("es-HN", { month:"short", day:"numeric" }));
        }
      }).catch(() => {});
    const init = async () => {
      setSyncStatus("syncing");
      // Check connection
      const online = await checkConnection();
      if (cancelled) return;
      if (!online) { setSyncStatus("offline"); isInitializing.current = false; return; }

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
        if (remoteCfg.whatsappBiz)  setWhatsappBiz(remoteCfg.whatsappBiz);
        if (remoteCfg.seoTitle)     setSeoTitle(remoteCfg.seoTitle);
        if (remoteCfg.seoDesc)      setSeoDesc(remoteCfg.seoDesc);
        if (remoteCfg.seoSlogan)    setSeoSlogan(remoteCfg.seoSlogan);
        if (remoteCfg.docTerms !== undefined) setDocTerms(remoteCfg.docTerms);
        if (remoteCfg.docShowPrices !== undefined) setDocShowPrices(remoteCfg.docShowPrices);
        if (remoteCfg.darkMode      !== undefined)  setDarkMode(remoteCfg.darkMode);
        if (remoteCfg.mostrarUSD    !== undefined)  setMostrarUSD(remoteCfg.mostrarUSD);
        if (remoteCfg.margenMin     !== undefined)  setMargenMin(remoteCfg.margenMin);
        if (remoteCfg.unitSystem)   setUnitSystem(remoteCfg.unitSystem);
        if (remoteCfg.agruparPorColor !== undefined) setAgruparPorColor(remoteCfg.agruparPorColor);
        // adminPin stored separately, not in remote config
        if (remoteCfg.prensaWatts)  setPrensaWatts(remoteCfg.prensaWatts);
        if (remoteCfg.prensaSeg)    setPrensaSeg(remoteCfg.prensaSeg);
        if (remoteCfg.tarifaKwh)    setTarifaKwh(remoteCfg.tarifaKwh);
      }

      const effectivePrendas = remoteCfg?.prendas ?? saved?.prendas ?? INIT_PRENDAS;
      const effectivePlacements = remoteCfg?.placements ?? saved?.placements ?? INIT_PLACEMENTS;
      const effectiveTallasCfg = remoteCfg?.tallasCfg ?? saved?.tallasCfg ?? TALLAS_DEFAULT;

      // Load remote cotizaciones
      const remoteCots = await loadCotizaciones();
      if (!cancelled && remoteCots !== null) {
        const mapped = remoteCots.map(row => hydratePedidoRecord(row, {
          prendas: effectivePrendas,
          placements: effectivePlacements,
          tallasCfg: effectiveTallasCfg,
        }));
        setPedidos(mapped);
        savePedidos(mapped); // update localStorage too
      }

      if (!cancelled) { setSyncStatus("online"); setSupabaseReady(true); isInitializing.current = false; }
    };
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // Auto-save 1.5s after any config change (skip during init)
  // Auto-save removed — save only on explicit button click

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
        if (cfg.unitSystem) setUnitSystem(cfg.unitSystem);
        if (cfg.agruparPorColor !== undefined) setAgruparPorColor(cfg.agruparPorColor);
        // adminPin stored separately
        if (cfg.whatsappBiz) setWhatsappBiz(cfg.whatsappBiz);
        if (cfg.seoTitle)    setSeoTitle(cfg.seoTitle);
        if (cfg.seoDesc)     setSeoDesc(cfg.seoDesc);
        if (cfg.seoSlogan)   setSeoSlogan(cfg.seoSlogan);
        if (cfg.docTerms !== undefined) setDocTerms(cfg.docTerms);
        if (cfg.docShowPrices !== undefined) setDocShowPrices(cfg.docShowPrices);
        alert("✅ Configuración importada correctamente");
      } catch { alert("❌ Archivo inválido"); }
    };
    reader.readAsText(file);
  }, []);

  // Save cotización as pedido — with Supabase sync
  const savePedido = useCallback(async (calc, clientName, invoiceNum, email = "", telefono = "", notas = "", docTypeOverride = "cotizacion") => {
    if (!calc) return false;
    const exists = loadPedidos().some(p => p.num === invoiceNum);
    if (exists) return "duplicate";

    const meta = {
      ...defaultDocumentMeta("Borrador", docTypeOverride),
      designWho,
      designId,
      fixId,
      createdFrom: "admin",
    };
    const lineItems = serializeLinesFromCalc(calc);
    const payload = createDocumentPayload(lineItems, meta);
    const estado = meta.status;

    // Save to Supabase if online
    let id = uid();
    if (supabaseReady) {
      const row = await createCotizacion({
        numero: invoiceNum,
        cliente: clientName || "Sin nombre",
        email, telefono, notas,
        total: calc.total,
        estado,
        lines: payload,
      });
      if (row) id = row.id;
    }

    const nuevo = hydratePedidoRecord({
      id, num: invoiceNum,
      cliente: clientName || "Sin nombre",
      email, telefono, notas,
      fecha: new Date().toISOString(),
      total: calc.total,
      estado,
      lines: payload,
    }, { prendas, placements, tallasCfg });
    setPedidos(prev => [nuevo, ...prev]);
    return "ok";
  }, [designId, designWho, fixId, prendas, placements, supabaseReady, tallasCfg]);

  const savePedidoEdits = useCallback(async (pedidoBase, calc, overrides) => {
    if (!calc) return false;

    const meta = {
      ...defaultDocumentMeta(overrides.status, overrides.docType),
      ...(pedidoBase?.meta || {}),
      docType: overrides.docType,
      status: overrides.status,
      designWho: overrides.designWho,
      designId: overrides.designId,
      fixId: overrides.fixId,
      adjustments: normalizeDocumentAdjustments(overrides.adjustments),
      internalNotes: overrides.internalNotes || "",
      sourceQuoteId: overrides.sourceQuoteId || pedidoBase?.meta?.sourceQuoteId || null,
      convertedAt: overrides.convertedAt || pedidoBase?.meta?.convertedAt || null,
      createdFrom: pedidoBase?.meta?.createdFrom || (pedidoBase?.fromWeb ? "web" : "admin"),
    };
    const payload = createDocumentPayload(serializeLinesFromCalc(calc), meta);
    const normalizedRecord = hydratePedidoRecord({
      id: pedidoBase.id,
      numero: overrides.num,
      cliente: overrides.cliente,
      email: overrides.email,
      telefono: overrides.telefono,
      created_at: pedidoBase.fecha,
      total: calc.total,
      estado: overrides.status,
      notas: overrides.notas,
      lines: payload,
    }, { prendas, placements, tallasCfg });

    setPedidos(prev => prev.map(item => item.id === normalizedRecord.id ? normalizedRecord : item));
    setSelectedPedido(normalizedRecord);

    if (supabaseReady) {
      await updateCotizacion(pedidoBase.id, {
        numero: overrides.num,
        cliente: overrides.cliente,
        email: overrides.email,
        telefono: overrides.telefono,
        total: calc.total,
        estado: overrides.status,
        notas: overrides.notas,
        lines: payload,
      });
    }

    return true;
  }, [placements, prendas, supabaseReady, tallasCfg]);

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

  const packingContext = useMemo(() => buildPackingContext({
    lines,
    placements,
    prendas,
    poliRate,
    sheets,
    agruparPorColor,
    unitSystem,
  }), [lines, placements, prendas, poliRate, sheets, agruparPorColor, unitSystem]);

  const previewSolution = useMemo(() => {
    if (!packingContext?.packingRequest) return null;
    return solvePackingPreview(packingContext.packingRequest);
  }, [packingContext?.requestKey]);

  useEffect(() => {
    if (!packingContext?.packingRequest) {
      setPackingState({ requestKey: null, solution: null, loading: false, error: null });
      return;
    }

    const cached = packingCacheRef.current.get(packingContext.requestKey);
    if (cached) {
      setPackingState({
        requestKey: packingContext.requestKey,
        solution: cached,
        loading: false,
        error: cached.error || null,
      });
      return;
    }

    const controller = new AbortController();
    setPackingState(prev => ({
      requestKey: packingContext.requestKey,
      solution: prev.requestKey === packingContext.requestKey ? prev.solution : null,
      loading: true,
      error: null,
    }));

    solvePackingRequest(packingContext.packingRequest, { signal: controller.signal })
      .then(solution => {
        packingCacheRef.current.set(packingContext.requestKey, solution);
        setPackingState({
          requestKey: packingContext.requestKey,
          solution,
          loading: false,
          error: solution.error || null,
        });
      })
      .catch(error => {
        if (error?.name === "AbortError") return;
        setPackingState({
          requestKey: packingContext.requestKey,
          solution: null,
          loading: false,
          error: error?.message || "No se pudo resolver el packing exacto.",
        });
      });

    return () => controller.abort();
  }, [packingContext?.requestKey]);

  const activePackingSolution = useMemo(() => {
    if (!packingContext?.packingRequest) return null;
    if (packingState.requestKey === packingContext.requestKey && packingState.solution) return packingState.solution;
    return previewSolution;
  }, [packingContext?.requestKey, packingState.requestKey, packingState.solution, previewSolution]);

  const activeNesting = useMemo(() => (
    activePackingSolution ? legacyNestingFromSolution(activePackingSolution) : null
  ), [activePackingSolution]);

  const calc = useMemo(() => {
    if (!packingContext || !activeNesting) return null;
    return buildCalcResult({
      lineDetails: packingContext.lineDetails,
      totalQty: packingContext.totalQty,
      nesting: activeNesting,
      designWho,
      designId,
      fixId,
      designTypes,
      fixTypes,
      volTiers,
      margin,
      energyCost,
      prensaWatts,
      tarifaKwh,
      adjustments: undefined,
    });
  }, [
    activeNesting,
    designId,
    designTypes,
    designWho,
    energyCost,
    fixId,
    fixTypes,
    margin,
    packingContext,
    prensaWatts,
    tarifaKwh,
    volTiers,
  ]);
  const packingModeLabel = useMemo(
    () => formatPackingMode(activePackingSolution, packingState.loading),
    [activePackingSolution, packingState.loading]
  );
  // Note: energyCost is derived from prensaWatts/prensaSeg/tarifaKwh which ARE in currentConfig


  // ── RENDER ──
  return (
    <div className="light-theme" style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "'Inter',-apple-system,BlinkMacSystemFont,sans-serif", minHeight: "100dvh" }}>
      {/* PIN Gate */}
      {!pinUnlocked && (
        <div style={{ position: "fixed", inset: 0, background: "#F5F5F7", zIndex: 999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
          <div style={{ position: "absolute", top: "-20%", right: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle,rgba(0,113,227,.04) 0%,transparent 70%)", filter: "blur(80px)", pointerEvents: "none" }}/>
          <div style={{ textAlign: "center", marginBottom: 8, position: "relative" }}>
            <div style={{ fontFamily: "'Inter'", fontWeight: 800, fontSize: 28, color: "#1D1D1F", letterSpacing: "-.03em" }}>{businessName}</div>
            <div style={{ fontSize: 10, color: "#86868B", letterSpacing: ".14em", textTransform: "uppercase", marginTop: 6, fontWeight: 600 }}>Panel interno · Acceso restringido</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #E8E8ED", borderRadius: 22, padding: "28px 32px", width: 280, textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,.06)", position: "relative" }}>
            <div style={{ fontSize: 13, color: "#6E6E73", marginBottom: 16, fontWeight: 600 }}>Ingresa el PIN de acceso</div>
            <input
              type="password" inputMode="numeric" maxLength={8}
              value={pinInput} onChange={e => { setPinInput(e.target.value); setPinError(false); }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  if (pinInput === adminPin) { sessionStorage.setItem("dtf_pin_ok", "1"); setPinUnlocked(true); }
                  else { setPinError(true); setPinInput(""); }
                }
              }}
              placeholder="••••"
              style={{ width: "100%", textAlign: "center", fontSize: 28, letterSpacing: 8, fontFamily: "'JetBrains Mono'", fontWeight: 700,
                background: "#fff", border: `2px solid ${pinError ? "#F87171" : "#E8E8ED"}`, borderRadius: 10, padding: "12px", color: "#1D1D1F", outline: "none" }}
              autoFocus
            />
            {pinError && <div style={{ color: "#F87171", fontSize: 12, marginTop: 8, fontWeight: 600 }}>PIN incorrecto</div>}
            <button onClick={() => {
              if (pinInput === adminPin) { sessionStorage.setItem("dtf_pin_ok", "1"); setPinUnlocked(true); }
              else { setPinError(true); setPinInput(""); }
            }} style={{ marginTop: 16, width: "100%", background: "var(--accent)", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 800, color: "#fff", cursor: "pointer" }}>
              Entrar
            </button>
          </div>
          <a href="/" style={{ fontSize: 12, color: "#6E6E73", textDecoration: "none" }}>← Volver al cotizador público</a>
        </div>
      )}
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* No ambient effects — clean Apple-like aesthetic */}
      <style>{`
        :root {
          --accent: #0071E3;
          --accent-dim: rgba(0,113,227,.08);
          --accent-glow: rgba(0,113,227,.15);
          --green: #2E7D32;
          --red: #D32F2F;
          --warn: #F57F17;
          --radius: 16px;
          --radius-sm: 10px;
        }
        .dark-theme {
          --bg: #111827; --bg2: #1F2937; --bg3: #374151;
          --border: #374151; --border2: #4B5563;
          --text: #F9FAFC; --text2: #D1D5DB; --text3: #9CA3AF;
          --shadow: rgba(0,0,0,.4);
          --accent: #007AFF;
          --accent-dim: rgba(0,122,255,0.15);
        }
        .light-theme {
          --bg: #F2F2F7; --bg2: #FFFFFF; --bg3: #F9F9FB;
          --border: #E5E5EA; --border2: #D1D1D6;
          --text: #1C1C1E; --text2: #3C3C43; --text3: #8E8E93;
          --shadow: rgba(0,0,0,.04);
          --accent: #007AFF;
          --accent-dim: rgba(0,122,255,0.08);
          --green: #34C759; --red: #FF3B30; --warn: #FF9500;
        }
        .light-theme .card { box-shadow: 0 1px 4px var(--shadow); }
        .light-theme .line-card { background: #FAFAFA; }
        .light-theme header { background: #ffffff; border-bottom: 1px solid var(--border); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; font-size: 16px; }
        body { background: var(--bg); overscroll-behavior-y: none; }
        input, select, button { font-family: inherit; }
        input[type=number] { -moz-appearance: textfield; }
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button { -webkit-appearance: none; }
        ::selection { background: var(--accent); color: var(--bg); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
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
        .card:hover { border-color: var(--border2); }
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
          background: var(--bg3);
          border: 1.5px solid var(--border2);
          border-radius: var(--radius-sm);
          padding: 11px 14px;
          font-size: 14px;
          color: var(--text);
          width: 100%;
          transition: all .2s ease;
          -webkit-appearance: none;
          min-height: 44px;
          letter-spacing: -.01em;
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
          letter-spacing: -.01em;
        }
        .btn-save:hover { opacity: .85; }

        /* ── TABS ── */
        .tab-btn {
          padding: 12px 20px;
          border: none; background: transparent;
          font-size: 14px; font-weight: 600;
          color: var(--text3); cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all .25s; white-space: nowrap;
          min-height: 44px; letter-spacing: -.01em;
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
          letter-spacing: -.01em;
        }
        .cfg-pill {
          padding: 8px 16px; min-height: 36px;
          border: 1.5px solid var(--border);
          border-radius: 24px;
          font-size: 12px; font-weight: 600;
          cursor: pointer;
          transition: all .25s cubic-bezier(.4,0,.2,1);
          background: transparent;
          color: var(--text2);
          white-space: nowrap;
        }
        .cfg-pill.active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .cfg-pill:hover:not(.active) { border-color: var(--accent); color: var(--accent); }

        /* ── PLACEMENT CHIPS ── */
        .pl-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 6px 11px;
          border-radius: 8px; border: 1.5px solid var(--border2);
          background: var(--bg3);
          font-size: 11px; font-weight: 600;
          cursor: pointer;
          transition: all .15s;
          user-select: none;
          color: var(--text2);
          min-height: 34px;
          -webkit-tap-highlight-color: transparent;
        }
        .pl-chip:hover { border-color: var(--text2); color: var(--text); }
        .pl-chip.on { color: #fff; border-color: transparent; font-weight: 700; }

        /* ── LINE CARD ── */
        .line-card {
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 16px;
          margin-bottom: 10px;
          transition: all .25s;
        }
        .line-card:hover { border-color: var(--border2); }

        /* ── LABEL ── */
        .lbl {
          font-size: 10px; text-transform: uppercase;
          letter-spacing: .14em; color: var(--text3);
          font-weight: 700; margin-bottom: 6px;
        }

        /* ── LAYOUT ── */
        .row { display: flex; gap: 8px; align-items: center; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

        /* ── ANIMATIONS ── */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp .4s cubic-bezier(.4,0,.2,1) both; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.4} }
        .blink { animation: blink 1.4s infinite; }

        /* ── MOBILE NAV BAR ── */
        .mobile-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: darkMode ? "rgba(28,28,30,.9)" : "rgba(245,245,247,.9)";
          backdrop-filter: blur(24px) saturate(1.5);
          -webkit-backdrop-filter: blur(24px) saturate(1.5);
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
          .grid2 { grid-template-columns: 1fr 1fr; gap: 14px; }
          .grid3 { grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
          .card { margin-bottom: 16px; }
          .card-body { padding: 20px; }
          .card-head { padding: 16px 20px; }
        }
      `}</style>

      {/* ── TOPBAR ── */}
      <header style={{
        background: "rgba(242,242,247,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.05)",
        position: "sticky", top: 0, zIndex: 100,
        padding: "12px clamp(16px,3vw,40px) 0",
      }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 }}>
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, width: "33%" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#007AFF", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,122,255,0.3)" }}>
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="#fff" strokeWidth="1.4"/>
                  <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="#fff" strokeWidth="1.4"/>
                  <path d="M4 8h8M6 11h4" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <h1 style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-.02em", lineHeight: 1.1, margin: 0, color: "#1C1C1E" }}>{businessName}</h1>
                <p style={{ fontSize: 10, color: "#8E8E93", letterSpacing: ".08em", textTransform: "uppercase", margin: 0, fontWeight: 600 }}>DTF Pro Admin</p>
              </div>
            </div>

            {/* Segmented control (center) */}
            <div style={{ display: "flex", justifyContent: "center", width: "34%" }}>
              <div style={{ background: "rgba(118,118,128,0.12)", borderRadius: 9, padding: 2, display: "inline-flex", gap: 0 }}>
                {[["cotizar","Cotizar"],["pedidos","Pedidos"],["config","Ajustes"]].map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} style={{
                    padding: "5px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600,
                    border: "none", cursor: "pointer", transition: "all .2s",
                    background: tab === k ? "#FFFFFF" : "transparent",
                    color: "#1C1C1E",
                    boxShadow: tab === k ? "0 3px 8px rgba(0,0,0,0.12),0 1px 3px rgba(0,0,0,0.04)" : "none",
                    position: "relative",
                  }}>
                    {label}
                    {k === "pedidos" && pedidos.filter(p => p.estado !== "Entregado").length > 0 && (
                      <span style={{ marginLeft: 5, background: "#FF3B30", color: "#fff", borderRadius: 99, padding: "1px 5px", fontSize: 9, fontWeight: 800, verticalAlign: "middle" }}>
                        {pedidos.filter(p => p.estado !== "Entregado").length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: save status + avatar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, width: "33%" }}>
              {saveStatus === "saved" && <span style={{ fontSize: 11, color: "#34C759", fontWeight: 600 }}>✓ Guardado</span>}
              {saveStatus === "saving" && <span style={{ fontSize: 11, color: "#007AFF", fontWeight: 600 }}>Guardando…</span>}
              {saveStatus === "error" && <span style={{ fontSize: 11, color: "#FF3B30", fontWeight: 600 }}>✗ Error</span>}
              {saveStatus === "dirty" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF9500", display: "inline-block" }} />}
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#007AFF,#5AC8FA)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 11, cursor: "pointer" }}>
                {businessName ? businessName.slice(0,2).toUpperCase() : "VF"}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}}
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "20px clamp(16px, 3vw, 40px) 80px" }} className="page-pad">

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

            {/* Config sidebar nav */}
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "start" }}>
            <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", boxShadow: "0 4px 24px rgba(0,0,0,0.04)" }}>
              {[
                ["negocio","Mi Negocio","#007AFF","storefront"],
                ["catalogo","Prendas y Catálogo","#8E8E93","checkroom"],
                ["placements","Posiciones","#8E8E93","place"],
                ["sheets","Hojas DTF","#FF9500","format_paint"],
                ["poli","Poliamida","#FF9500","science"],
                ["design","Servicios Diseño","#AF52DE","design_services"],
                ["fix","Corrección Arte","#AF52DE","auto_fix_high"],
                ["vol","Volumen y Márgenes","#34C759","trending_up"],
                ["documento","Documento","#3C3C43","receipt_long"],
              ].map(([k,label,color]) => (
                <button key={k} onClick={() => setCfgTab(k)} style={{
                  width: "100%", padding: "11px 16px",
                  display: "flex", alignItems: "center", gap: 10,
                  border: "none", borderBottom: "1px solid #E5E5EA",
                  background: cfgTab === k ? "rgba(0,122,255,0.06)" : "transparent",
                  borderLeft: cfgTab === k ? "3px solid #007AFF" : "3px solid transparent",
                  cursor: "pointer", textAlign: "left", transition: "all .15s",
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: cfgTab === k ? "#007AFF" : color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 14, color: "#fff", fontFamily: "'Material Symbols Outlined'", fontWeight: 300 }}>{k === "negocio" ? "storefront" : k === "catalogo" ? "checkroom" : k === "placements" ? "place" : k === "sheets" ? "format_paint" : k === "poli" ? "science" : k === "design" ? "design_services" : k === "fix" ? "auto_fix_high" : k === "vol" ? "trending_up" : "receipt_long"}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: cfgTab === k ? 700 : 500, color: cfgTab === k ? "#007AFF" : "#1C1C1E" }}>{label}</span>
                </button>
              ))}
            </div>
            <div>

            {/* NEGOCIO */}
            {cfgTab === "negocio" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Mi Negocio</span></div>
                <div className="card-body">
                  <div style={{ marginBottom: 14 }}>
                    <div className="lbl">Nombre del negocio</div>
                    <input className="inp" value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ fontWeight: 700, fontSize: 16 }} />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div className="lbl">WhatsApp del negocio</div>
                    <PhoneInput value={whatsappBiz} onChange={setWhatsappBiz} placeholder="tu número" />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>Se usa para recibir solicitudes de clientes y como botón en la factura</div>
                  </div>

                  {/* SEO — editable desde admin */}
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>SEO y redes sociales</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
                      Estos datos aparecen cuando alguien comparte el link de tu cotizador en WhatsApp, Facebook o Google.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <div className="lbl">Título de la página (SEO title)</div>
                        <input className="inp" value={seoTitle}
                          onChange={e => setSeoTitle(e.target.value)}
                          placeholder={`${businessName} — Cotización DTF`}
                          maxLength={70} />
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                          <span>Aparece en la pestaña del browser y en Google</span>
                          <span style={{ color: seoTitle.length > 60 ? "var(--warn)" : "var(--text3)" }}>{seoTitle.length}/70</span>
                        </div>
                      </div>
                      <div>
                        <div className="lbl">Descripción (meta description)</div>
                        <textarea className="inp" value={seoDesc}
                          onChange={e => setSeoDesc(e.target.value)}
                          placeholder="Personalizá tus prendas con estampado DTF. Cotizá en minutos, entrega en 24-48h."
                          maxLength={160} rows={3} style={{ resize: "vertical", minHeight: 70 }} />
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                          <span>Aparece en Google y cuando se comparte el link en WhatsApp</span>
                          <span style={{ color: seoDesc.length > 150 ? "var(--warn)" : "var(--text3)" }}>{seoDesc.length}/160</span>
                        </div>
                      </div>
                      <div>
                        <div className="lbl">Slogan / subtítulo (página pública)</div>
                        <input className="inp" value={seoSlogan}
                          onChange={e => setSeoSlogan(e.target.value)}
                          placeholder="Estampado DTF · Entrega 24-48h · Honduras"
                          maxLength={80} />
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>Aparece debajo del nombre en la página de cotización del cliente</div>
                      </div>
                    </div>
                    {/* Preview */}
                    {(seoTitle || seoDesc) && (
                      <div style={{ marginTop: 14, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>Preview Google</div>
                        <div style={{ fontSize: 15, color: "#1a73e8", fontWeight: 500, marginBottom: 2 }}>{seoTitle || `${businessName} — Cotización DTF`}</div>
                        <div style={{ fontSize: 12, color: "#006621", marginBottom: 4, fontFamily: "'JetBrains Mono'" }}>dtf-cotizador...vercel.app</div>
                        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>{seoDesc || "Personalizá tus prendas con estampado DTF. Cotizá en minutos."}</div>
                      </div>
                    )}
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
                    <div style={{ background: "var(--accent-dim)", border: "1px solid rgba(34,211,238,.2)", borderRadius: 8, padding: "8px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 16, color: "var(--accent)" }}>L{energyCost}</span>
                        <span style={{ fontSize: 11, color: "var(--text2)" }}>por prensada · ({prensaWatts}W × {prensaSeg}s ÷ 3,600 × L{tarifaKwh}/kWh)</span>
                      </div>
                      <div style={{ borderTop: "1px solid rgba(34,211,238,.15)", paddingTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
                        <div><span style={{ color: "var(--text3)" }}>Calentamiento estimado:</span> <b style={{ color: "var(--warn)", fontFamily: "'JetBrains Mono'" }}>{Math.round(((165-25)*3.5*900)/(prensaWatts*60)*1.4*10)/10} min</b></div>
                        <div><span style={{ color: "var(--text3)" }}>Energía calentamiento:</span> <b style={{ fontFamily: "'JetBrains Mono'", color: "var(--accent)" }}>L{((prensaWatts/1000)*(Math.round(((165-25)*3.5*900)/(prensaWatts*60)*1.4*10)/10/60)*tarifaKwh).toFixed(3)}/sesión</b></div>
                        <div><span style={{ color: "var(--text3)" }}>Temp. óptima DTF:</span> <b style={{ color: "var(--green)", fontFamily: "'JetBrains Mono'" }}>160–165°C</b></div>
                        <div><span style={{ color: "var(--text3)" }}>Poliéster:</span> <b style={{ color: "var(--warn)", fontFamily: "'JetBrains Mono'" }}>150–155°C · 10-12s</b></div>
                      </div>
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

                  {/* Unidad de Medida */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">Sistema de Medida</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <select className="sel" value={unitSystem} onChange={e => {
                        const newUnit = e.target.value;
                        if (newUnit !== unitSystem && confirm(`¿Convertir valores existentes (placements, hojas) de ${unitSystem === "in" ? "pulgadas a centímetros" : "centímetros a pulgadas"}?`)) {
                          const factor = newUnit === "cm" ? 2.54 : 1 / 2.54;
                          setPlacements(p => p.map(x => ({ ...x, w: parseFloat((x.w * factor).toFixed(2)), h: parseFloat((x.h * factor).toFixed(2)) })));
                          setSheets(s => s.map(x => ({ ...x, w: parseFloat((x.w * factor).toFixed(2)), h: parseFloat((x.h * factor).toFixed(2)) })));
                        }
                        setUnitSystem(newUnit);
                      }} style={{ maxWidth: 160, fontWeight: 700 }}>
                        <option value="in">Pulgadas (in, ″)</option>
                        <option value="cm">Centímetros (cm)</option>
                      </select>
                      <span style={{ fontSize: 12, color: "var(--text3)", flex: 1 }}>Si cambias la unidad, se te preguntará si quieres convertir los valores actuales.</span>
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

                  {/* PIN de acceso */}
                  <div style={{ marginTop: 14 }}>
                    <div className="lbl">PIN de acceso al panel interno</div>
                    <div className="row" style={{ gap: 8 }}>
                      <input type="password" inputMode="numeric" maxLength={8} className="inp" value={adminPin}
                        onChange={e => setAdminPin(e.target.value)}
                        style={{ maxWidth: 120, fontFamily: "'JetBrains Mono'", fontWeight: 700, letterSpacing: 4, fontSize: 18 }} />
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>Numérico, 4-8 dígitos</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>Cambia el PIN y guardá. Se pide al entrar a /admin</div>
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

            {/* DOCUMENTO */}
            {cfgTab === "documento" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Configuración de Documentos</span></div>
                <div className="card-body">
                  <div style={{ marginBottom: 14 }}>
                    <div className="lbl">Términos y condiciones por defecto</div>
                    <textarea className="inp" value={docTerms} onChange={e => setDocTerms(e.target.value)} rows={4} style={{ resize: "vertical", minHeight: 80 }} placeholder="Tiempo de entrega, condiciones de pago..." />
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>Este texto se pre-rellenará en las notas de nuevas cotizaciones y facturas.</div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text2)" }}>
                      <input type="checkbox" checked={docShowPrices} onChange={e => setDocShowPrices(e.target.checked)} style={{ width: 16, height: 16 }} />
                      Mostrar precio unitario y subtotal por línea en el PDF
                    </label>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, marginLeft: 24 }}>Si se desmarca, el PDF solo mostrará la cantidad de prendas y el total final.</div>
                  </div>
                </div>
              </div>
            )}

            {/* PRENDAS */}
            {cfgTab === "catalogo" && (
              <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 0 }}>

                {/* PRENDAS */}
                <div className="card">
                  <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Catálogo de Prendas</span></div>
                  <div className="card-body">
                    {prendas.map((p, i) => (
                      <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 32px", gap: 6, marginBottom: 8, alignItems: "center" }}>
                        <input className="inp inp-sm" value={p.name} placeholder="Nombre prenda"
                          onChange={e => setPrendas(pr => pr.map((x,j) => j===i ? {...x, name:e.target.value} : x))} />
                        <input className="inp inp-sm" type="number" value={p.cost ?? 0} placeholder="Costo L"
                          onChange={e => setPrendas(pr => pr.map((x,j) => j===i ? {...x, cost:Number(e.target.value)} : x))}
                          style={{ textAlign: "center" }} />
                        <input className="inp inp-sm" type="number" value={p.costCliente ?? 0} placeholder="C. cliente"
                          onChange={e => setPrendas(pr => pr.map((x,j) => j===i ? {...x, costCliente:Number(e.target.value)} : x))}
                          style={{ textAlign: "center" }} />
                        <button onClick={() => setPrendas(p => p.filter((_,j) => j!==i))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 32px", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                      <span>Nombre</span><span style={{textAlign:"center"}}>Costo (Yo)</span><span style={{textAlign:"center"}}>Costo Cliente</span><span/>
                    </div>
                    <button className="btn-add" onClick={add(setPrendas, { id: Date.now(), name: "", cost: 0, costCliente: 0, colors: [], tallas: [] })}>+ Agregar prenda</button>
                  </div>
                </div>

                {/* TALLAS */}
                <div className="card">
                  <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Tallas disponibles</span></div>
                  <div className="card-body">
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                      Define las tallas que aparecen al cotizar.
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
                      <input className="inp inp-sm" placeholder="Nueva talla (ej. 4T, One Size…)" value={newTalla}
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

                {/* COLORES */}
                <div className="card">
                  <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Colores de prenda frecuentes</span></div>
                  <div className="card-body">
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                      Estos colores aparecen como sugerencias al cotizar.
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
                      <input className="inp inp-sm" placeholder="Nuevo color (ej. Verde militar…)" value={newColor}
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

              </div>
            )}

            {/* SHEETS */}
            {cfgTab === "sheets" && (
              <div className="card fade-up">
                <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Hojas DTF</span></div>
                <div className="card-body">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 76px 36px", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--text3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>
                    <span>Nombre</span><span>W {unitSystem==="cm"?"cm":"″"}</span><span>H {unitSystem==="cm"?"cm":"″"}</span><span>Precio L</span><span></span>
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
          </div>
          </div>
        )}

        {/* ══ PEDIDOS ══ */}
        {tab === "pedidos" && (
          <div className="fade-up">
            {/* Pending alert */}
            {pedidos.filter(p => p.estado === "Pendiente").length > 0 && (
              <div style={{ background:"rgba(251,191,36,.1)", border:"1.5px solid rgba(251,191,36,.35)", borderRadius:14, padding:"12px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div>
                  <span style={{ fontWeight:700, fontSize:13, color:"var(--warn)" }}>
                    {pedidos.filter(p=>p.estado==="Pendiente").length} solicitud{pedidos.filter(p=>p.estado==="Pendiente").length>1?"es":""} pendiente{pedidos.filter(p=>p.estado==="Pendiente").length>1?"s":""} de cotizar
                  </span>
                  <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>Revisá los pedidos de clientes, ajustá el precio y aprobá para notificar por WhatsApp</div>
                </div>
                <button onClick={()=>setPedidoTab("Pendiente")} style={{ marginLeft:"auto", background:"var(--warn)", border:"none", borderRadius:8, padding:"6px 12px", fontSize:11, fontWeight:800, color:"#080A10", cursor:"pointer", flexShrink:0 }}>
                  Ver ahora
                </button>
              </div>
            )}
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Solicitudes y pedidos</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Todos", ...ESTADOS].map(e => {
                  const count = e === "Todos" ? pedidos.length : pedidos.filter(p=>p.estado===e).length;
                  return (
                  <button key={e} onClick={() => { setPedidoTab(e); setPedidosPage(0); }}
                    style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none",
                      background: pedidoTab === e ? "var(--accent)" : "var(--bg3)",
                      color: pedidoTab === e ? "var(--bg)" : "var(--text2)",
                      position: "relative",
                    }}>
                    {e}{count>0 && ` (${count})`}
                  </button>
                )})}
              </div>
            </div>
            {(() => {
              const filtered = pedidos.filter(p => pedidoTab === "Todos" || p.estado === pedidoTab);
              const paginated = filtered.slice(pedidosPage * PEDIDOS_PER_PAGE, (pedidosPage + 1) * PEDIDOS_PER_PAGE);
              const totalPages = Math.ceil(filtered.length / PEDIDOS_PER_PAGE);
              if (filtered.length === 0) return (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)" }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Sin pedidos {pedidoTab !== "Todos" ? `en estado "${pedidoTab}"` : "registrados"}</div>
                  <div style={{ fontSize: 13, color: "var(--border2)", marginTop: 4 }}>Los pedidos guardados desde la factura aparecerán aquí</div>
                </div>
              );
              return (<>
              {paginated.map(p => {
                  const ec = ESTADO_COLOR[p.estado] || ESTADO_COLOR.Borrador;
                  // ── Auto-estimate pricing for web orders without total ──
                  const autoCalc = (!p.total && p.lines?.length)
                    ? calcPrecioSolicitud({ lines: p.lines, prendas, placements, sheets, volTiers, poliRate, energyCost: prensaWatts * (prensaSeg / 3600) * tarifaKwh, margin, unitSystem })
                    : null;
                  const displayTotal = p.total || autoCalc?.total || 0;
                  const displayCost = autoCalc?.cost || 0;
                  const displayProfit = autoCalc ? (autoCalc.total - autoCalc.cost) : 0;
                  const isEstimated = !p.total && autoCalc;
                  const enrichedLines = autoCalc ? autoCalc.lp : (p.lines || []);
                  const groupedLines = buildQuoteGroups(enrichedLines);
                  const badgeColor = p.estado === "Pendiente" ? "#FF9500" : p.estado === "Enviada" ? "#007AFF" : p.estado === "Entregado" ? "#34C759" : "#8E8E93";
                  return (
                    <div key={p.id} style={{ background: "#fff", borderRadius: 24, border: "1px solid #E5E5EA", boxShadow: "0 4px 24px rgba(0,0,0,0.04)", marginBottom: 16, overflow: "hidden", display: "flex" }}>
                      {/* Left: main content */}
                      <div style={{ flex: 1, padding: "28px 32px", borderRight: "1px solid #E5E5EA" }}>
                        {/* Header row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                          <div>
                            <span style={{ display: "inline-block", background: `${badgeColor}18`, color: badgeColor, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", padding: "3px 10px", borderRadius: 6, marginBottom: 8 }}>
                              {p.estado}
                            </span>
                            {p.fromWeb && <span style={{ marginLeft: 8, background: "rgba(251,191,36,.12)", color: "#FF9500", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, letterSpacing: ".05em" }}>WEB</span>}
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <h3 style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-.02em", color: "#1C1C1E", margin: 0 }}>
                                #{p.num} <span style={{ fontWeight: 500, fontSize: 20, color: "#8E8E93" }}>{p.cliente}</span>
                              </h3>
                            </div>
                            <p style={{ fontSize: 13, color: "#8E8E93", marginTop: 4 }}>
                              {new Date(p.fecha).toLocaleDateString("es-HN", { year:"numeric", month:"short", day:"numeric" })}
                              {p.telefono && ` · ${p.telefono}`}
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setSelectedPedido(p)}
                              style={{ width: 36, height: 36, borderRadius: "50%", background: "#F2F2F7", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#007AFF", fontSize: 16 }}>
                              ✏️
                            </button>
                            <button onClick={async () => { if (confirm("¿Eliminar este pedido?")) {
                              setPedidos(prev => prev.filter(x => x.id !== p.id));
                              if (supabaseReady) await deleteCotizacion(p.id);
                            }}}
                              style={{ width: 36, height: 36, borderRadius: "50%", background: "#F2F2F7", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#8E8E93", fontSize: 18 }}>
                              ×
                            </button>
                          </div>
                        </div>

                        {/* Line items */}
                        <div style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", letterSpacing: ".08em", borderBottom: "1px solid #F2F2F7", paddingBottom: 8, marginBottom: 12 }}>Artículos del Pedido</div>
                          {groupedLines.map(group => (
                            <div key={group.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "10px 12px", borderRadius: 12, marginBottom: 4 }}
                              onMouseOver={e => e.currentTarget.style.background="#F9F9FB"}
                              onMouseOut={e => e.currentTarget.style.background="transparent"}>
                              <div style={{ width: 44, height: 44, background: "#fff", border: "1px solid #E5E5EA", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, color: "#1C1C1E", flexShrink: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}>
                                {group.totalQty}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C1E" }}>{group.label}</div>
                                {group.cfgLabel && <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>Estampado: {group.cfgLabel}</div>}
                                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                                  {group.variants?.slice(0,3).map(v => (
                                    <span key={v.sku} style={{ fontSize: 10, background: "#fff", border: "1px solid #E5E5EA", padding: "2px 6px", borderRadius: 4, color: "#8E8E93", fontFamily: "'JetBrains Mono'" }}>
                                      {v.color || ""}{v.talla ? ` ${v.talla}` : ""}{v.qty > 1 ? ` ×${v.qty}` : ""}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C1E" }}>L{formatMoney(group.totalLine || 0)}</div>
                            </div>
                          ))}
                          {p.notas && <div style={{ marginTop: 8, fontSize: 12, color: "#FF9500", fontStyle: "italic" }}>📝 {p.notas.slice(0,80)}{p.notas.length>80?"…":""}</div>}
                        </div>

                        {/* Approve button */}
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          {p.estado === "Pendiente" && whatsappBiz && (
                            <button onClick={() => {
                              const groupPreview = groupedLines.map(group =>
                                `👕 ${group.label}\n🎨 ${group.cfgLabel || "Sin posiciones"}\n📦 ${group.totalQty} prendas\n↳ ${formatGroupSummaryText(group)}`
                              ).join("\n\n");
                              const msg = encodeURIComponent(
                                `Hola ${p.cliente}! 👋\n\n📋 *Cotización #${p.num} — ${businessName}*\n\n${groupPreview ? `${groupPreview}\n\n` : ""}💰 *Total: L${displayTotal ? formatMoney(displayTotal) : "_____"}*\n\n_Confirmame si estás de acuerdo y coordinamos los detalles._`
                              );
                              window.open(`https://wa.me/${p.telefono || p.lines?.[0]?.telefono}?text=${msg}`, "_blank");
                              setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, estado: "Enviada", meta: { ...x.meta, status: "Enviada" } } : x));
                              if (supabaseReady) updateCotizacionEstado(p.id, "Enviada");
                            }}
                              style={{ background: "#34C759", color: "#fff", border: "none", borderRadius: 12, padding: "12px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center" }}>
                              ✓ Aprobar y Enviar WhatsApp
                            </button>
                          )}
                          <select value={p.estado} onChange={async e => {
                            const newEstado = e.target.value;
                            setPedidos(prev => prev.map(x => x.id === p.id ? { ...x, estado: newEstado, meta: { ...x.meta, status: newEstado } } : x));
                            if (supabaseReady) await updateCotizacionEstado(p.id, newEstado);
                          }}
                            style={{ background: "#F2F2F7", border: "1px solid #E5E5EA", color: "#1C1C1E", borderRadius: 10, padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {ESTADOS.map(es => <option key={es}>{es}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Right: receipt breakdown */}
                      <div style={{ width: 280, background: "#F9F9FB", padding: "28px 24px", display: "flex", flexDirection: "column", position: "relative" }}>
                        <div style={{ position: "absolute", top: 40, left: -12, width: 24, height: 24, borderRadius: "50%", background: "#fff", border: "1px solid #E5E5EA" }}/>
                        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 14, color: "#1C1C1E", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          <span style={{ fontSize: 16 }}>🧾</span> Desglose Interno
                        </div>
                        {isEstimated && autoCalc ? (
                          <div style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono'", color: "#8E8E93", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 20, borderBottom: "2px dashed #E5E5EA", marginBottom: 20 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}><span>DTF</span><span>L{formatMoney(autoCalc.dtfCost)}</span></div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Prendas</span><span>L{formatMoney(autoCalc.lp.reduce((s,l) => s + l.prendaCost*l.qty, 0))}</span></div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Poliamida ({autoCalc.totalPoli?.toFixed(1)}g)</span><span>L{formatMoney(autoCalc.totalPoliCost)}</span></div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Energía</span><span>L{formatMoney(autoCalc.totalEnergyCost)}</span></div>
                          </div>
                        ) : (
                          <div style={{ flex: 1, paddingBottom: 20, borderBottom: "2px dashed #E5E5EA", marginBottom: 20 }}>
                            <div style={{ fontSize: 12, color: "#C7C7CC", textAlign: "center", padding: "20px 0" }}>Cotización manual</div>
                          </div>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {isEstimated && autoCalc && (
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#3C3C43", fontWeight: 500 }}>
                              <span>Mi Costo Operativo</span>
                              <span>L{formatMoney(displayCost)}</span>
                            </div>
                          )}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#8E8E93" }}>Total Cliente</span>
                            <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-.02em", color: "#1C1C1E" }}>
                              L{formatMoney(displayTotal)}
                              {isEstimated && <span style={{ fontSize: 12, color: "#FF9500", marginLeft: 4 }}>≈</span>}
                            </span>
                          </div>
                          {isEstimated && autoCalc && displayTotal > 0 && (
                            <div style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#34C759", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Margen de Ganancia</div>
                              <div style={{ fontWeight: 900, color: "#34C759", fontSize: 15 }}>L{formatMoney(displayProfit)} ({displayTotal > 0 ? ((displayProfit/displayTotal)*100).toFixed(0) : 0}%)</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
              })}
              {totalPages > 1 && (
                <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:8, marginTop:16 }}>
                  <button disabled={pedidosPage === 0} onClick={() => setPedidosPage(p=>p-1)}
                    style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:700, color:"var(--text2)", cursor:pedidosPage===0?"not-allowed":"pointer", opacity:pedidosPage===0?.4:1 }}>
                    ← Anterior
                  </button>
                  <span style={{ fontSize:12, color:"var(--text3)" }}>
                    Página {pedidosPage+1} de {totalPages} · {filtered.length} pedidos
                  </span>
                  <button disabled={pedidosPage >= totalPages-1} onClick={() => setPedidosPage(p=>p+1)}
                    style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:700, color:"var(--text2)", cursor:pedidosPage>=totalPages-1?"not-allowed":"pointer", opacity:pedidosPage>=totalPages-1?.4:1 }}>
                    Siguiente →
                  </button>
                </div>
              )}
              </>);
            })()}
          </div>
        )}

        {/* ══ COTIZAR ══ */}
        {tab === "cotizar" && (
          <div className="fade-up">

            {/* Unsaved changes bar */}
            {saveStatus === "dirty" && (
              <div className="fade-up" style={{ background:"rgba(251,191,36,.08)", border:"1px solid rgba(251,191,36,.25)", borderRadius:12, padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                <span style={{ fontSize:12, color:"var(--warn)", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--warn)", display:"inline-block" }}/>
                  Hay configuración sin guardar
                </span>
                <button onClick={handleSave} style={{ background:"var(--warn)", border:"none", borderRadius:8, padding:"6px 14px", fontSize:12, fontWeight:800, color:"#080A10", cursor:"pointer" }}>
                  Guardar ahora
                </button>
              </div>
            )}

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
                        {(() => {
                          const isAuto = line.tallas?.some(x => x.qty > 0);
                          const autoTotal = (line.tallas || []).reduce((s, x) => s + (x.qty || 0), 0);
                          const mismatch = isAuto && Number(line.qty) > 0 && autoTotal !== Number(line.qty);

                          return (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginLeft: 4, paddingLeft: 12, borderLeft: "1px solid var(--border)" }}>
                              <span style={{
                                fontSize: 8, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase",
                                padding: "2px 6px", borderRadius: 4,
                                background: isAuto ? "rgba(46, 125, 50, 0.12)" : "rgba(245, 127, 23, 0.12)",
                                color: isAuto ? "var(--green)" : "var(--warn)",
                                border: `1px solid ${isAuto ? "rgba(46, 125, 50, 0.2)" : "rgba(245, 127, 23, 0.2)"}`
                              }}>
                                {isAuto ? "Auto ✓" : "Manual"}
                              </span>
                              <input
                                type="number" min={0}
                                value={isAuto ? autoTotal : (line.qty || "")}
                                readOnly={isAuto}
                                placeholder="0"
                                onChange={e => { if (!isAuto) updLine(i, "qty", e.target.value); }}
                                style={{
                                  width: 54, height: 40, textAlign: "center",
                                  fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 16,
                                  background: isAuto ? "rgba(46, 125, 50, 0.05)" : "var(--bg2)",
                                  border: `2px solid ${isAuto ? "var(--green)" : "var(--warn)"}`,
                                  borderRadius: 8, padding: "0 2px",
                                  color: isAuto ? "var(--green)" : "var(--warn)", outline: "none",
                                  cursor: isAuto ? "default" : "text",
                                  transition: "all .2s ease",
                                }}
                              />
                              {mismatch && (
                                <span style={{ fontSize: 9, color: "var(--warn)", fontWeight: 700 }}>≠ {line.qty}</span>
                              )}
                            </div>
                          );
                        })()}
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
                          <input type="number" step={0.5} className="inp inp-sm" placeholder={unitSystem==="cm" ? 'W cm' : 'W"'} style={{ width: 58, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.w} onChange={e => updCustom(i, ci, "w", e.target.value)} />
                          <span style={{ color: "var(--text3)", fontWeight: 700 }}>×</span>
                          <input type="number" step={0.5} className="inp inp-sm" placeholder={unitSystem==="cm" ? 'H cm' : 'H"'} style={{ width: 58, textAlign: "center", fontFamily: "'JetBrains Mono'" }} value={c.h} onChange={e => updCustom(i, ci, "h", e.target.value)} />
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
                    <span style={{
                      marginLeft: 10,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: activePackingSolution?.source === "cp_sat" ? "var(--green)" : "var(--text3)",
                      background: activePackingSolution?.source === "cp_sat" ? "rgba(52,211,153,.12)" : "rgba(148,163,184,.08)",
                      border: "1px solid rgba(148,163,184,.16)",
                      borderRadius: 999,
                      padding: "4px 8px",
                    }}>{packingModeLabel}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono'", fontSize: 20, fontWeight: 800, color: "var(--accent)" }}>L{calc.dtfCost}</span>
                  </div>
                  <div style={{ padding: 16, background: "var(--bg)" }}>
                    {(packingState.error || calc.nesting?.unplaced?.length > 0) && (
                      <div style={{
                        marginBottom: 14,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "rgba(251,191,36,.08)",
                        border: "1px solid rgba(251,191,36,.18)",
                        color: "var(--warn)",
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}>
                        {packingState.error
                          ? `Se mostró el preview local porque el solver exacto no respondió: ${packingState.error}`
                          : `${calc.nesting.unplaced.length} pieza(s) no caben en las hojas configuradas.`}
                      </div>
                    )}
                    {/* Resumen */}
                    {(() => {
                      const counts = {};
                      (calc.nesting?.results || []).forEach(r => { counts[r.sheet?.name || '?'] = (counts[r.sheet?.name || '?'] || 0) + 1; });
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
                    {(calc.nesting?.results || []).map((res, ri) => {
                      const { sheet, placed } = res;
                      const maxH = placed?.length ? Math.max(...placed.map(p => (p.y || 0) + (p.h || 0))) : (sheet.h || 20);
                      const dH = Math.min(maxH + 2, sheet.h);
                      const svW = 340, sc = svW / sheet.w, svH = dH * sc, pd = 24;
                      return (
                        <div key={ri} style={{ marginBottom: ri < (calc.nesting?.results?.length || 0) - 1 ? 20 : 0 }}>
                          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 700 }}>{sheet.name}
                              <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 11, marginLeft: 8, fontFamily: "'JetBrains Mono'" }}>{sheet.w}{unitSystem==="cm"?"cm":"″"} × {sheet.h}{unitSystem==="cm"?"cm":"″"}</span></span>
                            <span style={{ fontFamily: "'JetBrains Mono'", color: "var(--accent)", fontSize: 18, fontWeight: 800 }}>L{sheet.price}</span>
                          </div>
                          <svg width="100%" viewBox={`${-pd} ${-pd} ${svW + pd * 2} ${svH + pd * 2}`} style={{ display: "block", borderRadius: 8, overflow: "visible" }}>
                            <defs>
                              <pattern id={`g${ri}`} width={sc} height={sc} patternUnits="userSpaceOnUse"><rect width={sc} height={sc} fill="none" stroke="rgba(30,37,53,.8)" strokeWidth=".5" /></pattern>
                              <pattern id={`ht${ri}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.04)" strokeWidth="1" /></pattern>
                              <filter id={`sh${ri}`}><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity=".4" /></filter>
                            </defs>
                            <rect x={0} y={0} width={svW} height={svH} rx={6} fill="var(--bg2)" stroke="var(--border2)" strokeWidth={1.5} />
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
                                    fill="white" fontSize={Math.min(11, pw / 5)} fontWeight="700" style={{ fontFamily: "'Inter'" }}>{p.label}</text>}
                                  {sl && sd && <text x={px + pw / 2} y={py + ph / 2 + 10} textAnchor="middle"
                                    fill="rgba(255,255,255,.4)" fontSize={Math.min(8, pw / 7)} style={{ fontFamily: "'JetBrains Mono'" }}>{p.w}×{p.h}{unitSystem==="cm"?"cm":"″"}</text>}
                                </g>
                              );
                            })}
                            <line x1={0} y1={-10} x2={svW} y2={-10} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={0} y1={-14} x2={0} y2={-6} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={svW} y1={-14} x2={svW} y2={-6} stroke="var(--border2)" strokeWidth={.6} />
                            <text x={svW / 2} y={-15} textAnchor="middle" fill="var(--text3)" fontSize={8} style={{ fontFamily: "'JetBrains Mono'" }}>{sheet.w}{unitSystem==="cm"?"":"″"}</text>
                            <line x1={-10} y1={0} x2={-10} y2={svH} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={-14} y1={0} x2={-6} y2={0} stroke="var(--border2)" strokeWidth={.6} />
                            <line x1={-14} y1={svH} x2={-6} y2={svH} stroke="var(--border2)" strokeWidth={.6} />
                            <text x={-14} y={svH / 2} textAnchor="middle" fill="var(--text3)" fontSize={8}
                              transform={`rotate(-90,-14,${svH / 2})`} style={{ fontFamily: "'JetBrains Mono'" }}>{dH.toFixed(1)}{unitSystem==="cm"?"":"″"}</text>
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
                    {calc.groups.map(group => (
                      <div key={group.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "var(--accent)", fontSize: 14 }}>{group.totalQty}×</span>
                            <span style={{ marginLeft: 6, fontWeight: 700 }}>{group.label}</span>
                            {group.cfgLabel && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{group.cfgLabel}</div>}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "'JetBrains Mono'" }}>L{group.avgUnitPrice.toFixed(2)}/u</div>
                            <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 14 }}>L{group.totalLine}</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {group.variants.map(variant => (
                            <div key={`${group.id}-${variant.sku}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--bg)", borderRadius: 8, gap: 10 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "var(--text2)" }}>{variant.sku}</div>
                                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                  {variant.color || "Sin color"}{variant.talla ? ` · Talla ${variant.talla}` : ""}
                                </div>
                              </div>
                              <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, color: "var(--accent)", flexShrink: 0 }}>{variant.qty}u</div>
                            </div>
                          ))}
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
                        <div style={{ fontFamily: "'Inter'", fontSize: 48, fontWeight: 800, color: "var(--accent)", letterSpacing: "-2px", lineHeight: 1 }}>L{calc.total.toLocaleString()}</div>
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
                <Factura calc={calc} businessName={businessName} logoB64={logoB64} validezDias={validezDias} onSavePedido={savePedido} whatsappBiz={whatsappBiz} docTerms={docTerms} docShowPrices={docShowPrices} />
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

      {selectedPedido && (
        <DocumentEditorModal
          pedido={selectedPedido}
          onClose={() => setSelectedPedido(null)}
          onSave={savePedidoEdits}
          prendas={prendas}
          placements={placements}
          sheets={sheets}
          tallasCfg={tallasCfg}
          coloresCfg={coloresCfg}
          designTypes={designTypes}
          fixTypes={fixTypes}
          volTiers={volTiers}
          margin={margin}
          poliRate={poliRate}
          energyCost={energyCost}
          agruparPorColor={agruparPorColor}
          prensaWatts={prensaWatts}
          tarifaKwh={tarifaKwh}
          businessName={businessName}
          logoB64={logoB64}
          validezDias={validezDias}
          docShowPrices={docShowPrices}
          unitSystem={unitSystem}
        />
      )}

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

function DocumentEditorModal({
  pedido,
  onClose,
  onSave,
  prendas,
  placements,
  sheets,
  tallasCfg,
  coloresCfg,
  designTypes,
  fixTypes,
  volTiers,
  margin,
  poliRate,
  energyCost,
  agruparPorColor,
  prensaWatts,
  tarifaKwh,
  businessName,
  logoB64,
  validezDias,
  docShowPrices,
  unitSystem,
}) {
  const [cliente, setCliente] = useState(pedido.cliente || "");
  const [email, setEmail] = useState(pedido.email || "");
  const [telefono, setTelefono] = useState(pedido.telefono || "");
  const [num, setNum] = useState(pedido.num || "");
  const [status, setStatus] = useState(normalizeDocumentStatus(pedido.estado));
  const [docType, setDocType] = useState(inferDocumentType(pedido.docType, pedido.estado));
  const [notas, setNotas] = useState(pedido.notas || "");
  const [internalNotes, setInternalNotes] = useState(pedido.meta?.internalNotes || "");
  const [designWho, setDesignWho] = useState(pedido.meta?.designWho || "Cliente trae arte");
  const [designId, setDesignId] = useState(pedido.meta?.designId || "d0");
  const [fixId, setFixId] = useState(pedido.meta?.fixId || "f0");
  const [adjustments, setAdjustments] = useState(() => normalizeDocumentAdjustments(pedido.meta?.adjustments));
  const [editorLines, setEditorLines] = useState(() => pedido.editorLines.map(line => ({ ...line, customs: [...line.customs], tallas: [...line.tallas] })));
  const [saving, setSaving] = useState(false);
  const editorPackingCacheRef = useRef(new Map());
  const [editorPackingState, setEditorPackingState] = useState({
    requestKey: null,
    solution: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    setCliente(pedido.cliente || "");
    setEmail(pedido.email || "");
    setTelefono(pedido.telefono || "");
    setNum(pedido.num || "");
    setStatus(normalizeDocumentStatus(pedido.estado));
    setDocType(inferDocumentType(pedido.docType, pedido.estado));
    setNotas(pedido.notas || "");
    setInternalNotes(pedido.meta?.internalNotes || "");
    setDesignWho(pedido.meta?.designWho || "Cliente trae arte");
    setDesignId(pedido.meta?.designId || "d0");
    setFixId(pedido.meta?.fixId || "f0");
    setAdjustments(normalizeDocumentAdjustments(pedido.meta?.adjustments));
    setEditorLines(pedido.editorLines.map(line => ({
      ...line,
      customs: (line.customs || []).map(custom => ({ ...custom })),
      tallas: (line.tallas || []).map(size => ({ ...size })),
    })));
  }, [pedido]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const updateLine = useCallback((lineId, updater) => {
    setEditorLines(prev => prev.map(line => {
      if (line.id !== lineId) return line;
      const nextLine = typeof updater === "function" ? updater(line) : { ...line, ...updater };
      return syncLineQty(nextLine);
    }));
  }, []);

  const togglePlacement = useCallback((lineId, placementId) => {
    updateLine(lineId, line => ({
      ...line,
      placementIds: line.placementIds.includes(placementId)
        ? line.placementIds.filter(id => id !== placementId)
        : [...line.placementIds, placementId],
    }));
  }, [updateLine]);

  const addCustomToLine = useCallback((lineId) => {
    updateLine(lineId, line => ({
      ...line,
      customs: [...line.customs, { label: "Custom", color: "#9B6B8B", w: "", h: "" }],
    }));
  }, [updateLine]);

  const updateCustomInLine = useCallback((lineId, customIndex, field, value) => {
    updateLine(lineId, line => ({
      ...line,
      customs: line.customs.map((custom, index) => index === customIndex ? { ...custom, [field]: value } : custom),
    }));
  }, [updateLine]);

  const removeCustomFromLine = useCallback((lineId, customIndex) => {
    updateLine(lineId, line => ({
      ...line,
      customs: line.customs.filter((_, index) => index !== customIndex),
    }));
  }, [updateLine]);

  const availableLineSizes = useCallback((line) => {
    const prenda = prendas.find(item => item.id === line.prendaId);
    const baseSizes = prenda?.tallas?.length ? prenda.tallas : tallasCfg;
    const extras = (line.tallas || []).map(item => item.talla).filter(talla => !baseSizes.includes(talla));
    return [...baseSizes, ...extras];
  }, [prendas, tallasCfg]);

  const editorPackingContext = useMemo(() => buildPackingContext({
    lines: editorLines,
    placements,
    prendas,
    poliRate,
    sheets,
    agruparPorColor,
    unitSystem,
  }), [agruparPorColor, editorLines, placements, poliRate, prendas, sheets, unitSystem]);

  const editorPreviewSolution = useMemo(() => {
    if (!editorPackingContext?.packingRequest) return null;
    return solvePackingPreview(editorPackingContext.packingRequest);
  }, [editorPackingContext?.requestKey]);

  useEffect(() => {
    if (!editorPackingContext?.packingRequest) {
      setEditorPackingState({ requestKey: null, solution: null, loading: false, error: null });
      return;
    }

    const cached = editorPackingCacheRef.current.get(editorPackingContext.requestKey);
    if (cached) {
      setEditorPackingState({
        requestKey: editorPackingContext.requestKey,
        solution: cached,
        loading: false,
        error: cached.error || null,
      });
      return;
    }

    const controller = new AbortController();
    setEditorPackingState(prev => ({
      requestKey: editorPackingContext.requestKey,
      solution: prev.requestKey === editorPackingContext.requestKey ? prev.solution : null,
      loading: true,
      error: null,
    }));

    solvePackingRequest(editorPackingContext.packingRequest, { signal: controller.signal })
      .then(solution => {
        editorPackingCacheRef.current.set(editorPackingContext.requestKey, solution);
        setEditorPackingState({
          requestKey: editorPackingContext.requestKey,
          solution,
          loading: false,
          error: solution.error || null,
        });
      })
      .catch(error => {
        if (error?.name === "AbortError") return;
        setEditorPackingState({
          requestKey: editorPackingContext.requestKey,
          solution: null,
          loading: false,
          error: error?.message || "No se pudo recalcular el packing exacto.",
        });
      });

    return () => controller.abort();
  }, [editorPackingContext?.requestKey]);

  const editorActiveSolution = useMemo(() => {
    if (!editorPackingContext?.packingRequest) return null;
    if (editorPackingState.requestKey === editorPackingContext.requestKey && editorPackingState.solution) {
      return editorPackingState.solution;
    }
    return editorPreviewSolution;
  }, [editorPackingContext?.requestKey, editorPackingState.requestKey, editorPackingState.solution, editorPreviewSolution]);

  const editorActiveNesting = useMemo(() => (
    editorActiveSolution ? legacyNestingFromSolution(editorActiveSolution) : null
  ), [editorActiveSolution]);

  const calc = useMemo(() => {
    if (!editorPackingContext || !editorActiveNesting) return null;
    return buildCalcResult({
      lineDetails: editorPackingContext.lineDetails,
      totalQty: editorPackingContext.totalQty,
      nesting: editorActiveNesting,
      designWho,
      designId,
      fixId,
      designTypes,
      fixTypes,
      volTiers,
      margin,
      energyCost,
      prensaWatts,
      tarifaKwh,
      adjustments,
    });
  }, [
    adjustments,
    designId,
    designTypes,
    designWho,
    editorActiveNesting,
    editorPackingContext,
    energyCost,
    fixId,
    fixTypes,
    margin,
    prensaWatts,
    tarifaKwh,
    volTiers,
  ]);

  const packingModeLabel = useMemo(
    () => formatPackingMode(editorActiveSolution, editorPackingState.loading),
    [editorActiveSolution, editorPackingState.loading]
  );
  const nextStatuses = getDocumentNextStatuses(status);
  const canConvert = docType === "cotizacion" && status === "Aprobada";

  const persist = useCallback(async (nextValues = {}) => {
    if (!calc) return;
    setSaving(true);
    const finalDocType = nextValues.docType || docType;
    const finalStatus = normalizeDocumentStatus(nextValues.status || status);
    await onSave(pedido, calc, {
      num,
      cliente,
      email,
      telefono,
      notas,
      internalNotes,
      status: finalStatus,
      docType: finalDocType,
      designWho,
      designId,
      fixId,
      adjustments,
      sourceQuoteId: nextValues.sourceQuoteId || pedido.meta?.sourceQuoteId || null,
      convertedAt: nextValues.convertedAt || pedido.meta?.convertedAt || null,
    });
    setStatus(finalStatus);
    setDocType(finalDocType);
    setSaving(false);
  }, [adjustments, calc, cliente, designId, designTypes, designWho, docType, email, fixId, internalNotes, notas, num, onSave, pedido, status, telefono]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 240, background: "rgba(8,10,16,.82)", backdropFilter: "blur(14px)", overflowY: "auto", padding: "20px 14px 40px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,.45)", overflow: "hidden" }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", background: "linear-gradient(135deg, rgba(34,211,238,.12), rgba(34,211,238,0) 60%)", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text3)", fontWeight: 700 }}>Panel documental</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>#{num || pedido.num}</div>
              <span className="pill" style={{ background: "rgba(34,211,238,.1)", border: "1px solid rgba(34,211,238,.2)", color: "var(--accent)" }}>
                {DOCUMENT_TYPE_LABEL[docType]}
              </span>
              <span className="pill" style={{ background: ESTADO_COLOR[status]?.bg, border: `1px solid ${ESTADO_COLOR[status]?.border}`, color: ESTADO_COLOR[status]?.text }}>
                {status}
              </span>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 14px", color: "var(--text2)", cursor: "pointer", fontWeight: 700 }}>
              Cerrar
            </button>
            {canConvert && (
              <button
                disabled={!calc || saving}
                onClick={() => persist({
                  docType: "factura",
                  status: "Facturada",
                  sourceQuoteId: pedido.meta?.sourceQuoteId || pedido.id,
                  convertedAt: new Date().toISOString(),
                })}
                style={{ background: "rgba(96,165,250,.14)", border: "1px solid rgba(96,165,250,.32)", borderRadius: 10, padding: "10px 14px", color: "#60A5FA", cursor: "pointer", fontWeight: 800 }}
              >
                Convertir a factura
              </button>
            )}
            <button
              disabled={!calc || saving}
              onClick={() => persist()}
              style={{ background: "var(--accent)", border: "none", borderRadius: 10, padding: "10px 16px", color: "var(--bg)", cursor: "pointer", fontWeight: 800 }}
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 18 }}>
          <div className="grid2">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Datos del documento</span></div>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div className="grid2">
                  <div>
                    <div className="lbl">Número</div>
                    <input className="inp inp-sm" value={num} onChange={e => setNum(e.target.value)} />
                  </div>
                  <div>
                    <div className="lbl">Tipo</div>
                    <select className="sel sel-sm" value={docType} onChange={e => setDocType(e.target.value)}>
                      <option value="cotizacion">Cotización</option>
                      <option value="factura">Factura</option>
                    </select>
                  </div>
                </div>
                <div className="grid2">
                  <div>
                    <div className="lbl">Estado</div>
                    <select className="sel sel-sm" value={status} onChange={e => setStatus(e.target.value)}>
                      {ESTADOS.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="lbl">Siguiente acción</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 38, alignItems: "center" }}>
                      {nextStatuses.length === 0 && <span style={{ color: "var(--text3)", fontSize: 12 }}>Sin transición sugerida</span>}
                      {nextStatuses.map(nextStatus => (
                        <button
                          key={nextStatus}
                          onClick={() => setStatus(nextStatus)}
                          style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 999, padding: "7px 12px", color: "var(--text2)", cursor: "pointer", fontSize: 11, fontWeight: 800 }}
                        >
                          {nextStatus}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ background: "var(--bg)", borderRadius: 12, padding: "12px 14px", border: "1px solid var(--border)" }}>
                  <div className="lbl">Lógica comercial</div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                    El recalculo es automático. Cada cambio de prenda, cantidad o diseño vuelve a correr el packing DTF y actualiza costos, subtotales y margen.
                  </div>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Cliente y notas</span></div>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div>
                  <div className="lbl">Cliente</div>
                  <input className="inp" value={cliente} onChange={e => setCliente(e.target.value)} />
                </div>
                <div className="grid2">
                  <div>
                    <div className="lbl">Correo</div>
                    <input className="inp inp-sm" value={email} onChange={e => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <div className="lbl">Teléfono</div>
                    <input className="inp inp-sm" value={telefono} onChange={e => setTelefono(e.target.value)} />
                  </div>
                </div>
                <div>
                  <div className="lbl">Nota visible para cliente</div>
                  <textarea className="inp inp-sm" rows={3} value={notas} onChange={e => setNotas(e.target.value)} style={{ resize: "vertical", minHeight: 72 }} />
                </div>
                <div>
                  <div className="lbl">Nota interna</div>
                  <textarea className="inp inp-sm" rows={2} value={internalNotes} onChange={e => setInternalNotes(e.target.value)} style={{ resize: "vertical", minHeight: 60 }} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid2">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Diseño y corrección</span></div>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div className="grid2">
                  <div>
                    <div className="lbl">¿Quién diseña?</div>
                    <select className="sel sel-sm" value={designWho} onChange={e => setDesignWho(e.target.value)}>
                      <option>Cliente trae arte</option>
                      <option>Nosotros diseñamos</option>
                    </select>
                  </div>
                  <div>
                    <div className="lbl">Tipo de diseño</div>
                    <select className="sel sel-sm" value={designId} onChange={e => setDesignId(e.target.value)} disabled={designWho === "Cliente trae arte"} style={{ opacity: designWho === "Cliente trae arte" ? .45 : 1 }}>
                      {designTypes.map(item => <option key={item.id} value={item.id}>{item.label}{item.price ? ` (L${item.price})` : ""}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="lbl">Corrección</div>
                  <select className="sel sel-sm" value={fixId} onChange={e => setFixId(e.target.value)} disabled={designWho === "Nosotros diseñamos"} style={{ opacity: designWho === "Nosotros diseñamos" ? .45 : 1 }}>
                    {fixTypes.map(item => <option key={item.id} value={item.id}>{item.label}{item.price ? ` (L${item.price})` : ""}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Overrides</span></div>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                <div className="grid2">
                  <div>
                    <div className="lbl">Descuento manual</div>
                    <select className="sel sel-sm" value={adjustments.discountMode} onChange={e => setAdjustments(prev => ({ ...prev, discountMode: e.target.value }))}>
                      <option value="percent">Porcentaje</option>
                      <option value="fixed">Monto fijo</option>
                    </select>
                  </div>
                  <div>
                    <div className="lbl">Valor</div>
                    <input className="inp inp-sm" type="number" step="0.01" value={adjustments.discountValue} onChange={e => setAdjustments(prev => ({ ...prev, discountValue: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <div className="lbl">Cargos adicionales</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {adjustments.extraCharges.map(charge => (
                      <div key={charge.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 40px", gap: 8 }}>
                        <input className="inp inp-sm" value={charge.label} onChange={e => setAdjustments(prev => ({ ...prev, extraCharges: prev.extraCharges.map(item => item.id === charge.id ? { ...item, label: e.target.value } : item) }))} />
                        <input className="inp inp-sm" type="number" step="0.01" value={charge.amount} onChange={e => setAdjustments(prev => ({ ...prev, extraCharges: prev.extraCharges.map(item => item.id === charge.id ? { ...item, amount: e.target.value } : item) }))} />
                        <button className="btn-del" onClick={() => setAdjustments(prev => ({ ...prev, extraCharges: prev.extraCharges.filter(item => item.id !== charge.id) }))}>×</button>
                      </div>
                    ))}
                    <button className="btn-add" onClick={() => setAdjustments(prev => ({ ...prev, extraCharges: [...prev.extraCharges, createEmptyCharge()] }))}>
                      + Agregar cargo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-head" style={{ justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Líneas editables</span>
              <button className="btn-save" onClick={() => setEditorLines(prev => [...prev, { ...emptyLine(), qty: 1 }])} style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--text2)" }}>
                + Agregar producto
              </button>
            </div>
            <div className="card-body">
              {editorLines.map((line, index) => {
                const prenda = prendas.find(item => item.id === line.prendaId);
                const colorOptions = prenda?.colores?.length ? prenda.colores : coloresCfg;
                const totalSizes = sumTallas(line);
                const sizes = availableLineSizes(line);
                return (
                  <div key={line.id} className="line-card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>Producto {index + 1}</div>
                      <button className="btn-del" onClick={() => setEditorLines(prev => prev.length === 1 ? prev : prev.filter(item => item.id !== line.id))}>×</button>
                    </div>
                    <div className="grid3" style={{ marginBottom: 12 }}>
                      <div>
                        <div className="lbl">Prenda</div>
                        <select className="sel sel-sm" value={line.prendaId} onChange={e => updateLine(line.id, current => ({ ...current, prendaId: e.target.value, otroName: e.target.value === "__otro" ? current.otroName : "", tallas: buildEditableTallas({ ...current, prendaId: e.target.value }, prendas.find(item => item.id === e.target.value), tallasCfg) }))}>
                          <option value="">Selecciona</option>
                          {prendas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                          <option value="__otro">Otra prenda</option>
                        </select>
                      </div>
                      <div>
                        <div className="lbl">Color</div>
                        <input className="inp inp-sm" list={`colors-${line.id}`} value={line.color} onChange={e => updateLine(line.id, { color: e.target.value })} />
                        <datalist id={`colors-${line.id}`}>
                          {colorOptions.map(color => <option key={color} value={color} />)}
                        </datalist>
                      </div>
                      <div>
                        <div className="lbl">Proveedor de prenda</div>
                        <select className="sel sel-sm" value={line.quien} onChange={e => updateLine(line.id, { quien: e.target.value })}>
                          <option>Yo</option>
                          <option>Cliente</option>
                        </select>
                      </div>
                    </div>

                    {(line.prendaId === "__otro" || !line.prendaId) && (
                      <div className="grid2" style={{ marginBottom: 12 }}>
                        <div>
                          <div className="lbl">Nombre visible</div>
                          <input className="inp inp-sm" value={line.otroName} onChange={e => updateLine(line.id, { otroName: e.target.value })} />
                        </div>
                        {line.quien !== "Cliente" && (
                          <div>
                            <div className="lbl">Costo prenda</div>
                            <input className="inp inp-sm" type="number" step="0.01" value={line.otroCost} onChange={e => updateLine(line.id, { otroCost: e.target.value })} />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid2" style={{ marginBottom: 12 }}>
                      <div>
                        <div className="lbl">Cantidad total</div>
                        <input className="inp inp-sm" type="number" min="0" value={line.showTallas ? totalSizes : line.qty} disabled={line.showTallas} onChange={e => updateLine(line.id, { qty: e.target.value })} />
                      </div>
                      <div>
                        <div className="lbl">Precio unitario final</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)", minWidth: 118 }}>
                            <input type="checkbox" checked={line.useManualUnitPrice} onChange={e => updateLine(line.id, { useManualUnitPrice: e.target.checked })} />
                            Override manual
                          </label>
                          <input className="inp inp-sm" type="number" step="0.01" value={line.manualUnitPrice} disabled={!line.useManualUnitPrice} onChange={e => updateLine(line.id, { manualUnitPrice: e.target.value })} />
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div className="lbl">Tallas</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                        <button className="cfg-pill active" onClick={() => updateLine(line.id, { showTallas: !line.showTallas })}>
                          {line.showTallas ? "Ocultar desglose" : "Usar tallas"}
                        </button>
                      </div>
                      {line.showTallas && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(82px,1fr))", gap: 8 }}>
                          {sizes.map(size => {
                            const qty = line.tallas.find(item => item.talla === size)?.qty || 0;
                            return (
                              <div key={`${line.id}-${size}`} style={{ background: "var(--bg)", border: `1px solid ${qty > 0 ? "rgba(34,211,238,.3)" : "var(--border)"}`, borderRadius: 10, padding: 10 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: qty > 0 ? "var(--accent)" : "var(--text3)", marginBottom: 6 }}>{size}</div>
                                <input
                                  className="inp inp-sm"
                                  type="number"
                                  min="0"
                                  value={qty || ""}
                                  onChange={e => updateLine(line.id, current => ({
                                    ...current,
                                    tallas: sizes.map(talla => ({
                                      talla,
                                      qty: talla === size ? (Number(e.target.value) || 0) : (current.tallas.find(item => item.talla === talla)?.qty || 0),
                                    })),
                                    showTallas: true,
                                  }))}
                                  style={{ textAlign: "center", fontFamily: "'JetBrains Mono'" }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <div className="lbl">Posiciones / diseños</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {placements.map(placement => {
                          const active = line.placementIds.includes(placement.id);
                          return (
                            <button
                              key={placement.id}
                              className={`pl-chip ${active ? "on" : ""}`}
                              style={active ? { background: placement.color, borderColor: placement.color } : {}}
                              onClick={() => togglePlacement(line.id, placement.id)}
                            >
                              <span style={{ fontSize: 9, opacity: .7, fontFamily: "'JetBrains Mono'" }}>{placement.w}×{placement.h}</span> {placement.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="lbl">Customs</div>
                      {line.customs.map((custom, customIndex) => (
                        <div key={`${line.id}-custom-${customIndex}`} className="row" style={{ marginBottom: 8, gap: 6, flexWrap: "wrap" }}>
                          <input className="inp inp-sm" placeholder="Nombre" style={{ width: 110 }} value={custom.label} onChange={e => updateCustomInLine(line.id, customIndex, "label", e.target.value)} />
                          <input className="inp inp-sm" placeholder={unitSystem==="cm" ? 'W cm' : 'W"'} type="number" step="0.5" style={{ width: 70, textAlign: "center" }} value={custom.w} onChange={e => updateCustomInLine(line.id, customIndex, "w", e.target.value)} />
                          <input className="inp inp-sm" placeholder={unitSystem==="cm" ? 'H cm' : 'H"'} type="number" step="0.5" style={{ width: 70, textAlign: "center" }} value={custom.h} onChange={e => updateCustomInLine(line.id, customIndex, "h", e.target.value)} />
                          <button className="btn-del" onClick={() => removeCustomFromLine(line.id, customIndex)}>×</button>
                        </div>
                      ))}
                      <button className="btn-add" onClick={() => addCustomToLine(line.id)}>+ Agregar diseño custom</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid2">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head">
                <span style={{ fontWeight: 700, fontSize: 14 }}>Recálculo y costos</span>
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: editorActiveSolution?.source === "cp_sat" ? "var(--green)" : "var(--text3)" }}>
                  {packingModeLabel}
                </span>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 10 }}>
                {!calc && (
                  <div style={{ background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.2)", borderRadius: 12, padding: "12px 14px", color: "#FCA5A5", fontSize: 13 }}>
                    Agrega al menos una línea con cantidad y una posición o diseño custom para recalcular el costo.
                  </div>
                )}
                {calc && (
                  <>
                    {(editorPackingState.error || calc.nesting?.unplaced?.length > 0) && (
                      <div style={{ background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.18)", borderRadius: 12, padding: "12px 14px", color: "var(--warn)", fontSize: 13 }}>
                        {editorPackingState.error || "Hay diseños sin ubicar. Se muestra preview local mientras se estabiliza el cálculo."}
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
                      <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                        <div className="lbl">Hojas DTF</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 22 }}>L{formatMoney(calc.dtfCost)}</div>
                      </div>
                      <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                        <div className="lbl">Subtotal</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 22 }}>L{formatMoney(calc.sub)}</div>
                      </div>
                      <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                        <div className="lbl">Margen real</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 22, color: calc.rm < 25 ? "#F87171" : "var(--accent)" }}>{calc.rm.toFixed(1)}%</div>
                      </div>
                      <div style={{ background: "rgba(34,211,238,.08)", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(34,211,238,.2)" }}>
                        <div className="lbl">Total final</div>
                        <div style={{ fontFamily: "'JetBrains Mono'", fontWeight: 800, fontSize: 22, color: "var(--accent)" }}>L{formatMoney(calc.total)}</div>
                      </div>
                    </div>
                    <div style={{ background: "var(--bg)", borderRadius: 12, padding: "12px 14px", border: "1px solid var(--border)" }}>
                      {[
                        ["Descuento volumen", calc.disc > 0 ? `-L${formatMoney(calc.disc)}` : "No aplica"],
                        ["Diseño", calc.designCharged > 0 ? `L${formatMoney(calc.designCharged)}` : "Incluido / no aplica"],
                        ["Corrección", calc.fixCharged > 0 ? `L${formatMoney(calc.fixCharged)}` : "Incluida / no aplica"],
                        ["Descuento manual", calc.manualDiscount > 0 ? `-L${formatMoney(calc.manualDiscount)}` : "No aplica"],
                        ["Cargos adicionales", calc.extraChargesTotal > 0 ? `L${formatMoney(calc.extraChargesTotal)}` : "No aplica"],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 13, color: "var(--text2)", borderBottom: "1px solid var(--border)" }}>
                          <span>{label}</span>
                          <span style={{ fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span style={{ fontWeight: 700, fontSize: 14 }}>Vista documental</span></div>
              <div className="card-body">
                <div style={{ background: "white", borderRadius: 16, padding: 18, border: "1px solid var(--border)", color: "#111" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "2px solid #111", paddingBottom: 14, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {logoB64 && <img src={logoB64} alt="Logo" style={{ height: 44, maxWidth: 96, objectFit: "contain" }} />}
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 22 }}>{businessName}</div>
                        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: ".1em" }}>{DOCUMENT_TYPE_LABEL[docType]}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#666" }}>#{num || pedido.num}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>Válida {validezDias} días</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{cliente || "Cliente sin nombre"}</div>
                    {email && <div style={{ fontSize: 12, color: "#666" }}>{email}</div>}
                    {telefono && <div style={{ fontSize: 12, color: "#666" }}>{telefono}</div>}
                  </div>
                  {calc ? (
                    <>
                      <div style={{ display: "grid", gap: 10 }}>
                        {calc.groups.map(group => (
                          <div key={group.id} style={{ borderBottom: "1px solid #eee", paddingBottom: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 700 }}>{group.label}</div>
                                <div style={{ fontSize: 11, color: "#666" }}>{group.cfgLabel || "Sin posiciones"}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 11, color: "#666" }}>{group.totalQty} u</div>
                                {docShowPrices && <div style={{ fontWeight: 800 }}>L{formatMoney(group.totalLine)}</div>}
                              </div>
                            </div>
                            <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                              {group.variants.map(variant => (
                                <div key={`${group.id}-${variant.sku}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#666", gap: 8 }}>
                                  <span>{variant.color || "Sin color"}{variant.talla ? ` / ${variant.talla}` : ""}</span>
                                  <span>{variant.qty} u</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "2px solid #111", display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>Subtotal</span><span>L{formatMoney(calc.sub)}</span></div>
                        {calc.disc > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#16a34a" }}><span>Descuento volumen</span><span>-L{formatMoney(calc.disc)}</span></div>}
                        {calc.manualDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#16a34a" }}><span>Descuento manual</span><span>-L{formatMoney(calc.manualDiscount)}</span></div>}
                        {calc.extraChargesTotal > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>Cargos extra</span><span>L{formatMoney(calc.extraChargesTotal)}</span></div>}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 800 }}><span>Total</span><span>L{formatMoney(calc.total)}</span></div>
                      </div>
                      {notas && <div style={{ marginTop: 14, fontSize: 11, color: "#666", lineHeight: 1.6 }}>{notas}</div>}
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: "#666" }}>El preview aparecerá cuando el documento tenga líneas calculables.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Factura({ calc, businessName, logoB64, validezDias = 15, onSavePedido, whatsappBiz, docTerms = "", docShowPrices = true,
  prefillCliente = "", prefillPhone = "", prefillEmail = "", prefillNum = null, prefillDocType = "cotizacion", prefillNotes = "" }) {
  const today = new Date();
  const [clientName, setClientName] = useState(prefillCliente);
  const [clientEmail, setClientEmail] = useState(prefillEmail);
  const [clientPhone, setClientPhone] = useState(prefillPhone);
  const [docType, setDocType] = useState(prefillDocType);
  const docLabel = docType === "factura" ? "Factura" : "Cotización";
  // FIX 7: generate invoice number ONCE per mount from Supabase (real auto-increment)
  const invoiceNumRef = useRef(null);
  // If we have a pre-existing number (from solicitud), use it; otherwise generate new
  const [invoiceNum, setInvoiceNum] = useState(prefillNum || "....");
  useEffect(() => {
    // use existing number from solicitud
    if (prefillNum) return;
    if (invoiceNumRef.current) return;
    invoiceNumRef.current = true;
    getNextNumero().then(n => setInvoiceNum(n));
  }, [prefillNum]);
  const [notes, setNotes] = useState(prefillNotes || docTerms || "");
  const [pdfLoading, setPdfLoading] = useState(false);
  const dateStr = today.toLocaleDateString("es-HN", { year: "numeric", month: "long", day: "numeric" });
  const groupedLines = useMemo(() => buildQuoteGroups(calc.lp), [calc.lp]);

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
      pdf.save(`${docLabel}-${invoiceNum}-${businessName.replace(/\s+/g,"-")}.pdf`);
    } catch (err) {
      console.error("PDF error:", err);
      alert("Error generando PDF. Intenta de nuevo.");
    }
    setPdfLoading(false);
  };

  const handleEmail = () => {
    const lines = groupedLines.map(group => (
      `${group.totalQty}× ${group.label}${docShowPrices ? ` — L${group.avgUnitPrice.toFixed(2)}/u = L${group.totalLine}` : ""}\n` +
      `${group.variants.map(variant => `  - ${variant.sku}: ${variant.color || "Sin color"}${variant.talla ? ` / ${variant.talla}` : ""} · ${variant.qty}u`).join("\n")}`
    )).join("\n");
    const body = encodeURIComponent(
`Estimado/a ${clientName || "cliente"},

Adjunto ${docLabel.toLowerCase() === "factura" ? "la factura" : "la cotización"} #${invoiceNum} de ${businessName} DTF:

${lines}
${calc.disc > 0 ? `\nDescuento ${calc.volPct}%: -L${calc.disc}` : ""}${calc.designFee > 0 ? `\nDiseño: ${calc.designCharged === 0 ? "Incluido" : `L${calc.designCharged}`}` : ""}${calc.fixFee > 0 ? `\nCorrección: ${calc.fixCharged === 0 ? "Incluida" : `L${calc.fixCharged}`}` : ""}

TOTAL: L${calc.total.toLocaleString()}

Fecha: ${dateStr}
${docLabel} válida por ${validezDias} días.

${notes ? `Notas: ${notes}\n` : ""}Gracias por preferirnos.
${businessName}`
    );
    window.location.href = `mailto:${clientEmail}?subject=${encodeURIComponent(docLabel)}%20%23${invoiceNum}%20-%20${encodeURIComponent(businessName)}%20DTF&body=${body}`;
  };

  return (
    <div className="card fade-up">
      <style>{`
        @media print { .no-print { display: none !important; } }
      `}</style>
      <div className="card-head">
        <StepBadge n={5} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{docLabel}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={async () => {
              const result = await onSavePedido(calc, clientName, invoiceNum, clientEmail, clientPhone, notes, docType);
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
          {whatsappBiz && (
            <button onClick={() => {
              const msg = encodeURIComponent(`${docLabel} #${invoiceNum} — ${clientName || "Cliente"}\nTotal: L${calc.total.toLocaleString()}\nFecha: ${dateStr}`);
              window.open(`https://wa.me/${whatsappBiz}?text=${msg}`, "_blank");
            }} style={{ background: "rgba(37,211,102,.1)", border: "1px solid rgba(37,211,102,.3)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#25D366", cursor: "pointer", minHeight: 36, display: "flex", alignItems: "center", gap: 6 }}>
              WhatsApp
            </button>
          )}
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
        {/* Document type toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div className="lbl" style={{ margin: 0 }}>Tipo de documento</div>
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {[["cotizacion", "Cotización"], ["factura", "Factura"]].map(([val, label]) => (
              <button key={val} onClick={() => setDocType(val)}
                style={{ padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", transition: "all .25s", border: "1.5px solid",
                  background: docType === val ? "var(--accent)" : "transparent",
                  borderColor: docType === val ? "transparent" : "var(--border2)",
                  color: docType === val ? "#fff" : "var(--text3)" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
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
            <div className="lbl">Nº de {docLabel.toLowerCase()}</div>
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
        <div id="factura-print" style={{ background: "white", padding: "40px", color: "#000", fontFamily: "Helvetica, Arial, sans-serif" }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 30, paddingBottom: 20, borderBottom: "1px solid #000" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {logoB64 && <img src={logoB64} alt="Logo" style={{ height: 60, maxWidth: 140, objectFit: "contain" }} />}
              <div>
                <div style={{ fontSize: 24, fontWeight: "bold", color: "#000", margin: 0, padding: 0 }}>{businessName}</div>
                <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "1px", marginTop: 4 }}>Impresión DTF y Personalización</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: "bold", color: "#000", textTransform: "uppercase", marginBottom: 4 }}>{docLabel}</div>
              <div style={{ fontSize: 14, color: "#333", fontWeight: "bold" }}>No. {invoiceNum}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Fecha: {dateStr}</div>
              {docType === "cotizacion" && <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>Válida por {validezDias} días</div>}
            </div>
          </div>

          {/* Cliente */}
          {clientName && (
            <div style={{ marginBottom: 30 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1px", color: "#777", fontWeight: "bold", marginBottom: 8, borderBottom: "1px solid #ddd", paddingBottom: 4, display: "inline-block" }}>Facturar a</div>
              <div style={{ fontSize: 16, fontWeight: "bold", color: "#000" }}>{clientName}</div>
              {clientEmail && <div style={{ fontSize: 12, color: "#333", marginTop: 4 }}>Email: {clientEmail}</div>}
              {clientPhone && <div style={{ fontSize: 12, color: "#333", marginTop: 2 }}>Tel: {clientPhone}</div>}
            </div>
          )}

          {/* Tabla de líneas */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 30 }}>
            <thead>
              <tr>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#000", fontWeight: "bold", padding: "10px 0", textAlign: "left", borderBottom: "1px solid #000" }}>Descripción</th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#000", fontWeight: "bold", padding: "10px 0", textAlign: "center", borderBottom: "1px solid #000", width: 80 }}>Cantidad</th>
                {docShowPrices && <th style={{ fontSize: 11, textTransform: "uppercase", color: "#000", fontWeight: "bold", padding: "10px 0", textAlign: "right", borderBottom: "1px solid #000", width: 100 }}>Precio Unit.</th>}
                {docShowPrices && <th style={{ fontSize: 11, textTransform: "uppercase", color: "#000", fontWeight: "bold", padding: "10px 0", textAlign: "right", borderBottom: "1px solid #000", width: 100 }}>Subtotal</th>}
              </tr>
            </thead>
            <tbody>
              {groupedLines.map((group) => (
                <tr key={group.id}>
                  <td style={{ padding: "12px 0", fontSize: 13, borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                    <div style={{ fontWeight: "bold", color: "#000" }}>{group.label}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Posiciones: {group.cfgLabel || "Sin especificar"}</div>
                    <div style={{ marginTop: 8 }}>
                      {group.variants.map(variant => (
                        <div key={`${group.id}-${variant.sku}`} style={{ fontSize: 11, color: "#333", marginBottom: 2 }}>
                          • {variant.color || "Sin color"}{variant.talla ? ` (Talla ${variant.talla})` : ""} - {variant.qty} u.
                        </div>
                      ))}
                    </div>
                    {group.items.some(item => item.quien === "Cliente") && <div style={{ fontSize: 10, color: "#666", fontStyle: "italic", marginTop: 6 }}>* Prendas provistas por el cliente</div>}
                  </td>
                  <td style={{ padding: "12px 0", textAlign: "center", fontWeight: "bold", fontSize: 13, color: "#000", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>{group.totalQty}</td>
                  {docShowPrices && <td style={{ padding: "12px 0", textAlign: "right", fontSize: 13, color: "#333", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>L {group.avgUnitPrice.toFixed(2)}</td>}
                  {docShowPrices && <td style={{ padding: "12px 0", textAlign: "right", fontWeight: "bold", fontSize: 13, color: "#000", borderBottom: "1px solid #ddd", verticalAlign: "top" }}>L {group.totalLine.toFixed(2)}</td>}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totales */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: 320 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#333" }}>
                <span>Subtotal</span><span>L {calc.sub.toFixed(2)}</span>
              </div>
              {calc.disc > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#000" }}>
                  <span>Descuento ({calc.volPct}%)</span><span>-L {calc.disc.toFixed(2)}</span>
                </div>
              )}
              {calc.designFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#333" }}>
                  <span>Diseño gráfico</span>
                  <span>{calc.designCharged === 0 ? "Incluido" : `L ${calc.designCharged.toFixed(2)}`}</span>
                </div>
              )}
              {calc.fixFee > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#333" }}>
                  <span>Corrección de arte</span>
                  <span>{calc.fixCharged === 0 ? "Incluida" : `L ${calc.fixCharged.toFixed(2)}`}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 18, fontWeight: "bold", borderTop: "2px solid #000", marginTop: 8, color: "#000" }}>
                <span>TOTAL A PAGAR</span><span>L {calc.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Notas */}
          {notes && (
            <div style={{ marginTop: 40, borderTop: "1px solid #ddd", paddingTop: 16 }}>
              <div style={{ fontWeight: "bold", fontSize: 11, textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Observaciones Adicionales</div>
              <div style={{ fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{notes}</div>
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: 60, borderTop: "1px solid #000", paddingTop: 16, fontSize: 10, color: "#777", textAlign: "center", textTransform: "uppercase", letterSpacing: "1px" }}>
            Documento generado por el sistema de gestión de {businessName}
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
      fontSize: 12, fontWeight: 800, flexShrink: 0, fontFamily: "'Inter'"
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
