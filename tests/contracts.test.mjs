import test from "node:test";
import assert from "node:assert/strict";
import { groupPiecesByKey } from "../src/packing/contracts.mjs";

test("groupPiecesByKey: separateByGroup=false returns a single group with all pieces", () => {
  const pieces = [{ id: "p1" }, { id: "p2" }];
  const result = groupPiecesByKey(pieces, false);

  assert.equal(result.length, 1);
  assert.equal(result[0].groupKey, null);
  assert.deepEqual(result[0].pieces, pieces);
  // Ensure it's a new array
  assert.notEqual(result[0].pieces, pieces);
});

test("groupPiecesByKey: separateByGroup=true groups pieces by groupKey", () => {
  const pieces = [
    { id: "p1", groupKey: "A" },
    { id: "p2", groupKey: "B" },
    { id: "p3", groupKey: "A" },
    { id: "p4" }, // Should use default
  ];
  const result = groupPiecesByKey(pieces, true);

  assert.equal(result.length, 3);

  const groupA = result.find(g => g.groupKey === "A");
  const groupB = result.find(g => g.groupKey === "B");
  const groupDefault = result.find(g => g.groupKey === "default");

  assert.equal(groupA.pieces.length, 2);
  assert.ok(groupA.pieces.some(p => p.id === "p1"));
  assert.ok(groupA.pieces.some(p => p.id === "p3"));

  assert.equal(groupB.pieces.length, 1);
  assert.equal(groupB.pieces[0].id, "p2");

  assert.equal(groupDefault.pieces.length, 1);
  assert.equal(groupDefault.pieces[0].id, "p4");
});

test("groupPiecesByKey: handles null or undefined pieces array", () => {
  assert.deepEqual(groupPiecesByKey(null, false), [{ groupKey: null, pieces: [] }]);
  assert.deepEqual(groupPiecesByKey(undefined, false), [{ groupKey: null, pieces: [] }]);
  assert.deepEqual(groupPiecesByKey(null, true), []);
  assert.deepEqual(groupPiecesByKey(undefined, true), []);
});

test("groupPiecesByKey: handles null/undefined elements in pieces array", () => {
  const pieces = [{ id: "p1", groupKey: "A" }, null, undefined, { id: "p2", groupKey: "A" }];

  // Test separateByGroup = false
  const resultFalse = groupPiecesByKey(pieces, false);
  assert.equal(resultFalse[0].pieces.length, 4);
  assert.deepEqual(resultFalse[0].pieces, pieces);

  // Test separateByGroup = true
  const resultTrue = groupPiecesByKey(pieces, true);
  assert.equal(resultTrue.length, 1);
  assert.equal(resultTrue[0].groupKey, "A");
  assert.equal(resultTrue[0].pieces.length, 2);
});
