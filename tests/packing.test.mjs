import test from "node:test";
import assert from "node:assert/strict";

import { buildPackingRequestFromLegacy, legacyNestingFromSolution } from "../src/packing/contracts.mjs";
import { solvePackingPreview } from "../src/packing/maxrects.mjs";

test("buildPackingRequestFromLegacy preserves groupKey when grouping is enabled", () => {
  const request = buildPackingRequestFromLegacy(
    [{ _idx: 1, w: 2, h: 3, label: "Front", color: "#fff", prendaColor: "Negro", prendaLabel: "Camisa" }],
    [{ id: "a4", name: "A4", w: 8, h: 10, price: 45 }],
    { separateByGroup: true }
  );

  assert.equal(request.separateByGroup, true);
  assert.equal(request.pieces[0].groupKey, "Negro|Camisa");
});

test("solvePackingPreview rotates pieces to reduce sheet count", () => {
  const request = buildPackingRequestFromLegacy(
    [
      { _idx: 1, w: 4, h: 3, label: "A", color: "#f00" },
      { _idx: 2, w: 4, h: 3, label: "B", color: "#0f0" },
    ],
    [{ id: "sheet", name: "6.55x4.3", w: 6.55, h: 4.3, price: 10 }],
    { separateByGroup: false }
  );

  const solution = solvePackingPreview(request);
  const nesting = legacyNestingFromSolution(solution);

  assert.equal(solution.sheetsUsed, 1);
  assert.equal(nesting.results.length, 1);
  assert.equal(nesting.results[0].placed.length, 2);
  assert.ok(nesting.results[0].placed.every(piece => piece.rotated));
});

test("solvePackingPreview leaves oversize pieces as unplaced", () => {
  const request = buildPackingRequestFromLegacy(
    [{ _idx: 1, w: 30, h: 30, label: "Too big", color: "#00f" }],
    [{ id: "sheet", name: "A4", w: 8, h: 10, price: 10 }],
    { separateByGroup: false }
  );

  const solution = solvePackingPreview(request);

  assert.equal(solution.sheetsUsed, 0);
  assert.equal(solution.unplaced.length, 1);
  assert.equal(solution.unplaced[0].pieceId, "piece-1");
});
