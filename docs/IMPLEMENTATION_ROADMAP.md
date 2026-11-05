# Implementation Roadmap — P0 … P4

## P0 — Critical (implemented in this session)
1. **Atomic posting engine** — every voucher writes invoice + stock ledger + GL in one transaction (data integrity).
2. **Double-entry GL + trial-balance integrity check** — financial correctness proof.
3. **GST engine** — inclusive/exclusive, PoS-driven CGST/SGST/IGST, round-off; single shared engine (UI + server).
4. **Jobwork chain** — Inward → Job Card (partial, process-wise, party rates) → Certificate → Invoice (user's core workflow).
5. **Cancel = reversal** everywhere; paid invoices not cancellable; gapless-forward numbering.
6. **Negative-stock + over-processing guards** (server-side, client input untrusted).

## P1 — Critical next
1. **Auth + RBAC** (laserp pattern: scrypt, DB sessions, HMAC cookie, middleware, requireWrite per module) — currently single-user.
2. Postgres + Decimal migration (Float paise precision risk at scale).
3. Sales/purchase returns (credit/debit notes) with stock return + GL.
4. Manual journal entries.
5. Backup/restore (SQLite file snapshot endpoint).
6. Dedicated audit log table (actor, action, before/after).

## P2 — Important
1. Quotation → Sales Order → Delivery Challan → Invoice chain.
2. PR → PO → GRN(QC) → Purchase Invoice chain (laserp's strongest workflow).
3. BOM + Work Order + Material Issue + Production Entry (with ERPNext over-production % and server-derived BOM requirements).
4. GSTR-1 JSON export (portal buckets), GSTR-3B summary, e-invoice JSON.
5. Aging buckets in outstanding; party statement print.
6. Stock transfer UI; bin-cache for large ledgers; FY closing.
7. Balance sheet.

## P3 — Productivity / advanced
1. CSV import for items/parties; Excel export.
2. MRP explosion (laserp pure-function pattern) + QC inspections.
3. Notifications (socket.io mini-service) + email PDF (pdfkit).
4. Command palette + keyboard shortcuts (laserp registry pattern).
5. Batch/serial tracking.
6. Multi-company.

## P4 — Optional
1. TDS/TCS engine (gst-billing marginal-threshold pattern), RCM full mode, LUT exports.
2. Recurring invoices, cost centres, FX invoicing.
3. Offline/PWA packaging.
