import { DOCUMENT_STATUSES, DOCUMENT_STATUS_COLORS } from "./documents.js";

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

export const ESTADOS = DOCUMENT_STATUSES;
export const ESTADO_COLOR = DOCUMENT_STATUS_COLORS;
