import { MaxRectsPacker } from "maxrects-packer";

const GAP = 0.25;
const EDGE = 0.15;

// ── MAXRECTS BIN PACKING ──
export function packOnSheet(pieces, sw, sh) {
  const uw = sw - EDGE * 2;
  const uh = sh - EDGE * 2;
  if (!pieces.length) return { fits: false, placed: [] };

  const eligible = pieces.filter(p =>
    (p.w <= uw + 0.005 && p.h <= uh + 0.005) ||
    (p.h <= uw + 0.005 && p.w <= uh + 0.005)
  );
  if (!eligible.length) return { fits: false, placed: [] };

  const sorted = [...eligible].sort((a, b) => b.w * b.h - a.w * a.h);

  const packer = new MaxRectsPacker(uw, uh, GAP, {
    smart: false, pot: false, square: false, allowRotation: true, tag: false,
  });

  for (const p of sorted) {
    packer.add(p.w, p.h, { _idx: p._idx, label: p.label, color: p.color, _origW: p.w, _origH: p.h });
  }

  const firstBin = packer.bins[0];
  if (!firstBin) return { fits: false, placed: [] };

  const placed = firstBin.rects.map(r => ({
    _idx: r.data._idx,
    label: r.data.label,
    color: r.data.color,
    x: r.x + EDGE,
    y: r.y + EDGE,
    w: r.rot ? r.data._origH : r.data._origW,
    h: r.rot ? r.data._origW : r.data._origH,
    rotated: r.rot || false,
  }));

  return { fits: placed.length === pieces.length, placed };
}

export function findBestSheets(allPieces, sheets) {
  if (!allPieces.length) return { results: [], totalCost: 0 };
  const sortedSheets = [...sheets].sort((a, b) => a.price - b.price);
  let rem = [...allPieces];
  const results = [];
  let safe = 100;

  while (rem.length > 0 && safe-- > 0) {
    let bestSheet = null;
    let bestPlaced = [];

    for (const sh of sortedSheets) {
      const pk = packOnSheet(rem, sh.w, sh.h);
      if (!pk.placed.length) continue;
      if (pk.fits) { bestSheet = sh; bestPlaced = pk.placed; break; }
      if (pk.placed.length > bestPlaced.length ||
         (pk.placed.length === bestPlaced.length && pk.placed.length > 0 && sh.price < (bestSheet?.price ?? Infinity))) {
        bestSheet = sh; bestPlaced = pk.placed;
      }
    }

    if (!bestSheet || !bestPlaced.length) break;
    results.push({ sheet: bestSheet, placed: bestPlaced });
    const usedIdx = new Set(bestPlaced.map(p => p._idx));
    rem = rem.filter(p => !usedIdx.has(p._idx));
  }

  return { results, totalCost: results.reduce((s, r) => s + r.sheet.price, 0) };
}

export const GAP_CONST = GAP;
export const EDGE_CONST = EDGE;
