# Feature Gap Analysis — References vs Target MVP

Legend: ✅ in MVP · 🔜 roadmap (P#) · ❌ out of scope

## A. Core ERP
| Feature | ERPNext | Laserp | GSTBill | Target MVP |
|---|---|---|---|---|
| Company setup (GSTIN, state, bank) | ✅ | ✅ | ✅ | ✅ setup wizard |
| Multi-company / tenants | ✅ | ✅ | P | ❌ (P3) |
| Users / roles / permissions | ✅ | ✅ | ❌ | ❌ (P0 roadmap — laserp session pattern) |
| Financial year handling | ✅ | ✅ (FY numbering) | ✅ | ✅ numbering only (P2: FY close) |
| Audit trail | ✅ | ✅ AuditLog | P | ✅ ledger reversal trail (P2: dedicated log) |
| Notifications | ✅ | ✅ socket.io | ❌ | 🔜 P3 |

## B. Masters
| Party (cust/sup/jobworker) | ✅ | ✅ | ✅ clients | ✅ |
| Item (HSN, UOM, GST) | ✅ | ✅ | ✅ products | ✅ |
| Warehouse | ✅ | ✅ | ❌ | ✅ |
| Process + party rates | subcontractor doctype | ❌ | ❌ | ✅ |
| GSTIN checksum | regional | ❌ | ✅ | ✅ |
| Item import (CSV) | ✅ | ✅ | ✅ | 🔜 P3 |

## C. Sales / Purchase
| Quotation / order chain | ✅ | ✅ | ✅ quotes | 🔜 P2 (invoice-first MVP) |
| Invoice with GST (incl/excl) | ✅ | ✅ excl-only | ✅ | ✅ both modes |
| Credit/debit notes | ✅ | ❌ (dead enum!) | ✅ | 🔜 P2 |
| Delivery challan | ✅ | ✅ | ✅ | 🔜 P2 |
| Payments + allocation | ✅ | ✅ | ✅ | ✅ |
| Outstanding/aging | ✅ | ✅ | ✅ | ✅ basic (aging P2) |
| Print compliance | ✅ | ✅ | ✅ (best) | ✅ |
| e-invoice / e-way | ✅ regional | mock | manual IRN | 🔜 P3 |

## D. Inventory
| Stock ledger append-only | ✅ | ✅ | deltas | ✅ |
| Negative stock guard | ✅ | ✅ | ❌ | ✅ |
| Valuation | FIFO+MA | MA | purchase price | ✅ WA-cost |
| Batch/serial | ✅ | ❌ | ❌ | 🔜 P3 |
| Transfers/adjustments | ✅ | ✅ | ❌ | ✅ opening+cancel reversal; transfer UI P2 |
| Reorder alerts | ✅ | ✅ | ✅ | ✅ dashboard low-stock |

## E. Manufacturing / Jobwork
| BOM | ✅ | ✅ | lite | 🔜 P2 |
| Work order / production | ✅ | ✅ | lite | 🔜 P2 |
| **Jobwork inward (multi-item)** | diff (subcontract) | ❌ | ❌ | ✅ |
| **Job card partial processing (qty+weight)** | P | ❌ | ❌ | ✅ |
| **Process-wise rates (KG/piece, party)** | ❌ | ❌ | ❌ | ✅ |
| **Same-process aggregation** | ❌ | ❌ | ❌ | ✅ |
| **Certificate** | ❌ | ❌ | ❌ | ✅ |
| **Jobwork → invoice (SAC 998887)** | ❌ | ❌ | ❌ | ✅ |
| **Pending process report** | ❌ | ❌ | ❌ | ✅ |
| MRP | ✅ | ✅ | ❌ | 🔜 P3 |
| QC | ✅ | ✅ | ❌ | 🔜 P3 |

## F. Accounting
| Double-entry GL | ✅ | **❌** | ❌ | ✅ |
| Trial balance | ✅ | ❌ | ❌ | ✅ |
| P&L / balance sheet | ✅ | P (profitability rpt) | P | ✅ P&L (BS P2) |
| Tax ledgers (GST output/input) | ✅ | ❌ | P | ✅ |
| Journal entries (manual) | ✅ | ❌ | ❌ | 🔜 P2 |

## G. GST compliance
| Inclusive/exclusive | ✅ | ❌ | ✅ | ✅ |
| PoS-driven split | ✅ regional | P | ✅ | ✅ |
| UTGST | ✅ regional | ❌ | ✅ | ✅ (as SGST bucket) |
| RCM | ✅ regional | ❌ | ✅ | 🔜 P2 |
| TDS/TCS | ✅ regional | ❌ | ✅ | ❌ P3 |
| GSTR-1 rate-wise summary | ✅ | P | ✅ JSON | ✅ summary (JSON P2) |
| GSTR-3B | ✅ | ❌ | ✅ | 🔜 P2 |
| LUT/export | ✅ | ❌ | ✅ | ❌ P3 |

## Net position
MVP delivers a **complete purchase→stock→sales→payment loop with real double-entry accounting** (stronger than laserp) and the **full jobwork chain** (absent in all three accessible references), with GST logic ported from the best-tested reference. Missing vs ERPNext: auth, BOM/WO, MRP/QC, batch/serial, regional compliance depth — all scheduled in the roadmap.
