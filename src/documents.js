const DOCUMENT_TYPE_SET = new Set(["cotizacion", "factura"]);

export const DOCUMENT_TYPES = ["cotizacion", "factura"];
export const DOCUMENT_TYPE_LABEL = {
  cotizacion: "Cotización",
  factura: "Factura",
};

export const DOCUMENT_STATUSES = [
  "Pendiente",
  "Borrador",
  "Enviada",
  "Aprobada",
  "Facturada",
  "En proceso",
  "Listo",
  "Entregado",
  "Cancelada",
];

export const DOCUMENT_STATUS_COLORS = {
  Pendiente: { bg: "rgba(251,191,36,.12)", border: "rgba(251,191,36,.4)", text: "#FBBF24" },
  Borrador: { bg: "rgba(148,163,184,.12)", border: "rgba(148,163,184,.3)", text: "#94A3B8" },
  Enviada: { bg: "rgba(34,211,238,.1)", border: "rgba(34,211,238,.3)", text: "#22D3EE" },
  Aprobada: { bg: "rgba(52,211,153,.1)", border: "rgba(52,211,153,.3)", text: "#34D399" },
  Facturada: { bg: "rgba(96,165,250,.1)", border: "rgba(96,165,250,.3)", text: "#60A5FA" },
  "En proceso": { bg: "rgba(251,191,36,.1)", border: "rgba(251,191,36,.3)", text: "#FBBF24" },
  Listo: { bg: "rgba(16,185,129,.1)", border: "rgba(16,185,129,.3)", text: "#10B981" },
  Entregado: { bg: "rgba(100,116,139,.08)", border: "rgba(100,116,139,.2)", text: "#64748B" },
  Cancelada: { bg: "rgba(248,113,113,.1)", border: "rgba(248,113,113,.3)", text: "#F87171" },
};

const SEND_BLOCKED_STATUSES = new Set(["Enviada", "Cancelada"]);

const LEGACY_STATUS_MAP = {
  Cotizado: "Enviada",
  Aceptado: "Aprobada",
};

const STATUS_FLOW = {
  Pendiente: ["Borrador", "Enviada", "Cancelada"],
  Borrador: ["Enviada", "Cancelada"],
  Enviada: ["Aprobada", "Borrador", "Cancelada"],
  Aprobada: ["Facturada", "Cancelada"],
  Facturada: ["En proceso", "Listo", "Entregado"],
  "En proceso": ["Listo", "Entregado"],
  Listo: ["Entregado"],
  Entregado: [],
  Cancelada: [],
};

export function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatMoney(value) {
  const amount = roundCurrency(value);
  const hasDecimals = Math.abs(amount % 1) > 0.001;
  return amount.toLocaleString("es-HN", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function normalizeDocumentStatus(status) {
  const mapped = LEGACY_STATUS_MAP[status] ?? status;
  return DOCUMENT_STATUSES.includes(mapped) ? mapped : "Borrador";
}

export function normalizeSendApprovedAt(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export function inferDocumentType(docType, status) {
  if (DOCUMENT_TYPE_SET.has(docType)) return docType;
  const normalized = normalizeDocumentStatus(status);
  return ["Facturada", "En proceso", "Listo", "Entregado"].includes(normalized)
    ? "factura"
    : "cotizacion";
}

export function isSendApproved(meta) {
  return Boolean(normalizeSendApprovedAt(meta?.sendApprovedAt));
}

export function canSendQuote({ docType, status, meta, telefono }) {
  const normalizedStatus = normalizeDocumentStatus(status);
  const normalizedType = inferDocumentType(docType, normalizedStatus);
  const normalizedPhone = String(telefono ?? "").trim();

  if (normalizedType !== "cotizacion") return false;
  if (SEND_BLOCKED_STATUSES.has(normalizedStatus)) return false;
  if (!isSendApproved(meta)) return false;
  return normalizedPhone.length > 0;
}

export function getAllowedManualStatuses(status, meta) {
  const currentStatus = normalizeDocumentStatus(status);
  return DOCUMENT_STATUSES.filter(candidate => {
    if (candidate !== "Enviada") return true;
    return currentStatus === "Enviada" || isSendApproved(meta);
  });
}

export function createEmptyCharge(label = "Cargo adicional") {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    label,
    amount: 0,
  };
}

export function normalizeDocumentAdjustments(adjustments = {}) {
  const discountMode = adjustments.discountMode === "fixed" ? "fixed" : "percent";
  const discountValue = roundCurrency(adjustments.discountValue);
  const extraCharges = Array.isArray(adjustments.extraCharges)
    ? adjustments.extraCharges
        .map(charge => ({
          id: charge?.id || createEmptyCharge().id,
          label: String(charge?.label || "Cargo adicional").trim() || "Cargo adicional",
          amount: roundCurrency(charge?.amount),
        }))
        .filter(charge => charge.label || charge.amount)
    : [];

  return {
    discountMode,
    discountValue: Math.max(0, discountValue),
    extraCharges,
  };
}

export function calculateDocumentAdjustments(baseTotal, adjustments = {}) {
  const normalized = normalizeDocumentAdjustments(adjustments);
  const safeBase = Math.max(0, roundCurrency(baseTotal));
  const manualDiscountRaw = normalized.discountMode === "fixed"
    ? normalized.discountValue
    : safeBase * (normalized.discountValue / 100);
  const manualDiscount = roundCurrency(Math.min(safeBase, Math.max(0, manualDiscountRaw)));
  const extraChargesTotal = roundCurrency(
    normalized.extraCharges.reduce((sum, charge) => sum + Math.max(0, roundCurrency(charge.amount)), 0)
  );

  return {
    adjustments: normalized,
    manualDiscount,
    extraChargesTotal,
  };
}

export function readDocumentPayload(rawLines) {
  if (!rawLines || Array.isArray(rawLines)) {
    return {
      version: 1,
      items: Array.isArray(rawLines) ? rawLines : [],
      meta: {},
    };
  }

  if (typeof rawLines === "object") {
    return {
      version: rawLines.version || 2,
      items: Array.isArray(rawLines.items) ? rawLines.items : [],
      meta: rawLines.meta && typeof rawLines.meta === "object" ? rawLines.meta : {},
    };
  }

  return {
    version: 1,
    items: [],
    meta: {},
  };
}

export function extractDocumentItems(rawLines) {
  return readDocumentPayload(rawLines).items;
}

export function createDocumentPayload(items, meta = {}) {
  return {
    version: 2,
    items,
    meta,
  };
}

export function getDocumentNextStatuses(status) {
  return STATUS_FLOW[normalizeDocumentStatus(status)] || [];
}
