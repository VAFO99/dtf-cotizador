import { legacyNestingFromSolution } from "./contracts.mjs";
import { solvePackingPreview } from "./maxrects.mjs";

const DEFAULT_ENDPOINT = (typeof import.meta !== "undefined" && import.meta.env?.VITE_PACKING_SOLVER_URL)
  || "/api/packing/solve";

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeServerSolution(payload, request, fallbackSolution) {
  if (!payload || !Array.isArray(payload.bins)) {
    return {
      ...fallbackSolution,
      status: "fallback",
      source: "maxrects",
      error: "La respuesta del solver exacto no fue válida.",
    };
  }

  const normalized = {
    objective: payload.objective || request.objective,
    source: payload.source || "cp_sat",
    status: payload.status || "optimal",
    sheetsUsed: numberOr(payload.sheetsUsed, payload.bins.length),
    totalCost: numberOr(payload.totalCost, 0),
    bins: payload.bins.map((bin, index) => ({
      binId: bin.binId || `bin-${index + 1}`,
      binIndex: numberOr(bin.binIndex, index),
      groupKey: bin.groupKey ?? null,
      sheet: {
        id: bin.sheet?.id || `sheet-${index + 1}`,
        name: bin.sheet?.name || "Hoja",
        width: numberOr(bin.sheet?.width, 0),
        height: numberOr(bin.sheet?.height, 0),
        cost: numberOr(bin.sheet?.cost, 0),
        padding: numberOr(bin.sheet?.padding, 0.25),
        edge: numberOr(bin.sheet?.edge, 0.15),
      },
      placements: (bin.placements || []).map(placement => ({
        pieceId: placement.pieceId,
        label: placement.label,
        color: placement.color,
        x: numberOr(placement.x, 0),
        y: numberOr(placement.y, 0),
        width: numberOr(placement.width, 0),
        height: numberOr(placement.height, 0),
        rotated: placement.rotated === true,
        meta: placement.meta && typeof placement.meta === "object" ? placement.meta : {},
        binId: bin.binId || `bin-${index + 1}`,
        groupKey: bin.groupKey ?? null,
      })),
    })),
    unplaced: (payload.unplaced || []).map(piece => ({
      pieceId: piece.pieceId || piece.id,
      label: piece.label || "",
      color: piece.color || "#888888",
      width: numberOr(piece.width, 0),
      height: numberOr(piece.height, 0),
      canRotate: piece.canRotate !== false,
      groupKey: piece.groupKey ?? null,
      meta: piece.meta && typeof piece.meta === "object" ? piece.meta : {},
    })),
    error: payload.error || null,
  };

  return {
    ...normalized,
    placements: normalized.bins.flatMap(bin => bin.placements),
  };
}

export function getPackingEndpoint() {
  return DEFAULT_ENDPOINT;
}

export async function solvePackingRequest(request, { endpoint = getPackingEndpoint(), signal } = {}) {
  const fallbackSolution = solvePackingPreview(request);
  if (!request?.pieces?.length || !request?.sheetTypes?.length) return fallbackSolution;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Solver exacto respondió ${response.status}`);
    }

    const payload = await response.json();
    return normalizeServerSolution(payload, request, fallbackSolution);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ...fallbackSolution,
      status: "fallback",
      source: "maxrects",
      error: error?.message || "No se pudo consultar el solver exacto.",
    };
  }
}

export function solveLegacyPackingExact(request) {
  return solvePackingRequest(request).then(legacyNestingFromSolution);
}
