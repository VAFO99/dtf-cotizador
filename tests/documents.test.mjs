import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateDocumentAdjustments,
  inferDocumentType,
  normalizeDocumentStatus,
} from "../src/documents.js";

test("normalizeDocumentStatus migrates legacy quote states", () => {
  assert.equal(normalizeDocumentStatus("Cotizado"), "Enviada");
  assert.equal(normalizeDocumentStatus("Aceptado"), "Aprobada");
  assert.equal(normalizeDocumentStatus("Facturada"), "Facturada");
});

test("calculateDocumentAdjustments applies fixed discount and extra charges", () => {
  const result = calculateDocumentAdjustments(1000, {
    discountMode: "fixed",
    discountValue: 125,
    extraCharges: [
      { label: "Vectorización", amount: 50 },
      { label: "Urgente", amount: 25 },
    ],
  });

  assert.equal(result.manualDiscount, 125);
  assert.equal(result.extraChargesTotal, 75);
  assert.equal(inferDocumentType(null, "En proceso"), "factura");
});
