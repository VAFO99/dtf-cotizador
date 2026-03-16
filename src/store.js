// ── Persistent stores ──────────────────────────────────────────────────────
// Separate from config so pedidos survive config resets.

const PEDIDOS_KEY = "dtf_pedidos_v1";
const QUOTE_NUM_KEY = "dtf_quote_num_v1";

export function loadPedidos() {
  try { return JSON.parse(localStorage.getItem(PEDIDOS_KEY) || "[]"); }
  catch { return []; }
}

export function savePedidos(list) {
  try { localStorage.setItem(PEDIDOS_KEY, JSON.stringify(list)); } catch {}
}

export function nextQuoteNum() {
  const n = parseInt(localStorage.getItem(QUOTE_NUM_KEY) || "0") + 1;
  localStorage.setItem(QUOTE_NUM_KEY, String(n));
  return String(n).padStart(4, "0");
}

// Pendiente = solicitud de cliente web aún sin cotizar
// Cotizado → Aceptado → En proceso → Listo → Entregado
export const ESTADOS = [
  "Pendiente",
  "Cotizado",
  "Aceptado",
  "En proceso",
  "Listo",
  "Entregado",
];

export const ESTADO_COLOR = {
  Pendiente:    { bg: "rgba(251,191,36,.12)",  border: "rgba(251,191,36,.4)",  text: "#FBBF24" },
  Cotizado:     { bg: "rgba(148,163,184,.12)", border: "rgba(148,163,184,.3)", text: "#94A3B8" },
  Aceptado:     { bg: "rgba(34,211,238,.1)",   border: "rgba(34,211,238,.3)",  text: "#22D3EE" },
  "En proceso": { bg: "rgba(251,191,36,.1)",   border: "rgba(251,191,36,.3)",  text: "#FBBF24" },
  Listo:        { bg: "rgba(52,211,153,.1)",   border: "rgba(52,211,153,.3)",  text: "#34D399" },
  Entregado:    { bg: "rgba(100,116,139,.08)", border: "rgba(100,116,139,.2)", text: "#64748B" },
};
