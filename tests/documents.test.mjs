import test from "node:test";
import assert from "node:assert/strict";

import {
  canSendQuote,
  calculateDocumentAdjustments,
  getAllowedManualStatuses,
  inferDocumentType,
  isSendApproved,
  normalizeSendApprovedAt,
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

test("normalizeSendApprovedAt normalizes empty values", () => {
  assert.equal(normalizeSendApprovedAt(""), null);
  assert.equal(normalizeSendApprovedAt("   "), null);
  assert.equal(normalizeSendApprovedAt("2026-03-20T10:00:00.000Z"), "2026-03-20T10:00:00.000Z");
});

test("isSendApproved returns true only when approval timestamp exists", () => {
  assert.equal(isSendApproved({ sendApprovedAt: null }), false);
  assert.equal(isSendApproved({ sendApprovedAt: "2026-03-20T10:00:00.000Z" }), true);
});

test("canSendQuote requires approval and phone", () => {
  const approvedMeta = { sendApprovedAt: "2026-03-20T10:00:00.000Z" };

  assert.equal(canSendQuote({
    docType: "cotizacion",
    status: "Borrador",
    meta: approvedMeta,
    telefono: "50499998888",
  }), true);

  assert.equal(canSendQuote({
    docType: "cotizacion",
    status: "Borrador",
    meta: approvedMeta,
    telefono: "",
  }), false);

  assert.equal(canSendQuote({
    docType: "cotizacion",
    status: "Borrador",
    meta: { sendApprovedAt: null },
    telefono: "50499998888",
  }), false);
});

test("getAllowedManualStatuses blocks Enviada until internal approval", () => {
  const withoutApproval = getAllowedManualStatuses("Borrador", { sendApprovedAt: null });
  const withApproval = getAllowedManualStatuses("Borrador", { sendApprovedAt: "2026-03-20T10:00:00.000Z" });

  assert.equal(withoutApproval.includes("Enviada"), false);
  assert.equal(withApproval.includes("Enviada"), true);
});
