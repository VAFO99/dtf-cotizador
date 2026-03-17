export const DEFAULT_PADDING = 0.25;
export const DEFAULT_EDGE = 0.15;
export const DEFAULT_TIMEOUT_MS = 3500;
export const PACKING_OBJECTIVE = "min_sheets_then_cost";

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanText = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

export function buildPackingRequest({
  pieces,
  sheetTypes,
  separateByGroup = false,
  objective = PACKING_OBJECTIVE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  defaultPadding = DEFAULT_PADDING,
  defaultEdge = DEFAULT_EDGE,
} = {}) {
  const normalizedPieces = (pieces || [])
    .map((piece, index) => {
      const width = numberOr(piece.width, numberOr(piece.w, 0));
      const height = numberOr(piece.height, numberOr(piece.h, 0));
      if (!(width > 0 && height > 0)) return null;
      return {
        id: cleanText(piece.id, `piece-${index + 1}`),
        width,
        height,
        canRotate: piece.canRotate !== false,
        label: cleanText(piece.label, `Pieza ${index + 1}`),
        color: cleanText(piece.color, "#888888"),
        groupKey: separateByGroup ? cleanText(piece.groupKey, "default") : null,
        meta: piece.meta && typeof piece.meta === "object" ? piece.meta : {},
      };
    })
    .filter(Boolean);

  const normalizedSheetTypes = (sheetTypes || [])
    .map((sheet, index) => {
      const width = numberOr(sheet.width, numberOr(sheet.w, 0));
      const height = numberOr(sheet.height, numberOr(sheet.h, 0));
      if (!(width > 0 && height > 0)) return null;
      return {
        id: cleanText(sheet.id, `sheet-${index + 1}`),
        name: cleanText(sheet.name, `Hoja ${index + 1}`),
        width,
        height,
        cost: numberOr(sheet.cost, numberOr(sheet.price, 0)),
        padding: numberOr(sheet.padding, defaultPadding),
        edge: numberOr(sheet.edge, defaultEdge),
      };
    })
    .filter(Boolean);

  return {
    objective,
    separateByGroup,
    timeoutMs: Math.max(500, Math.round(numberOr(timeoutMs, DEFAULT_TIMEOUT_MS))),
    pieces: normalizedPieces,
    sheetTypes: normalizedSheetTypes,
  };
}

export function buildPackingRequestFromLegacy(pieces, sheets, options = {}) {
  const separateByGroup = options.separateByGroup === true;
  return buildPackingRequest({
    pieces: (pieces || []).map((piece, index) => ({
      id: piece._idx !== undefined ? `piece-${piece._idx}` : cleanText(piece.id, `piece-${index + 1}`),
      width: piece.w,
      height: piece.h,
      canRotate: piece.canRotate !== false,
      label: piece.label,
      color: piece.color,
      groupKey: separateByGroup
        ? cleanText(piece.groupKey, `${cleanText(piece.prendaColor, "sin-color")}|${cleanText(piece.prendaLabel, "?")}`)
        : null,
      meta: {
        _idx: piece._idx ?? index,
        label: cleanText(piece.label, `Pieza ${index + 1}`),
        color: cleanText(piece.color, "#888888"),
        prendaColor: cleanText(piece.prendaColor, ""),
        prendaLabel: cleanText(piece.prendaLabel, ""),
      },
    })),
    sheetTypes: (sheets || []).map(sheet => ({
      id: sheet.id,
      name: sheet.name,
      width: sheet.w,
      height: sheet.h,
      cost: sheet.price,
      padding: sheet.padding,
      edge: sheet.edge,
    })),
    separateByGroup,
    objective: options.objective,
    timeoutMs: options.timeoutMs,
    defaultPadding: options.defaultPadding,
    defaultEdge: options.defaultEdge,
  });
}

export function stablePackingRequestKey(request) {
  return JSON.stringify(request || null);
}

export function groupPiecesByKey(pieces, separateByGroup = false) {
  if (!separateByGroup) return [{ groupKey: null, pieces: [...(pieces || [])] }];
  const groups = new Map();
  for (const piece of pieces || []) {
    const key = cleanText(piece.groupKey, "default");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(piece);
  }
  return [...groups.entries()].map(([groupKey, groupedPieces]) => ({ groupKey, pieces: groupedPieces }));
}

export function legacyNestingFromSolution(solution) {
  const bins = solution?.bins || [];
  return {
    results: bins.map(bin => ({
      sheet: {
        id: bin.sheet.id,
        name: bin.sheet.name,
        w: numberOr(bin.sheet.width, 0),
        h: numberOr(bin.sheet.height, 0),
        price: numberOr(bin.sheet.cost, 0),
        padding: numberOr(bin.sheet.padding, DEFAULT_PADDING),
        edge: numberOr(bin.sheet.edge, DEFAULT_EDGE),
      },
      placed: (bin.placements || []).map(placement => ({
        _idx: placement.meta?._idx ?? placement.pieceId,
        label: cleanText(placement.label, placement.meta?.label || placement.pieceId),
        color: cleanText(placement.color, placement.meta?.color || "#888888"),
        x: numberOr(placement.x, 0),
        y: numberOr(placement.y, 0),
        w: numberOr(placement.width, 0),
        h: numberOr(placement.height, 0),
        rotated: placement.rotated === true,
      })),
      groupKey: bin.groupKey ?? null,
    })),
    totalCost: numberOr(solution?.totalCost, 0),
    source: cleanText(solution?.source, "maxrects"),
    status: cleanText(solution?.status, "preview"),
    sheetsUsed: numberOr(solution?.sheetsUsed, bins.length),
    unplaced: [...(solution?.unplaced || [])],
    error: solution?.error || null,
  };
}

export function formatPackingMode(solution, loading = false) {
  if (loading) return "Optimizando exacto…";
  if (!solution) return "Sin resolver";
  if (solution.source === "cp_sat" && solution.status === "optimal") return "Óptimo exacto";
  if (solution.source === "cp_sat" && (solution.status === "timeout" || solution.status === "partial")) return "Exacto parcial";
  if (solution.source === "maxrects" && solution.status === "fallback") return "Preview local";
  if (solution.source === "maxrects" && solution.status === "partial") return "Preview parcial";
  if (solution.source === "maxrects") return "Preview rápido";
  return "Resuelto";
}
