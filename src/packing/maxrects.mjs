import { MaxRectsPacker } from "maxrects-packer";
import {
  DEFAULT_EDGE,
  DEFAULT_PADDING,
  buildPackingRequestFromLegacy,
  groupPiecesByKey,
  legacyNestingFromSolution,
} from "./contracts.mjs";

function packGroupOnSheet(pieces, sheet) {
  const edge = sheet.edge ?? DEFAULT_EDGE;
  const padding = sheet.padding ?? DEFAULT_PADDING;
  const usableWidth = sheet.width - edge * 2;
  const usableHeight = sheet.height - edge * 2;

  if (!pieces.length || usableWidth <= 0 || usableHeight <= 0) {
    return { fits: false, placements: [], omitted: [...pieces] };
  }

  const eligible = pieces.filter(piece => (
    (piece.width <= usableWidth + 0.005 && piece.height <= usableHeight + 0.005) ||
    (piece.canRotate && piece.height <= usableWidth + 0.005 && piece.width <= usableHeight + 0.005)
  ));

  if (!eligible.length) {
    return { fits: false, placements: [], omitted: [...pieces] };
  }

  const sorted = [...eligible].sort((left, right) => (right.width * right.height) - (left.width * left.height));
  const packer = new MaxRectsPacker(usableWidth, usableHeight, padding, {
    smart: false,
    pot: false,
    square: false,
    allowRotation: true,
    tag: false,
  });

  for (const piece of sorted) {
    packer.add(piece.width, piece.height, piece);
  }

  const bin = packer.bins[0];
  if (!bin) {
    return { fits: false, placements: [], omitted: [...pieces] };
  }

  const placements = bin.rects.map(rect => ({
    pieceId: rect.data.id,
    label: rect.data.label,
    color: rect.data.color,
    x: rect.x + edge,
    y: rect.y + edge,
    width: rect.rot ? rect.data.height : rect.data.width,
    height: rect.rot ? rect.data.width : rect.data.height,
    rotated: rect.rot || false,
    meta: rect.data.meta || {},
  }));

  return {
    fits: placements.length === pieces.length,
    placements,
    omitted: pieces.filter(piece => !placements.some(placement => placement.pieceId === piece.id)),
  };
}

/**
 * Simulate packing ALL pieces using ONLY a single sheet type repeatedly.
 * Returns { totalCost, sheetsNeeded } — used to find the globally cheapest single-type strategy.
 */
function simulateSingleType(pieces, sheet) {
  let remaining = [...pieces];
  let totalCost = 0;
  let sheetsNeeded = 0;
  const maxSheets = Math.max(10, pieces.length);

  while (remaining.length > 0 && sheetsNeeded < maxSheets) {
    const packed = packGroupOnSheet(remaining, sheet);
    if (!packed.placements.length) break; // nothing fits on this sheet type
    totalCost += sheet.cost || 0;
    sheetsNeeded++;
    const usedIds = new Set(packed.placements.map(p => p.pieceId));
    remaining = remaining.filter(p => !usedIds.has(p.id));
  }

  return {
    totalCost,
    sheetsNeeded,
    canFitAll: remaining.length === 0,
  };
}

function solveGroupPreview(groupPieces, sheetTypes, groupKey, binOffset = 0) {
  const sortedSheets = [...sheetTypes].sort((left, right) => {
    if (left.cost !== right.cost) return left.cost - right.cost;
    return (left.width * left.height) - (right.width * right.height);
  });

  // ── Strategy comparison ──────────────────────────────────────────────────
  // Before greedy, simulate using EACH sheet type exclusively for all pieces.
  // If a single-type strategy is cheaper, use that sheet type for ALL iterations.
  let forcedSheetType = null;

  if (sortedSheets.length > 1) {
    let bestSingleCost = Number.POSITIVE_INFINITY;
    let bestSingleSheet = null;

    for (const sheet of sortedSheets) {
      const sim = simulateSingleType(groupPieces, sheet);
      if (sim.canFitAll && sim.totalCost < bestSingleCost) {
        bestSingleCost = sim.totalCost;
        bestSingleSheet = sheet;
      }
    }

    // Now estimate greedy multi-type cost: run through all sheets greedily
    // (cheap simulation — just count sheets by cost-per-piece logic)
    if (bestSingleSheet) {
      let greedyEstimate = 0;
      let remaining = [...groupPieces];
      const maxIter = Math.max(10, groupPieces.length);
      let iter = 0;
      while (remaining.length > 0 && iter++ < maxIter) {
        let bestSheet = null;
        let bestPlacement = null;
        let bestCPP = Number.POSITIVE_INFINITY;
        for (const sheet of sortedSheets) {
          const packed = packGroupOnSheet(remaining, sheet);
          if (!packed.placements.length) continue;
          const cpp = (sheet.cost || 1) / packed.placements.length;
          if (cpp < bestCPP) { bestCPP = cpp; bestSheet = sheet; bestPlacement = packed; }
        }
        if (!bestSheet) break;
        greedyEstimate += bestSheet.cost || 0;
        const usedIds = new Set(bestPlacement.placements.map(p => p.pieceId));
        remaining = remaining.filter(p => !usedIds.has(p.id));
      }

      // If single-type strategy is cheaper than greedy, force that sheet type
      if (bestSingleCost < greedyEstimate) {
        forcedSheetType = bestSingleSheet;
      }
    }
  }

  // ── Greedy packing ───────────────────────────────────────────────────────
  let remaining = [...groupPieces];
  const bins = [];
  let guard = Math.max(10, groupPieces.length * Math.max(sortedSheets.length, 1));

  while (remaining.length > 0 && guard-- > 0) {
    let bestSheet = null;
    let bestPlacement = null;
    let bestCostPerPiece = Number.POSITIVE_INFINITY;

    const sheetsToEvaluate = forcedSheetType ? [forcedSheetType] : sortedSheets;

    for (const sheet of sheetsToEvaluate) {
      const packed = packGroupOnSheet(remaining, sheet);
      if (!packed.placements.length) continue;

      const sheetCost = sheet.cost || 1;
      const costPerPiece = sheetCost / packed.placements.length;

      if (!bestPlacement) {
        bestSheet = sheet;
        bestPlacement = packed;
        bestCostPerPiece = costPerPiece;
        continue;
      }

      const isBetter =
        costPerPiece < bestCostPerPiece - 0.001 ||
        (Math.abs(costPerPiece - bestCostPerPiece) <= 0.001 &&
          packed.placements.length > bestPlacement.placements.length) ||
        (Math.abs(costPerPiece - bestCostPerPiece) <= 0.001 &&
          packed.placements.length === bestPlacement.placements.length &&
          sheetCost < (bestSheet?.cost ?? Number.POSITIVE_INFINITY));

      if (isBetter) {
        bestSheet = sheet;
        bestPlacement = packed;
        bestCostPerPiece = costPerPiece;
      }
    }

    if (!bestSheet || !bestPlacement?.placements.length) break;

    const binIndex = binOffset + bins.length;
    bins.push({
      binId: `bin-${binIndex + 1}`,
      binIndex,
      groupKey,
      sheet: { ...bestSheet },
      placements: bestPlacement.placements.map(placement => ({
        ...placement,
        binId: `bin-${binIndex + 1}`,
        groupKey,
      })),
    });

    const usedIds = new Set(bestPlacement.placements.map(placement => placement.pieceId));
    remaining = remaining.filter(piece => !usedIds.has(piece.id));
  }

  return {
    bins,
    unplaced: remaining.map(piece => ({
      pieceId: piece.id,
      label: piece.label,
      color: piece.color,
      width: piece.width,
      height: piece.height,
      canRotate: piece.canRotate !== false,
      groupKey,
      meta: piece.meta || {},
    })),
  };
}

export function solvePackingPreview(request) {
  const groups = groupPiecesByKey(request?.pieces, request?.separateByGroup);
  const allBins = [];
  const allUnplaced = [];

  groups.forEach(({ groupKey, pieces }) => {
    const { bins, unplaced } = solveGroupPreview(pieces, request?.sheetTypes || [], groupKey, allBins.length);
    allBins.push(...bins);
    allUnplaced.push(...unplaced);
  });

  return {
    objective: request?.objective || "min_sheets_then_cost",
    source: "maxrects",
    status: allUnplaced.length ? "partial" : "preview",
    sheetsUsed: allBins.length,
    totalCost: allBins.reduce((sum, bin) => sum + (bin.sheet.cost || 0), 0),
    bins: allBins,
    placements: allBins.flatMap(bin => bin.placements),
    unplaced: allUnplaced,
  };
}

export function packOnSheet(pieces, sw, sh) {
  const request = buildPackingRequestFromLegacy(
    pieces,
    [{ id: "single-sheet", name: "Sheet", w: sw, h: sh, price: 0 }],
    { separateByGroup: false }
  );
  const solution = solvePackingPreview(request);
  const firstBin = solution.bins[0];
  if (!firstBin) return { fits: false, placed: [] };
  return {
    fits: !solution.unplaced.length && solution.bins.length === 1,
    placed: firstBin.placements.map(placement => ({
      _idx: placement.meta?._idx ?? placement.pieceId,
      label: placement.label,
      color: placement.color,
      x: placement.x,
      y: placement.y,
      w: placement.width,
      h: placement.height,
      rotated: placement.rotated,
    })),
  };
}

export function findBestSheets(allPieces, sheets, options = {}) {
  const request = buildPackingRequestFromLegacy(allPieces, sheets, options);
  return legacyNestingFromSolution(solvePackingPreview(request));
}

export const GAP_CONST = DEFAULT_PADDING;
export const EDGE_CONST = DEFAULT_EDGE;
